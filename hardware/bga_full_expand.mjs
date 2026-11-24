/**
 * RK T4 Rev 3.0 — True 1:1 Physical BGA Ball Map & Net Expansion Module
 * =====================================================================
 * Loads verified official silicon ball maps (ZERO pin omission):
 *   - U101 RK3588S2        : 1,253 physical FCCSP1253L balls (Rockchip Datasheet V1.7)
 *   - U301 K3LK7K70BM-BGCP :   496 physical FBGA-496 balls   (JEDEC x64 4CH LPDDR5/5X)
 *   - U302 KLMAG1JETD-B041 :   153 physical FBGA-153 balls   (JEDEC JESD84-B51 MO-276)
 *
 * Maps every connected power, ground, DDR, eMMC, MIPI, USB3/DP, PCIe, clock, reset,
 * and peripheral signal to its EXACT real physical ball number, while preserving all
 * NC / RFU / VSF / unused GPIO balls as physical SMD pads (net "").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAP_DIR = path.join(__dirname, 'bga_maps');

export const RK3588S2_MAP = JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'rk3588s2_1253.json'), 'utf8'));
export const LPDDR5X_MAP  = JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'lpddr5x_496.json'), 'utf8'));
export const EMMC51_MAP   = JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'emmc51_153.json'), 'utf8'));
export const TAS2562_MAP  = JSON.parse(fs.readFileSync(path.join(MAP_DIR, 'tas2562_36.json'), 'utf8'));

/**
 * Canonical LPDDR5X net name for a 4-channel x64 (CH0_A, CH0_B, CH1_C, CH1_D) bus.
 * Channels A & B belong to RK3588S2 DDR_CH0; Channels C & D belong to DDR_CH1.
 */
function lpddrNet(ch, sig) {
  const grp = (ch === 'A' || ch === 'B') ? `CH0${ch}` : `CH1${ch}`;
  return `LPDDR5X_${grp}_${sig}`;
}

/**
 * Map a Rockchip RK3588S2 DDR_CH* pin name to the exact canonical LPDDR5X net.
 */
function mapRkDdrPin(name) {
  // Power & PLL pins under DDR_CH* are handled before this, only signal pins arrive here.
  let m;
  if ((m = /^DDR_CH[01]_DQ(\d+)_([ABCD])$/.exec(name))) {
    return lpddrNet(m[2], `DQ${m[1]}`);
  }
  if ((m = /^DDR_CH[01]_DM([01])_([ABCD])$/.exec(name))) {
    return lpddrNet(m[2], `DMI${m[1]}`);
  }
  if ((m = /^DDR_CH[01]_DQS([01])([PN])_([ABCD])$/.exec(name))) {
    return lpddrNet(m[3], `RDQS${m[1]}_${m[2]}`);
  }
  if ((m = /^DDR_CH[01]_WCK([01])([PN])_([ABCD])$/.exec(name))) {
    return lpddrNet(m[3], `WCK${m[1]}_${m[2]}`);
  }
  if ((m = /^DDR_CH[01]_A([0-6])_([ABCD])$/.exec(name))) {
    return lpddrNet(m[2], `CA${m[1]}`);
  }
  if ((m = /^DDR_CH[01]_CK_([ABCD])$/.exec(name))) {
    return lpddrNet(m[1], 'CK_P');
  }
  if ((m = /^DDR_CH[01]_CKB_([ABCD])$/.exec(name))) {
    return lpddrNet(m[1], 'CK_N');
  }
  if ((m = /^DDR_CH[01]_LP4\/4X_CKE([01])\/LP5_CS\1_([ABCD])$/.exec(name))) {
    return lpddrNet(m[2], `CS${m[1]}`);
  }
  if (/^DDR_CH[01]_RESET_[ABCD]$/.test(name)) {
    return 'DDR_RESET_N';
  }
  if ((m = /^DDR_CH([01])_ZQ_([ABCD])$/.exec(name))) {
    return `SOC_DDR_ZQ_${m[2]}`;
  }
  // LPDDR4/4X-only CS0/CS1 pins are unused in LPDDR5/5X mode per Rockchip RK3588S HDG
  if (/^DDR_CH[01]_LP4\/4X_CS[01]_[ABCD]$/.test(name)) {
    return '';
  }
  return '';
}

/**
 * Map a Rockchip RK3588S2 power/ground ball name to its exact board power rail.
 */
