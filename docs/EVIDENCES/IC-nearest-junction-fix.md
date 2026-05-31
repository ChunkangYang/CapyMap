# Evidence: entry/exit IC を OSM nearest-junction で実名化

最終更新: 2026-05-31

## 背景 / 根因
Google Routes API の navigation instruction は entry/exit の **IC 専名を省略**し（出口すら「国道135号方面」止まり）、Places nearbySearch は NEXCO IC で店舗・バス停を返して使えない。結果、旧ロジックは instruction 中の **JCT 名**（大泉JCT・海老名JCT 等）を起訖に拾い、ドラぷら では JCT を出発/到着 IC に選べないため **査定不能**だった。

## 修正
1. OSM `highway=motorway_junction`（name+座標, 全日本 6849 件, ODbL）を `js/ic-coords.json` に bundle。
2. `getEntryCoord`/`getExitCoord` の maneuver 座標から **最寄り IC を引いて実名化**（`nearestICName`）。Places 反查を置換。
3. ドラぷら が値付けしない有料道路（真鶴道路・熱海ビーチライン等 民間/公社）を検出し、カードに「料金には NEXCO 以外の有料道路が含まれます」と注記（`detectNonNexcoTolls`、「（…の表示）」標識リストは除外）。

## テストケース
戸田市笹目1丁目38 → 伊東市富戸1317-13（普通車・ETC・有料道路ON）。実 Routes API レスポンス（3 ルート）に対し `test_ic_logic.js` で検証。

## 結果（node test_ic_logic.js）
| ルート | 距離 | entry（最寄り IC・距離）| exit | 非NEXCO有料 |
|---|---|---|---|---|
| 1 | 154.2km | **戸田南** (39m) | **小田原西IC** (24m) | 真鶴道路・熱海ビーチライン |
| 2 | 194.9km | **大泉IC** (7m) | **小田原西IC** (24m) | 真鶴道路・熱海ビーチライン |
| 3 | 181.6km | **戸田南** (39m) | **小田原西IC** (24m) | 真鶴道路・熱海ビーチライン |

- 全ルートで **JCT が消え、ドラぷら で選択可能な実 IC** に。修正前: route2=`大泉JCT→海老名JCT`, route3=`戸田南→海老名JCT`。
- 非NEXCO注記の false positive（伊豆スカイラインは標識表示のみで走行せず）は「の表示」ブロック除去で解消。

## 既知の限界
- Route 2 の entry が、外環の流入 IC（戸田付近）ではなく ramp step 終点に最も近い **大泉IC** になる（RAMP の endLocation が大泉JCT 付近に置かれるため）。同一 NEXCO 網内の実 IC で査定可能だが、厳密な流入点より数 km 下流。概算比較には許容。
