/**
 * URL から「ルームID」を導出する共通ロジック。
 *
 * - YouTube: 動画ID (v=xxxx / youtu.be/xxxx) を使う → 同じ動画なら同室
 * - Amazon:  商品ページの ASIN (/dp/XXXX or /gp/product/XXXX) を使う
 * - その他:  origin + pathname (クエリ・ハッシュを除いた URL) を使う
 *
 * popup.js からは <script> 経由、background.js からは importScripts 経由で読み込み、
 * どちらの環境でも window / self どちらにも公開する。
 */
(function (root) {
  function normalizeRoomId(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch (e) {
      // パースできない URL(chrome://, about:blank 等)はそのまま返す
      return rawUrl || "unknown";
    }

    const host = url.hostname.replace(/^www\./, "");

    // --- YouTube ---
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = url.searchParams.get("v");
      if (v) return `youtube:${v}`;
    }
    if (host === "youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0];
      if (id) return `youtube:${id}`;
    }

    // --- Amazon (各国ドメイン対応: amazon.co.jp, amazon.com など) ---
    if (/(^|\.)amazon\.[a-z.]+$/.test(host)) {
      const asin = extractAsin(url.pathname);
      if (asin) return `amazon:${asin}`;
    }

    // --- その他: クエリ/ハッシュを除いた正規 URL ---
    // 末尾スラッシュは揺れやすいので取り除いて統一する
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${path}`;
  }

  function extractAsin(pathname) {
    // /dp/ASIN, /gp/product/ASIN, /product/ASIN などから 10桁の ASIN を抽出
    const patterns = [
      /\/dp\/([A-Z0-9]{10})/i,
      /\/gp\/product\/([A-Z0-9]{10})/i,
      /\/product\/([A-Z0-9]{10})/i,
      /\/gp\/aw\/d\/([A-Z0-9]{10})/i,
    ];
    for (const re of patterns) {
      const m = pathname.match(re);
      if (m) return m[1].toUpperCase();
    }
    return null;
  }

  const api = { normalizeRoomId, extractAsin };

  // window(popup) と self(service worker) の両方に公開
  root.RoomId = api;
})(typeof self !== "undefined" ? self : this);
