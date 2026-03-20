"""
Naver Works SMTP 이메일 발송기
- HTML 브리핑 이메일 발송
- 실패 시 재시도 1회
- 실패 알림: 슬랙 웹훅
"""

import os
import logging
import time
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
import requests

logger = logging.getLogger(__name__)

EMAIL_HOST = os.environ.get("EMAIL_HOST", "smtp.worksmobile.com")
EMAIL_PORT = int(os.environ.get("EMAIL_PORT", "465"))
EMAIL_USER = os.environ.get("EMAIL_USER", "")
EMAIL_PASSWORD = os.environ.get("EMAIL_PASSWORD", "")
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")

FROM_EMAIL = EMAIL_USER
FROM_NAME = "옵티버스 데일리 브리핑"


def _send_once(to_email: str, subject: str, html_content: str) -> bool:
    """SMTP SSL로 이메일 1회 발송. 성공 시 True 반환."""
    if not EMAIL_USER or not EMAIL_PASSWORD:
        raise ValueError("EMAIL_USER 또는 EMAIL_PASSWORD 환경변수가 설정되지 않았습니다.")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = f"{FROM_NAME} <{FROM_EMAIL}>"
    msg["To"] = to_email
    msg.attach(MIMEText(html_content, "html", "utf-8"))

    with smtplib.SMTP_SSL(EMAIL_HOST, EMAIL_PORT) as server:
        server.login(EMAIL_USER, EMAIL_PASSWORD)
        server.sendmail(FROM_EMAIL, to_email, msg.as_string())

    logger.info(f"이메일 발송 성공: {to_email}")
    return True


def send_briefing(client: dict, html_content: str) -> bool:
    """
    고객사 브리핑 이메일 발송.
    실패 시 30초 후 재시도 1회.
    """
    to_email = client.get("notify_email", "")
    if not to_email:
        logger.error(f"[{client['name']}] notify_email 미설정")
        return False

    from datetime import datetime
    today = datetime.now().strftime("%Y년 %m월 %d일")
    subject = f"[옵티버스] {client['name']} 데일리 브리핑 - {today}"

    # 1차 시도
    try:
        if _send_once(to_email, subject, html_content):
            return True
    except Exception as e:
        logger.warning(f"[{client['name']}] 1차 발송 실패: {e}")

    # 재시도 (30초 대기)
    logger.info(f"[{client['name']}] 30초 후 재시도...")
    time.sleep(30)

    try:
        if _send_once(to_email, subject, html_content):
            return True
    except Exception as e:
        logger.error(f"[{client['name']}] 2차 발송도 실패: {e}")

    # 최종 실패 → 슬랙 알림
    _notify_slack_failure(client, to_email)
    return False


def _notify_slack_failure(client: dict, to_email: str) -> None:
    """슬랙 웹훅으로 발송 실패 알림"""
    if not SLACK_WEBHOOK_URL:
        logger.warning("SLACK_WEBHOOK_URL 미설정 → 슬랙 알림 생략")
        return

    from datetime import datetime
    message = {
        "text": (
            f":warning: *옵티버스 브리핑 발송 실패*\n"
            f"• 고객사: {client['name']}\n"
            f"• 수신 이메일: {to_email}\n"
            f"• 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"
            f"• 조치: 수동 재발송 필요"
        )
    }

    try:
        requests.post(SLACK_WEBHOOK_URL, json=message, timeout=10)
    except Exception as e:
        logger.error(f"슬랙 알림 실패: {e}")


def notify_pipeline_failure(error_message: str, client_name: str = "") -> None:
    """파이프라인 전체 오류 슬랙 알림"""
    if not SLACK_WEBHOOK_URL:
        return

    from datetime import datetime
    text = (
        f":red_circle: *옵티버스 브리핑 파이프라인 오류*\n"
        f"• 고객사: {client_name or '전체'}\n"
        f"• 오류: {error_message[:500]}\n"
        f"• 시각: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
    )

    try:
        requests.post(SLACK_WEBHOOK_URL, json={"text": text}, timeout=10)
    except Exception as e:
        logger.error(f"슬랙 파이프라인 오류 알림 실패: {e}")
