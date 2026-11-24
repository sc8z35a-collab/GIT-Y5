# RK T4 Flagship Rev 5.0 (True EVT Hardware Build) — Engineering & Bring-Up Report

> **Branch / Release:** `main` (Rev 5.0 True EVT — Post-EVT Review Silicon Audit & Cellular Upgrade)  
> **Architecture:** 14-Layer `1.20 mm` `3+8+3` Staggered HDI Mainboard (`S1000-2M TG170`, 1 oz Inner/Outer Cu, ENIG, POFV) + 8-Layer `0.80 mm` `JLC08081H-1080A` 50Ω CPWG RF Mezzanine (`60.8 × 33.8 mm` L-shape) + Triple-Camera Module Assembly  
> **BOM Totals (Verified from `hardware/rk_t4_netlist.json`):** 743 components (Mainboard 617, Mezzanine 111, Camera Module 15) · 124 unique real MPNs · 4,753 physical pads (Mainboard 3,999, Mezzanine 611, CamMod 143) · 625 active nets

---

## 1. Automated Verification Scorecard (All Gates 100% PASS)

| Verification Gate | Tool / Script | Result | Key Measured Metrics |
|---|---|---|---|
| **Datasheet 1:1 Pinmap & Real-Silicon ERC** | `node hardware/verify_erc.mjs` | **PASS (102/102, 0 errors)** | 100% active IC pins mapped via official datasheet modules (`hardware/ic_pinmaps/index.mjs`); 0 sequential fallbacks; `pad-pad=0`, `pad-edge=0` |
| **KiCad 9.0.8 Mainboard Schematic ERC** | `kicad-cli sch erc --severity-all --exit-code-violations` | **PASS (0 violations)** | Hierarchical root + 4 sub-sheets (`soc_ddr_emmc`, `pmic_charging`, `display_camera_usb`, `audio_sensors_io`), 728 symbols (`RK_T4.kicad_sym`) |
| **KiCad 9.0.8 Mezzanine Schematic ERC** | `kicad-cli sch erc --severity-all --exit-code-violations` | **PASS (0 violations)** | 111 RF/modem/Wi-Fi 6E/GNSS/NFC/SE/SAR components (`U701` `Quectel EG25-G` + dual LTE MHF4 `J701`/`J702` + dual Hirose `DF40C-40DP`) |
| **KiCad 9.0.8 Mainboard PCB DRC (14L HDI)** | `kicad-cli pcb drc --severity-all --all-track-errors` | **PASS (0 violations / 0 unconnected)** | 547/547 nets routed (100%), 27,546 tracks, 11,101 staggered vias (0 stacked VIPPO), 46 native `ZONE_FILLER` planes/pours |
| **KiCad 9.0.8 Mezzanine PCB DRC (8L RF)** | `kicad-cli pcb drc --severity-all --all-track-errors` | **PASS (0 violations / 0 unconnected)** | 99 active nets (85/85 inner nets routed, 0 unrouted), 1,808 tracks, 714 vias (`0.15/0.25 mm` POFV), 9/9 microwave RF feeds = 100% Pure `F.Cu` 50Ω CPWG + 98 CPWG fence vias + 98 shield perimeter vias |
| **PDN Real-Copper IR-Drop & IPC-2152 ΔT** | `node hardware/verify_pdn_ir_drop.mjs` | **PASS (14/14 rails)** | Worst DC drop: **1.60%** (`VDD_GPU_S0` 13.6 mV @ 5.0 A, limit ≤ 3.0%); Worst ΔT: **12.91 °C** (limit ≤ 20 °C @ 75 °C ambient, 1 oz Cu) |
| **High-Speed Timing Closure (RK3588S2 / JEDEC)** | `hardware/length_match_report.json` | **PASS (66/66 groups)** | LPDDR5X Byte worst **15.23 ps** (≤ 16.8 ps); CA/CK worst **10.61 ps** (≤ 25.0 ps); eMMC HS400 **0.00 ps** (≤ 5.0 ps); 53 Diff Pairs worst **0.19 ps** (≤ 1.0 ps) |
| **Pin-Accurate RK3588S2 Linux Device Tree** | `node hardware/generate_dts.mjs` | **PASS (759 lines)** | 374 RK3588S2 nets verified 1:1 against netlist; all 8 I2C buses (`&i2c0`–`&i2c7`), UART2/3/6/9, SPI0/2/3, I2S0/1/2, PDM0, PCIe2x1l1, mainline `"quectel,eg25"` binding |
| **3D CAD Mechanical Stackup & Clearance** | `npm run build && check_3d_intersections.mjs` | **PASS (0 interferences)** | 2,818 solid meshes checked (0 excluded); honest **10.900 mm** EVT body (**12.870 mm** w/ camera); 6000 mAh Si-C battery **844.89 Wh/L** (≤ 860 Wh/L) |
| **Live JLCPCB Auto-DFM (Mainboard 14L HDI)** | `check_jlcpcb_dfm.mjs` (read-only) | **`RES_OK` (`gerberResult: 0`)** | 14L `117 × 35 mm`, 11,101 drills across 8 Excellon files (`0.075 mm` laser / `0.15 mm` core), `minLineWidth/Dist = 0.08 mm`, POFV supported, 5-board quote **\$496.00** |
| **Live JLCPCB Auto-DFM (Mezzanine 8L RF)** | `check_jlcpcb_dfm.mjs` (read-only) | **`RES_OK` (`gerberResult: 0`)** | 8L `60.8 × 33.8 mm` L-shape (`gerberFileId: 77976540`), 714 drills (`0.15 mm`), `minLineWidth/Dist = 0.09 mm`, POFV supported, 5-board quote **\$106.80** (Desktop **\$101.80**) |

