# Tab Chat

同じWebページ（URL）を開いているユーザー同士が、リアルタイムで **現在の接続人数** を確認し、**匿名でチャット** できるChrome拡張機能 + WebSocket(Socket.io)サーバーです。

- チャット履歴は **DBに保存せず、サーバーのメモリ上のみ** で処理します（サーバー再起動・全員退室で消えます）。
- ルームIDは **開いているタブのURL** から生成します。YouTube / Amazon は一意IDを抽出し、その他はクエリを除いたURLを使います。

---

## ディレクトリ構造

```
tab-chat/
├── README.md
├── server/                     # バックエンド (Node.js + Express + Socket.io)
│   ├── package.json
│   └── server.js               # 接続管理・人数カウント・ブロードキャスト
│
└── extension/                  # Chrome拡張機能 (Manifest V3)
    ├── manifest.json
    ├── popup.html              # 人数表示 + チャットUI
    ├── popup.js                # DOM操作 + Socket通信
    ├── background.js           # タブURL検知・バッジ表示 (Service Worker)
    ├── roomId.js               # URL→ルームID 正規化 (popup/background共通)
    ├── lib/
    │   └── socket.io.min.js    # Socket.ioクライアント (ローカルにバンドル)
    └── icons/
        ├── icon16.png          # ※プレースホルダ。好きな画像に差し替え可
        ├── icon48.png
        └── icon128.png
```

---

## ルームID の決め方 (`extension/roomId.js`)

| サイト | ルームID の例 | 抽出方法 |
| --- | --- | --- |
| YouTube | `youtube:dQw4w9WgXcQ` | `?v=` または `youtu.be/xxxx` の動画ID |
| Amazon（各国ドメイン） | `amazon:B08XXXXXXX` | `/dp/`・`/gp/product/` などの ASIN |
| その他 | `https://example.com/path` | `origin + pathname`（クエリ・ハッシュ・末尾スラッシュを除去） |

同じロジックをサーバーではなくクライアント側で適用しているため、サーバーは受け取った `roomId` 文字列をそのまま部屋のキーとして扱います。

---

## 動かし方

### 1. サーバーを起動

```bash
cd server
npm install
npm start
```

`http://localhost:3000` で待ち受けます。ブラウザで開くと `{"status":"ok", ...}` が返ればOKです。

> 開発中はファイル変更で自動再起動する `npm run dev`（Node 18+ の `--watch`）も使えます。

### 2. 拡張機能を読み込む

1. Chromeで `chrome://extensions` を開く
2. 右上の **デベロッパーモード** をON
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. この `extension/` フォルダを選択

ツールバーにアイコンが追加され、開いているページ種別に応じてバッジ（`YT` / `AMZ` / `WEB`）が表示されます。

### 3. 使ってみる

1. 任意のページ（例: あるYouTube動画）を開く
2. ツールバーの **Tab Chat** アイコンをクリックしてポップアップを開く
3. ヘッダーに現在の接続人数、下部にチャット欄が表示される
4. メッセージを入力して送信

---

## テスト方法（複数人をシミュレート）

1つのブラウザだけでも複数接続を再現できます。

1. **同じURL** を複数のタブ／ウィンドウで開く
2. それぞれでポップアップを開く（＝それぞれが1接続としてカウント）
3. 人数が増え、片方で送信したメッセージがもう片方にも即時表示されることを確認
4. 片方のポップアップを閉じると人数が減ることを確認

さらに **別プロファイル** や **シークレットウィンドウ**（拡張機能をシークレットでも許可）を使うと、より実環境に近い形でテストできます。

### 動作確認のポイント
- YouTubeで **別の動画** を開くと別ルームになり、人数・チャットが分離されること
- Amazon商品ページで、URLに付く長いトラッキングパラメータが違っても **同じASINなら同室** になること
- サーバーを再起動すると履歴・人数がリセットされること（メモリのみ仕様）

---

## 仕様上の注意・拡張ポイント

- **カウントの意味**: 本実装では「ポップアップを開いている間だけ」Socket接続します。そのため人数は厳密には *「そのページでポップアップを開いている人数」* です。「タブを開いているだけで人数に数える」挙動にしたい場合は、`background.js`（Service Worker）側で常時Socket接続する設計に拡張してください（MV3のService Workerはアイドルで停止するため、`chrome.alarms` 等での延命が必要）。
- **匿名名**: サーバーが入室順に `ゲスト1, ゲスト2, ...` を採番します。完全匿名にしたい場合は `server.js` の `displayName` 生成部を変更してください。
- **本番運用**: `SERVER_URL`（`popup.js`）と `manifest.json` の `host_permissions` を実際のサーバーURL（`wss://`/`https://`）に変更し、CORS設定を絞ってください。
- **アイコン**: `extension/icons/*.png` は1x1透明のプレースホルダです。任意の画像に差し替えてください。
