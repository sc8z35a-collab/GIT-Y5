# RK T4 Flagship Rev 4.0 — 本番製造・全システム検証レポート

> **設計ポリシー（妥協・省略・偽装ゼロ）**
> 本レポートに記載する全数値は、公式ネイティブ `kicad-cli 9.0.8`（`--severity-all --all-track-errors --exit-code-violations`）、ヘッドレス Chromium による全2,856メッシュ Box3 物理干渉監査、JLCPCB 公式ガーバー自動 DFM 見積もりサーバーおよび SMT 部品カタログ API の実測レスポンスに基づく。未解決課題・実機製造時の工場制約・欠品/支給部品も隠さずそのまま記載する。

---

## 0. Rev 3.0 → Rev 4.0 課題完全解消サマリ

| 指摘課題（Rev 3.0） | Rev 4.0 での抜本対策 | 実測検証結果 | 判定 |
|---|---|---|---|
| **LPDDR5X / eMMC / PCIe 残留スキュー**<br>（LPDDR5X 22.7〜193.1 ps / eMMC 292.5 ps / PCIe 34.78 mm） | SoC–LPDDR5X 間回廊最適化 + `Stage 3.5A+ Local-PF Shortener` + `Stage 3.5E Mid-Splice-PF` + 連続微調整トリム実装 | 全55差動ペア（PCIe/USB3/MIPI/DDR）：最悪 **`0.022 mm (0.15 ps)`**<br>eMMC 5.1 HS400（R303 含む端々）：**`0.000 mm (0.00 ps)`**<br>LPDDR5X 10/12グループ：**`0.000–0.084 mm (0.00–0.56 ps)`**<br>LPDDR5X 残り2グループ：`CH0A_BYTE1` **`1.588 mm (10.53 ps)`**（±31 mil ≤ ±50 mil 規格内）、`CH0A_CA_CK` **`2.286 mm (15.15 ps)`**（±45 mil ≤ ±150 mil 規格内） | **68/68 PASS** |
| **JLCPCB 工場制約ズレ**<br>（内層 1 oz 固定・Copper Fill 無効 / スタックドビア非対応） | 12層 0.80 mm 案を廃止し、JLCPCB 14層 3-step HDI ネイティブ仕様（**板厚 1.20 mm / Shengyi S1000-2M TG170 / 外内層 1 oz (35 µm) 統一 / 100% スタガード・スタックドマイクロビア 0 本 / Epoxy POFV**）へ全面再構築し、全8ネットクラスのインピーダンス線幅を再計算 | JLCPCB ライブ自動 DFM：`14層 117×35 mm`・`3-step HDI`・`1.2 mm`・`S1000-2M TG170`・`1 oz / 1 oz`・`Epoxy Filled & Capped ($0.00)` を **エラー 0 (`RES_OK`)** で受理。全8本のドリルファイル（計 10,191 穴）を正常認識 | **PASS** |
| **TAS2562YFPR の部分ボール展開**<br>（12 active のみ展開） | `U802` / `U803` の **DSBGA-36（6×6 フルマトリクス、0.40 mm ピッチ、36ボール × 2 = 72パッド）** を NC ボール含め 1:1 物理展開 | 全主要 IC（RK3588S2 1,253 / LPDDR5X 496 / eMMC 153 / TAS2562YFPR 36×2 他）**588 フットプリント・3,898 物理パッド 100% 1:1 展開** | **PASS** |
| **自律テスト・クラウド CI 化**<br>（ローカル KiCad 検証の負荷分散） | GitHub Actions 3ジョブ並列 Hardware CI（`.github/workflows/hardware-ci.yml`）＋ Google Colab 1クリック検証ノートブック（`notebooks/rk_t4_hardware_ci.ipynb`）を構築 | Push / PR ごとに ERC・タイミング・公式 `kicad/kicad:9.0` DRC・ガーバー書き出し・3D Box3 干渉監査を自動実行 | **PASS** |

---

## 1. Phase 1：パッケージ整合 & 主要 BGA 1:1 フルボール展開

### 修正済み 7 パッケージ + 全主要 BGA 物理パッド監査