---

## 2. Verified Active Silicon BOM (1:1 Extracted from `hardware/rk_t4_netlist.json`)

Every active IC below is cross-verified against `hardware/rk_t4_netlist.json`, `hardware/ic_pinmaps/index.mjs`, KiCad schematics/PCBs, JLCPCB BOM CSVs, and `firmware/rk3588s2-rk-t4-evt.dts`:

| Subsystem | RefDes | Verified Real MPN | Package (Physical Pads) | Interface / Key Notes |
|---|---|---|---|---|
| **Application SoC** | `U101` | Rockchip **`RK3588S2`** | `FCCSP1253L` (17×17 mm, 1,253 balls) | All 184 power + 666 GND + 5 REXT/VBUSDET wired 1:1 |
| **LPDDR5X DRAM** | `U301` | Samsung **`K3LK7K70BM-BGCP`** | `FBGA-496` (12.4×14.0 mm, **496 balls**) | Single-package **64-bit Quad-Channel (`x64`)** 16 GB LPDDR5/5X |
| **Storage** | `U302`, `U303` | Samsung **`KLMAG1JETD-B041`**, Winbond **`W25Q128JWPIQ`** | `FBGA-153` (153 balls), `WSON-8` | 256 GB eMMC 5.1 HS400 (`0.00 ps` skew) + 16 MB QSPI NOR |
| **Primary PMIC & Rails** | `U206`, `U207`–`U209`, `U211`–`U212` | Rockchip **`RK806-1`**, 3× **`RK860-2`/`RK860-3`**, 2× Silergy **`SY8089AAAC`** | `QFN-68`, `WLCSP-20`, `SOT23-5` | SPI2_M2 PMIC + I2C0/I2C1 DVS bucks + 0.90 V / 1.10 V DDR/core bucks |
| **Battery / Charging / Qi** | `U201`, `U202`, `U205`, `U210` | TI **`BQ27Z561-R2`** (`0x55`), TI **`BQ25895RTWR`** (`0x6A`), TI **`BQ51013BRHLR`**, TI **`TPS61022RWUR`** | `DSBGA-12`, `WQFN-24`, `VQFN-20`, `VQFN-7` | 5 mΩ Kelvin sense, 5 A NVDC 5–12 V PD charger, 5 W Qi Rx, 5 V OTG boost |
| **USB-C PD / DP Alt-Mode** | `U601`, `U602`, `U603` | onsemi **`FUSB302BMPX`** (`0x22`), TI **`TUSB546-DCI`** (`0x44`), TI **`TPD4S480RUKR`** | `MLP-14`, `WQFN-40`, `WQFN-20` | USB-PD 3.0 CC + USB 3.2 Gen1 / DP 1.4 redriver + 28 V OVP/ESD |
| **Display & Fingerprint Power** | `U501`, `U502`, `U503` | TI **`TPS65632RTER`**, SGMICRO **`SGM2036-3.3`**, **`SGM2036-3.0`** | `WQFN-16`, `UTDFN-1x1` | AMOLED SWIRE ELVDD/ELVSS/AVDD + 4-lane MIPI DSI-2 + SPI0/SPI3 |
| **Audio Codec & SmartPAs** | `U801`, `U802`, `U803` | Everest **`ES8388`** (`0x10`), Dual TI **`TAS2562YFPR`** (`0x4C`/`0x4D`) | `QFN-28` (4×4 mm), `DSBGA-36` (**full 36 balls**) | Native RK3588S2 **`I2S0` + `I2C7`** (`ES8388`) & **`I2S2_M1` + `I2C7`** (dual `TAS2562YFPR`) + `MP34DT05TR-A` (`PDM0`) |
| **Haptics, Sensors & RTC** | `U804`–`U810`, `U102` | TI **`DRV2625YFFR`** (`0x5A`), ST **`LSM6DSOTR`** (`0x6A`), AKM **`AK09918C`** (`0x0C`), Bosch **`BMP581`** (`0x46`), TI **`TMAG5273A1QDBVR`** (`0x35`), Vishay **`VCNL4040M3OE`** (`0x60`), **`HYM8563TS`** (`0x51`) | `DSBGA-9`, `LGA-14`, `WLCSP-4`, `LGA-10`, `SOT-23-6`, `SMD-8`, `MSOP-8` | Zero I2C collisions across `&i2c0`–`&i2c7`; matched 1.8 V IO domains |
| **Cellular Modem (8L Mezzanine)** | `U701` | Quectel **`EG25-G`** *(100% pin-to-pin drop-in compatible w/ Japan TELEC/JATE **`EC25-J`**)* | `LGA-144` (29.0×32.0×2.40 mm, **144 pins**) | **LTE Cat 4 (150/50 Mbps)**, Global + **all Japan bands (`B1/3/8/18/19/26/28/41`)**, **2×2 DL MIMO Dual Antenna** (`ANT_MAIN` `J701` + `ANT_DIV` `J702`), USB 2.0 + VoLTE PCM (`I2S1_M0`) + UART9 |
| **Wi-Fi 6E / BT / GNSS / NFC / SE / SAR** | `U707`, `U708`, `U710`, `U716`, `U715` | Ampak **`AP6275P`**, u-blox **`MIA-M10Q-00B`**, NXP **`PN7160A1HN`** (`0x28`), ST **`STSAFE-A110`** (`0x20`), Azoteq **`IQS7222A001QNR`** (`0x44`) | `LGA-50`, `LGA-54`, `HVQFN-40`, `UFDFPN8`, `QFN-20` | PCIe 2.0 Wi-Fi 6E 2×2 + BT 5.4 (`UART6_M1`), Multi-GNSS (`UART3_M0`), NFC/FeliCa, Hardware Secure Element, SAR proximity |
| **Camera Modules (Rigid-Flex)** | `CAM_U1`–`CAM_U9`, `U402` | Sony **`LYT-818`** + **`RK1608B`** + **`DW9786`**, **`IMX355-AAJH5`**, **`IMX615-AAJH5`**, **`VL53L8CXV9GC/1`**, **`TCS3408FNM`**, TI **`LM3644TT`** (`0x63`) | COB / FBGA / WLCSP / OLGA / DSBGA-12 | 4-lane MIPI CSI-2 triple camera + discrete `SGM2036` Pi-filtered LDO bank |

