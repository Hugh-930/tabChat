/**
 * config.js
 *
 * 接続先サーバーの設定。配布時はここ1箇所を書き換えるだけでよい。
 *
 * 【開発時】  ローカルサーバー (npm start で起動したもの) を使う
 * 【配布時】  Render 等にデプロイした本番URL (https://～) に切り替える
 *            → https にすると WebSocket は自動的に wss (暗号化) になる
 */
const TabChatConfig = {
  // ▼ 開発用 (ローカル)
  SERVER_URL: "http://localhost:3000",

  // ▼ 本番用: デプロイ後、上の行をコメントアウトして下を有効にする
  // SERVER_URL: "https://YOUR-APP-NAME.onrender.com",
};
