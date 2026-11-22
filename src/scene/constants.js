/**
 * RK T4 — Master Mechanical CAD Dimensions & Coordinate Stackup
 * Scale: 1.0 world unit = 10 mm (0.1 unit = 1.0 mm, 0.01 unit = 0.1 mm)
 * +Z = Front (Display), -Z = Rear (Camera / Back Ceramic), +Y = Top, +X = Right
 */
export const PHONE = {
  W: 7.50,       // 75.0 mm width (flagship 6.78" class)
  H: 16.20,      // 162.0 mm height (houses real 28cm3 6000mAh Si-C pack + bottom bay!)
  T: 1.004,      // 10.04 mm honest non-squashed body thickness (1.20mm 14L HDI + 0.80mm 8L Mezz + 5.18mm 6000mAh Si-C!)
  R: 0.92,       // 9.2 mm corner radius
  RAIL_W: 0.24,  // 2.4 mm CNC Grade-5 titanium perimeter wall
};

export const DISPLAY_DIM = {
  W: 7.18,
  H: 15.88,
  R: 0.78,
  PUNCH_Y: 7.36,
  PUNCH_R: 0.175,
  FP_Y: -4.45,
};

// Rear Camera Island (upper-left from front view = -X, +Y; appears upper-right when looking at rear)
export const CAMERA_BAY = {
  CENTER_X: -1.78,
  CENTER_Y: 5.22,
  W: 2.94,
  H: 4.28,
  R: 0.68,
  // 45MP Master Large-Format 1/1.28" Optical Axis (Sony LYT-818 + 1G+6P)
  MAIN_X: -2.08,
  MAIN_Y: 6.06,
  MAIN_R: 1.06,
  // Auxiliary Ultra-Wide Lens (Sony IMX355 + 5P)
  AUX_X: -2.08,
  AUX_Y: 4.02,
  AUX_R: 0.62,
  // True-CRI Dual-Tone LED Flash (ams OSRAM KW/KY CELNM2)
  FLASH_X: -0.71,
  FLASH_Y: 6.08,
  FLASH_R: 0.28,
  // 8x8 dToF Laser AF & Spectral Flicker (ST VL53L8CX + ams TCS3408)
  TOF_X: -0.71,
  TOF_Y: 4.96,
  TOF_R: 0.24,
  // Rear Audio-Zoom MEMS Mic pinhole (Knowles SPH0655LM4H-1)
  MIC_X: -0.71,
  MIC_Y: 4.02,
};

// REAL Non-Squashed 6000mAh (23.22Wh) Dual-Cell 10% Silicon-Carbon Battery:
// 59.6 mm x 89.6 mm x 5.18 mm = 27.66 cm3 -> 839 Wh/L (genuine 2026 commercial Si-C pack density!)
export const BATTERY_DIM = {
  CENTER_X: -0.49,
  CENTER_Y: -1.42,
  W: 5.96,
  H: 8.96,
  T: 0.518,
  R: 0.22,
};

// Bottom Electromechanical Bay (Y: -7.76 .. -6.02)
export const BOTTOM_BAY = {
  HAPTIC: { x: -2.06, y: -7.12, w: 2.02, h: 1.16, t: 0.34 },
  USBC:   { x:  0.00, y: -6.82, w: 1.36, h: 1.66, t: 0.34 },
  SPEAKER:{ x:  2.06, y: -6.86, w: 2.30, h: 1.72, t: 0.36 },
};

// Honest Uncompressed Z-Stack (Body: -5.34mm .. +4.70mm = 10.04mm; zero squashing, zero overlaps!)
export const Z_STACK = {
  DISPLAY_GLASS:    0.440, // 0.60mm Ceramic Shield Cover Glass [+0.410 .. +0.470]
  DISPLAY_TOUCH:    0.394, // 0.08mm OCA + Capacitive Touch [+0.390 .. +0.398]
  DISPLAY_POLAR:    0.380, // 0.08mm Circular Polarizer [+0.376 .. +0.384]
  DISPLAY_OLED:     0.362, // 0.14mm LTPO AMOLED Emissive [+0.355 .. +0.369]
  DISPLAY_TFT:      0.342, // 0.12mm LTPO TFT + COF [+0.336 .. +0.348]
  DISPLAY_SHIELD:   0.308, // 0.14mm Copper EMI Foil + FP [+0.301 .. +0.315]

  COOLING_GRAPHITE: 0.280, // 0.12mm Pyrolytic Graphite [+0.274 .. +0.286]
  COOLING_VC_TOP:   0.264, // 0.12mm Copper VC Upper Lid [+0.258 .. +0.270]
  COOLING_VC_WICK:  0.248, // 0.12mm Sintered Copper Wick [+0.242 .. +0.254]
  COOLING_VC_BOT:   0.232, // 0.12mm Copper VC Lower Base [+0.226 .. +0.238]

  FRAME_WEB:        0.194, // 0.46mm CNC Midframe Structural Deck [+0.171 .. +0.217]
  INTERNAL_MID:    -0.055, // Central internal reference plane

  WIRELESS_FERRITE: -0.306, // 0.14mm Nanocrystalline Ferrite [-0.313 .. -0.299]
  WIRELESS_COIL:    -0.336, // 0.36mm 14-Turn Spiral Copper Coil [-0.354 .. -0.318]
  WIRELESS_NFC:     -0.452, // 0.08mm Etched Copper NFC Loop [-0.456 .. -0.448] (clears 1.20+0.80mm sandwich!)
  WIRELESS_MAG:     -0.384, // 0.24mm 18-Segment Alignment Magnets [-0.396 .. -0.372] (lower battery region only)
  REAR_GLASS:       -0.498, // 0.72mm Matte Ceramic Rear Glass [-0.534 .. -0.462]
};

/**
 * Tailored macro camera presets when the user clicks directly on a subsystem.
 * target: offset from subsystem's centered world origin (0,0,0)
 * theta: azimuth angle (radians), phi: polar angle from +Y (radians), distance: macro orbit radius
 */
export const FOCUS_PRESETS = {
  camera: {
    theta: 2.06,
    phi: 1.24,
    distance: 13.6,
    target: [-0.25, 0.28, -0.75],
  },
  battery: {
    theta: -2.12,
    phi: 1.18,
    distance: 17.6,
    target: [0.0, 0.35, -0.10],
  },
  display: {
    theta: 0.98,
    phi: 1.24,
    distance: 31.0,
    target: [0.0, 0.0, 1.10],
  },
  motherboard: {
    theta: -2.14,
    phi: 1.22,
    distance: 23.8,
    target: [0.15, -0.55, -0.35],
  },
  cooling: {
    theta: 1.06,
    phi: 1.20,
    distance: 25.8,
    target: [0.0, 0.15, 0.25],
  },
  frame: {
    theta: 0.72,
    phi: 1.24,
    distance: 34.5,
    target: [0.0, 0.0, 0.0],
  },
  wireless: {
    theta: -2.12,
    phi: 1.24,
    distance: 30.5,
    target: [0.0, 0.0, -0.85],
  },
  speaker: {
    theta: -2.18,
    phi: 1.16,
    distance: 7.4,
    target: [0.0, 0.0, -0.15],
  },
  haptic: {
    theta: -2.18,
    phi: 1.16,
    distance: 7.4,
    target: [0.0, 0.0, -0.15],
  },
  usbc: {
    theta: -2.36,
    phi: 1.18,
    distance: 9.8,
    target: [0.0, -0.65, 0.0],
  },
  selfie: {
    theta: 0.88,
    phi: 1.20,
    distance: 7.8,
    target: [0.0, 0.15, 0.75],
  },
};
