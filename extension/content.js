/**
 * content.js
 *
 * ページ内に常駐するチャットウィジェット。
 *
 * 【なぜポップアップではなくコンテンツスクリプトか】
 * Chrome拡張のポップアップは、ページのどこかをクリックする(フォーカスが外れる)と
 * 自動的に閉じてしまう仕様で、これは無効化できない。
 * そこでチャットUIをページのDOMに直接描画し、以下の操作で制御する:
 *
 *   - ツールバーアイコン : パネルの表示/最小化を切り替え
 *   - hide(–)ボタン     : バブルに最小化(Socket接続は維持、未読数を表示)
 *   - close(×)ボタン    : 切断してウィジェットを完全に閉じる
 *
 * スタイルは Shadow DOM で隔離し、ページ側のCSSと干渉しないようにする。
 * 開閉状態は sessionStorage に保存し、同じタブ内のページ遷移後も復元する。
 */
(() => {
  // 二重注入ガード
  if (window.__tabChatInjected) return;
  window.__tabChatInjected = true;

  // 接続先は config.js (TabChatConfig) で一元管理する
  const SERVER_URL = TabChatConfig.SERVER_URL;
  const STATE_KEY = "__tabchat_state"; // "open" | "min" | "closed"

  let socket = null;
  let myName = null;
  let currentRoomId = null;
  let unread = 0;
  let ui = null; // { host, els }

  /* ---------- 開閉状態の保存(タブ内のページ遷移をまたいで復元) ---------- */

  function getState() {
    try {
      return sessionStorage.getItem(STATE_KEY) || "closed";
    } catch (e) {
      return "closed";
    }
  }

  function setState(s) {
    try {
      sessionStorage.setItem(STATE_KEY, s);
    } catch (e) {
      /* sandbox 等で sessionStorage が使えないページでは状態復元を諦める */
    }
  }

  /* ---------- background からのメッセージ ---------- */

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "tabchat:toggle") toggle();
    else if (msg.type === "tabchat:url-changed") handleUrlChange();
  });

  // SPA(pushState/hashchange)のページ内遷移にも追随する
  window.addEventListener("popstate", handleUrlChange);
  window.addEventListener("hashchange", handleUrlChange);

  // ページ読み込み時: 前のページで開いていたら自動復元
  const initialState = getState();
  if (initialState === "open") open();
  else if (initialState === "min") {
    open();
    minimize();
  }

  /* ---------- 開閉制御 ---------- */

  function toggle() {
    if (getState() === "open") minimize();
    else open();
  }

  function open() {
    const u = ensureUi();
    u.els.panel.classList.remove("hidden");
    u.els.bubble.classList.add("hidden");
    unread = 0;
    updateBubble();
    setState("open");

    if (!socket) startConnection();
  }

  function minimize() {
    if (!ui) return;
    ui.els.panel.classList.add("hidden");
    ui.els.bubble.classList.remove("hidden");
    setState("min");
    // ※ Socket接続は維持する(人数に数え続け、未読も受け取る)
  }

  function closeWidget() {
    if (socket) {
      if (socket.connected) socket.emit("room:leave");
      socket.disconnect();
      socket = null;
    }
    if (ui) {
      ui.host.remove();
      ui = null;
    }
    myName = null;
    currentRoomId = null;
    unread = 0;
    setState("closed");
  }

  /* ---------- UI構築 (Shadow DOM) ---------- */

  function ensureUi() {
    if (ui) return ui;

    const host = document.createElement("div");
    host.id = "__tabchat-root";
    // ページCSSに負けないよう、配置に関わるスタイルはインラインで最優先指定
    host.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483647;" +
      "width:auto;height:auto;margin:0;padding:0;border:none;background:none;";

    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }

        .panel {
          display: flex;
          flex-direction: column;
          width: 320px;
          height: 420px;
          background: #ffffff;
          color: #1f2328;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25);
          overflow: hidden;
          font-family: "Segoe UI", "Hiragino Kaku Gothic ProN", Meiryo, sans-serif;
          font-size: 13px;
          line-height: 1.4;
          text-align: left;
        }

        .hidden { display: none !important; }

        header {
          padding: 8px 10px;
          border-bottom: 1px solid #e5e7eb;
          background: #f4f5f7;
          flex-shrink: 0;
        }

        .title-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .title { font-weight: 700; font-size: 13px; }

        .count-badge {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: #2563eb;
          color: #fff;
          padding: 2px 8px;
          border-radius: 999px;
          font-weight: 600;
          font-size: 11px;
        }

        .dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #34d399; display: inline-block;
        }

        .win-btns {
          margin-left: auto;
          display: flex;
          gap: 4px;
        }

        .win-btns button {
          width: 24px; height: 24px;
          border: none;
          border-radius: 6px;
          background: transparent;
          color: #6b7280;
          font-size: 15px;
          line-height: 1;
          cursor: pointer;
        }

        .win-btns button:hover { background: #e5e7eb; color: #1f2328; }
        #close-btn:hover { background: #fee2e2; color: #dc2626; }

        .room-label {
          margin-top: 5px;
          color: #6b7280;
          font-size: 10px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .status { margin-top: 3px; font-size: 10px; color: #6b7280; }
        .status.err { color: #dc2626; }

        .messages {
          flex: 1;
          overflow-y: auto;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          background: #fff;
        }

        .msg { max-width: 85%; }
        .msg .name { font-size: 10px; color: #6b7280; margin-bottom: 2px; }
        .msg .bubble-msg {
          background: #f4f5f7;
          padding: 6px 9px;
          border-radius: 10px;
          word-break: break-word;
          white-space: pre-wrap;
        }
        .msg.self { align-self: flex-end; text-align: right; }
        .msg.self .bubble-msg { background: #2563eb; color: #fff; }
        .msg.system { align-self: center; max-width: 100%; }
        .msg.system .bubble-msg {
          background: transparent;
          color: #9ca3af;
          font-size: 10px;
          padding: 2px 0;
        }

        form {
          display: flex;
          gap: 6px;
          padding: 8px 10px;
          border-top: 1px solid #e5e7eb;
          background: #f4f5f7;
          flex-shrink: 0;
        }

        #input {
          flex: 1;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 7px 9px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
          background: #fff;
          color: #1f2328;
        }

        #input:focus { border-color: #2563eb; }

        #send {
          border: none;
          border-radius: 8px;
          background: #2563eb;
          color: #fff;
          padding: 0 12px;
          font-weight: 600;
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
        }

        #send:disabled, #input:disabled { opacity: 0.5; cursor: default; }

        /* --- 最小化時のバブル --- */
        .bubble {
          position: relative;
          width: 52px; height: 52px;
          border: none;
          border-radius: 50%;
          background: #2563eb;
          color: #fff;
          font-size: 22px;
          cursor: pointer;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bubble:hover { background: #1d4ed8; }

        .bubble-count {
          position: absolute;
          bottom: -2px; right: -2px;
          background: #111827;
          color: #fff;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
        }

        .bubble-unread {
          position: absolute;
          top: -4px; right: -4px;
          background: #dc2626;
          color: #fff;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          min-width: 18px;
          height: 18px;
          padding: 0 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 2px solid #fff;
        }
      </style>

      <div class="panel" id="panel">
        <header>
          <div class="title-row">
            <span class="title">Tab Chat</span>
            <span class="count-badge"><span class="dot"></span><span id="count">-</span> 人</span>
            <div class="win-btns">
              <button id="hide-btn" title="最小化(接続は維持)">–</button>
              <button id="close-btn" title="閉じる(退室)">×</button>
            </div>
          </div>
          <div class="room-label" id="room-label"></div>
          <div class="status" id="status">接続中…</div>
        </header>
        <div class="messages" id="messages"></div>
        <form id="chat-form" autocomplete="off">
          <input type="text" id="input" placeholder="メッセージを入力…" maxlength="1000" disabled />
          <button type="submit" id="send" disabled>送信</button>
        </form>
      </div>

      <button class="bubble hidden" id="bubble" title="Tab Chat を開く">
        💬
        <span class="bubble-count" id="bubble-count">-</span>
        <span class="bubble-unread hidden" id="bubble-unread">0</span>
      </button>
    `;

    const $ = (id) => root.getElementById(id);
    const els = {
      panel: $("panel"),
      bubble: $("bubble"),
      bubbleCount: $("bubble-count"),
      bubbleUnread: $("bubble-unread"),
      count: $("count"),
      roomLabel: $("room-label"),
      status: $("status"),
      messages: $("messages"),
      form: $("chat-form"),
      input: $("input"),
      send: $("send"),
      hideBtn: $("hide-btn"),
      closeBtn: $("close-btn"),
    };

    els.hideBtn.addEventListener("click", minimize);
    els.closeBtn.addEventListener("click", closeWidget);
    els.bubble.addEventListener("click", open);

    els.form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = els.input.value.trim();
      if (!text || !socket || !socket.connected) return;
      socket.emit("chat:message", { text });
      els.input.value = "";
      els.input.focus();
    });

    (document.body || document.documentElement).appendChild(host);
    ui = { host, els };

    return ui;
  }

  /**
   * ウィジェット内で入力中のキーイベントがページ側のショートカット
   * (YouTube の k=一時停止 など)を誤爆させないようにする。
   * Shadow DOM の外から見ると e.target は host 要素になるため、それで判定する。
   */
  ["keydown", "keyup", "keypress"].forEach((type) => {
    window.addEventListener(
      type,
      (e) => {
        if (ui && e.target === ui.host) e.stopPropagation();
      },
      true
    );
  });

  /* ---------- Socket 通信 ---------- */

  function startConnection() {
    currentRoomId = RoomId.normalizeRoomId(location.href);
    if (ui) {
      ui.els.roomLabel.textContent = currentRoomId;
      ui.els.roomLabel.title = currentRoomId;
    }

    setStatus("接続中…");

    socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true,
    });

    socket.on("connect", () => {
      setStatus("接続しました");
      socket.emit("room:join", { roomId: currentRoomId });
    });

    socket.on("connect_error", () => {
      setStatus("サーバーに接続できません", true);
      setEnabled(false);
    });

    socket.on("disconnect", () => {
      setStatus("切断されました", true);
      setEnabled(false);
    });

    // 入室完了: 名前と履歴を受け取る
    socket.on("room:joined", ({ name, history }) => {
      myName = name;
      setStatus(`あなたは「${name}」として参加中`);
      setEnabled(true);

      if (ui) {
        ui.els.messages.innerHTML = "";
        (history || []).forEach(renderMessage);
        scrollToBottom();
      }
    });

    // 人数更新
    socket.on("room:count", ({ count }) => {
      if (!ui) return;
      ui.els.count.textContent = count;
      ui.els.bubbleCount.textContent = count;
    });

    // 新着メッセージ
    socket.on("chat:message", (message) => {
      renderMessage(message);
      scrollToBottom();

      // 最小化中はユーザーメッセージを未読としてカウント
      if (getState() === "min" && message.type === "user") {
        unread += 1;
        updateBubble();
      }
    });
  }

  /** URL変更(SPA遷移)時: ルームIDが変わっていたら部屋を移動する */
  function handleUrlChange() {
    if (!socket) return;

    const newRoomId = RoomId.normalizeRoomId(location.href);
    if (newRoomId === currentRoomId) return;

    currentRoomId = newRoomId;
    if (ui) {
      ui.els.roomLabel.textContent = newRoomId;
      ui.els.roomLabel.title = newRoomId;
      ui.els.messages.innerHTML = "";
      ui.els.count.textContent = "-";
    }

    // サーバー側の room:join は「別ルームへの移動」も処理してくれる
    if (socket.connected) {
      socket.emit("room:join", { roomId: newRoomId });
    }
  }

  /* ---------- 描画ヘルパー ---------- */

  function renderMessage(message) {
    if (!ui || !message) return;

    const wrap = document.createElement("div");

    if (message.type === "system") {
      wrap.className = "msg system";
      const bubble = document.createElement("div");
      bubble.className = "bubble-msg";
      bubble.textContent = message.text;
      wrap.appendChild(bubble);
      ui.els.messages.appendChild(wrap);
      return;
    }

    const isSelf = message.name && message.name === myName;
    wrap.className = "msg" + (isSelf ? " self" : "");

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = message.name || "匿名";

    const bubble = document.createElement("div");
    bubble.className = "bubble-msg";
    bubble.textContent = message.text;

    wrap.appendChild(name);
    wrap.appendChild(bubble);
    ui.els.messages.appendChild(wrap);
  }

  function updateBubble() {
    if (!ui) return;
    ui.els.bubbleUnread.textContent = unread > 99 ? "99+" : String(unread);
    ui.els.bubbleUnread.classList.toggle("hidden", unread === 0);
  }

  function scrollToBottom() {
    if (!ui) return;
    ui.els.messages.scrollTop = ui.els.messages.scrollHeight;
  }

  function setStatus(text, isError = false) {
    if (!ui) return;
    ui.els.status.textContent = text;
    ui.els.status.classList.toggle("err", isError);
  }

  function setEnabled(enabled) {
    if (!ui) return;
    ui.els.input.disabled = !enabled;
    ui.els.send.disabled = !enabled;
  }
})();