function mapRkPowerPin(name) {
  if (/^(A?VSS|TVSS|.*_AVSS|.*_VSS)/.test(name)) return 'GND';
  if (/^VDD_LOGIC(_\d+)?$/.test(name)) return 'VDD_LOG_S0';
  if (/^VDD_GPU(_\d+|_MEM_\d+)?$/.test(name)) return 'VDD_GPU_S0';
  if (/^VDD_CPU_BIG0(_\d+)?$/.test(name)) return 'VDD_CPU_BIG0_S0';
  if (/^VDD_CPU_BIG1(_\d+)?$/.test(name)) return 'VDD_CPU_BIG1_S0';
  if (/^VDD_CPU_BIG[01]_MEM(_\d+)?$/.test(name)) return 'VDD_CPU_BIG_MEM_S0';
  if (/^VDD_CPU_LIT(_\d+|_MEM_\d+)?$/.test(name)) return 'VDD_CPU_LIT_S0';
  if (/^VDD_NPU(_\d+|_MEM_\d+)?$/.test(name)) return 'VDD_NPU_S0';
  if (/^VDD_VDENC(_\d+|_MEM_\d+)?$/.test(name)) return 'VDD_VDENC_S0';
  if (/^DDR_CH[01]_VDD(_\d+|_MIF_\d+)?$/.test(name)) return 'VDD_DDR_S0';
  if (/^DDR_CH[01]_VDDQ(_\d+|_CK(_\d+)?)?$/.test(name)) return 'VDDQ_DDR_S0';
  if (/^DDR_CH[01]_VDDQ_CKE(_\d+)?$/.test(name)) return 'VDDQ_DDR_CKE_S3';
  if (/^DDR_CH[01]_PLL_DVDD$/.test(name)) return 'VDDA_DDR_PLL_S0';
  if (/^DDR_CH[01]_PLL_AVDD1V8$/.test(name)) return 'AVCC_1V8_S0';
  if (/^PLL_AVDD1V8$/.test(name)) return 'AVCC_1V8_S0';
  // Rev 5.0 FIX: Rockchip Datasheet V1.7 names ball Y26 "PLL_DVDD0V75" (without underscore)!
  if (/^PLL_DVDD_?0V75$/.test(name)) return 'VDD_0V75_S0_PLL';
  if (/^PMU_0V75/.test(name)) return 'VDD_0V75_S3';
  if (/^PMUIO1_1V8/.test(name)) return 'VCC_1V8_PMU_S3';
  if (/^PMUIO2_1V8/.test(name)) return 'VCC_1V8_PMU_S3';
  if (/^PMUIO2(_\d+)?$/.test(name)) return 'VCC_1V8_S3';
  if (/^OSC_1V8/.test(name)) return 'VCC_1V8_PMU_S3';
  if (/^EMMCIO_1V8/.test(name)) return 'VCC_1V8_S3';
  // Rev 5.0 FIX: RK T4 has NO microSD slot; tie VCCIO2 (GPIO4_D0..D5) directly to fixed 1.8V VCC_1V8_S0
  // so SWD, KEY_VOL_DN, FG_ALRT_N, CHG_INT_N, HAPTIC_TRIG all operate cleanly in 1.8V IO domain!
  if (/^VCCIO2(_1V8)?$/.test(name)) return 'VCC_1V8_S0';
  if (/^VCCIO[1456](_1V8)?(_\d+)?$/.test(name)) return 'VCC_1V8_S0';
  if (/^SARADC_AVDD_1V8/.test(name)) return 'AVCC_1V8_S0';
  // Rev 5.0 FIX: Connect BOTH OTP_VCC1V8 AND OTP_VDDOTP_0V75 (ball AN8, mandatory for eFuse/BootROM!)
  if (/^OTP_VCC1V8/.test(name)) return 'AVCC_1V8_S0';
  if (/^OTP_VDDOTP_0V75/.test(name)) return 'VDD_0V75_S0';
  // Rev 5.0 FIX: Match MIPI_D/C_PHY0/1 power balls (AR27, AR33, AR34, AR35, AR30, AT30) with slash!
  if (/^MIPI_D(\/)?C_?PHY\d_VDD_1V2|^MIPI_DPHY.*_AVDD_1V2/.test(name)) return 'AVDD_1V2_S0';
  if (/^MIPI_D(\/)?C_?PHY\d_VDD_1V8|^MIPI_.*AVCC1V8|^MIPI_.*AVDD_1V8/.test(name)) return 'AVCC_1V8_S0';
  if (/^MIPI_D(\/)?C_?PHY\d_VDD$|^MIPI_.*AVCC0V75|^MIPI_.*AVDD_0V75/.test(name)) return 'VDD_0V75_S0';
  if (/^TYPEC0_DP0_VDDH_1V8|^USB20_AVDD_1V8/.test(name)) return 'AVCC_1V8_S0';
  if (/^TYPEC0_DP0_VDD(A)?_0V85/.test(name)) return 'AVDD_0V85_S0';
  if (/^USB20_DVDD_0V75/.test(name)) return 'VDD_0V75_S0';
  if (/^USB20_AVDD_3V3/.test(name)) return 'AVDD_3V3_S0';
  if (/^PCIE20_.*AVDD_1V8/.test(name)) return 'AVCC_1V8_S0';
  if (/^PCIE20_.*AVDD_0V85/.test(name)) return 'AVDD_0V85_S0';
  // Rev 5.0 FIX: Match ALL HDMI/eDP_TX0_VDD* rails (AK12, AL14, AM13, AN12, AN10)!
  if (/^HDMI\/eDP_TX0_(A)?VDD_0V75/.test(name)) return 'VDD_0V75_S0';
  if (/^HDMI\/eDP_TX0_(A)?VDD(_IO|_CMN)?_1V8/.test(name)) return 'AVCC_1V8_S0';
  return null;
}