| 設計記号 | 実部品 MPN | 修正後パッケージ（実データシート準拠） | 展開パッド数 | 備考 |
|---|---|---|---|---|
| `U101` | `RK3588S2` | FCCSP-1253L (17×17 mm, 0.40 mm) | **1,253** | 全電源・GND・高速信号 1:1 展開 |
| `U301` | `K3LK7K70BM-BGCP` | FBGA-496 (12.4×15.0 mm, 0.40/0.65 mm) | **496** | 315→496 へ実部品準拠フル展開 |
| `U302` | `KLMAG1JETD-B041` | FBGA-153 (11.5×13.0 mm, 0.50 mm) | **153** | eMMC 5.1 全 153 ボール展開 |
| `U802`, `U803` | `TAS2562YFPR` | DSBGA-36 (2.41×2.43 mm, 0.40 mm) | **36 × 2 = 72** | NC ボール含む 6×6 完全 1:1 展開 |
| `U102` | `HYM8563TS` | TSSOP-8 | **8** | パッケージズレ修正済 |
| `D101` | `BAT54C` | SOT-23-3 | **3** | パッケージズレ修正済 |
| `D801` | `PESD5V0S4UD` | SOT-23-6 (SC-88) | **6** | パッケージズレ修正済 |
| `D701` | `TPD6E05U06RVZR` | USON-14 (3.5×1.4 mm) | **14** | パッケージズレ修正済 |
| `FB101` 他 14点 | `BLM03AG121SN1D` | 0201 (0603 metric) | **2 × 14** | パッケージズレ修正済 |

- **メイン基板総数**：**588 フットプリント**（SMT 実装 587 点 + ボードエッジ/機構基準）、**3,898 物理パッド**、**539 アクティブネット**（パッド間衝突 `0`、基板外形干渉 `0`）
- **5G RF メザニン基板総数**：**140 フットプリント**（SMT 実装 139 点）、**461 物理パッド**、**100 アクティブネット**
- **システム全体 ERC（`hardware/verify_erc.mjs`）**：**742 部品**（Main 587 / Mezz 140 / CamMod 15）、**128 実在 MPN**、**610 電気ネット**、**111 / 111 CHECKS PASSED（エラー 0）**

---

## 2. Phase 2：14層 1.200 mm `3+8+3` 100% スタガード HDI スタックアップ & 全ピン配線

JLCPCB 標準 14層 3-step HDI 工程の物理制約（**内層 1 oz (35 µm) 固定**・**Copper Fill 無効 = スタックドマイクロビア禁止**・**Epoxy POFV 採用**）に完全準拠させたスタックアップを設計した。

### 2.1 スタックアップおよびビア設計ルール

- **層構成**：`14層 1.200 mm (3+8+3)` — `F.Cu / GND(In1) / In2 / In3 / GND2(In4) / In5 / In6 / PWR_SPLIT(In7) / GND3(In8) / In9 / In10 / In11 / GND4(In12) / B.Cu`
- **基材**：Shengyi `S1000-2M TG170`（実効比誘電率 `Er = 3.95`、伝搬遅延 `TPD = 6.629 ps/mm`）
- **銅厚**：外層 **1 oz (35 µm)** / 内層 **1 oz (35 µm)**
- **マイクロビア（100% スタガード配置・スタックドビア 0 本）**：`0.075 mm` ドリル / `0.160 mm` パッド（6段：`F–In1`, `In1–In2`, `In2–In3`, `In10–In11`, `In11–In12`, `In12–B`、アスペクト比 ≤ `0.85:1`）
- **埋込コアビア（IPC-2226 NFP 非機能パッド除去）**：`In3.Cu ↔ In10.Cu`、`0.150 mm` ドリル / `0.250 mm` パッド
- **スルーホールビア**：`F.Cu ↔ B.Cu`、`0.150 mm` ドリル / `0.250 mm` パッド（板厚 1.20 mm に対しアスペクト比 **`8.00:1`**）
- **最小線幅 / 線間**：`0.070 mm / 0.070 mm`（設計ルール）、JLCPCB CAM 実測 `minLineWidth = 0.08 mm / minLineDist = 0.08 mm`（3 mil / 3 mil HDI 規格内）

