# CapyMap Project Status

最後更新: 2026-05-28

## 目標
日本の高速道路料金を計算できるモバイル対応マップアプリ。GitHub Pages にデプロイ済み。

## 現在の状態
✅ **稼働中 — API Key 不要で完全動作**

URL: https://chunkangyang.github.io/CapyMap/

## 完成済みの実装
- [x] `index.html` — モバイル対応 UI
- [x] `css/style.css` — モバイルファーストデザイン
- [x] `js/app.js` — 経路検索・料金計算ロジック
  - **Leaflet.js + OpenStreetMap** で地図表示（無料）
  - **OSRM API** で経路計算・地図描画（無料）
  - **Nominatim** で住所→座標変換（無料）
  - **NEXCO標準料金** で通行料金概算（車種別・ETC割引対応）
  - 現在地ボタン（Geolocation API）
  - 月次使用量トラッカー
- [x] `.github/workflows/deploy.yml` — GitHub Actions 自動デプロイ

## 動作確認済み
| テスト | 結果 |
|--------|------|
| 東京駅→大阪駅（普通車・ETC） | 距離 494.2km / 6時間16分 / ¥5,680 |
| GitHub Pages デプロイ | ✅ 正常 |
| モバイルレイアウト | ✅ viewport 設定済み |

## 機能一覧
| 機能 | 状態 |
|------|------|
| 地図表示（OpenStreetMap） | ✅ |
| 経路計算・描画（OSRM） | ✅ |
| 住所入力 | ✅ |
| 通行料金概算（NEXCO） | ✅ |
| ETC割引対応 | ✅ |
| 車種選択（普通車/軽/中型/大型/特大） | ✅ |
| 有料道路回避オプション | ✅ |
| 現在地ボタン | ✅ |
| モバイル対応 | ✅ |
| API Key 不要 | ✅ |
| 月次使用量表示 | ✅ |

## 今後の拡張（オプション）
- Google Maps API Key を追加 → より正確な料金・リアルタイム渋滞情報
- 複数経路の比較表示
- 経由地追加