/**
 * Exact RK3588S2 Non-DDR, Non-Power Silicon Ball -> Board Net Mapping (Rev 5.0 True EVT).
 * Every single ball and peripheral mux (_M0/_M1/_M2/_M4) is verified directly against
 * Rockchip RK3588S Datasheet V1.7 Table 2-1 (`hardware/bga_maps/rk3588s2_1253.json`)
 * and audited automatically by `hardware/verify_erc.mjs`.
 */
export const RK_EXACT_SIGNAL_BALLS = {
  // Clocks, Reset, Thermal Shutdown, Recovery, SARADC, PMIC SPI2_M2 & Sleep Controls
  T41:  'CLK_24M_IN',
  T42:  'CLK_24M_OUT_R',
  AD38: 'CLK_32K_RTC',
  V42:  'PMIC_RESETB',
  AC39: 'TSADC_SHUT_ORG',
  AW15: 'SARADC_IN0_RECOVERY',
  AY13: 'BOARD_ID_ADC',
  AV11: 'BAT_NTC_ADC',
  AV13: 'THERM_SOC_ADC',
  AY15: 'THERM_CHG_ADC',
  AW13: 'THERM_RFPA_ADC',
  W40:  'PMIC_SPI_CS0',        // SPI2_CS0_M2
  Y39:  'PMIC_SPI_CLK_SOC',    // SPI2_CLK_M2
  W39:  'PMIC_SPI_MOSI_SOC',   // SPI2_MOSI_M2
  Y38:  'PMIC_SPI_MISO',       // SPI2_MISO_M2
  W41:  'PMIC_SLEEP1',         // PMIC_SLEEP1
  AD39: 'PMIC_SLEEP2',         // PMIC_SLEEP2
  W42:  'PMIC_INT_L',          // Dedicated PMIC_INT_L / GPIO0_A7_u (Rev 5.0 FIX!)
  AG42: 'RTC_INT_L',           // GPIO0_B2_u

  // eMMC 5.1 HS400 (12 exact balls — Radxa CM5 V2.21 Page 19)
  Y41:  'EMMC_D0',
  Y40:  'EMMC_D1',
  AA41: 'EMMC_D2',
  AA42: 'EMMC_D3',
  AB42: 'EMMC_D4',
  AD42: 'EMMC_D5',
  AD41: 'EMMC_D6',
  AE41: 'EMMC_D7',
  AE42: 'EMMC_CMD',
  AB41: 'EMMC_CLK_SOC',
  AC40: 'EMMC_DATA_STROBE',
  AD40: 'EMMC_RSTN',

  // Fail-Safe Quad-SPI NOR Flash (FSPI_M2 mux — GPIO3_A/C, 6 exact balls!)
  AV38: 'FSPI_CLK',   // FSPI_CLK_M2
  AU34: 'FSPI_CS0',   // FSPI_CS0N_M2
  AR38: 'FSPI_D0',    // FSPI_D0_M2
  AR37: 'FSPI_D1',    // FSPI_D1_M2
  AT38: 'FSPI_D2',    // FSPI_D2_M2
  AT40: 'FSPI_D3',    // FSPI_D3_M2

  // Display: LTPO AMOLED MIPI DSI-2 (MIPI_DPHY0_TX — 10 exact balls) + TPS65632 SWIRE + Touch SPI3_M1
  BB34: 'MIPI_DSI0_CLK_P', BA34: 'MIPI_DSI0_CLK_N',
  BB31: 'MIPI_DSI0_D0_P',  BA31: 'MIPI_DSI0_D0_N',
  BA32: 'MIPI_DSI0_D1_P',  BB32: 'MIPI_DSI0_D1_N',
  BA35: 'MIPI_DSI0_D2_P',  BB35: 'MIPI_DSI0_D2_N',
  BB37: 'MIPI_DSI0_D3_P',  BA37: 'MIPI_DSI0_D3_N',
  AV40: 'LCD_TE_SYNC',     // MIPI_TE0 / GPIO3_C2_d
  AW39: 'LCD_RST_N',       // GPIO3_C3_d
  AV34: 'LCD_ERR_FG',      // GPIO3_C5_u
  AW38: 'OLED_PMIC_EN',    // GPIO3_C1_d -> TPS65632 EN
  AV37: 'OLED_PMIC_CTRL',  // GPIO3_A6_d -> TPS65632 CTRL (SWIRE single-wire!)
  AV35: 'TP_INT_N',        // GPIO3_B4_u
  AY19: 'TP_RST_N',        // GPIO4_A3_d
  AV22: 'TP_SPI_CLK',      // SPI3_CLK_M1 (Rev 5.0 FIX — true hardware SPI3_M1!)
  AW22: 'TP_SPI_MOSI',     // SPI3_MOSI_M1
  AU23: 'TP_SPI_MISO',     // SPI3_MISO_M1
  AW23: 'TP_SPI_CS',       // SPI3_CS0_M1

  // 45MP Main Camera + RK1608B Pre-ISP (MIPI_DPHY0_RX — 10 exact balls)
  BB41: 'MIPI_CSI0_CLK_P', BA41: 'MIPI_CSI0_CLK_N',
  BA38: 'MIPI_CSI0_D0_P',  BB38: 'MIPI_CSI0_D0_N',
  BA40: 'MIPI_CSI0_D1_P',  AY40: 'MIPI_CSI0_D1_N',
  AY42: 'MIPI_CSI0_D2_P',  BA42: 'MIPI_CSI0_D2_N',
  AW41: 'MIPI_CSI0_D3_P',  AW42: 'MIPI_CSI0_D3_N',

  // 16MP Ultra-Wide Camera (MIPI_DPHY1_RX — 10 exact balls)
  BA26: 'MIPI_CSI1_CLK_P', BB26: 'MIPI_CSI1_CLK_N',
  BA23: 'MIPI_CSI1_D0_P',  BB23: 'MIPI_CSI1_D0_N',
  BB25: 'MIPI_CSI1_D1_P',  BA25: 'MIPI_CSI1_D1_N',
  BB28: 'MIPI_CSI1_D2_P',  BA28: 'MIPI_CSI1_D2_N',
  BA29: 'MIPI_CSI1_D3_P',  BB29: 'MIPI_CSI1_D3_N',

  // 32MP Selfie Camera (MIPI_CSI0 4-lane — 10 exact balls)
  AN42: 'MIPI_CSI2_CLK_P', AN41: 'MIPI_CSI2_CLK_N',
  AL42: 'MIPI_CSI2_D0_P',  AL41: 'MIPI_CSI2_D0_N',
  AK41: 'MIPI_CSI2_D1_P',  AK42: 'MIPI_CSI2_D1_N',
  AT41: 'MIPI_CSI2_D2_P',  AT42: 'MIPI_CSI2_D2_N',
  AP42: 'MIPI_CSI2_D3_P',  AP41: 'MIPI_CSI2_D3_N',

  // Camera MCLKs, Resets, Discrete LDO Enable, dToF / Spectral / Flash Controls
  L38:  'CAM0_MCLK_SOC',     // MIPI_CAMERA1_CLK_M0
  F37:  'CAM1_MCLK_SOC',     // MIPI_CAMERA2_CLK_M0
  L37:  'CAM2_MCLK_SOC',     // MIPI_CAMERA3_CLK_M0
  G38:  'CAM0_RST_N',        // GPIO1_D7_u
  AT37: 'CAM1_RST_N',        // GPIO3_A7_u
  AV30: 'CAM2_RST_N',        // GPIO3_C6_u
  AU22: 'CAM_LDO_EN',        // GPIO4_B1_u -> Discrete SGM2036 Camera LDO bank enable
  AV23: 'TOF_INT_N',         // GPIO4_B3_u
  AW19: 'TOF_LPN',           // GPIO4_A4_d
  AV27: 'FLICKER_INT_N',     // GPIO4_B4_u
  AT39: 'CAM_FLASH_STROBE',  // GPIO3_A4_d -> LM3644TT STROBE
  AV39: 'CAM_FLASH_HWEN',    // GPIO3_B1_d -> LM3644TT HWEN (Rev 5.0 FIX!)

  // USB-C 3.1 Gen1 + DP 1.4 Alt-Mode + USB 2.0 OTG + ALL Mandatory REXT/VBUSDET Balls!
  AY11: 'USB0_D_P',        AY10: 'USB0_D_N',
  BB11: 'USB3_SOC_TX0_P',  BA11: 'USB3_SOC_TX0_N',
  BB10: 'USB3_SOC_RX0_P',  BA10: 'USB3_SOC_RX0_N',
  BB14: 'USB3_SOC_TX1_P',  BA14: 'USB3_SOC_TX1_N',
  BB13: 'USB3_SOC_RX1_P',  BA13: 'USB3_SOC_RX1_N',
  AU7:  'USB20_OTG_REXT',      // 200R 1% to GND
  AW11: 'TYPEC0_DP0_REXT',     // 8.2K 1% to GND
  AW5:  'USB20_HOST0_REXT',    // 200R 1% to GND (Rev 5.0 FIX — Cellular Modem USB2 PHY!)
  AU6:  'USB20_HOST1_REXT',    // 200R 1% to GND (Rev 5.0 FIX!)
  AY3:  'HDMI_EDP_TX0_REXT',   // 200R 1% to GND (Rev 5.0 FIX!)
  AV10: 'VBUS_VDC_DET',        // TYPEC0_USB20_VBUSDET <= 3.0V divided VBUS (Rev 5.0 FIX!)
  AC38: 'USB_CC_INT_N',        // GPIO0_A4_u

  // Cellular Modem Quectel EG800Q-EU (USB20_HOST0 + UART9_M2 + I2S1_M0 VoLTE PCM + Open-Drain PWRKEY/RESET)
  AW6:  'MODEM_USB_DP',        // USB20_HOST0_DP
  AV6:  'MODEM_USB_DN',        // USB20_HOST0_DM
  AW30: 'MODEM_UART_TX',       // UART9_TX_M2 -> EG800Q MAIN_RXD
  AV31: 'MODEM_UART_RX',       // UART9_RX_M2 <- EG800Q MAIN_TXD
  H38:  'MODEM_PWRKEY_EN',     // GPIO1_A7_u -> Q701 BSS138 Gate -> EG800Q PWRKEY (open-drain!)
  H39:  'MODEM_RESET_EN',      // GPIO1_B0_u -> Q702 BSS138 Gate -> EG800Q RESET_N (open-drain!)
  AL39: 'MODEM_STATUS',        // GPIO0_D4_u <- EG800Q STATUS
  AR39: 'MODEM_NET_STATUS',    // GPIO3_B0_u <- EG800Q NET_STATUS

  // Wi-Fi 6E + BT 5.4 Ampak AP6275P (PCIE20_2 + Native PCIE20X1_2_M0 + UART6_M1 4-Wire BT HCI!)
  E41:  'PCIE_WIFI_TX_P',   D41:  'PCIE_WIFI_TX_N',
  D42:  'PCIE_WIFI_RX_P',   C42:  'PCIE_WIFI_RX_N',
  F41:  'PCIE_WIFI_CLK_P',  F42:  'PCIE_WIFI_CLK_N',
  AY27: 'WIFI_PERST_N',     // PCIE20X1_2_PERSTN_M0 / GPIO3_D1_d (Rev 5.0 Native M0!)
  AW31: 'WIFI_WAKE_N',      // PCIE20X1_2_WAKEN_M0 / GPIO3_D0_u  (Rev 5.0 Native M0!)
  AU30: 'WIFI_CLKREQ_N',    // PCIE20X1_2_CLKREQN_M0 / GPIO3_C7_u (Rev 5.0 Native M0!)
  D39:  'WIFI_REG_ON',      // GPIO1_A6_d -> AP6275P WL_REG_ON
  G37:  'BT_REG_ON',        // GPIO1_A4_d -> AP6275P BT_REG_ON
  M40:  'BT_WAKE',          // GPIO1_A5_d -> AP6275P BT_WAKE
  AG37: 'BT_HOST_WAKE',     // GPIO0_D3_u <- AP6275P BT_HOST_WAKE
  L40:  'BT_UART_TX',       // UART6_TX_M1 -> AP6275P BT_UART_RXD (Rev 5.0 4-wire hardware UART6_M1!)
  G40:  'BT_UART_RX',       // UART6_RX_M1 <- AP6275P BT_UART_TXD
  D38:  'BT_UART_RTS_N',    // UART6_RTSN_M1 -> AP6275P BT_UART_CTS_N
  L39:  'BT_UART_CTS_N',    // UART6_CTSN_M1 <- AP6275P BT_UART_RTS_N

  // GNSS u-blox MIA-M10Q (UART3_M0) & NFC PN7160 / STSAFE-A110 GPIOs
  N41:  'GNSS_UART_TX',     // UART3_TX_M0 -> MIA-M10Q RXD (Rev 5.0 true UART3_M0!)
  R38:  'GNSS_UART_RX',     // UART3_RX_M0 <- MIA-M10Q TXD
  AH38: 'GNSS_RST_N',       // GPIO0_C3_d  -> MIA-M10Q RESET_N
  D40:  'NFC_IRQ',          // GPIO1_B5_u  <- PN7160 IRQ
  AH42: 'NFC_VEN',          // GPIO0_C6_u  -> PN7160 VEN (Rev 5.0 FIX!)
  AM39: 'NFC_DWL_REQ',      // GPIO0_D5_u  -> PN7160 DWL_REQ
  AG36: 'ESE_RST_N',        // GPIO0_C2_d  -> STSAFE-A110 RESET

  // Audio: I2S0 (ES8388), I2S2_M1 (Dual TAS2562 SmartPA), I2S1_M0 (EG800Q VoLTE PCM), PDM0_M0 (3-Mic ANC)
  U36:  'I2S0_CODEC_MCLK',  // I2S0_MCLK
  M42:  'I2S0_CODEC_SCLK',  // I2S0_SCLK_TX
  P39:  'I2S0_CODEC_LRCK',  // I2S0_LRCK_TX
  P41:  'I2S0_CODEC_SDO',   // I2S0_SDO0
  N42:  'I2S0_CODEC_SDI',   // I2S0_SDI0
  AY35: 'I2S2_PA_SCLK',     // I2S2_SCLK_TX_M1 (Rev 5.0 FIX — true matched I2S2_M1!)
  AW37: 'I2S2_PA_LRCK',     // I2S2_LRCK_TX_M1
  AW35: 'I2S2_PA_SDO',      // I2S2_SDO_M1
  AW34: 'I2S2_PA_SDI',      // I2S2_SDI_M1
  AW18: 'PCM_MODEM_CLK',    // I2S1_SCLK_TX_M0 (Rev 5.0 FIX — true matched I2S1_M0!)
  AV26: 'PCM_MODEM_SYNC',   // I2S1_LRCK_TX_M0
  AT15: 'PCM_MODEM_TX',     // I2S1_SDO1_M0 (rockchip,i2s-tx-route)
  AU15: 'PCM_MODEM_RX',     // I2S1_SDI0_M0
  M41:  'PDM0_MIC_CLK',     // PDM0_CLK0_M0
  P38:  'PDM0_MIC_BOT_TOP', // PDM0_SDI0_M0
  U38:  'PDM0_MIC_REAR_ZOOM', // PDM0_SDI1_M0

  // All 8 Hardware I2C Buses (I2C0..I2C7 — 100% Matched _M* Groups, ZERO Overlap, ZERO Address Collisions!)
  AH41: 'I2C0_SCL',  AG41: 'I2C0_SDA', // I2C0_M2: U207(0x42), U208(0x43)
  P40:  'I2C1_SCL',  R39:  'I2C1_SDA', // I2C1_M4: U209(0x42)
  AK39: 'I2C2_SCL',  AM40: 'I2C2_SDA', // I2C2_M0: U201(0x55), U202(0x6A)
  AY34: 'I2C3_SCL',  AR36: 'I2C3_SDA', // I2C3_M1: U402(0x63), CAM_U1..U4/U7/U8
  AG38: 'I2C4_SCL',  AL38: 'I2C4_SDA', // I2C4_M2: U601(0x22), U602(0x44), CAM_U5/U6/U9
  AV18: 'I2C5_SCL',  AW26: 'I2C5_SDA', // I2C5_M2: Touch(0x5D), U710/PN7160(0x28), U716/STSAFE(0x20)
  AG39: 'I2C6_SCL',  AL40: 'I2C6_SDA', // I2C6_M0: U102(0x51), U805(0x6A), U806(0x0C), U807(0x46), U809(0x35), U810(0x60), U715(0x44)
  AY30: 'I2C7_SCL',  AY31: 'I2C7_SDA', // I2C7_M2: U801(0x10), U802(0x4C), U803(0x4D), U804(0x5A)

  // Ultrasonic Fingerprint SPI0_M2, Sensor/Key/Haptic/Charger IRQs, Debug UART2_M0 & SWD JTAG_M1!
  M37:  'FP_SPI_CLK',       // SPI0_CLK_M2 (Rev 5.0 FIX — true matched SPI0_M2!)
  M38:  'FP_SPI_MOSI',      // SPI0_MOSI_M2
  G39:  'FP_SPI_MISO',      // SPI0_MISO_M2
  M39:  'FP_SPI_CS',        // SPI0_CS0_M2
  AM38: 'FP_INT_N',         // GPIO0_C1_d
  AC37: 'FP_RST_N',         // GPIO0_B0_z
  AW27: 'IMU_INT1',         // GPIO4_B0_d
  AY26: 'ALS_PROX_INT_N',   // GPIO4_C1_d
  U35:  'SAR_INT_N',        // GPIO1_C4_d
  U37:  'HAPTIC_NRST',      // GPIO1_D0_d -> DRV2625 NRST (Rev 5.0 FIX!)
  AU1:  'HAPTIC_TRIG',      // GPIO4_D4_u -> DRV2625 TRIG/INTZ
  AR1:  'FG_ALRT_N',        // GPIO4_D5_d <- BQ27Z561 INT
  AT1:  'KEY_VOL_DN',       // GPIO4_D3_u <- Side Key Vol-
  AV1:  'CHG_INT_N',        // GPIO4_D2_u <- BQ25895 INT (Dedicated, NOT shorted to PMIC_INT_L!)
  AH39: 'UART2_DBG_TX',     // UART2_TX_M0
  AH40: 'UART2_DBG_RX',     // UART2_RX_M0
  AR2:  'JTAG_SWDIO',       // JTAG_TMS_M1 (Rev 5.0 SWAP FIXED! AR2 = TMS/SWDIO!)
  AV2:  'JTAG_SWCLK',       // JTAG_TCK_M1 (Rev 5.0 SWAP FIXED! AV2 = TCK/SWCLK!)
};

