# CapyMap Project Status

最後更新: 2026-05-31

## 目標
日本の高速道路料金を計算できるモバイル対応マップアプリ。GitHub Pages にデプロイ済み。

## 現在の状態
🟡 **稼働中 — ただし IC 名表示バグ未解決（修正コードはデプロイ済みだが GitHub Pages CDN キャッシュで反映待ち）**

URL: https://chunkangyang.github.io/CapyMap/

---

## ⚠️ 進行中の問題（次セッションで継続）

### Bug 概要
ルートカードの「高速 IC（NEXCO 検索用）」に表示される **entry IC が間違っている**。

| 項目 | 表示 | 正解 | 出典 |
|---|---|---|---|
| 起点 | 熊野町JCT | **戸田南IC** | ユーザーの Google Maps 副図 |
| 終点 | 厚木IC | 厚木IC（暫定 OK） | 多運営者ルートの NEXCO 区間最終 IC |
| 全長 | 154.2 km | 154.2 km | ✅ |
| 料金 | ¥3,080 (Routes API) | 検証は NEXCO 手動 | NEXCO「戸田南→厚木」¥1,730 ETC + 公社/民間道路 ≒ Google 値 |

テストケース: 埼玉県戸田市笹目1丁目38（惣右衛門公園サッカー場）→ 静岡県伊東市富戸1317-13（伊豆シャボテン動物公園）, 普通車, ETC ON, 有料道路 ON。

### Root Cause（playwright 実機検証で確定）
1. **Google Routes API の navigation instruction text に、実際の entry IC 名（戸田南）は IC suffix 付きで一切現れない**。  
   - First MERGE step (step 7): `"首都高速５号池袋線/ルート 5 に入る"` — 高速名のみ  
   - First RAMP step (step 6): `"右折して 首都高速５号/首都高速都心環状線/東名高速道路/東関東自動車道 方面のランプに入る"` — 高速名のみ  
   - その前の TURN_LEFT step (step 5): `"...国道17号 に入る (517/首都高速５号/戸田南/首都高速都心環状線/東名高速道路/東関東自動車道/コンパル/笹目コミュニティーセンター/戸田市 の表示)"` — **「戸田南」は表示リストの slash-token として埋め込まれている**  
   - 旧 regex は IC/JCT/ランプ suffix を要求するため、suffix 無しの「戸田南」を捕捉できず、step 8 の `"熊野町JCT で..."` を最初の IC-suffix 候補として誤って entry に採用してしまう

2. **Places nearbySearch（座標反查）が NEXCO IC で完全に役に立たない**。  
   - entry coord (35.8016, 139.6477) 付近で keyword=入口/IC/ランプ/インターチェンジ で検索した結果（playwright で実測、top 10 を観察）:
     - 入口 → 戸田競艇場入口(バス)・戸田緑地入口・笹目東小学校入口 など全部バス停・公園・学校  
     - IC → ファミマ・セブン・アポロステーション など全部商店  
     - ランプ → スーパーオートバックス・らんぷ小屋・LAMPHAIR・AladdinLamp・株式会社アラジンランプ など全部照明・電器ブランド  
     - インターチェンジ → BEE STAGE 早瀬店・バスターミナル など  
   - 戸田南IC や 美女木JCT 自体は Places インデックスに登録されておらず、構造的にこの戦略は破綻

3. （以前の試みで触れた）**ドラぷら kind=2 deep-link は多運営者ルート（NEXCO + 公社 + 民間）に構造的非対応**のため別途別件で切り出して廃止済み (commit `558efb8`)

### 試した解決策の履歴
| Commit | アプローチ | 結果 |
|---|---|---|
| `558efb8` | ドラぷら kind=2 リンク廃止、UI を「IC 大書き表示＋NEXCO 手動検索リンク」に再設計 | UI は OK |
| `558efb8` | exit 抽出を「最後の RAMP/OFF_RAMP step」位置不変量に変更（中途 junction の 出口 テキスト誤抓を排除） | exit はそれなりに改善 |
| `be95d7c` | `isCleanICName` から JCT 排除、`isLikelyHighwayRamp` に NEXCO IC pattern (`^[一-龯ぁ-んァ-ヶー]{2,8}(IC|ランプ)$`) 追加 | regression: 「株式会社アラジンランプ」が false positive |
| `dda7578` | `isLikelyHighwayRamp` 厳格化（漢字のみ・ランプ後缀禁止・株式会社 etc 除外）＋ `findRampNameAt` に診断 log | Places 自体に IC POI が無いことを実機で確認、Places 戦略を断念 |
| `1096651` | **表示リスト parser 追加**（`(...の表示)` 内の slash-token から純漢字 2-5 字を IC 候補として抽出、HWY prefix と 市/区/町 等を除外。entry collection のみで使用、exit と fallback では使わない） | コード単体テストでは「戸田南IC → 厚木IC」を正しく返すが本番反映が確認できず |
| `e276e2d` | `index.html` の `app.js?v=28` → `v=29` cache bust | curl で v=29 確認、playwright でも fetch 直叩きで新コード確認、しかし `<script src>` は依然 v=28 を読込 |

