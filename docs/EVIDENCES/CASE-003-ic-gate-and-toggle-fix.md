# CASE-003: IC閘口修正 & 有料道路Toggle直觀化

日期: 2026-05-30

## 修正內容

### 1. IC閘口表示修正
**問題**: extractHighwayICs() の regex が IC/JCT のみ対応し、ランプ（例: 中台ランプ）を見逃す。
最初にマッチする JCT（熊野町JCT 等）を起点 IC として表示してしまう。

**修正**:
- regex を `/([ぁ-鿿\w]{1,12}(?:IC|JCT|ランプ))/` に変更
- 抽出後に IC/ランプ のみを優先フィルタ（JCT は中間ジャンクションとして除外）
- entryIC = 最初の IC/ランプ、exitIC = 最後の IC/ランプ

### 2. 有料道路Toggle直觀化
**問題**: checkbox unchecked = "使用"、checked = "回避" と直感に反する。

**修正**:
- ON（checked） = 有料道路を使用（avoidTolls = false）
- OFF（unchecked） = 有料道路を回避（avoidTolls = true）
- 初期状態: checked（ON）
- テキスト: "ON" / "OFF"

## 検証結果

### デプロイ確認 (v8)
- `app.js?v=8` がロードされていること: ✅
- Toggle 初期状態: `checked=true`, テキスト="ON" ✅

### コード検証（fetch app.js?v=8）
| 確認項目 | 結果 |
|----------|------|
| toggleLine | `avoid-text').textContent = this.checked ? 'ON' : 'OFF'` ✅ |
| avoidTollsLine | `avoidTolls = !document.getElementById('avoid-tolls').checked` ✅ |
| icReLine | `const icRe = /([ぁ-鿿\w]{1,12}(?:IC\|JCT\|ランプ))/` ✅ |
| entryExitsLine | `entryExits = allICs.filter(ic => ic.endsWith('IC') \|\| ic.endsWith('ランプ'))` ✅ |

証拠スクリーンショット: `CASE-003-toggle-and-ic-fix.png`