/**
 * Build exact 1,253-ball pin map for U101 (RK3588S2).
 * Returns { pins: { [ball]: netName }, stats }
 */
export function buildRk3588s2FullPins() {
  const pins = {};
  const stats = { total: 0, gnd: 0, power: 0, ddr: 0, emmc: 0, signal: 0, nc: 0 };
  for (const b of RK3588S2_MAP.balls) {
    stats.total++;
    const pwr = mapRkPowerPin(b.name);
    if (pwr !== null) {
      pins[b.ball] = pwr;
      if (pwr === 'GND') stats.gnd++;
      else stats.power++;
      continue;
    }
    if (b.name.startsWith('DDR_CH')) {
      const net = mapRkDdrPin(b.name);
      pins[b.ball] = net;
      if (net) stats.ddr++;
      else stats.nc++;
      continue;
    }
    if (RK_EXACT_SIGNAL_BALLS[b.ball]) {
      const net = RK_EXACT_SIGNAL_BALLS[b.ball];
      pins[b.ball] = net;
      if (net.startsWith('EMMC_')) stats.emmc++;
      else stats.signal++;
      continue;
    }
    // Unused GPIO / HDMI / extra PCIe / USB20_HOST1 balls remain physically present as NC pads!
    pins[b.ball] = '';
    stats.nc++;
  }
  return { pins, stats };
}