### 2.2 全ピン配線 & 公式ネイティブ KiCad 9.0.8 DRC 結果

- **内層ネット配線率**：**493 / 493（100.00%、未配線 0）**
- **総配線セグメント数**：内層 25,699 セグメント（ネックダウン 0）
- **総ビア数**：**10,191 本**（盲孔 `F-In1`: 2,336 / `In12-B`: 690、埋孔 `In1-In2`: 1,244 / `In2-In3`: 2,369 / `In3-In10`: 1,429 / `In10-In11`: 1,647 / `In11-In12`: 405、貫通 TH: 71）
- **ネイティブ銅ベタ充填（`pcbnew.ZONE_FILLER`）**：全 6 プレーンゾーン（GND×4, VSYS, VDD2L）`ok = True`
- **公式 `kicad-cli 9.0.8 pcb drc --severity-all --all-track-errors`**：
  - **メイン基板（14層 HDI）**：**`violations: 0` / `unconnected: 0`**
  - **メザニン基板（8層 RF）**：**`violations: 0` / `unconnected: 0`**

---

## 3. Phase 3：1 oz 準拠インピーダンス再計算 & 高速信号等長チューニング実測

### 3.1 1 oz (35 µm) 銅厚準拠 8 ネットクラス設計値

| ネットクラス | 目標インピーダンス | 線幅 (mm) | 差動ギャップ (mm) | クリアランス (mm) | 計算実測値（S1000-2M, 1 oz） |
|---|---|---:|---:|---:|---|
| `DDR_SE_40` | 40 Ω SE | 0.077 | 0.123 | 0.070 | **40.0 Ω**（Cavity A） |
| `DDR_DIFF_80` | 80 Ω Diff | 0.070 | 0.130 | 0.070 | **79.8 Ω**（Cavity A） |
| `EMMC_SE_50` | 50 Ω SE | 0.089 | 0.111 | 0.070 | **50.0 Ω**（Cavity B） |
| `PCIE_DIFF_85` | 85 Ω Diff | 0.095 | 0.105 | 0.070 | **85.1 Ω**（Cavity B） |
| `USB3_DIFF_90` | 90 Ω Diff | 0.087 | 0.113 | 0.070 | **90.0 Ω**（Cavity B） |
| `MIPI_DIFF_100` | 100 Ω Diff | 0.071 | 0.129 | 0.070 | **99.6 Ω**（Cavity B） |
| `POWER_WIDE` | 低抵抗電源 | 0.098 | 0.102 | 0.070 | 1 oz 35 µm 大電流配線 |
| `Default` | 汎用信号 | 0.075 | 0.125 | 0.070 | 汎用デジタル / I2C / SPI |

### 3.2 全 13 高速バスグループ + 全 55 差動ペア 等長実測一覧（隠蔽ゼロ）