### 現在ブロックされているポイント
**GitHub Pages の CDN が古い HTML (v=28) をキャッシュしている**。  
- `curl -s "https://chunkangyang.github.io/CapyMap/" | grep "v=29"` は成功  
- だが playwright で navigate して `document.querySelector('script[src*="app.js"]')?.src` を見ると `app.js?v=28` のまま  
- つまり CDN ノードによっては古い HTML を返している（GitHub Pages の CDN cache TTL がまだ切れていない、もしくはエッジノード差）  
- 結果として:
  - playwright で fetch して `new Function(deployedSrc)('extractHighwayICs')` を直接呼ぶと **戸田南IC → 厚木IC** が返る（修正コードは正しい）  
  - だが page 内で動いている古い `extractHighwayICs`（v=28 内のもの）は依然 熊野町JCT を返す

### 修正そのものは正しい（実証済み）
```js
// playwright で実測:
// new Function でデプロイ済 js から extractHighwayICs を取り出し直接実行
{
  entryIC: "戸田南IC",  ✅ ground truth と一致
  exitIC:  "厚木IC",     ✅
  entryRaw: "戸田南",
  exitRaw:  "厚木"
}
```

---

## 次セッションで最初にやること

1. **CDN cache が抜けたか確認**: playwright で deployed URL を開き `document.querySelector('script[src*="app.js"]').src` が `v=29` を指すか確認
2. v=29 を読込めていれば、戸田→伊豆富戸ケースで起点が「戸田南IC」になるか実機検証
3. **依然 v=28 のままなら 強制的にキャッシュ破壊**:
   - 案 A: `app.js` をリネーム（`app.v30.js` 等）して `index.html` も書き換え（query string と違いファイル名はキャッシュキーが必ず変わる）
   - 案 B: GitHub Pages の `.html` に `<meta http-equiv="Cache-Control" content="no-cache">` を追加
   - 案 C: GitHub Actions deploy.yml に「デプロイ後 Cloudflare/GitHub の cache purge を叩く」ステップ追加（無料枠で可能か要調査）
4. 検証 OK 後 `console.log('[IC-debug] ...')` を削除（commit `dda7578` で入れた診断 log）

---

## 完成済みの実装
- [x] `index.html` — モバイル対応 UI
- [x] `css/style.css` — モバイルファーストデザイン + IC 大書き表示 + 緑色 NEXCO CTA
- [x] `js/app.js` — 経路検索・料金計算ロジック
  - **Google Maps JavaScript API** で地図表示
  - **Google Routes API v2** (`computeRoutes`) で経路計算・通行料金取得
  - **Google Places Autocomplete** で住所補完
  - **Google Geocoding API** で住所→座標変換
  - Google Sign-In（GIS）で認証（許可メール: cky1983@gmail.com, meilin709@gmail.com）
  - 複数ルート比較表示（最安・最速バッジ付き、¥/km コスパ表示）
  - Yahoo!マップ確認リンク
  - 車種別・ETC/非ETC対応（Google Routes API の tollPasses）
  - 有料道路回避オプション
  - 現在地ボタン（Geolocation API）
  - 月次使用量トラッカー（$200/月の無料枠管理）
  - **IC 抽出ロジック**（5/30 リファクタ）:
    - position invariant（exit = 最後の RAMP/OFF_RAMP step）
    - 表示リスト parser（entry の NEXCO IC 名対応）
    - Places nearbySearch fallback（厳格 filter）
- [x] `.github/workflows/deploy.yml` — GitHub Actions 自動デプロイ（secrets注入）

## 動作確認済み
| テスト | 結果 |
|--------|------|
| 東京駅→大阪駅（普通車・ETC） | 距離 554.4km / 6時間47分 / ¥9,270 / ¥17/km ✅ |
| 複数ルート比較カード表示 | ✅ |
| 最安・最速バッジ | ✅ |
| Google サインイン認証 | ✅ |
| GitHub Pages デプロイ | ✅ |
| モバイルレイアウト | ✅ |
| 戸田→伊豆富戸 entry IC 表示 | 🟡 修正コードでは戸田南IC、本番 CDN キャッシュ反映待ち |

## 今後の拡張（オプション）
- 経由地追加
- 渋滞考慮ルートのリアルタイム表示
- CI に Playwright E2E 回帰テスト追加（IC 抽出の手動デバッグを自動化）
