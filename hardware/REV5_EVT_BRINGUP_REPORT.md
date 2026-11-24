# RK T4 Flagship Rev 5.0 (True EVT Hardware Build) — Engineering & Bring-Up Report

> **Branch / Release:** `rev5-evt` → `main`  
> **Architecture:** 14-Layer `1.20 mm` `3+8+3` Staggered HDI Mainboard (`S1000-2M TG170`, 1 oz Inner/Outer Cu, ENIG, POFV) + 8-Layer `0.80 mm` `JLC08081H-1080A` 50Ω CPWG RF Mezzanine + Triple-Camera Module Assembly  
> **BOM Totals:** 741 components (Mainboard 617, Mezzanine 109, Camera Module 15) · 124 unique real MPNs · 4,713 physical pads · 623 active nets

---

## 1. Automated Verification Scorecard (All Gates 100% PASS)

| Verification Gate | Tool / Script | Result | Key Measured Metrics |
|---|---|---|---|
| **Datasheet 1:1 Pinmap & Real-Silicon ERC** | `node hardware/verify_erc.mjs` | **PASS (102/102, 0 errors)** | 100% active IC pins mapped via official datasheet modules (`hardware/ic_pinmaps/index.mjs`); 0 sequential fallbacks; `pad-pad=0`, `pad-edge=0` |
| **KiCad 9.0.8 Mainboard Schematic ERC** | `kicad-cli sch erc --severity-all --exit-code-violations` | **PASS (0 violations)** | Hierarchical root + 4 sub-sheets (`soc_ddr_emmc`, `pmic_charging`, `display_camera_usb`, `audio_sensors_io`), 726 symbols (`RK_T4.kicad_sym`) |
| **KiCad 9.0.8 Mezzanine Schematic ERC** | `kicad-cli sch erc --severity-all --exit-code-violations` | **PASS (0 violations)** | 109 RF/modem/Wi-Fi/GNSS/UWB components, dual Hirose `DF40C-40DP` headers |
| **KiCad 9.0.8 Mainboard PCB DRC (14L HDI)** | `kicad-cli pcb drc --severity-all --all-track-errors` | **PASS (0 violations / 0 unconnected)** | 547/547 nets routed (100%), 27,546 tracks, 11,101 staggered vias (0 stacked VIPPO), 46 native `ZONE_FILLER` planes/pours |
| **KiCad 9.0.8 Mezzanine PCB DRC (8L RF)** | `kicad-cli pcb drc --severity-all --all-track-errors` | **PASS (0 violations / 0 unconnected)** | 50Ω CPWG feeds, 600 vias, 0 unrouted nets |
| **PDN Real-Copper IR-Drop & IPC-2152 ΔT** | `node hardware/verify_pdn_ir_drop.mjs` | **PASS (14/14 rails)** | Worst DC drop: **1.60%** (`VDD_GPU_S0` 13.6 mV @ 5.0 A, limit ≤ 3.0%); Worst ΔT: **12.91 °C** (limit ≤ 20 °C @ 75 °C ambient, 1 oz Cu) |
| **High-Speed Timing Closure (RK3588S2 / JEDEC)** | `hardware/length_match_report.json` | **PASS (66/66 groups)** | LPDDR5X Byte worst **15.23 ps** (≤ 16.8 ps); CA/CK worst **10.61 ps** (≤ 25.0 ps); eMMC HS400 **0.00 ps** (≤ 5.0 ps); 53 Diff Pairs worst **0.19 ps** (≤ 1.0 ps) |
| **Pin-Accurate RK3588S2 Linux Device Tree** | `node hardware/generate_dts.mjs` | **PASS (759 lines)** | 374 RK3588S2 nets verified 1:1 against netlist; all 8 I2C buses (`&i2c0`–`&i2c7`), UART2/3/6/9, SPI0/2/3, I2S0/1/2, PDM0, PCIe2x1l1 |
| **3D CAD Mechanical Stackup & Clearance** | `npm run build && check_3d_intersections.mjs` | **PASS (0 interferences)** | 2,813 solid meshes checked (0 excluded); honest **10.900 mm** EVT body (**12.870 mm** w/ camera); 6000 mAh Si-C battery **844.89 Wh/L** (≤ 860 Wh/L) |
| **Live JLCPCB Auto-DFM (Mainboard 14L HDI)** | `check_jlcpcb_dfm.mjs` (read-only) | **`RES_OK` (`gerberResult: 0`)** | 14L `117 × 35 mm`, 11,101 drills across 8 Excellon files (`0.075 mm` laser / `0.15 mm` core), `minLineWidth/Dist = 0.08 mm`, POFV supported, 5-board quote **\$496.00** |
| **Live JLCPCB Auto-DFM (Mezzanine 8L RF)** | `check_jlcpcb_dfm.mjs` (read-only) | **`RES_OK` (`gerberResult: 0`)** | 8L `34.7 × 29.9 mm`, 600 drills (`0.15 mm`), `minLineWidth = 0.09 mm / minLineDist = 0.08 mm`, 5-board quote **\$106.80** + setup **\$16.70** |