/**
 * Build exact 496-ball pin map for U301 (Samsung K3LK7K70BM-BGCP FBGA-496 LPDDR5/5X).
 */
export function buildLpddr5xFullPins() {
  const pins = {};
  const stats = { total: 0, gnd: 0, power: 0, signal: 0, zqReset: 0, nc: 0 };
  for (const b of LPDDR5X_MAP.balls) {
    stats.total++;
    const n = b.name;
    if (n === 'VSS') { pins[b.ball] = 'GND'; stats.gnd++; continue; }
    if (n === 'VDD2H') { pins[b.ball] = 'VDD2_DDR_S3'; stats.power++; continue; }
    if (n === 'VDD2L') { pins[b.ball] = 'VDD2L_0V9_DDR_S3'; stats.power++; continue; }
    if (n === 'VDDQ')  { pins[b.ball] = 'VDDQ_DDR_S0'; stats.power++; continue; }
    if (n === 'VDD1')  { pins[b.ball] = 'VCC_1V8_S3'; stats.power++; continue; }
    if (n === 'ZQ_A_C') { pins[b.ball] = 'DDR_ZQ_A'; stats.zqReset++; continue; }
    if (n === 'ZQ_B_D') { pins[b.ball] = 'DDR_ZQ_B'; stats.zqReset++; continue; }
    if (n === 'RESET_n') { pins[b.ball] = 'DDR_RESET_N'; stats.zqReset++; continue; }
    if (n === 'NC' || n === 'RFU') { pins[b.ball] = ''; stats.nc++; continue; }

    let m;
    if ((m = /^DQ(\d+)_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[2], `DQ${m[1]}`); stats.signal++; continue; }
    if ((m = /^DMI([01])_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[2], `DMI${m[1]}`); stats.signal++; continue; }
    if ((m = /^RDQS([01])_([TC])_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[3], `RDQS${m[1]}_${m[2] === 'T' ? 'P' : 'N'}`); stats.signal++; continue; }
    if ((m = /^WCK([01])_([TC])_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[3], `WCK${m[1]}_${m[2] === 'T' ? 'P' : 'N'}`); stats.signal++; continue; }
    if ((m = /^CA([0-6])_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[2], `CA${m[1]}`); stats.signal++; continue; }
    if ((m = /^CS([01])_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[2], `CS${m[1]}`); stats.signal++; continue; }
    if ((m = /^CK_([TC])_([ABCD])$/.exec(n))) { pins[b.ball] = lpddrNet(m[2], `CK_${m[1] === 'T' ? 'P' : 'N'}`); stats.signal++; continue; }

    throw new Error(`Unmapped LPDDR5X ball: ${b.ball} (${n})`);
  }
  return { pins, stats };
}

