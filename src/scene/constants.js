/**
 * RK T4 — Master Mechanical CAD Dimensions & Coordinate Stackup
 * Scale: 1.0 world unit = 10 mm (0.1 unit = 1.0 mm, 0.01 unit = 0.1 mm)
 * +Z = Front (Display), -Z = Rear (Camera / Back Ceramic), +Y = Top, +X = Right
 */
export const PHONE = {
  W: 7.36,       // 73.6 mm width
  H: 15.60,      // 156.0 mm height
  T: 0.86,       // 8.6 mm main body thickness (6000mAh high-density silicon-carbon)
  R: 0.92,       // 9.2 mm corner radius
  RAIL_W: 0.24,  // 2.4 mm CNC titanium perimeter wall thickness
};

export const DISPLAY_DIM = {
  W: 7.04,
  H: 15.28,
  R: 0.78,
  PUNCH_Y: 7.06,
  PUNCH_R: 0.175,
  FP_Y: -4.25,
};

// Rear Camera Island (upper-left from front view = -X, +Y; appears upper-right when looking at rear)
export const CAMERA_BAY = {
  CENTER_X: -1.78,
  CENTER_Y: 4.92,
  W: 2.94,
  H: 4.28,
  R: 0.68,
  // 45MP Master Large-Format Optical Axis
  MAIN_X: -2.08,
  MAIN_Y: 5.76,
  MAIN_R: 1.06,
  // Auxiliary Ultra-Wide Lens
  AUX_X: -2.08,
  AUX_Y: 3.72,
  AUX_R: 0.62,
  // True-CRI Dual-Tone LED Flash
  FLASH_X: -0.78,
  FLASH_Y: 5.78,
  FLASH_R: 0.28,
  // Laser ToF / Spectral Color Sensor
  TOF_X: -0.78,
  TOF_Y: 4.66,
  TOF_R: 0.24,
  // Rear Microphone pinhole
  MIC_X: -0.78,
  MIC_Y: 3.72,
};

// 6000mAh Dual-Cell High-Density Silicon-Carbon Battery
export const BATTERY_DIM = {
  CENTER_X: -0.52,
  CENTER_Y: -0.96,
  W: 5.40,
  H: 6.92,
  T: 0.40,
  R: 0.22,
};

// Bottom Electromechanical Bay (Y: -7.28 .. -4.72)
// Haptic engine realistically sized to flagship X-axis LRA (20.5x13.2mm), freeing upper-left pocket for Dual-SIM tray!
export const BOTTOM_BAY = {
  HAPTIC: { x: -2.02, y: -6.58, w: 2.05, h: 1.32, t: 0.32 },
  USBC:   { x:  0.00, y: -6.16, w: 1.36, h: 2.38, t: 0.32 },
  SPEAKER:{ x:  2.02, y: -6.02, w: 2.32, h: 2.22, t: 0.34 },
};

// Exact non-overlapping Z coordinates when assembled (explode = 0, verified 0.000mm interference!)
export const Z_STACK = {
  DISPLAY_GLASS:    0.408,
  DISPLAY_TOUCH:    0.368,
  DISPLAY_POLAR:    0.354,
  DISPLAY_OLED:     0.338,
  DISPLAY_TFT:      0.318,
  DISPLAY_SHIELD:   0.284,

  COOLING_GRAPHITE: 0.250,
  COOLING_VC_TOP:   0.234,
  COOLING_VC_WICK:  0.220,
  COOLING_VC_BOT:   0.206,

  FRAME_WEB:        0.176,
  INTERNAL_MID:    -0.055, // center of Z[-0.270 .. +0.150]

  WIRELESS_FERRITE: -0.284,
  WIRELESS_COIL:    -0.314,
  WIRELESS_NFC:     -0.340,
  WIRELESS_MAG:     -0.360,
  REAR_GLASS:       -0.412,
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