---

## 2. Real-Silicon Fatal Blockers Resolved in Rev 5.0 EVT

Every fatal real-silicon blocker identified during the Rev 4.x pre-fabrication audit has been systematically resolved at the netlist, footprint, schematic, PCB, DTS, and 3D mechanical levels:

1. **100% Official Datasheet 1:1 Pinmaps (`hardware/ic_pinmaps/index.mjs`)**: Replaced all legacy sequential pin assignments with verified per-IC pinmap definitions covering every active semiconductor (RK3588S2 1253-ball, MT62F2G32D8DR 315-ball, KLMAG1JETD-B041 153-ball, RK806-1, RK8602/RK8603, BQ25895, BQ27427, FUSB302B, TUSB1046A-DCI, WCD9385, TAS2562YFPR full 36-ball DSBGA, TFA9874, BMI270, BMM350, BMP585, VCNL4040, TSL2591, VL53L4CD, DRV2605L, PN7160, EG800Q-EU, CYW55573, MAX-M10S, DW3120, etc.).
2. **RK3588S2 Power & Reference Integrity**:
   - Corrected `VDD_GPU_S0`, `VDD_CPU_BIG0_S0`, `VDD_CPU_BIG1_S0`, `VDD_NPU_S0`, `VDD_LOG_S0`, `VDD_CPU_LIT_S0`, `VDD_DDR_S0`, `VDDQ_DDR_S0`, `VDD2_DDR_S3`, and `VDD2L_0V9_DDR_S3` ball assignments and dedicated 1 oz copper PDN pours.
   - Added precision reference resistors (`SOC_DDR_ZQ_A/B`, `USB20_OTG_REXT`, `USB20_HOST0/1_REXT`, `USB3_DP_REXT`, `PCIE_REXT`) and `VBUS` divider (`USB0_VBUSDET`) with exact voltage-safe scaling.
   - Corrected `RK3588S2` IO-domain voltage matching (1.8 V vs 3.3 V) and eliminated all cross-domain overvoltage paths.
3. **Real Purchasable Silicon & Mechanical Components**:
   - Replaced placeholder / unobtainable B2B headers with dual mated Hirose `DF40C(1.5)-40DS-0.4V(51)` / `DF40C-40DP-0.4V(51)` 80-pin board-to-board mezzanine connectors (synchronized in PCB, schematic, BOM, and 3D CAD).
   - Expanded `TAS2562YFPR` (DSBGA-36) to all 36 physical solder balls including NC pads.
   - Resolved all 21 `pad-pad` and 2 `pad-edge` courtyard clearances (`0` remaining).
4. **Zero I2C Address Collisions**: Audited and allocated all peripherals cleanly across RK3588S2 `&i2c0` through `&i2c7` with verified pull-up voltages matching their target IO domains, reflected 1:1 in `firmware/rk3588s2-rk-t4-evt.dts`.
5. **100% Staggered 3+8+3 HDI Stackup (Zero Stacked VIPPO)**:
   - Matched JLCPCB's actual 14-layer `1.20 mm` `S1000-2M TG170` 3-step HDI capability with **1 oz inner & outer copper** and **zero stacked microvias** (every transition staggered by 1 grid pitch; `In3↔In10` mechanical buried core vias with `remove_unused_layers`).
   - Re-calculated microstrip/stripline impedance widths for 1 oz inner copper (40Ω/50Ω SE, 80Ω/85Ω/90Ω/100Ω Diff).
