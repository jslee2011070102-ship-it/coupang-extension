/**
 * background.js (Service Worker)
 * 역할: 확장 아이콘 클릭 시 사이드 패널을 열거나 닫는다.
 *       사이드 패널은 탭 이동/페이지 새로고침에도 유지된다.
 */

// 아이콘 클릭 → 사이드 패널 토글
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// 사이드 패널이 항상 모든 탭에서 사용 가능하도록 설정
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {
  // 구버전 Chrome에서 오류 발생 시 무시
});
