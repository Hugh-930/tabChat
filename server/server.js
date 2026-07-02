/**
 * Tab Chat - WebSocket サーバー
 *
 * 役割:
 *   - Socket.io の接続管理
 *   - ルーム(= 正規化された URL / ID)ごとの人数カウント
 *   - 同じルームの参加者へのメッセージのブロードキャスト
 *
 * 仕様:
 *   - チャット履歴は DB に保存せず、メモリ上でのみ処理する。
 *     直近の履歴だけを一時的に保持し、後から入室した人にも少し見えるようにする。
 *   - サーバーを再起動すると全ての履歴・人数はリセットされる。
 */

const http = require("http");
const express = require("express");
const cors = require("cors");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;

// ルームごとに直近何件の履歴をメモリに保持するか
const HISTORY_LIMIT = 50;

const app = express();
app.use(cors());

// 動作確認用の簡単なヘルスチェックエンドポイント
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "tab-chat-server",
    rooms: rooms.size,
    connections: io ? io.engine.clientsCount : 0,
  });
});

const server = http.createServer(app);

const io = new Server(server, {
  // 拡張機能(chrome-extension://...)など、任意のオリジンからの接続を許可する
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

/**
 * ルーム状態を保持するマップ。
 *   key:   roomId (string)
 *   value: {
 *     count: number,               // 現在の接続人数
 *     history: Array<message>,     // 直近のチャット履歴(メモリのみ)
 *     guestSeq: number             // ゲスト番号の連番採番用
 *   }
 */
const rooms = new Map();

function getRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { count: 0, history: [], guestSeq: 0 };
    rooms.set(roomId, room);
  }
  return room;
}

/** ルームの現在人数を、そのルームの全員に通知する */
function broadcastCount(roomId) {
  const room = rooms.get(roomId);
  const count = room ? room.count : 0;
  io.to(roomId).emit("room:count", { roomId, count });
}

io.on("connection", (socket) => {
  // このソケットが現在参加しているルームと表示名を state に保持する
  let currentRoomId = null;
  let displayName = null;

  /**
   * ルーム参加。
   * クライアントは接続後 / URL 変更時にこのイベントを送る。
   * payload: { roomId: string }
   */
  socket.on("room:join", (payload) => {
    // null や文字列など、不正なペイロードが来てもクラッシュしないよう防御する
    const roomId = payload && typeof payload === "object" ? payload.roomId : null;
    if (typeof roomId !== "string" || roomId.length === 0) return;

    // 既に別ルームにいた場合は先に退室処理を行う
    if (currentRoomId && currentRoomId !== roomId) {
      leaveCurrentRoom();
    }

    // 同じルームへの二重 join は無視する
    if (currentRoomId === roomId) {
      socket.emit("room:count", { roomId, count: getRoom(roomId).count });
      return;
    }

    const room = getRoom(roomId);
    room.count += 1;
    room.guestSeq += 1;
    displayName = `ゲスト${room.guestSeq}`;
    currentRoomId = roomId;

    socket.join(roomId);

    // 参加者本人へ: 割り当てられた名前と、直近の履歴を送る
    socket.emit("room:joined", {
      roomId,
      name: displayName,
      history: room.history,
    });

    // ルーム全員へ最新人数を通知
    broadcastCount(roomId);

    // 入室を他の参加者へ通知(システムメッセージ)
    const sysMsg = makeSystemMessage(`${displayName} さんが参加しました`);
    room.history.push(sysMsg);
    trimHistory(room);
    socket.to(roomId).emit("chat:message", sysMsg);
  });

  /**
   * チャット送信。
   * payload: { text: string }
   */
  socket.on("chat:message", (payload) => {
    if (!currentRoomId) return;
    const text = payload && typeof payload === "object" ? payload.text : null;
    if (typeof text !== "string") return;

    const trimmed = text.trim();
    if (trimmed.length === 0) return;

    // 過剰に長いメッセージは切り詰める
    const safeText = trimmed.slice(0, 1000);

    const room = getRoom(currentRoomId);
    const message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: "user",
      name: displayName,
      text: safeText,
      ts: Date.now(),
    };

    room.history.push(message);
    trimHistory(room);

    // 送信者を含むルーム全員へブロードキャスト
    io.to(currentRoomId).emit("chat:message", message);
  });

  /** 明示的な退室(タブを閉じる前などにクライアントから送られる場合がある) */
  socket.on("room:leave", () => {
    leaveCurrentRoom();
  });

  /** 切断時 */
  socket.on("disconnect", () => {
    leaveCurrentRoom();
  });

  /** 現在のルームから抜ける共通処理 */
  function leaveCurrentRoom() {
    if (!currentRoomId) return;

    const roomId = currentRoomId;
    const room = rooms.get(roomId);

    if (room) {
      room.count = Math.max(0, room.count - 1);

      if (displayName) {
        const sysMsg = makeSystemMessage(`${displayName} さんが退出しました`);
        room.history.push(sysMsg);
        trimHistory(room);
        socket.to(roomId).emit("chat:message", sysMsg);
      }

      // 誰もいなくなったらルーム状態をメモリから破棄する
      if (room.count === 0) {
        rooms.delete(roomId);
      }
    }

    socket.leave(roomId);
    currentRoomId = null;
    displayName = null;

    broadcastCount(roomId);
  }
});

function makeSystemMessage(text) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: "system",
    name: null,
    text,
    ts: Date.now(),
  };
}

function trimHistory(room) {
  if (room.history.length > HISTORY_LIMIT) {
    room.history.splice(0, room.history.length - HISTORY_LIMIT);
  }
}

server.listen(PORT, () => {
  console.log(`tab-chat-server listening on http://localhost:${PORT}`);
});
