import * as THREE from 'three';
import { PHONE, CAMERA_BAY, BATTERY_DIM, DISPLAY_DIM, Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  createRoundedRectHole,
  extrudePlate,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * RK T4 — CNC Grade-5 Titanium Unibody Midframe, Tactile Side Buttons + Dome-Switch Flex,
 * Dual-SIM Tray + IP68 Gasket, and Dual 5G mmWave Phased-Array Antennas.
 */
export function buildFrameSystem(textures) {
  const root = new THREE.Group();
  root.name = 'frame';
  root.position.set(0, 0, 0);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const matTitanium = new THREE.MeshStandardMaterial({
    color: 0xc2beb6,
    map: textures.titanium.map,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.92,
    roughness: 0.27,
  });

  const matMidframeAlloy = new THREE.MeshStandardMaterial({
    color: 0x9fa3aa,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.86,
    roughness: 0.34,
  });

  const matPeekAntenna = new THREE.MeshStandardMaterial({
    color: 0x6f7176,
    metalness: 0.12,
    roughness: 0.62,
  });

  const matSilicone = new THREE.MeshPhysicalMaterial({
    color: 0xe6ebf2,
    transparent: true,
    opacity: 0.72,
    roughness: 0.35,
    metalness: 0.0,
  });

  const matRedGasket = new THREE.MeshStandardMaterial({
    color: 0xa6322e,
    roughness: 0.55,
    metalness: 0.04,
  });

  const matGold = new THREE.MeshStandardMaterial({
    color: 0xdcb45c,
    metalness: 0.96,
    roughness: 0.18,
  });

  const matCeramicWhite = new THREE.MeshStandardMaterial({
    color: 0xeaecef,
    metalness: 0.14,
    roughness: 0.28,
  });

  const matFlexDark = new THREE.MeshStandardMaterial({
    color: 0x201a15,
    metalness: 0.38,
    roughness: 0.42,
  });

  const matScrew = new THREE.MeshStandardMaterial({
    color: 0xdedfe2,
    metalness: 0.96,
    roughness: 0.18,
  });

  // =========================================================================
  // 1. CNC GRADE-5 TITANIUM OUTER PERIMETER RAIL
  // =========================================================================
  const railShape = createRoundedRectShape(PHONE.W, PHONE.H, PHONE.R);
  railShape.holes.push(
    createRoundedRectHole(
      PHONE.W - PHONE.RAIL_W * 2,
      PHONE.H - PHONE.RAIL_W * 2,
      PHONE.R - PHONE.RAIL_W
    )
  );
  const railMesh = new THREE.Mesh(
    extrudePlate(railShape, PHONE.T - 0.04, {
      bevelSize: 0.045,
      bevelThickness: 0.045,
      bevelSegments: 5,
      curveSegments: 44,
    }),
    matTitanium
  );
  root.add(railMesh);

  // 6 Insulated PEEK RF Antenna Split Bands inlaid cleanly across the Titanium perimeter
  const sideBandGeo = new THREE.BoxGeometry(PHONE.RAIL_W + 0.025, 0.11, PHONE.T - 0.06);
  const topBotBandGeo = new THREE.BoxGeometry(0.11, PHONE.RAIL_W + 0.025, PHONE.T - 0.06);
  [
    [-PHONE.W / 2 + PHONE.RAIL_W / 2,  6.20, sideBandGeo],
    [ PHONE.W / 2 - PHONE.RAIL_W / 2,  6.20, sideBandGeo],
    [-PHONE.W / 2 + PHONE.RAIL_W / 2, -6.20, sideBandGeo],
    [ PHONE.W / 2 - PHONE.RAIL_W / 2, -6.20, sideBandGeo],
    [-2.05,  PHONE.H / 2 - PHONE.RAIL_W / 2, topBotBandGeo],
    [ 2.05, -PHONE.H / 2 + PHONE.RAIL_W / 2, topBotBandGeo],
  ].forEach(([bx, by, geo]) => {
    const band = new THREE.Mesh(geo, matPeekAntenna);
    band.position.set(bx, by, 0);
    root.add(band);
  });

  // CNC Bottom Acoustic Speaker Grille Ports (6 machined capsule slots) + USB-C Cutout Shadow
  const matDarkPort = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.85, metalness: 0.2 });
  for (let i = 0; i < 6; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 12), matDarkPort);
    hole.position.set(1.22 + i * 0.21, -PHONE.H / 2 + 0.02, 0);
    root.add(hole);
  }
  // Primary mic pinhole on bottom-left
  const botMic = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.08, 12), matDarkPort);
  botMic.position.set(-1.32, -PHONE.H / 2 + 0.02, 0);
  root.add(botMic);

  // =========================================================================
  // 2. INTERNAL CNC-MILLED STRUCTURAL MIDFRAME DECK (Z = +0.192)
  // =========================================================================
  const webShape = createRoundedRectShape(PHONE.W - 0.34, PHONE.H - 0.34, PHONE.R - 0.16);
  // Milled structural relief cutouts matching Camera Bay, Battery Thermal Window & Ultrasonic FP Window
  webShape.holes.push(
    createRoundedRectHole(CAMERA_BAY.W - 0.24, CAMERA_BAY.H - 0.24, 0.44, CAMERA_BAY.CENTER_X, CAMERA_BAY.CENTER_Y)
  );
  webShape.holes.push(
    createRoundedRectHole(BATTERY_DIM.W - 0.72, BATTERY_DIM.H - 1.40, 0.28, BATTERY_DIM.CENTER_X, BATTERY_DIM.CENTER_Y + 0.22)
  );
  webShape.holes.push(
    createRoundedRectHole(1.18, 1.18, 0.14, 0, DISPLAY_DIM.FP_Y)
  );

  const webMesh = new THREE.Mesh(
    extrudePlate(webShape, 0.052, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matMidframeAlloy
  );
  webMesh.position.z = Z_STACK.FRAME_WEB;
  root.add(webMesh);

  // Internal machined compartmental dividing ribs (separating Battery, Camera, Motherboard, Bottom Bay)
  const ribSpecs = [
    [0.0, -4.64, 6.72, 0.12, 0.32],  // Horizontal rib above bottom electromechanical bay
    [-0.28, 4.92, 0.10, 4.24, 0.30], // Vertical rib separating Camera bay from Logic board
    [2.30, -1.04, 0.08, 7.04, 0.28], // Vertical rib separating Battery from Motherboard spine
    [-0.78, -6.02, 0.08, 2.38, 0.26],// Bottom bay rib: Haptic | USB-C
    [0.78, -6.02, 0.08, 2.38, 0.26], // Bottom bay rib: USB-C | Speaker
  ];
  ribSpecs.forEach(([rx, ry, rw, rh, rt]) => {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rt), matMidframeAlloy);
    rib.position.set(rx, ry, Z_STACK.FRAME_WEB - rt / 2 - 0.01);
    root.add(rib);
  });

  // 14 Precision Micro-Torx Titanium Screws around perimeter standoffs!
  const screwHeadGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.028, 12);
  screwHeadGeo.rotateX(Math.PI / 2);
  const screwCoords = [
    [-3.18, 6.85], [3.18, 6.85], [3.18, 3.60], [3.18, 0.05],
    [3.18, -3.60], [3.18, -6.95], [-3.18, -6.95], [-3.18, -4.64],
    [-3.18, 1.80], [-0.28, 6.85], [-0.28, 2.66], [2.30, 2.66],
    [0.78, -4.64], [-0.78, -4.64],
  ];
  screwCoords.forEach(([sx, sy]) => {
    const scr = new THREE.Mesh(screwHeadGeo, matScrew);
    scr.position.set(sx, sy, Z_STACK.FRAME_WEB - 0.04);
    root.add(scr);
  });

  // =========================================================================
  // 3. SIDE TACTILE VOLUME ROCKER & POWER BUTTON DISSECTION (+X EDGE)
  // =========================================================================
  // 3A. External CNC Titanium Keycaps (pull outward +X on dissection!)
  const keycapsGroup = new THREE.Group();
  keycapsGroup.position.set(PHONE.W / 2 + 0.035, 0, 0);

  const volRocker = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.11, 2.15, 0.05), 0.23, { bevelSize: 0.025, bevelThickness: 0.025 }),
    matTitanium
  );
  volRocker.position.set(0, 2.85, 0);
  keycapsGroup.add(volRocker);

  const powerBtn = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.11, 1.24, 0.05), 0.23, { bevelSize: 0.025, bevelThickness: 0.025 }),
    matTitanium
  );
  powerBtn.position.set(0, 0.42, 0);
  keycapsGroup.add(powerBtn);

  // Subtle machined key-plunger pins on inner side of buttons
  [3.42, 2.28, 0.42].forEach((py) => {
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.16, 12), matScrew);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(-0.10, py, 0);
    keycapsGroup.add(pin);
  });
  root.add(keycapsGroup);
  registerLayer(keycapsGroup, [1.55, 0, 0]);

  // 3B. Waterproof Silicone Dust Boots (middle separation layer!)
  const bootsGroup = new THREE.Group();
  bootsGroup.position.set(PHONE.W / 2 - 0.05, 0, 0);
  [3.42, 2.28, 0.42].forEach((py) => {
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.10, 0.09, 16), matSilicone);
    boot.rotation.z = Math.PI / 2;
    boot.position.set(0, py, 0);
    bootsGroup.add(boot);
  });
  root.add(bootsGroup);
  registerLayer(bootsGroup, [0.95, 0, 0]);

  // 3C. Gold-Plated Micro Tactile Dome-Switch Side Flex PCB
  const switchFlexGroup = new THREE.Group();
  switchFlexGroup.position.set(PHONE.W / 2 - 0.18, 1.85, 0);
  const sideFlex = new THREE.Mesh(new THREE.BoxGeometry(0.022, 4.15, 0.24), matFlexDark);
  switchFlexGroup.add(sideFlex);
  // 3 gleaming gold tactile metal snap domes!
  [1.57, 0.43, -1.43].forEach((dy) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), matGold);
    dome.rotation.z = -Math.PI / 2;
    dome.position.set(0.015, dy, 0);
    switchFlexGroup.add(dome);
  });
  root.add(switchFlexGroup);
  registerLayer(switchFlexGroup, [0.46, 0, 0]);

  // =========================================================================
  // 4. DUAL-SIM / eSIM MACHINED TITANIUM TRAY + RED IP68 O-RING (-X EDGE)
  // =========================================================================
  const simGroup = new THREE.Group();
  simGroup.position.set(-PHONE.W / 2 - 0.01, -3.55, 0);

  // Outer flush titanium cap with tiny eject pinhole
  const simCap = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.09, 1.38, 0.04), 0.24, { bevelSize: 0.018, bevelThickness: 0.018 }),
    matTitanium
  );
  simGroup.add(simCap);

  // Red IP68 silicone waterproof O-ring gasket behind cap
  const simGasket = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.04, 1.32, 0.04), 0.22, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matRedGasket
  );
  simGasket.position.x = 0.075;
  simGroup.add(simGasket);

  // Internal dual-nano-SIM open metal sled frame
  const sledShape = createRoundedRectShape(1.55, 1.18, 0.08);
  sledShape.holes.push(createRoundedRectHole(1.24, 0.92, 0.04));
  const simSled = new THREE.Mesh(
    extrudePlate(sledShape, 0.065, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matMidframeAlloy
  );
  simSled.position.set(0.86, 0, 0);
  simGroup.add(simSled);

  root.add(simGroup);
  registerLayer(simGroup, [-1.85, 0, 0]);

  // =========================================================================
  // 5. DUAL 5G mmWAVE PHASED-ARRAY ANTENNA MODULES (LEFT & RIGHT RAILS)
  // =========================================================================
  const buildMmWaveModule = (sideSign, yPos) => {
    const grp = new THREE.Group();
    grp.position.set(sideSign * (PHONE.W / 2 - 0.14), yPos, 0);

    // White ceramic phased-array dielectric substrate
    const ceramicBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 1.88, 0.34), matCeramicWhite);
    grp.add(ceramicBody);

    // 4 gleaming gold rectangular mmWave phased-array patch antenna elements!
    for (let i = 0; i < 4; i++) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.32, 0.22), matGold);
      patch.position.set(sideSign * 0.052, -0.63 + i * 0.42, 0);
      grp.add(patch);
    }

    // Rear RF shielding micro-can & flex lead
    const rfBack = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.72, 0.28), matMidframeAlloy);
    rfBack.position.set(-sideSign * 0.06, 0, 0);
    grp.add(rfBack);

    root.add(grp);
    registerLayer(grp, [sideSign * 1.15, 0, 0]);
  };

  buildMmWaveModule(-1, 0.45);  // Left mmWave 5G Array
  buildMmWaveModule( 1, -2.55); // Right Lower 5G Array

  prepareAssembly(root, 'frame');

  return {
    id: 'frame',
    root,
    homePos: new THREE.Vector3(0, 0, 0),
    macroOffset: new THREE.Vector3(0, 0, 0),
    hoverOffset: new THREE.Vector3(0, 0, 0.08),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}
