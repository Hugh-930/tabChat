/**
 * background.js (Service Worker / Manifest V3)
 *
 * 担当:
 *   1. ツールバーアイコンのクリックを検知し、そのタブの content.js に
 *      ウィジェットの開閉(トグル)を指示する。
 *      ※ manifest から default_popup を外しているため onClicked が発火する。
 *   2. タブの URL 変更(SPA遷移含む)を content.js に通知し、ルームを移動させる。
 *   3. ページ種別(YT / AMZ / WEB)をツールバーのバッジに表示する。
 *
 * roomId.js を共有して、content と同じルーム正規化ロジックを使う。
 */

importScripts("roomId.js");

/** content script が入っていないページ(chrome:// 等)への送信エラーを握りつぶす */
function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    void chrome.runtime.lastError;
  });
}

// ツールバーアイコンのクリック → ウィジェットの開閉
chrome.action.onClicked.addListener((tab) => {
  if (!tab || tab.id == null) return;
  if (!/^https?:/.test(tab.url || "")) return;
  sendToTab(tab.id, { type: "tabchat:toggle" });
});

/** タブのURLからルーム種別ラベルを作り、バッジに表示する */
function updateBadgeForTab(tab) {
  if (!tab || tab.id == null) return;

  if (!tab.url || !/^https?:/.test(tab.url)) {
    chrome.action.setBadgeText({ text: "", tabId: tab.id });
    return;
  }

  const roomId = RoomId.normalizeRoomId(tab.url);
  let label = "WEB";
  if (roomId.startsWith("youtube:")) label = "YT";
  else if (roomId.startsWith("amazon:")) label = "AMZ";

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
  // URL が変わったら content.js にルーム移動を通知
  if (changeInfo.url) {
    sendToTab(tabId, { type: "tabchat:url-changed" });
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
