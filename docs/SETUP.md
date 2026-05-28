# Google Maps API Key 設定手順

## 必要な API

以下の 3 つを有効にする必要があります：

| API | 用途 |
|-----|------|
| Maps JavaScript API | 地図表示 |
| Directions API | 経路取得・地図描画 |
| Routes API | 高速料金計算（正確な通行料金） |
| Places API | 住所オートコンプリート |
| Geocoding API | 住所→座標変換 |

---

## 手順

### 1. Google Cloud Console にアクセス
https://console.cloud.google.com/

### 2. プロジェクト作成
- 「プロジェクトを選択」→「新しいプロジェクト」
- 名前: `CapyMap`（任意）

### 3. 請求先アカウントの設定
- API を使うには課金設定が必要です
- Google Maps Platform には毎月 $200 の無料クレジットがあります
- 個人利用レベルでは無料枠内に収まることがほとんどです

### 4. API を有効化
「APIとサービス」→「ライブラリ」で以下を検索して有効化：
1. Maps JavaScript API
2. Directions API
3. Routes API
4. Places API (New) または Places API
5. Geocoding API

### 5. API Key の作成
「APIとサービス」→「認証情報」→「認証情報を作成」→「API キー」

### 6. API Key の制限設定（重要！）
作成した API Key をクリックして編集：

**アプリケーションの制限：**
- 「HTTPリファラー（ウェブサイト）」を選択
- 以下を追加：
  - `https://chunkyangyang.github.io/*`（GitHub Pages）
  - `http://localhost:*`（ローカル開発用）

**API の制限：**
- 「キーを制限する」を選択
- 上記 5 つの API を選択

### 7. index.html に API Key を設定
`index.html` の以下の行を編集：

```js
window.MAPS_API_KEY = 'REPLACE_WITH_YOUR_API_KEY';
```

↓ API Key に置き換え：

```js
window.MAPS_API_KEY = 'AIzaSy...（あなたの API Key）';
```

---

## 料金目安（2024年）

個人利用の場合、月 $200 の無料クレジットで大部分カバーできます：

| API | 単価 | 月 1,000 回の費用 |
|-----|------|------------------|
| Maps JS API | 地図表示は無料 | $0 |
| Directions API | $5 / 1,000リクエスト | $5 |
| Routes API | $5 / 1,000リクエスト | $5 |
| Places Autocomplete | $2.83 / 1,000 | $2.83 |
| Geocoding | $5 / 1,000 | $5 |

月 1,000 回検索しても約 $17.83 → 無料クレジット内に収まります。

---

## デプロイ（GitHub Pages）

```bash
git add .
git commit -m "deploy: initial version"
git push origin main
```

GitHub リポジトリの Settings → Pages → Branch: `main` / Folder: `/ (root)` で有効化。

URL: `https://chunkyangyang.github.io/CapyMap/`