---

## 3. EVT Design Review Audit Findings & Engineering Resolutions

1. **`U701` Cellular Modem Upgrade (`EG800Q-EU` → `Quectel EG25-G` / drop-in `EC25-J`)**:
   - **Finding**: Prior Mezzanine used `EG800Q-EU` (EU-only IoT LTE Cat 1 bis, 10 Mbps DL, single antenna, missing Japan platinum bands `B18/19`).
   - **Resolution**: Upgraded `U701` to **`Quectel EG25-G`** (`144-pin LGA 29.0 × 32.0 × 2.40 mm`, verified 1:1 against official `Quectel_EG25-G_Hardware_Design_V1.4` & `EC2x&EG2x-G_Compatible_Design_V1.2` Table 5), adding **LTE Cat 4 (150/50 Mbps)**, full Japanese carrier coverage (`B1/3/8/18/19/26/28/41`), **2nd 50Ω CPWG diversity RF chain** (`C702` + `J702` `I-PEX 20449-001E`), and **100% pin-to-pin drop-in compatibility with Japan TELEC/JATE `Quectel EC25-J`**. The 8-layer Mezzanine was cleanly extended into an L-shape (`60.8 × 33.8 mm`) while keeping the **14-layer Mainboard (`rk_t4_mainboard.kicad_pcb`) 100% untouched** and maintaining **0 3D interferences** at `10.900 mm` thickness.
   - **Why `EG25-G`/`EC25-J` instead of 5G `RM520N-GL` / `RG500U` / `RG255C-GL`**: `RM520N-GL` (`30×52 mm` M.2 + `3.2–4.2 mm` socket) and `RG500U` (`41×44×2.75 mm` LGA) physically exceed the smartphone upper-head envelope (`34.8 mm` width, `2.52 mm` Mezzanine Z-clearance) without shrinking the 6000 mAh battery and thickening the chassis; `RG255C-GL` LGA pinout documentation is NDA-gated (violating our zero-guesswork policy). `EG25-G`/`EC25-J` is 100% public, Linux smartphone proven (PinePhone), fits within `2.40 mm` Z-height, and supports Japanese LTE bands + VoLTE out of the box.