/**
 * Build exact 153-ball pin map for U302 (Samsung KLMAG1JETD-B041 FBGA-153 eMMC 5.1).
 */
export function buildEmmc51FullPins() {
  const pins = {};
  const stats = { total: 0, gnd: 0, power: 0, signal: 0, nc: 0 };
  const map = {
    DAT0: 'EMMC_D0', DAT1: 'EMMC_D1', DAT2: 'EMMC_D2', DAT3: 'EMMC_D3',
    DAT4: 'EMMC_D4', DAT5: 'EMMC_D5', DAT6: 'EMMC_D6', DAT7: 'EMMC_D7',
    CLK: 'EMMC_CLK_LINE', CMD: 'EMMC_CMD', DS: 'EMMC_DATA_STROBE', RST_n: 'EMMC_RSTN',
    VDDI: 'EMMC_VDDI', VCC: 'VCC_3V3_S3', VCCQ: 'VCC_1V8_S3', VSS: 'GND', VSSQ: 'GND',
  };
  for (const b of EMMC51_MAP.balls) {
    stats.total++;
    const net = map[b.name] || '';
    pins[b.ball] = net;
    if (!net) stats.nc++;
    else if (net === 'GND') stats.gnd++;
    else if (net === 'VCC_3V3_S3' || net === 'VCC_1V8_S3' || net === 'EMMC_VDDI') stats.power++;
    else stats.signal++;
  }
  return { pins, stats };
}

