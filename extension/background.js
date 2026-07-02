/**
 * background.js (Service Worker / Manifest V3)
 *
 * このプロジェクトでは、チャットの実接続はポップアップを開いている間に
 * popup.js が行う。background では補助的に以下を担当する:
 *
 *   1. アクティブタブ / URL 変更を検知し、ツールバーのバッジに
 *      現在のルームIDの短縮表示(サイト種別)を出す。
 *   2. 将来的に「ポップアップを開いていなくても常時接続して人数に数える」
 *      設計へ拡張する場合の土台。
 *
 * roomId.js を共有して、popup と同じルーム正規化ロジックを使う。
 */

importScripts("roomId.js");

/** タブのURLからルーム種別ラベルを作り、バッジに表示する */
function updateBadgeForTab(tab) {
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    chrome.action.setBadgeText({ text: "", tabId: tab && tab.id });
    return;
  }

  const roomId = RoomId.normalizeRoomId(tab.url);
  let label = "•";
  if (roomId.startsWith("youtube:")) label = "YT";
  else if (roomId.startsWith("amazon:")) label = "AMZ";
  else label = "WEB";

  chrome.action.setBadgeBackgroundColor({ color: "#2563eb", tabId: tab.id });
  chrome.action.setBadgeText({ text: label, tabId: tab.id });
}

// アクティブタブが切り替わったとき
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    updateBadgeForTab(tab);
  });
});

// タブ内で URL が変わったとき(SPA遷移含む)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateBadgeForTab(tab);
  }
});

// 起動時に現在のアクティブタブへも反映
chrome.runtime.onStartup.addListener(refreshActive);
chrome.runtime.onInstalled.addListener(refreshActive);

function refreshActive() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0]) updateBadgeForTab(tabs[0]);
  });
}