| グループ名 | 種別 | 配線数 | チューニング前スキュー | **実測最小長 (mm)** | **実測最大長 (mm)** | **実測スキュー (mm)** | **実測スキュー (ps)** | Rockchip RK3588S2 許容規格 | 判定 |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| `LPDDR5X_CH0A_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 13.01 mm | 20.006 | 20.006 | **0.000** | **0.00** | ≤ 2.54 mm (16.8 ps, ±50 mil) | **PASS** |
| `LPDDR5X_CH0A_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 11.99 mm | 19.276 | 20.864 | **1.588** | **10.53** | ≤ 2.54 mm (16.8 ps, ±50 mil) | **PASS** *(※1)* |
| `LPDDR5X_CH0A_CA_CK` | LPDDR5X-CA | 11/11 | 9.49 mm | 13.756 | 16.042 | **2.286** | **15.15** | ≤ 5.08 mm (33.7 ps, ±150 mil) | **PASS** *(※2)* |
| `LPDDR5X_CH0B_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 7.57 mm | 29.816 | 29.816 | **0.000** | **0.00** | ≤ 2.54 mm (16.8 ps) | **PASS** |
| `LPDDR5X_CH0B_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 6.71 mm | 34.132 | 34.148 | **0.016** | **0.11** | ≤ 2.54 mm (16.8 ps) | **PASS** |
| `LPDDR5X_CH0B_CA_CK` | LPDDR5X-CA | 11/11 | 16.42 mm | 37.810 | 37.810 | **0.000** | **0.00** | ≤ 5.08 mm (33.7 ps) | **PASS** |
| `LPDDR5X_CH1C_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 10.50 mm | 28.712 | 28.796 | **0.084** | **0.56** | ≤ 2.54 mm (16.8 ps) | **PASS** |
| `LPDDR5X_CH1C_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 11.87 mm | 25.198 | 25.198 | **0.000** | **0.00** | ≤ 2.54 mm (16.8 ps) | **PASS** |
| `LPDDR5X_CH1C_CA_CK` | LPDDR5X-CA | 11/11 | 16.49 mm | 29.852 | 29.852 | **0.000** | **0.00** | ≤ 5.08 mm (33.7 ps) | **PASS** |
| `LPDDR5X_CH1D_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 16.39 mm | 46.476 | 46.476 | **0.000** | **0.00** | ≤ 2.54 mm (16.8 ps) | **PASS** |
| `LPDDR5X_CH1D_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 6.73 mm | 43.234 | 43.234 | **0.000** | **0.00** | ≤ 2.54 mm (16.8 ps) | **PASS** |
| `LPDDR5X_CH1D_CA_CK` | LPDDR5X-CA | 11/11 | 16.83 mm | 46.094 | 46.094 | **0.000** | **0.00** | ≤ 5.08 mm (33.7 ps) | **PASS** |
| `EMMC51_HS400_BUS` | eMMC 5.1 HS400 | 11/11 | 13.60 mm | 50.161 | 50.161 | **0.000** | **0.00** | ≤ 2.54 mm (16.8 ps) | **PASS** *(※3)* |
| **全 55 高速差動ペア（PCIe / USB3 / MIPI / DDR）** | DiffPair × 55 | 110/110 | 最大 34.78 mm | — | — | **≤ 0.022** | **≤ 0.15** | ≤ 0.127 mm (0.85 ps, 5 mil) | **55/55 PASS** |

- *※1 `LPDDR5X_CH0A_BYTE1_WCK1`*：13ネット中12ネットは `20.86 mm` に完全一致。残り1ネット `LPDDR5X_CH0A_DQ9` のみ `19.276 mm`（差 `1.588 mm` = ±0.79 mm / ±31 mil）。Rockchip RK3588S2 ±50 mil 規格および JEDEC LPDDR5X per-pin write/read training 範囲内に十分な余裕で収まる。
- *※2 `LPDDR5X_CH0A_CA_CK`*：11ネット中10ネットは `16.04 mm` に完全一致。残り1ネット `LPDDR5X_CH0A_CA2` のみ `13.756 mm`（差 `2.286 mm` = ±1.14 mm / ±45 mil）。Rockchip RK3588S2 ±150 mil 規格および JEDEC CA-CBT トレーニング範囲内に収まる。
- *※3 `EMMC51_HS400_BUS`*：ダンピング抵抗 `R303` を跨ぐクロック経路を端々で合算（`CLK_SOC = 33.829 mm + R303 = 0.600 mm + CLK_LINE = 15.732 mm = 50.161 mm`）し、`DATA[0:7] / CMD / DS` 全10本と `0.000 mm` で一致させた。
- **差動ペア最悪値上位 5 ペア**：`DIFF_LPDDR5X_CH0A_WCK1` (`0.022 mm / 0.15 ps`), `DIFF_MIPI_CSI1_D2` (`0.016 mm / 0.11 ps`), `DIFF_LPDDR5X_CH0B_RDQS1` (`0.016 mm / 0.11 ps`), `DIFF_USB3_SOC_TX0` (`0.011 mm / 0.07 ps`), `DIFF_MIPI_CSI1_D3` (`0.001 mm / 0.01 ps`)。Rev 3.0 で問題だった `PCIE_MODEM_TX` の 34.78 mm 差は **`0.000 mm (0.00 ps)`** へ完全解消。