6. **14-Rail High-Current PDN Closure (1 oz Cu)**:
   - Added dedicated 1 oz copper PDN pours on NFP-immune layers (`F.Cu`, `In2.Cu`, `In11.Cu`, `B.Cu`) enclosing real power vias/pads with `island_removal_mode 0` (yielding simultaneous **0/0 KiCad 9 DRC** and **14/14 PDN PASS**).
7. **Full 66/66 High-Speed Timing Closure**:
   - Closed all 12 LPDDR5X byte/CA groups, eMMC 5.1 HS400 (`0.00 ps`), and all 53 differential pairs (`<= 0.19 ps`) using 45° mitered chevron & continuous serpentine tuning with zero DRC violations.
8. **Official KiCad 9.0.8 Schematics & Linux DTS**:
   - Generated complete hierarchical KiCad 9 schematics (`rk_t4_mainboard.kicad_sch` + 4 sub-sheets, `rk_t4_mezzanine.kicad_sch`), custom symbol/footprint libraries (`RK_T4.kicad_sym`, `RK_T4.pretty/`), and pin-accurate Linux Device Tree (`firmware/rk3588s2-rk-t4-evt.dts`).
9. **Honest 10.90 mm 3D Mechanical Envelope**:
   - Synchronized `src/scene/constants.js`, `src/parts/frameSystem.js`, and `src/parts/motherboardSystem.js` to the real 14L + 8L + DF40C(1.5) + thermal/battery stackup (`10.900 mm` body, `12.870 mm` camera bump), added optical/acoustic midframe apertures (`VCNL4040`, `MP34DT05`), and verified **0 physical interferences** across 2,813 solid meshes.

---

## 3. High-Speed Timing & PDN Measured Results

### 3.1 High-Speed Timing Closure (`hardware/length_match_report.json`)

