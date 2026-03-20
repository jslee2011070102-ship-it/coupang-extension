"""
SendGrid 이메일 발송기
- HTML 브리핑 이메일 발송
- 실패 시 재시도 1회
- 실패 알림: 슬랙 웹훅
"""

import os
import logging
import time
import requests
from sendgrid import SendGridAPIClient
from sendgrid.helpers.mail import Mail, To, From

logger = logging.getLogger(__name__)

SENDGRID_API_KEY = os.environ.get("SENDGRID_API_KEY", "")
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL", "")

FROM_EMAIL = "briefing@optiverse.co.kr"
FROM_NAME = "옵티버스 데일리 브리핑"


def _send_once(to_email: str, subject: str, html_content: str) -> bool:
    """SendGrid API로 이메일 1회 발송. 성공 시 True 반환."""
    if not SENDGRID_API_KEY:
        raise ValueError("SENDGRID_API_KEY 환경변수가 설정되지 않았습니다.")

    message = Mail(
        from_email=From(FROM_EMAIL, FROM_NAME),
        to_emails=To(to_email),
        subject=subject,
        html_content=html_content,
    )

    sg = SendGridAPIClient(api_key=SENDGRID_API_KEY)
    response = sg.send(message)

    if response.status_code in (200, 202):
        logger.info(f"이메일 발송 성공: {to_email} (status: {response.status_code})")
        return True
    else:
        logger.error(f"이메일 발송 실패: {to_email} (status: {response.status_code})")
        return False


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
