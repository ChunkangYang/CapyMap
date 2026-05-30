# CASE-004: IC抽取ノイズ除去 & 検証リンク刷新

日期: 2026-05-30

## 問題

1. **IC表示が誤っていた**: 「方面のランプ」のような方向案内テキストが IC 名として抽出されていた。
   - 原因: regex `/([ぁ-鿿\w]{1,12}(?:IC|JCT|ランプ))/` が「○○方面のランプに入る」の「方面のランプ」にマッチしていた。
2. **Yahoo!マップ確認リンクの目的不一致**: Yahoo は独自の routing engine で経路を再計算するため、CapyMap が表示した経路と一致しない。費用検証用途には使えない。

## 修正

### 1. IC抽取 regex の強化 (`extractHighwayICs`)
- regex を `/([一-龯ぁ-んァ-ヶーA-Za-z0-9々]{1,10})(IC|JCT|ランプ|本線料金所)/g` に変更
- ノイズトークン（`方面`, `出口`, `入口`, `本線`, `高速`, `方向`）を含む match を除外
- 「本線料金所」を新たに支持
- 入口 IC / 出口 IC は IC・ランプ・本線料金所 を優先選択（JCT は中間ジャンクションとして除外）

### 2. 検証リンクの刷新
- Yahoo!マップ リンクを廃止
- 代わりに **Google マップ で経路** リンク（緯度経度直指定で経路をピンポイント再現）
- **ドラぷら で料金検証** リンク（IC 名を CapyMap カードで確認後、手動入力で料金検証可能）

## 検証

### IC抽取 unit test（playwright で実機 fetch + eval）
入力 steps:
- `中山道を北東に進む`
- `首都高速5号池袋線方面のランプに入る` ← ノイズ
- `中台ランプから首都高速5号池袋線に入る`
- `熊野町JCTを首都高速中央環状線方向へ進む`
- `海老名JCTで東名高速道路方面に進む`
- `厚木ICで一般道路に降りる`
- `厚木出口を通過` ← ノイズ

結果:
```json
{ "entryIC": "中台ランプ", "exitIC": "厚木IC" }
```

「方面のランプ」「方面」「出口」が全て除外され、入口=中台ランプ・出口=厚木IC が正しく識別された。

### コード fetch 検証 (`app.js?v=9`)
| 確認項目 | 結果 |
|----------|------|
| ノイズフィルタ実装 | ✅ NOISE = ['方面', ...] |
| Yahoo リンク削除 | ✅ `map.yahoo.co.jp/route/car` 消失 |
| Googleマップ builder | ✅ `https://www.google.com/maps/dir/?api=1&origin=...` |
| ドラぷら builder | ✅ `https://www.driveplaza.com/dp/SearchTop` |

証拠スクリーンショット: `CASE-004-ic-extraction-and-verify-links.png`

## なぜ Yahoo は使えなかったか（root cause）
- Yahoo の `route/car?from=X&to=Y` URL は from/to の住所文字列を渡すだけで、Yahoo 側で経路を再計算する
- CapyMap は Google Routes API v2 で経路計算しており、ルーティング・エンジンが異なれば同じ住所でも経路は別物になる
- これは API 仕様レベルの制約で、URL 形式の工夫では解決不可能

→ 解決策: Google マップは座標で経路を再現できるので routing engine が同じ Google 同士で経路一致を保証。料金検証は IC ベースのドラぷらに分離。
