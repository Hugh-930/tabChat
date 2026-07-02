# 公開・配布手順

サーバーを無料ホスティング（Render）に公開し、拡張機能を他の人に配布する手順です。

---

## Part 1: サーバーを Render に無料デプロイ

[Render](https://render.com) の無料プランは WebSocket (Socket.io) に対応しており、クレジットカード登録も不要です。

### 手順

1. **GitHubリポジトリを作成してプッシュ**
   ```bash
   cd tab-chat
   git init
   git add .
   git commit -m "initial commit"
   # GitHubで新しいリポジトリを作成後:
   git remote add origin https://github.com/<あなたのユーザー名>/tab-chat.git
   git push -u origin main
   ```

2. **Renderにデプロイ**
   1. [render.com](https://render.com) にGitHubアカウントでサインアップ
   2. ダッシュボードで **New → Web Service** を選択
   3. 作成したGitHubリポジトリを接続
   4. 以下を設定:
      | 項目 | 値 |
      | --- | --- |
      | Name | `tab-chat-server`（任意） |
      | Root Directory | `server` |
      | Build Command | `npm install` |
      | Start Command | `npm start` |
      | Instance Type | **Free** |
   5. **Create Web Service** をクリック

   > リポジトリ直下の `render.yaml` があるので、**New → Blueprint** からリポジトリを選ぶだけでも同じ構成が自動作成されます。

3. **デプロイ完了を確認**
   - `https://tab-chat-server-xxxx.onrender.com` のようなURLが発行される
   - ブラウザでそのURLを開き、`{"status":"ok", ...}` が返ればOK

### 無料プランの注意点

- **15分間アクセスがないとスリープ**し、次のアクセス時に起動へ数十秒かかります（その間「サーバーに接続できません」と表示 → 自動再接続で回復）。
- 常時起動させたい場合は [UptimeRobot](https://uptimerobot.com)（無料）などでヘルスチェックURL（`/`）を定期的にpingする方法があります（無料枠は月750時間なので1サービスなら常時稼働可能）。
- **メモリのみの仕様のため、スリープ／再デプロイのたびにチャット履歴は消えます**（本プロジェクトの仕様どおり）。

---

## Part 2: 拡張機能を本番サーバーに向ける

1. [extension/config.js](extension/config.js) を開き、接続先を切り替える:

   ```js
   const TabChatConfig = {
     // SERVER_URL: "http://localhost:3000",                     // ← コメントアウト
     SERVER_URL: "https://tab-chat-server-xxxx.onrender.com",   // ← 実際のURLに
   };
   ```

2. `manifest.json` の `host_permissions` には `https://*.onrender.com/*` を既に含めてあるため、Renderを使う限り変更不要です（独自ドメインの場合は追加してください）。

3. 動作確認: `chrome://extensions` で拡張機能をリロード → ページを再読み込み → チャットが本番サーバーにつながることを確認。

---

## Part 3: 拡張機能を他の人に配布

### 方法A: ZIPで配布（無料・手軽、身内向け）

1. `extension/` フォルダをZIP圧縮して相手に送る
2. 受け取った人の手順:
   1. ZIPを解凍
   2. Chromeで `chrome://extensions` を開く
   3. **デベロッパーモード** をON
   4. **「パッケージ化されていない拡張機能を読み込む」** で解凍したフォルダを選択

> 手軽ですが、自動更新されない・受け取る側に開発者モード操作が必要、という制約があります。

### 方法B: Chrome ウェブストアで公開（推奨、広く配布する場合）

1. [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) に登録
   （**初回のみ $5** の開発者登録料。以降の公開は無料）
2. `extension/` フォルダをZIP化してアップロード
3. ストア掲載情報（説明文・スクリーンショット等）を入力して審査に提出
4. 審査通過後、ストアのURLを共有するだけで誰でもワンクリックでインストール可能・自動更新も有効

> 公開前に `icons/` のプレースルダ画像を実際のアイコンに差し替えてください（ストア審査で必要になります）。

---

## 公開時のセキュリティ/運用メモ

- 現状は誰でも接続できるオープンな仕様です。荒らし対策が必要になったら、サーバー側にレート制限（例: 1秒あたりの発言数制限）やNGワードフィルタの追加を検討してください。
- Render無料プランは同時接続数が多いと重くなることがあります。利用者が増えたら有料プラン（$7/月〜）や他ホスティングへの移行を検討してください。
