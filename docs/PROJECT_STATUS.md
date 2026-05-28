# CapyMap Project Status

最後更新: 2026-05-28

## 目標
日本の高速道路料金を計算できるモバイル対応マップアプリ。  
GitHub Pages にデプロイ、Google Maps API 使用。

## 現在の状態
⏳ **待機中 — API Key の設定待ち**

## 完成済みの実装
- [x] `index.html` — メイン UI（出発地・目的地入力、車種・ETC 設定、地図）
- [x] `css/style.css` — モバイルファーストデザイン
- [x] `js/app.js` — 経路検索・料金計算ロジック
  - Google Maps Directions API で経路描画
  - Routes API v2 (`extraComputations: TOLLS`) で通行料金計算
  - Places Autocomplete で住所入力補完
  - 現在地ボタン（Geolocation API）
- [x] `docs/SETUP.md` — API Key 設定手順

## 次のステップ
1. ユーザーが Google Cloud Console で API Key を取得
2. `index.html` の `REPLACE_WITH_YOUR_API_KEY` を実際の Key に置き換え
3. 動作確認後 GitHub Pages にデプロイ

## 機能一覧
| 機能 | 状態 |
|------|------|
| 地図表示 | ✅ |
| 住所オートコンプリート | ✅ |
| 経路計算・描画 | ✅ |
| 通行料金計算 | ✅ |
| ETC 割引対応 | ✅ |
| 車種選択（普通車/軽自動車/中型/大型/特大） | ✅ |
| 有料道路回避オプション | ✅ |
| 現在地ボタン | ✅ |
| モバイル対応 | ✅ |
