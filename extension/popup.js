/**
 * popup.js
 *
 * - アクティブタブの URL を取得し、ルームIDへ正規化する
 * - Socket.io でサーバーへ接続し、ルームへ join する
 * - 人数表示の更新、メッセージの送受信・描画を行う
 *
 * ポップアップは開いている間だけ動く。閉じると socket も切断され、
 * サーバー側の人数カウントから外れる(= "そのタブを見ている人数" ではなく
 * "ポップアップを開いている人数" になる点に注意。仕様に応じて background 側で
 * 常時接続する設計にも拡張可能)。
 */

const SERVER_URL = "http://localhost:3000";

const els = {
  count: document.getElementById("count"),
  roomLabel: document.getElementById("room-label"),
  status: document.getElementById("status"),
  messages: document.getElementById("messages"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("input"),
  send: document.getElementById("send"),
};

let socket = null;
let myName = null;
let currentRoomId = null;

init();

async function init() {
  const tab = await getActiveTab();

  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    setStatus("このページではチャットを利用できません", true);
    els.roomLabel.textContent = "対応していないページです";
    return;
  }

  currentRoomId = RoomId.normalizeRoomId(tab.url);
  els.roomLabel.textContent = currentRoomId;
  els.roomLabel.title = currentRoomId;

  connect(currentRoomId);
  wireForm();
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0]);
    });
  });
}

function connect(roomId) {
  setStatus("接続中…");

  socket = io(SERVER_URL, {
    transports: ["websocket"],
    reconnection: true,
  });

  socket.on("connect", () => {
    setStatus("接続しました");
    socket.emit("room:join", { roomId });
  });

  socket.on("connect_error", () => {
    setStatus("サーバーに接続できません", true);
    setEnabled(false);
  });

  socket.on("disconnect", () => {
    setStatus("切断されました", true);
    setEnabled(false);
  });

  // 自分の入室完了: 名前と履歴を受け取る
  socket.on("room:joined", ({ name, history }) => {
    myName = name;
    setStatus(`あなたは「${name}」として参加中`);
    setEnabled(true);

    els.messages.innerHTML = "";
    (history || []).forEach(renderMessage);
    scrollToBottom();
  });

  // 人数更新
  socket.on("room:count", ({ count }) => {
    els.count.textContent = count;
  });

  // 新着メッセージ
  socket.on("chat:message", (message) => {
    renderMessage(message);
    scrollToBottom();
  });
}

function wireForm() {
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = els.input.value.trim();
    if (!text || !socket || !socket.connected) return;

    socket.emit("chat:message", { text });
    els.input.value = "";
    els.input.focus();
  });
}

function renderMessage(message) {
  const wrap = document.createElement("div");

  if (message.type === "system") {
    wrap.className = "msg system";
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = message.text;
    wrap.appendChild(bubble);
    els.messages.appendChild(wrap);
    return;
  }

  const isSelf = message.name && message.name === myName;
  wrap.className = "msg" + (isSelf ? " self" : "");

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = message.name || "匿名";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = message.text;

  wrap.appendChild(name);
  wrap.appendChild(bubble);
  els.messages.appendChild(wrap);
}

function scrollToBottom() {
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle("err", isError);
}

function setEnabled(enabled) {
  els.input.disabled = !enabled;
  els.send.disabled = !enabled;
  if (enabled) els.input.focus();
}

// ポップアップが閉じられる際に明示的に退室を通知(ベストエフォート)
window.addEventListener("beforeunload", () => {
  if (socket && socket.connected) {
    socket.emit("room:leave");
  }
});
