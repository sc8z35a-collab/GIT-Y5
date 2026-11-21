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
  const anchorZ = -0.036; // World Z span: [-0.297 .. +0.221] = 5.18 mm REAL 6000mAh Si-C pack!
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
  // 1. TOP ALUMINUM-LAMINATED POUCH COVER (local Z: [-0.261..-0.179], world [-0.297..-0.215])
  // =========================================================================
  const topPouchGroup = new THREE.Group();
  topPouchGroup.position.set(0, -0.22, -0.220);

  const pouchPlateGeo = extrudePlate(
    createRoundedRectShape(W - 0.14, H - 0.56, BATTERY_DIM.R),
    0.082,
    { bevelSize: 0.022, bevelThickness: 0.022, bevelSegments: 4, flipUVX: true }
  );
  const topPouchMesh = new THREE.Mesh(pouchPlateGeo, matPouchTop);
  topPouchGroup.add(topPouchMesh);

  const crimpGeo = new THREE.BoxGeometry(0.08, H - 0.90, 0.020);
  const crimpL = new THREE.Mesh(crimpGeo, matPouchBottom);
  crimpL.position.set(-W / 2 + 0.04, 0, 0.01);
  const crimpR = new THREE.Mesh(crimpGeo, matPouchBottom);
  crimpR.position.set(W / 2 - 0.04, 0, 0.01);
  topPouchGroup.add(crimpL, crimpR);

  root.add(topPouchGroup);
  registerLayer(topPouchGroup, [0, 0, -2.45]);

  // =========================================================================
  // 2. BMS PROTECTION BOARD + AMBER KAPTON INSULATION + DUAL FPC FLEX (seated cleanly ABOVE pouch in +Y!)
  // =========================================================================
  const bmsGroup = new THREE.Group();
  bmsGroup.position.set(0, H / 2 - 0.19, -0.02);

  const bmsBoard = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(W - 0.40, 0.28, 0.04), 0.052, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matBmsPcb
  );
  bmsGroup.add(bmsBoard);

  // TI BQ27Z561-R2 SHA-256 Fuel Gauge (WLCSP), Dual CSD87501L Protection MOSFETs,
  // Vishay WSL0805 5mOhm 4-Terminal Alloy Current Shunt, PTC Thermal Fuse & 0201 MLCC Array!
  const matWlcsp = new THREE.MeshPhysicalMaterial({ color: 0x2a3548, metalness: 0.88, roughness: 0.12, iridescence: 0.72 });
  const matMlcc = new THREE.MeshStandardMaterial({ color: 0x997046, metalness: 0.30, roughness: 0.42 });
  const icSpecs = [
    { x: -1.95, w: 0.36, h: 0.18, mat: matIc },
    { x: -1.40, w: 0.36, h: 0.18, mat: matIc },
    { x: -0.78, w: 0.24, h: 0.20, mat: matWlcsp },
    { x: -0.20, w: 0.32, h: 0.16, mat: matCopperFoil },
    { x:  0.48, w: 0.36, h: 0.18, mat: matAluminumFoil },
    { x:  1.15, w: 0.38, h: 0.18, mat: matIc },
    { x:  1.76, w: 0.26, h: 0.16, mat: matIc },
  ];
  icSpecs.forEach((ic) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(ic.w, ic.h, 0.048), ic.mat);
    m.position.set(ic.x, 0, -0.052);
    bmsGroup.add(m);
  });
  [-1.68, -1.08, -0.48, 0.14, 0.82, 1.48].forEach((cx) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.032), matMlcc);
    c.position.set(cx, 0.06, -0.044);
    bmsGroup.add(c);
  });

  [-2.05, -0.84, 0.84, 2.05].forEach((tx) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.022), matGold);
    pad.position.set(tx, -0.03, 0.038);
    bmsGroup.add(pad);
  });

  // Dual high-current FPC battery connector ribbons routing cleanly toward right edge
  const fpc1 = createFlexRibbon(
    [
      new THREE.Vector3(1.85, 0.02, -0.02),
      new THREE.Vector3(2.26, 0.04, -0.03),
      new THREE.Vector3(2.62, 0.06, -0.02),
    ],
    0.20,
    0.012,
    matFlex
  );
  const fpc2 = createFlexRibbon(
    [
      new THREE.Vector3(1.10, 0.02, -0.02),
      new THREE.Vector3(1.52, 0.05, -0.03),
      new THREE.Vector3(1.94, 0.08, -0.02),
    ],
    0.16,
    0.012,
    matFlex
  );
  const btb1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.034), matGold);
  btb1.position.set(2.68, 0.06, -0.02);
  const btb2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.034), matGold);
  btb2.position.set(2.00, 0.08, -0.02);
  bmsGroup.add(fpc1, fpc2, btb1, btb2);

  root.add(bmsGroup);
  registerLayer(bmsGroup, [0, 0.92, -1.25]);

  // Translucent Amber Polyimide Kapton Insulating Tape strictly above BMS ICs in -Z (Z = -0.145 -> [-0.152..-0.138]!)
  const kaptonGroup = new THREE.Group();
  kaptonGroup.position.set(0, H / 2 - 0.19, -0.145);
  const kaptonStrip = new THREE.Mesh(new THREE.BoxGeometry(W - 0.26, 0.34, 0.012), matKapton);
  kaptonGroup.add(kaptonStrip);
  root.add(kaptonGroup);
  registerLayer(kaptonGroup, [0, 1.38, -2.05]);

  // =========================================================================
  // 3. DEEP INSIDE THE 6000mAh BATTERY: DUAL-CELL INTERNAL ELECTROCHEMISTRY STACK!
  //    Strictly non-overlapping Z strata across local [-0.166 .. +0.134]
  // =========================================================================
  const cellW = (W - 0.66) / 2;
  const cellH = H - 1.24;
  const cellOffsetsX = [-(cellW / 2 + 0.10), +(cellW / 2 + 0.10)];

  const createElectrodeLayer = (type, zBase, explodeZ) => {
    const layerGrp = new THREE.Group();
    layerGrp.position.set(0, -0.28, zBase);

    const isSep = type === 'separator';
    const plateW = isSep ? cellW + 0.12 : cellW;
    const plateH = isSep ? cellH + 0.12 : cellH;
    const plateT = isSep ? 0.014 : 0.032;

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
        const tabOffsetX = type === 'anode' ? -0.58 : 0.58;
        const tabGeo = new THREE.BoxGeometry(0.32, 0.32, 0.014);
        const tab = new THREE.Mesh(tabGeo, matTab);
        tab.position.set(cx + tabOffsetX, plateH / 2 + 0.16, 0);
        layerGrp.add(tab);

        const weld = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.10, 0.018), matGold);
        weld.position.set(cx + tabOffsetX, plateH / 2 + 0.28, 0);
        layerGrp.add(weld);

        const rimEdge = new THREE.Mesh(
          new THREE.BoxGeometry(0.06, plateH - 0.24, plateT + 0.002),
          matTab
        );
        rimEdge.position.set(cx + (cellIdx === 0 ? -plateW / 2 + 0.03 : plateW / 2 - 0.03), 0, 0);
        layerGrp.add(rimEdge);
      }
    });

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

  createElectrodeLayer('anode',     -0.150, -1.68); // [-0.166..-0.134]
  createElectrodeLayer('separator', -0.116, -1.24); // [-0.123..-0.109]
  createElectrodeLayer('cathode',   -0.084, -0.78); // [-0.100..-0.068]
  createElectrodeLayer('separator', -0.050, -0.32); // [-0.057..-0.043]

  // Central Dual-Cell Electrolyte-Gel Core & Internal Thermal Sense Strip (local [-0.034..+0.014])
  const coreSpineGroup = new THREE.Group();
  coreSpineGroup.position.set(0, -0.28, -0.010);
  const spineDivider = new THREE.Mesh(new THREE.BoxGeometry(0.10, cellH - 0.10, 0.032), matKapton);
  coreSpineGroup.add(spineDivider);
  const probe = new THREE.Mesh(new THREE.BoxGeometry(0.05, cellH * 0.65, 0.010), matCopperFoil);
  probe.position.set(0, 0.30, -0.022);
  coreSpineGroup.add(probe);
  const busbar = new THREE.Mesh(new THREE.BoxGeometry(3.85, 0.10, 0.020), matAluminumFoil);
  busbar.position.set(0, cellH / 2 + 0.26, 0);
  coreSpineGroup.add(busbar);
  root.add(coreSpineGroup);
  registerLayer(coreSpineGroup, [0, 0, 0.12]);

  createElectrodeLayer('anode',      0.042,  0.58); // [+0.026..+0.058]
  createElectrodeLayer('separator',  0.078,  1.04); // [+0.071..+0.085]
  createElectrodeLayer('cathode',    0.116,  1.48); // [+0.100..+0.132]

  // =========================================================================
  // 4. LOWER ALUMINUM-LAMINATED POUCH TRAY & WHITE STRETCH-RELEASE PULL TABS
  // =========================================================================
  const bottomPouchGroup = new THREE.Group();
  bottomPouchGroup.position.set(0, -0.22, 0.194); // local [+0.153..+0.235] -> world [+0.117..+0.199]

  const botTray = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(W - 0.14, H - 0.56, BATTERY_DIM.R), 0.082, {
      bevelSize: 0.022,
      bevelThickness: 0.022,
      bevelSegments: 4,
    }),
    matPouchBottom
  );
  bottomPouchGroup.add(botTray);
  root.add(bottomPouchGroup);
  registerLayer(bottomPouchGroup, [0, 0, 2.25]);

  // Dual White Stretch-Release Service Adhesive Pull-Tabs (local [+0.241..+0.257] -> world [+0.205..+0.221], below VC_BOT +0.226!)
  const pullTabsGroup = new THREE.Group();
  pullTabsGroup.position.set(0, -0.22, 0.249);
  [-1.65, 1.65].forEach((px) => {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.68, H - 1.35, 0.012), matPullTab);
    strip.position.set(px, 0.08, 0);
    pullTabsGroup.add(strip);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.22, 0.016), matIc);
    grip.position.set(px, -(H - 1.35) / 2 - 0.06, 0);
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