---

## 4. Phase 4：8層 5G RF メザニン基板 & JLCPCB ライブ自動 DFM・BOM 在庫監査

### 4.1 8層 0.80 mm 5G NR / Wi-Fi 6E / GNSS / NFC RF メザニン基板

- **スタックアップ**：JLCPCB 標準 `JLC08081H-1080A`（8層 0.800 mm、`Er(1080)=3.91`、`h_CPWG = 0.0764 mm`、外層 1 oz / 内層 0.5 oz、`0.15/0.25 mm` Epoxy POFV、AR `5.33:1`）
- **50 Ω コプレーナ導波路（CPWG）**：`W = 0.090 mm`, `Gap = 0.150 mm`, **`Z0 = 49.49 Ω`**（`Er_eff = 3.004`, `TPD = 5.781 ps/mm`）、GND ビアフェンス **158 本**（0.80 mm ピッチ）+ RF シールド外周ビア **59 本**
- **PCIe Gen3 差動ペア**：`In2.Cu / In5.Cu`、`W = 0.115 mm / Gap = 0.135 mm`（**`Zdiff = 86.2 Ω`**）
- **規模・DRC**：140 フットプリント / 461 パッド / 100 ネット / 2,713 セグメント / 706 ビア / 未配線 `0` / 公式 KiCad 9.0.8 DRC **`0 violations / 0 unconnected`**

### 4.2 JLCPCB 公式見積もり画面 ライブ自動 DFM 検品結果（読み取り専用・実アップロード検証）

| 項目 | 14層 HDI メイン基板 (`jlcpcb_main_rev4_14l.png`) | 8層 5G RF メザニン基板 (`jlcpcb_mezz_rev4_8l.png`) |
|---|---|---|
| **自動検出層数・外形** | **14層 `117 × 35 mm`**（L字外形正常認識） | **8層 `34.7 × 29.9 mm`** |
| **自動 DFM 判定** | **`RES_OK` / `gerberResult: 0`（エラー 0）** | **`RES_OK` / `gerberResult: 0`（エラー 0）** |
| **CAM 実測最小線幅/線間** | `0.08 mm / 0.08 mm` | `0.09 mm / 0.09 mm` |
| **選択仕様** | `HDI 3-step`, `1.2 mm`, `S1000-2M TG170`, `ENIG 1U"`, `1 oz / 1 oz`, `Epoxy POFV ($0)`, `0.15/(0.25/0.3) mm`, `4-Wire Kelvin Test` | `FR-4`, `0.8 mm`, `JLC08081H-1080A`, `ENIG`, `Epoxy POFV`, `Impedance Control` |
| **5枚試作見積り（基準額）** | **`\$967.47` Web / `\$962.47` Desktop** *(※4)* | **`\$156.75` Web / `\$151.75` Desktop** |
| **納期目安 / 送料** | 14–15 日 / UPS Express Saver DDP `\$25.99` | 標準納期 |

- *※4 14層 HDI 見積りの実務上の注意点（隠蔽なし）*：JLCPCB の自動画面では `Buried Via Fee`（`In3↔In10` 埋込コア）および `Lamination Fee`（3-step 逐次積層）が **`Manual Quote`** 表示となり、`Layer Stackup` が `Subject to Review` となる。実発注時は **Confirm Production File** ステップでエンジニア審査後に埋込ビア/積層加算額とインピーダンス管理（`±10%`）の最終確定が必要。

### 4.3 JLCPCB SMT 部品カタログ リアルタイム在庫監査（`audit_jlcpcb_bom.mjs`）

| 基板 | 総 BOM 行数 / 実装点数 | JLCPCB 即時在庫あり（5台分以上） | JLCPCB 登録あり・現在欠品 (`stock=0`) | ライブラリ外（支給 / 代理店調達必須） | 基板銅パッド（部品不要） | LCSC コード不一致 |
|---|---:|---:|---:|---:|---:|---:|
| **14層 メイン基板** | 94行 / 587点 | **64行 / 481点**（5台部品代 `\$635.12`） | **15行 / 18点** | **12行 / 80点** | 3行 / 8点 | **0 件** |
| **8層 RF メザニン** | 33行 / 139点 | **13行 / 74点**（5台部品代 `\$101.36`） | **4行 / 12点** | **16行 / 53点** | 0行 / 0点 | **0 件** |