/**
 * Build exact 36-ball pin map for U802 / U803 (TI TAS2562YFPR DSBGA-36 SmartPA, SLASEI7A).
 * Maps all 36 physical balls (A1..F6), including distinct I2C address straps (0x4C / 0x4D),
 * DREG / GREG / PVDD-VBST internal boost rails, IV-sense (VSNS_P/N), and all 7 GND balls.
 * Rev 5.0: Wired to RK3588S2 hardware I2S2_M1 (`I2S2_PA_*`) and outputs directly to filtered EMI nets.
 */
export function buildTas2562FullPins({ ref, outP, outN, i2cAddrBit0 = false }) {
  const pins = {};
  const stats = { total: 0, gnd: 0, power: 0, signal: 0, nc: 0 };
  const map = {
    SDZ:    'VCC_1V8_S0', // Active-high hardware enable (controlled via I2C software shutdown)
    SBCLK:  'I2S2_PA_SCLK',
    FSYNC:  'I2S2_PA_LRCK',
    SCL:    'I2C7_SCL',
    SDA:    'I2C7_SDA',
    DREG:   `TAS_DREG_${ref}`,
    SDOUT:  'I2S2_PA_SDI',
    SDIN:   'I2S2_PA_SDO',
    AD1:    'GND',
    AD0:    i2cAddrBit0 ? 'VCC_1V8_S0' : 'GND',
    IRQZ:   '', // Optional open-drain IRQ (internal pull-up, polled over I2C7)
    VDD:    'VCC_1V8_S0',
    VBAT_1: 'VSYS_3V87',
    VBAT_2: 'VSYS_3V87',
    VSNS_N: outN,
    GREG:   `TAS_GREG_${ref}`,
    VSNS_P: outP,
    GPIO:   '', // Unused general purpose I/O (per datasheet: no connect if not used)
    BGND_1: 'GND',
    BGND_2: 'GND',
    BGND_3: 'GND',
    GND:    'GND',
    PGND_1: 'GND',
    PGND_2: 'GND',
    GNDD:   'GND',
    SW_1:   `SW_${ref}`,
    SW_2:   `SW_${ref}`,
    SW_3:   `SW_${ref}`,
    OUT_P:  outP,
    OUT_N:  outN,
    VBST_1: `TAS_PVDD_${ref}`,
    VBST_2: `TAS_PVDD_${ref}`,
    VBST_3: `TAS_PVDD_${ref}`,
    PVDD_1: `TAS_PVDD_${ref}`,
    PVDD_2: `TAS_PVDD_${ref}`,
    PVDD_3: `TAS_PVDD_${ref}`,
  };
  for (const b of TAS2562_MAP.balls) {
    stats.total++;
    const net = map[b.name];
    if (net === undefined) throw new Error(`Unmapped TAS2562 ball: ${b.ball} (${b.name})`);
    pins[b.ball] = net;
    if (!net) stats.nc++;
    else if (net === 'GND') stats.gnd++;
    else if (/^(VSYS|VCC|SW_|TAS_)/.test(net)) stats.power++;
    else stats.signal++;
  }
  return { pins, stats };
}

