# CapyMap Project Status

最後更新: 2026-05-28

## 目標
日本の高速道路料金を計算できるモバイル対応マップアプリ。GitHub Pages にデプロイ済み。

## 現在の状態
✅ **稼働中 — Google Maps API + Google Routes API v2 で完全動作**

URL: https://chunkangyang.github.io/CapyMap/

## 完成済みの実装
- [x] `index.html` — モバイル対応 UI
- [x] `css/style.css` — モバイルファーストデザイン
- [x] `js/app.js` — 経路検索・料金計算ロジック
  - **Google Maps JavaScript API** で地図表示
  - **Google Routes API v2** (`computeRoutes`) で経路計算・通行料金取得
  - **Google Places Autocomplete** で住所補完
  - **Google Geocoding API** で住所→座標変換
  - Google Sign-In（GIS）で認証（許可メール: cky1983@gmail.com, meilin709@gmail.com）
  - 複数ルート比較表示（最安・最速バッジ付き、¥/km コスパ表示）
  - Yahoo!マップ確認リンク（住所テキスト → 即ルート表示）
  - 車種別・ETC/非ETC対応（Google Routes API の tollPasses）
  - 有料道路回避オプション
  - 現在地ボタン（Geolocation API）
  - 月次使用量トラッカー（$200/月の無料枠管理）
- [x] `.github/workflows/deploy.yml` — GitHub Actions 自動デプロイ（secrets注入）

## 動作確認済み
| テスト | 結果 |
|--------|------|
| 東京駅→大阪駅（普通車・ETC） | 距離 554.4km / 6時間47分 / ¥9,270 / ¥17/km ✅ |
| 複数ルート比較カード表示 | ✅（API 返却数に応じて自動表示） |
| 最安・最速バッジ | ✅ |
| Google サインイン認証 | ✅ |
| GitHub Pages デプロイ | ✅ 正常 |
| モバイルレイアウト | ✅ viewport 設定済み |

証拠: `docs/EVIDENCES/multi-route-test-2026-05-28.png`

## 機能一覧
| 機能 | 状態 |
|------|------|
| 地図表示（Google Maps） | ✅ |
| 経路計算・描画（Routes API v2） | ✅ |
| 住所入力（Places Autocomplete） | ✅ |
| 通行料金（Routes API tollInfo） | ✅ |
| ETC割引対応 | ✅ |
| 車種選択（普通車/軽/中型/大型/特大） | ✅ |
| 複数ルート比較表示 | ✅ |
| 最安・最速バッジ + ¥/km 表示 | ✅ |
| Yahoo!マップ確認リンク | ✅ |
| 有料道路回避オプション | ✅ |
| 現在地ボタン | ✅ |
| Google 認証（許可メール制限） | ✅ |
| 月次使用量表示 | ✅ |

## 今後の拡張（オプション）
- 経由地追加
- 渋滞考慮ルートのリアルタイム表示