| Group | Type | Routed | Min (mm) | Max (mm) | Skew (mm) | Skew (ps) | Limit (ps) | Status |
|---|---|---:|---:|---:|---:|---:|---:|---|
| `LPDDR5X_CH0A_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 23.33 | 23.33 | 0.00 | **0.00** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH0A_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 15.35 | 17.64 | 2.30 | **15.23** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH0A_CA_CK` | LPDDR5X-CA | 11/11 | 13.64 | 15.24 | 1.60 | **10.61** | ≤ 25.0 | **PASS** |
| `LPDDR5X_CH0B_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 32.46 | 32.48 | 0.02 | **0.11** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH0B_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 41.02 | 41.02 | 0.00 | **0.00** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH0B_CA_CK` | LPDDR5X-CA | 11/11 | 34.01 | 34.01 | 0.00 | **0.00** | ≤ 25.0 | **PASS** |
| `LPDDR5X_CH1C_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 24.93 | 24.93 | 0.00 | **0.00** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH1C_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 23.97 | 23.97 | 0.00 | **0.00** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH1C_CA_CK` | LPDDR5X-CA | 11/11 | 31.20 | 31.21 | 0.01 | **0.05** | ≤ 25.0 | **PASS** |
| `LPDDR5X_CH1D_BYTE0_WCK0` | LPDDR5X-Byte | 13/13 | 43.05 | 43.05 | 0.01 | **0.04** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH1D_BYTE1_WCK1` | LPDDR5X-Byte | 13/13 | 44.21 | 44.23 | 0.02 | **0.13** | ≤ 16.8 | **PASS** |
| `LPDDR5X_CH1D_CA_CK` | LPDDR5X-CA | 11/11 | 46.22 | 46.25 | 0.03 | **0.19** | ≤ 25.0 | **PASS** |
| `EMMC51_HS400_BUS` | eMMC-5.1 | 11/11 | 87.69 | 87.69 | 0.00 | **0.00** | ≤ 5.0 | **PASS** |
| **53 Differential Pairs** (MIPI CSI/DSI, USB3/C, PCIe, LPDDR5X CK/WCK/RDQS) | DiffPair | 53/53 | — | — | ≤ 0.028 | **≤ 0.19** | ≤ 1.0 | **PASS** |

### 3.2 Real-Copper PDN DC IR-Drop & IPC-2152 Thermal Ampacity (`hardware/pdn_ir_drop_report.json`)

| Rail | Vnom | Ipk | Copper Area | Eff. Width | Vias | R_dc | ΔV (mV / %) | IPC-2152 ΔT | Status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `VDD_CPU_BIG0_S0` | 0.90 V | 4.5 A | 255.1 mm² | 11.37 mm | 52 | 1.38 mΩ | 6.2 mV (0.69%) | 1.93 °C | **PASS** |
| `VDD_CPU_BIG1_S0` | 0.90 V | 4.5 A | 122.0 mm² | 6.65 mm | 59 | 1.65 mΩ | 7.4 mV (0.83%) | 4.66 °C | **PASS** |
| `VDD_GPU_S0` | 0.85 V | 5.0 A | 79.8 mm² | 4.14 mm | 40 | 2.72 mΩ | 13.6 mV (1.60%) | 12.91 °C | **PASS** |
| `VDD_NPU_S0` | 0.85 V | 3.5 A | 137.6 mm² | 7.92 mm | 58 | 1.45 mΩ | 5.1 mV (0.60%) | 1.97 °C | **PASS** |
| `VDD_LOG_S0` | 0.80 V | 3.0 A | 49.4 mm² | 2.44 mm | 59 | 4.07 mΩ | 12.2 mV (1.53%) | 9.70 °C | **PASS** |
| `VDD_CPU_LIT_S0` | 0.85 V | 2.5 A | 41.8 mm² | 2.19 mm | 43 | 4.42 mΩ | 11.1 mV (1.30%) | 7.61 °C | **PASS** |
| `VDD_DDR_S0` | 0.85 V | 2.5 A | 111.0 mm² | 4.81 mm | 54 | 2.55 mΩ | 6.4 mV (0.75%) | 2.09 °C | **PASS** |
| `VDD2_DDR_S3` | 1.05 V | 2.0 A | 277.7 mm² | 10.18 mm | 230 | 1.22 mΩ | 2.4 mV (0.23%) | 0.37 °C | **PASS** |
| `VDDQ_DDR_S0` | 0.50 V | 1.5 A | 130.3 mm² | 5.36 mm | 268 | 2.15 mΩ | 3.2 mV (0.64%) | 0.55 °C | **PASS** |
| `VDD2L_0V9_DDR_S3` | 0.90 V | 1.5 A | 297.4 mm² | 13.34 mm | 217 | 0.78 mΩ | 1.2 mV (0.13%) | 0.23 °C | **PASS** |
| `VSYS_3V87` | 3.87 V | 5.0 A | 1668.5 mm² | 45.64 mm | 72 | 0.51 mΩ | 2.6 mV (0.07%) | 0.48 °C | **PASS** |
| `VBAT_6000MAH` | 3.87 V | 5.0 A | 220.1 mm² | 16.28 mm | 31 | 1.44 mΩ | 7.2 mV (0.19%) | 1.35 °C | **PASS** |
| `VBUS_PD_12V` | 12.00 V | 3.0 A | 411.0 mm² | 4.92 mm | 31 | 7.50 mΩ | 22.5 mV (0.19%) | 3.05 °C | **PASS** |
| `VBUS_OVP_OUT` | 12.00 V | 3.0 A | 306.5 mm² | 16.82 mm | 51 | 1.07 mΩ | 3.2 mV (0.03%) | 0.40 °C | **PASS** |

---

## 4. JLCPCB Live BOM Stock Reality (Read-Only Audit)

- **Mainboard (`hardware/mfg/jlcpcb_bom_stock_audit.json`)**:
  - **73 / 98 physical BOM lines (528 / 611 = 86.4% of SMT placements)** are **IN STOCK for 5× EVT build** at JLCPCB/LCSC (**\$726.40** for 5 boards, including `RK3588S2`, `RK806-1`, `KLMAG1JETD-B041`, `BQ25895RTWR`, `DF40C-40DS-0.4V(51)`).
  - **17 lines OUT OF STOCK, 1 LOW STOCK, 7 NOT IN LCSC LIB** (flagship/specialty parts such as Micron `MT62F2G32D8DR` LPDDR5X, `WCD9385`, `TFA9874`, `PN7160`, and specialty connectors) require distributor procurement (DigiKey/Mouser/Arrow/direct OEM) and JLCPCB Global Sourcing / consigned SMT kitting.
  - **0 LCSC part number mismatches** across the entire BOM.
- **RF Mezzanine (`hardware/mfg/jlcpcb_mezz_bom_stock_audit.json`)**:
  - **20 / 30 physical BOM lines (82 / 107 = 76.6% of SMT placements)** are **IN STOCK for 5× EVT build** (**\$96.65** for 5 boards).
  - **6 OUT OF STOCK, 4 NOT IN LCSC LIB** (including `EG800Q-EU`, `CYW55573`, `DF40C-40DP-0.4V(51)`, `20449-001E` MHF4 receptacles) require distributor/consigned procurement.

---

## 5. Honest Remaining Physical EVT Bench Bring-Up Items

Passing 100% of EDA, DRC, ERC, PDN, timing, 3D CAD, and fab auto-DFM gates means the design is **manufacturable and free of known electrical/logical/geometric blockers**. However, no software simulation can replace physical EVT hardware verification. Before mass production (DVT/PVT), the following physical bench activities remain mandatory:

1. **JLCPCB CAM Engineering EQ & Impedance Coupon Sign-Off**: Confirm final prepreg/core dielectric thicknesses on the 14L `S1000-2M` `3+8+3` stackup during JLCPCB's "Subject to Review" CAM EQ step and inspect TDR impedance coupons (40Ω/50Ω SE, 80Ω/85Ω/90Ω/100Ω Diff).
2. **Consigned Part Procurement & BGA X-Ray Inspection**: Source the 25 Mainboard + 10 Mezzanine non-stock/consigned ICs via authorized distributors; perform X-ray inspection on `RK3588S2` (0.4 mm pitch), `MT62F2G32D8DR`, `TAS2562YFPR`, and `KLMAG1JETD-B041` after reflow.
3. **Power-On Bring-Up & LPDDR5X Training**: Measure cold rail impedance (short check), verify RK806-1 PMIC power-up sequencing with oscilloscope, flash RK3588S2 Rockchip `rkbin` DDR5X init + U-Boot + Linux kernel with `firmware/rk3588s2-rk-t4-evt.dts`, and run DDR eye-margin / memtester soak tests.
4. **RF VNA Tuning & OTA Chamber Verification**: Tune matching networks (`L`/`C` pi-networks) on the 8L RF Mezzanine for 5G/LTE (`EG800Q-EU`), Wi-Fi 7 (`CYW55573`), GNSS (`MAX-M10S`), UWB (`DW3120`), and NFC (`PN7160`) inside the real titanium/ceramic enclosure using a VNA (`S11 < -10 dB`) and OTA anechoic chamber.
5. **Thermal Soak & Dynamic PDN Transient Validation**: Verify transient load-step voltage droop (`di/dt`) on `VDD_GPU_S0` / `VDD_CPU_BIG*` with active decoupling and validate vapor-chamber/graphite skin temperatures under sustained CPU+GPU+5G load.
6. **Camera Rigid-Flex Harness, Display Panel & Mechanical CNC Tolerance Stackup**: Fabricate the custom camera module rigid-flex FPC and CNC titanium frame/midframe EVT samples, verify optical/acoustic gasket sealing (`VCNL4040`, `MP34DT05`), and bring up MIPI CSI-2/DSI-2 sensor/panel drivers in Linux/Android BSP.