2. **`U301` LPDDR5X (`496-ball x64` Confirmed)**:
   - Confirmed in `hardware/rk_t4_netlist.json`, `hardware/bom.csv`, `hardware/ic_pinmaps/index.mjs`, and `rk_t4_mainboard.kicad_pcb`: the physical hardware has **always** used **`Samsung K3LK7K70BM-BGCP`** (`FBGA-496 12.4×14.0 mm`, single-package 64-bit Quad-Channel `x64`, all 496 balls). The erroneous reference in the prior edition of this report has been corrected.
3. **`U801` Audio Codec (`ES8388` I2S) & `U802`/`U803` SmartPAs (Dual `TAS2562YFPR`) Confirmed**:
   - Confirmed in `hardware/rk_t4_netlist.json`, BOM CSVs, KiCad schematics/PCB, and `firmware/rk3588s2-rk-t4-evt.dts`: `U801` is **`Everest ES8388`** (`QFN-28`, native RK3588S2 `I2S0` + `I2C7 0x10`), and `U802`/`U803` are **dual `TI TAS2562YFPR`** (`DSBGA-36`, full 36-ball footprint, `I2S2_M1` + `I2C7 0x4C/0x4D`). No SoundWire codec or duplicate amplifier exists in the hardware design.

---

## 4. High-Speed Timing & PDN Measured Results

### 4.1 High-Speed Timing Closure (`hardware/length_match_report.json`)

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

### 4.2 Real-Copper PDN DC IR-Drop & IPC-2152 Thermal Ampacity (`hardware/pdn_ir_drop_report.json`)

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

## 5. JLCPCB Live BOM Stock Reality (Read-Only Audit)

- **Mainboard (`hardware/mfg/jlcpcb_bom_stock_audit.json`)**:
  - **73 / 98 physical BOM lines (528 / 611 = 86.4% of SMT placements)** are **IN STOCK for 5× EVT build** at JLCPCB/LCSC (**\$726.40** for 5 boards, including `RK3588S2`, `RK806-1`, `KLMAG1JETD-B041`, `BQ25895RTWR`, `ES8388`, `DF40C-40DS-0.4V(51)`).
  - **17 lines OUT OF STOCK, 1 LOW STOCK (`TPD6E05U06RVZR`), 7 NOT IN LCSC LIB** (including Samsung `K3LK7K70BM-BGCP`, dual TI `TAS2562YFPR`, `TUSB546-DCI`, `TPS65632RTER`, `TPS61022RWUR`, `LM3644TT`, `BQ27Z561-R2`, `HYM8563TS`, Murata `01005` / `DFE201610E` inductors) require distributor procurement (DigiKey/Mouser/Arrow/direct OEM) and JLCPCB Global Sourcing / consigned SMT kitting.
  - **0 LCSC part number mismatches** across the entire BOM.