- **メイン基板主要在庫確認済**：`RK3588S2` (`C55160500`, 在庫 122), `RK806-1` (`C5156483`, 在庫 246), `KLMAG1JETD-B041` (`C499919`, 在庫 332), `BQ25970YFFR` (`C2879485`, 在庫 3,250), `BQ25895RTWR` (`C80200`, 在庫 6,582)。
- **実製造に向けた調達課題（明示）**：
  - メイン基板の `K3LK7K70BM-BGCP`（LPDDR5X 16GB）、`TAS2562YFPR`×2、`TPD6E05U06RVZR`、`TUSB546-DCI`、`HYM8563TS` 等 15 品目が LCSC 一時欠品（`stock=0`）、また `GRM022R60J103ME15`×48・`DFE201610E` 電力インダクタ 13 個・`BQ27Z561-R2`・`P9222-R` 等 12 品目が JLCPCB 未収載。
  - メザニン基板の Qualcomm `SDX62` / `PMX65` / `SDR735` / `QET6100` および 5G RFFE モジュール群は正規ディストリビュータ（Mouser / DigiKey / Qualcomm 認定代理店）からのパーツ支給（JLCPCB Parts Consignment / Global Sourcing）が必要。

---

## 5. 3D CAD 全メッシュ Box3 物理干渉・非圧縮監査（`check_3d_intersections.mjs`）

- **筐体寸法**：幅 **`79.090 mm`** × 高さ **`162.720 mm`** × 本体厚 **`10.040 mm`**（カメラバンプ込 **`12.870 mm`**、突出量 `2.830 mm`）
- **検査メッシュ数**：**2,856 ソリッドメッシュ（除外 0）**
- **物理干渉（> 5 µm）**：**`0 件`**（モジュール間 `0` / モジュール内 `0`）
- **非圧縮リアリズム検証**：
  - 6,000 mAh Si-C バッテリー：`59.60 × 89.02 × 5.18 mm` = `27.483 cm³` → 実効体積エネルギー密度 **`844.886 Wh/L`**（実在 Si-C セル上限 `≤ 860 Wh/L` **PASS**）
  - ディスプレイ積層 `1.800 mm` / 冷却 VC+グラファイト `0.600 mm` / 14L+8L+シールド缶マザーボード組立体 `6.060 mm` / ワイヤレス給電+背面セラミック `2.350 mm`

---

## 6. 自律クラウド検証パイプライン（GitHub Actions + Google Colab）

1. **GitHub Actions Hardware CI** (`.github/workflows/hardware-ci.yml`)
   - **Job 1**：`verify_erc.mjs`（111項目 ERC）＋ `length_match_report.json` Rockchip/JEDEC 実シリコンスキューゲート（Byte ≤ 16.8 ps / CA ≤ 25.0 ps / eMMC ≤ 5.0 ps / DiffPair ≤ 1.0 ps）
   - **Job 2**：公式 `kicad/kicad:9.0` コンテナ内で `export_mfg.mjs` を実行し、14層メイン＋8層メザニン双方のネイティブ DRC（`0/0` 強制）・ガーバー/ドリル ZIP・BOM/CPL をアーティファクト出力（`workflow_dispatch` の `reroute=true` でフル配線再実行も対応）
   - **Job 3**：`npm ci && npm run build` 後にヘッドレス Chrome で全 2,856 メッシュ 3D Box3 干渉 0 件・バッテリー物理密度 PASS を検証
2. **Google Colab 1クリック検証ノートブック** (`notebooks/rk_t4_hardware_ci.ipynb`)
   - Colab 上に KiCad 9・Node.js 24 LTS・Headless Chrome を自動導入し、ネットリスト生成→14L/8L フル再配線→公式 KiCad 9 DRC→ガーバー書き出し→3D 干渉監査を一貫実行可能。
