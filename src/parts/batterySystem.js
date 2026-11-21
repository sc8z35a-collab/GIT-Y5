import * as THREE from 'three';
import { BATTERY_DIM, Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  extrudePlate,
  createFlexRibbon,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * RK T4 — 6000mAh Dual-Cell High-Density Silicon-Carbon Battery
 * Deep Internal Dissection ("バッテリーの中の解剖"):
 *   Top Aluminum-Laminated Pouch Shell (6000mAh specs) ->
 *   Amber Kapton Insulating Tape + BMS Protection Circuit Board (MOSFETs, Shunt, NTC, Dual FPC) ->
 *   Ultrasonic-Welded Nickel/Copper/Aluminum Electrode Tabs ->
 *   Dual-Cell Internal Stacked/Wound Electrochemistry Architecture (Cell A 3000mAh + Cell B 3000mAh):
 *     Copper Anode Foil + Silicon-Carbon Coating <->
 *     Translucent Microporous Polymer Separator Membrane <->
 *     Aluminum Cathode Foil + NMC Active Coating <->
 *     Central Electrolyte-Gel Dual-Cell Core & Thermal Sense Strip ->
 *   Lower Pouch Shell + White Stretch-Release Service Pull Tabs.
 */
export function buildBatterySystem(textures) {
  const root = new THREE.Group();
  root.name = 'battery';

  const anchorX = BATTERY_DIM.CENTER_X;
  const anchorY = BATTERY_DIM.CENTER_Y;
  const anchorZ = Z_STACK.INTERNAL_MID;
  root.position.set(anchorX, anchorY, anchorZ);

  const W = BATTERY_DIM.W;
  const H = BATTERY_DIM.H;

  // --- Precision Electrochemistry Materials ---
  const matPouchTop = new THREE.MeshStandardMaterial({
    map: textures.batteryPouch.map,
    roughnessMap: textures.batteryPouch.roughnessMap,
    metalness: 0.48,
    roughness: 0.44,
  });

  const matPouchBottom = new THREE.MeshStandardMaterial({
    color: 0x202329,
    metalness: 0.56,
    roughness: 0.40,
  });

  const matAnode = new THREE.MeshStandardMaterial({
    map: textures.anode,
    metalness: 0.68,
    roughness: 0.34,
  });

  const matCopperFoil = new THREE.MeshStandardMaterial({
    color: 0xd17c47,
    metalness: 0.94,
    roughness: 0.22,
  });

  const matCathode = new THREE.MeshStandardMaterial({
    map: textures.cathode,
    metalness: 0.62,
    roughness: 0.36,
  });

  const matAluminumFoil = new THREE.MeshStandardMaterial({
    color: 0xd6dce4,
    metalness: 0.92,
    roughness: 0.24,
  });

  const matSeparator = new THREE.MeshPhysicalMaterial({
    map: textures.separator,
    color: 0xf7f9fc,
    transparent: true,
    opacity: 0.78,
    roughness: 0.34,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });

  const matKapton = new THREE.MeshPhysicalMaterial({
    color: 0xd98e26,
    transparent: true,
    opacity: 0.62,
    roughness: 0.16,
    metalness: 0.08,
    clearcoat: 0.8,
  });

  const matBmsPcb = new THREE.MeshStandardMaterial({
    color: 0x162b23,
    metalness: 0.34,
    roughness: 0.46,
  });

  const matIc = new THREE.MeshStandardMaterial({
    color: 0x1b1e24,
    metalness: 0.26,
    roughness: 0.52,
  });

  const matGold = new THREE.MeshStandardMaterial({
    color: 0xdcb45c,
    metalness: 0.96,
    roughness: 0.18,
  });

  const matPullTab = new THREE.MeshStandardMaterial({
    color: 0xf0f2f5,
    roughness: 0.55,
    metalness: 0.04,
  });

  const matFlex = new THREE.MeshStandardMaterial({
    color: 0x1e1812,
    metalness: 0.38,
    roughness: 0.40,
  });

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  // =========================================================================
  // 1. TOP ALUMINUM-LAMINATED POUCH COVER (faces rear -Z)
  // =========================================================================
  const topPouchGroup = new THREE.Group();
  topPouchGroup.position.set(0, -0.14, -0.145);

  const pouchPlateGeo = extrudePlate(
    createRoundedRectShape(W, H - 0.32, BATTERY_DIM.R),
    0.095,
    { bevelSize: 0.032, bevelThickness: 0.032, bevelSegments: 4, flipUVX: true }
  );
  const topPouchMesh = new THREE.Mesh(pouchPlateGeo, matPouchTop);
  topPouchGroup.add(topPouchMesh);

  // Subtle folded heat-seal metallic crimps along left & right edges
  const crimpGeo = new THREE.BoxGeometry(0.11, H - 0.64, 0.022);
  const crimpL = new THREE.Mesh(crimpGeo, matPouchBottom);
  crimpL.position.set(-W / 2 - 0.03, 0, 0.01);
  const crimpR = new THREE.Mesh(crimpGeo, matPouchBottom);
  crimpR.position.set(W / 2 + 0.03, 0, 0.01);
  topPouchGroup.add(crimpL, crimpR);

  root.add(topPouchGroup);
  registerLayer(topPouchGroup, [0, 0, -2.45]);

  // =========================================================================
  // 2. BMS PROTECTION BOARD + AMBER KAPTON INSULATION + DUAL FPC FLEX
  // =========================================================================
  const bmsGroup = new THREE.Group();
  bmsGroup.position.set(0, H / 2 - 0.14, -0.02);

  // Slim green/black BMS protection PCB spanning both cells
  const bmsBoard = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(W - 0.36, 0.30, 0.04), 0.055, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matBmsPcb
  );
  bmsGroup.add(bmsBoard);

  // TI BQ27Z561-R2 SHA-256 Fuel Gauge (WLCSP), Dual CSD87501L Protection MOSFETs,
  // Vishay WSL0805 5mOhm 4-Terminal Alloy Current Shunt, PTC Thermal Fuse & 0201 MLCC Array!
  const matWlcsp = new THREE.MeshPhysicalMaterial({ color: 0x2a3548, metalness: 0.88, roughness: 0.12, iridescence: 0.72 });
  const matMlcc = new THREE.MeshStandardMaterial({ color: 0x997046, metalness: 0.30, roughness: 0.42 });
  const icSpecs = [
    { x: -1.85, w: 0.36, h: 0.18, mat: matIc },          // Protection MOSFET Q1
    { x: -1.32, w: 0.36, h: 0.18, mat: matIc },          // Protection MOSFET Q2
    { x: -0.74, w: 0.24, h: 0.20, mat: matWlcsp },       // TI BQ27Z561-R2 WLCSP Fuel Gauge
    { x: -0.18, w: 0.32, h: 0.16, mat: matCopperFoil },  // Vishay WSL0805 5mOhm Kelvin Shunt
    { x:  0.48, w: 0.36, h: 0.18, mat: matAluminumFoil },// Resettable PTC Thermal Fuse
    { x:  1.15, w: 0.38, h: 0.18, mat: matIc },          // Cell Balancing & Protector IC
    { x:  1.72, w: 0.26, h: 0.16, mat: matIc },          // Secondary ESD / NTC Monitor
  ];
  icSpecs.forEach((ic) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(ic.w, ic.h, 0.048), ic.mat);
    m.position.set(ic.x, 0, -0.048);
    bmsGroup.add(m);
  });
  // Micro 0201 decoupling MLCCs & Kelvin sense resistors along BMS strip
  [-1.58, -1.02, -0.46, 0.14, 0.82, 1.46].forEach((cx) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.032), matMlcc);
    c.position.set(cx, 0.06, -0.042);
    bmsGroup.add(c);
  });

  // Ultrasonic-welded nickel/gold cell-tab solder pads on BMS
  [-1.95, -0.82, 0.82, 1.95].forEach((tx) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.025), matGold);
    pad.position.set(tx, -0.03, 0.036);
    bmsGroup.add(pad);
  });

  // Dual high-current FPC battery connector ribbons routing cleanly toward Motherboard spine
  const fpc1 = createFlexRibbon(
    [
      new THREE.Vector3(1.65, 0.04, -0.02),
      new THREE.Vector3(2.08, 0.08, -0.04),
      new THREE.Vector3(2.44, 0.14, -0.02),
    ],
    0.22,
    0.012,
    matFlex
  );
  const fpc2 = createFlexRibbon(
    [
      new THREE.Vector3(0.95, 0.04, -0.02),
      new THREE.Vector3(1.38, 0.12, -0.04),
      new THREE.Vector3(1.78, 0.18, -0.02),
    ],
    0.18,
    0.012,
    matFlex
  );
  const btb1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.24, 0.036), matGold);
  btb1.position.set(2.50, 0.14, -0.02);
  const btb2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.20, 0.036), matGold);
  btb2.position.set(1.84, 0.18, -0.02);
  bmsGroup.add(fpc1, fpc2, btb1, btb2);

  root.add(bmsGroup);
  registerLayer(bmsGroup, [0, 0.92, -1.25]);

  // Translucent Amber Polyimide Kapton Insulating Tape covering BMS header
  const kaptonGroup = new THREE.Group();
  kaptonGroup.position.set(0, H / 2 - 0.16, -0.10);
  const kaptonStrip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.12, 0.44, 0.014), matKapton);
  kaptonGroup.add(kaptonStrip);
  root.add(kaptonGroup);
  registerLayer(kaptonGroup, [0, 1.38, -2.05]);

  // =========================================================================
  // 3. DEEP INSIDE THE 6000mAh BATTERY: DUAL-CELL INTERNAL ELECTROCHEMISTRY STACK!
  //    Cell A (left 3000mAh) & Cell B (right 3000mAh) interleaved Anode / Separator / Cathode
  // =========================================================================
  const cellW = (W - 0.62) / 2; // 2.41 each cell
  const cellH = H - 0.88;       // 6.16
  const cellOffsetsX = [-(cellW / 2 + 0.10), +(cellW / 2 + 0.10)];

  // Helper: creates a pair of Cell A & Cell B electrode sheets with authentic welded metallic tabs!
  const createElectrodeLayer = (type, zBase, explodeZ) => {
    const layerGrp = new THREE.Group();
    layerGrp.position.set(0, -0.16, zBase);

    const isSep = type === 'separator';
    const plateW = isSep ? cellW + 0.14 : cellW;
    const plateH = isSep ? cellH + 0.14 : cellH;
    const plateT = isSep ? 0.010 : 0.022;

    const plateGeo = extrudePlate(
      createRoundedRectShape(plateW, plateH, 0.07),
      plateT,
      { bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 1 }
    );

    const matMain =
      type === 'anode' ? matAnode : type === 'cathode' ? matCathode : matSeparator;
    const matTab = type === 'anode' ? matCopperFoil : matAluminumFoil;

    cellOffsetsX.forEach((cx, cellIdx) => {
      const sheet = new THREE.Mesh(plateGeo, matMain);
      sheet.position.x = cx;
      layerGrp.add(sheet);

      if (!isSep) {
        // Exposed gleaming metallic current-collector welded tab extending upward toward BMS!
        const tabOffsetX = type === 'anode' ? -0.58 : 0.58;
        const tabGeo = new THREE.BoxGeometry(0.32, 0.54, 0.014);
        const tab = new THREE.Mesh(tabGeo, matTab);
        tab.position.set(cx + tabOffsetX, plateH / 2 + 0.22, 0);
        layerGrp.add(tab);

        // Subtle ultrasonic weld-grid stamp pad at top of tab
        const weld = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.14, 0.018), matGold);
        weld.position.set(cx + tabOffsetX, plateH / 2 + 0.40, 0);
        layerGrp.add(weld);

        // Exposed copper/aluminum edge collector rail visible along outer rim of each sheet
        const rimEdge = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, plateH - 0.24, plateT + 0.004),
          matTab
        );
        rimEdge.position.set(cx + (cellIdx === 0 ? -plateW / 2 + 0.03 : plateW / 2 - 0.03), 0, 0);
        layerGrp.add(rimEdge);
      }
    });

    // If separator, add a continuous bridge fold across the two cells (Z-fold / jelly-roll membrane!)
    if (isSep) {
      const foldBridge = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, plateH - 0.12, 0.008),
        matSeparator
      );
      layerGrp.add(foldBridge);
    }

    root.add(layerGrp);
    registerLayer(layerGrp, [0, 0, explodeZ]);
    return layerGrp;
  };

  // Interleaved Dual-Cell Electrochemistry Strata (assembled tightly inside Z[-0.09..+0.09],
  // fanning out dramatically across Z[-1.72..+1.55] when dissected!)
  createElectrodeLayer('anode',     -0.088, -1.68); // Anode 1: Copper + Si-C Graphite
  createElectrodeLayer('separator', -0.064, -1.24); // Separator 1: Microporous Polymer Film
  createElectrodeLayer('cathode',   -0.038, -0.78); // Cathode 1: Aluminum + NMC Active
  createElectrodeLayer('separator', -0.012, -0.32); // Separator 2: Microporous Polymer Film

  // Central Dual-Cell Electrolyte-Gel Core & Internal Thermal Sense Strip
  const coreSpineGroup = new THREE.Group();
  coreSpineGroup.position.set(0, -0.16, 0.008);
  const spineDivider = new THREE.Mesh(
    new THREE.BoxGeometry(0.10, cellH - 0.10, 0.035),
    matKapton
  );
  coreSpineGroup.add(spineDivider);
  // Central parallel busbar linking Cell A & Cell B + embedded copper thermal sense probe
  const probe = new THREE.Mesh(new THREE.BoxGeometry(0.05, cellH * 0.65, 0.014), matCopperFoil);
  probe.position.set(0, 0.45, -0.02);
  coreSpineGroup.add(probe);
  const busbar = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.12, 0.022), matAluminumFoil);
  busbar.position.set(0, cellH / 2 + 0.34, 0);
  coreSpineGroup.add(busbar);
  root.add(coreSpineGroup);
  registerLayer(coreSpineGroup, [0, 0, 0.12]);

  createElectrodeLayer('anode',      0.032,  0.58); // Anode 2: Copper + Si-C Graphite
  createElectrodeLayer('separator',  0.056,  1.04); // Separator 3: Microporous Polymer Film
  createElectrodeLayer('cathode',    0.082,  1.48); // Cathode 2: Aluminum + NMC Active

  // =========================================================================
  // 4. LOWER ALUMINUM-LAMINATED POUCH TRAY & WHITE STRETCH-RELEASE PULL TABS
  // =========================================================================
  const bottomPouchGroup = new THREE.Group();
  bottomPouchGroup.position.set(0, -0.14, 0.142);

  const botTray = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(W, H - 0.32, BATTERY_DIM.R), 0.085, {
      bevelSize: 0.028,
      bevelThickness: 0.028,
      bevelSegments: 4,
    }),
    matPouchBottom
  );
  bottomPouchGroup.add(botTray);
  root.add(bottomPouchGroup);
  registerLayer(bottomPouchGroup, [0, 0, 2.25]);

  // Dual White Stretch-Release Service Adhesive Pull-Tabs (underneath battery)
  const pullTabsGroup = new THREE.Group();
  pullTabsGroup.position.set(0, -0.18, 0.195);
  [-1.55, 1.55].forEach((px) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.68, H - 1.15, 0.012), matPullTab);
    strip.position.set(px, 0.08, 0);
    pullTabsGroup.add(strip);
    // Dark pull-tab grip loop at bottom edge
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.24, 0.016), matIc);
    grip.position.set(px, -(H - 1.15) / 2 - 0.04, 0);
    pullTabsGroup.add(grip);
  });
  root.add(pullTabsGroup);
  registerLayer(pullTabsGroup, [0, -0.35, 2.75]);

  prepareAssembly(root, 'battery');

  return {
    id: 'battery',
    root,
    homePos: new THREE.Vector3(anchorX, anchorY, anchorZ),
    macroOffset: new THREE.Vector3(-0.48, -0.18, -2.55),
    hoverOffset: new THREE.Vector3(0, 0, -0.28),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}