- **RF Mezzanine (`hardware/mfg/jlcpcb_mezz_bom_stock_audit.json`)**:
  - **20 / 30 physical BOM lines (83 / 109 = 76.1% of SMT placements)** are **IN STOCK for 5× EVT build** (**\$96.68** for 5 boards, including `AP6275P` Wi-Fi 6E + BT 5.4 and Hirose `DF40C-40DP-0.4V(51)`).
  - **6 OUT OF STOCK (`EG25-G` [`C9900022634` exact match, or drop-in `EC25-J`], 5× `20449-001E` MHF4, `MIA-M10Q-00B`, `PN7160A1HN`, `STSAFE-A110`, `IQS7222A001QNR`) + 4 NOT IN LCSC LIB (`NX2016SA-37.4M`, `NX2016SA-27.12M`, `DFE201610E-0R56M=P2`, `GRM022R60J103ME15`)** require distributor/consigned procurement.
  - **0 LCSC part number mismatches**.

---

## 6. Honest Remaining Physical EVT Bench Bring-Up Items

Passing 100% of EDA, DRC, ERC, PDN, timing, 3D CAD, and fab auto-DFM gates confirms the design is **manufacturable and free of known electrical/logical/geometric blockers**. Before mass production (DVT/PVT), the following physical bench activities remain mandatory:

1. **JLCPCB CAM Engineering EQ & Impedance Coupon Sign-Off**: Confirm final prepreg/core dielectric thicknesses on the 14L `S1000-2M` `3+8+3` stackup during JLCPCB's "Subject to Review" CAM EQ step and inspect TDR impedance coupons (40Ω/50Ω SE, 80Ω/85Ω/90Ω/100Ω Diff).
2. **Consigned Part Procurement & BGA X-Ray Inspection**: Source the 25 Mainboard + 10 Mezzanine non-stock/consigned components via authorized distributors (for Japan domestic certification/TELEC, populate `Quectel EC25-J` directly onto the 100% pin-compatible `EG25-G` `U701` LGA-144 footprint); perform X-ray inspection on `RK3588S2` (0.4 mm pitch), `K3LK7K70BM-BGCP`, `TAS2562YFPR`, `KLMAG1JETD-B041`, and `EG25-G` after reflow.
3. **Power-On Bring-Up & LPDDR5X Training**: Measure cold rail impedance (short check), verify `RK806-1` PMIC power-up sequencing with oscilloscope, flash RK3588S2 Rockchip `rkbin` DDR5X init + U-Boot + Linux kernel with `firmware/rk3588s2-rk-t4-evt.dts`, and run DDR eye-margin / `memtester` soak tests.
4. **RF VNA Tuning & OTA Chamber Verification**: Tune matching networks on the 8L RF Mezzanine for LTE Cat 4 Dual-Ant MIMO (`EG25-G` / `EC25-J` `ANT_MAIN` + `ANT_DIV`), Wi-Fi 6E 2×2 (`AP6275P`), Multi-GNSS (`MIA-M10Q-00B`), and NFC (`PN7160A1HN`) inside the real titanium/ceramic enclosure using a VNA (`S11 < -10 dB`) and OTA anechoic chamber.
5. **Thermal Soak & Dynamic PDN Transient Validation**: Verify transient load-step voltage droop (`di/dt`) on `VDD_GPU_S0` / `VDD_CPU_BIG*` with active decoupling and validate vapor-chamber/graphite skin temperatures under sustained CPU+GPU+LTE load.
6. **Camera Rigid-Flex Harness, Display Panel & Mechanical CNC Tolerance Stackup**: Fabricate the custom camera module rigid-flex FPC and CNC titanium frame/midframe EVT samples, verify optical/acoustic gasket sealing (`VCNL4040M3OE`, `MP34DT05TR-A`), and bring up MIPI CSI-2/DSI-2 sensor/panel drivers in Linux/Android BSP.
