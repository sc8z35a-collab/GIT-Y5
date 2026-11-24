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
  // 1 & 2. CNC GRADE-5 TITANIUM UNIBODY CHASSIS + MIDFRAME DECK (Z rail: [-0.394..+0.394])
  //        Static machined unibody components grouped cleanly into chassisGroup!
  // =========================================================================
  const chassisGroup = new THREE.Group();
  chassisGroup.name = 'unibody_chassis';
  root.add(chassisGroup);

  const railShape = createRoundedRectShape(PHONE.W, PHONE.H, PHONE.R);
  railShape.holes.push(
    createRoundedRectHole(
      PHONE.W - PHONE.RAIL_W * 2,
      PHONE.H - PHONE.RAIL_W * 2,
      PHONE.R - PHONE.RAIL_W
    )
  );
  const railMesh = new THREE.Mesh(
    extrudePlate(railShape, 0.938, {
      bevelSize: 0.036,
      bevelThickness: 0.036,
      bevelSegments: 5,
      curveSegments: 44,
    }),
    matTitanium
  );
  railMesh.position.z = -0.075; // World Z: [-0.544 .. +0.394] flush between front glass & Rev 5.0 EVT rear ceramic!
  chassisGroup.add(railMesh);

  // 6 Insulated PEEK RF Antenna Split Bands inlaid cleanly across the Titanium perimeter
  const sideBandGeo = new THREE.BoxGeometry(PHONE.RAIL_W + 0.018, 0.11, 0.88);
  const topBotBandGeo = new THREE.BoxGeometry(0.11, PHONE.RAIL_W + 0.018, 0.88);
  [
    [-PHONE.W / 2 + PHONE.RAIL_W / 2,  6.40, sideBandGeo],
    [ PHONE.W / 2 - PHONE.RAIL_W / 2,  6.40, sideBandGeo],
    [-PHONE.W / 2 + PHONE.RAIL_W / 2, -6.40, sideBandGeo],
    [ PHONE.W / 2 - PHONE.RAIL_W / 2, -6.40, sideBandGeo],
    [-2.05,  PHONE.H / 2 - PHONE.RAIL_W / 2, topBotBandGeo],
    [ 2.05, -PHONE.H / 2 + PHONE.RAIL_W / 2, topBotBandGeo],
  ].forEach(([bx, by, geo]) => {
    const band = new THREE.Mesh(geo, matPeekAntenna);
    band.position.set(bx, by, -0.075);
    chassisGroup.add(band);
  });

  // CNC Bottom Acoustic Speaker Grille Ports (6 machined capsule slots) + Primary Mic Pinhole
  const matDarkPort = new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.85, metalness: 0.2 });
  for (let i = 0; i < 6; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 12), matDarkPort);
    hole.position.set(1.22 + i * 0.21, -PHONE.H / 2 + 0.02, 0);
    chassisGroup.add(hole);
  }
  const botMic = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.08, 12), matDarkPort);
  botMic.position.set(-1.32, -PHONE.H / 2 + 0.02, 0);
  chassisGroup.add(botMic);

  // Internal CNC-Milled Structural Midframe Deck (REAL 0.46mm alloy at Z = +0.194 -> [+0.171..+0.217])
  const webShape = createRoundedRectShape(PHONE.W - 0.56, PHONE.H - 0.56, PHONE.R - 0.26);
  // Full milled through-pockets so Camera Bay, 5.18mm 6000mAh Battery, Ultrasonic FP, Selfie/Earpiece, VCNL4040 & Top Mic seat cleanly!
  webShape.holes.push(
    createRoundedRectHole(CAMERA_BAY.W - 0.16, CAMERA_BAY.H - 0.16, 0.44, CAMERA_BAY.CENTER_X, CAMERA_BAY.CENTER_Y)
  );
  webShape.holes.push(
    createRoundedRectHole(BATTERY_DIM.W + 0.14, BATTERY_DIM.H + 0.14, 0.22, BATTERY_DIM.CENTER_X, BATTERY_DIM.CENTER_Y)
  );
  webShape.holes.push(
    createRoundedRectHole(1.18, 1.18, 0.14, 0, DISPLAY_DIM.FP_Y)
  );
  webShape.holes.push(
    createRoundedRectHole(2.74, 0.86, 0.16, 0.16, DISPLAY_DIM.PUNCH_Y + 0.12)
  );
  // Optical Proximity/ALS aperture pocket for U810 (Vishay VCNL4040M3OE, 1.10mm tall) & Top Mic acoustic port for MK801 (MP34DT05TR-A, 1.00mm)
  webShape.holes.push(
    createRoundedRectHole(0.56, 0.36, 0.06, 2.10, 7.41)
  );
  webShape.holes.push(
    createRoundedRectHole(0.46, 0.56, 0.06, 2.76, 7.39)
  );

  const webMesh = new THREE.Mesh(
    extrudePlate(webShape, 0.046, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matMidframeAlloy
  );
  webMesh.position.z = Z_STACK.FRAME_WEB;
  chassisGroup.add(webMesh);

  // Internal machined compartmental dividing ribs (strictly clear of battery, motherboard spine, camera MIPI flex, selfie & bottom bay!)
  const ribSpecs = [
    [0.0, -5.940, 6.76, 0.052, 0.24],  // Horizontal rib separating 6000mAh Battery (-5.86) from Bottom Bay (-5.99)
    [-0.18, 4.10, 0.06, 1.92, 0.24],   // Lower vertical rib separating Ultra-Wide bay from Logic board
    [-0.18, 6.72, 0.06, 0.44, 0.24],   // Upper vertical rib boss above 45MP MIPI slot (clears selfie at +7.05!)
    [2.505, -1.42, 0.024, 8.70, 0.24], // Thin structural titanium spine divider between Battery (+2.490) & Motherboard (+2.528)
    [-0.78, -6.92, 0.06, 1.72, 0.24],  // Bottom bay rib: Haptic/SIM | USB-C
    [0.78, -6.92, 0.06, 1.72, 0.24],   // Bottom bay rib: USB-C | Speaker
  ];
  ribSpecs.forEach(([rx, ry, rw, rh, rt]) => {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(rw, rh, rt), matMidframeAlloy);
    rib.position.set(rx, ry, Z_STACK.FRAME_WEB - rt / 2 - 0.026);
    chassisGroup.add(rib);
  });

  // 12 Precision Micro-Torx Titanium Screws around perimeter standoffs (strictly outside battery & motherboard!)
  const screwHeadGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.024, 12);
  screwHeadGeo.rotateX(Math.PI / 2);
  const screwCoords = [
    [-3.32, 7.25], [3.32, 7.25], [3.32, -5.945], [-3.32, -5.945],
    [3.32, -7.35], [-3.32, -7.35], [-0.18, 6.86], [-0.18, 3.16],
    [2.505, 3.08], [0.78, -5.950], [-0.78, -5.950], [-3.32, 3.16],
  ];
  screwCoords.forEach(([sx, sy]) => {
    const scr = new THREE.Mesh(screwHeadGeo, matScrew);
    scr.position.set(sx, sy, Z_STACK.FRAME_WEB - 0.028);
    chassisGroup.add(scr);
  });

  // =========================================================================
  // 3. SIDE TACTILE VOLUME ROCKER & POWER BUTTON DISSECTION (+X EDGE, strictly non-overlapping!)
  // =========================================================================
  const keycapsGroup = new THREE.Group();
  keycapsGroup.position.set(PHONE.W / 2 + 0.130, 0, 0);

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

  root.add(keycapsGroup);
  registerLayer(keycapsGroup, [1.55, 0, 0]);

  const bootsGroup = new THREE.Group();
  bootsGroup.position.set(PHONE.W / 2 - 0.285, 0, 0);
  [3.42, 2.28, 0.42].forEach((py) => {
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.012, 16), matSilicone);
    boot.rotation.z = Math.PI / 2;
    boot.position.set(0, py, 0);
    bootsGroup.add(boot);
  });
  root.add(bootsGroup);
  registerLayer(bootsGroup, [0.95, 0, 0]);

  const switchFlexGroup = new THREE.Group();
  switchFlexGroup.position.set(PHONE.W / 2 - 0.308, 1.85, 0);
  const sideFlex = new THREE.Mesh(new THREE.BoxGeometry(0.010, 4.15, 0.22), matFlexDark);
  switchFlexGroup.add(sideFlex);
  [1.57, 0.43, -1.43].forEach((dy) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), matGold);
    dome.rotation.z = -Math.PI / 2;
    dome.position.set(0.005, dy, 0);
    switchFlexGroup.add(dome);
  });
  root.add(switchFlexGroup);
  registerLayer(switchFlexGroup, [0.46, 0, 0]);

  // =========================================================================
  // 4. DUAL-SIM / eSIM MACHINED TITANIUM TRAY + RED IP68 O-RING (-X LOWER BAY, Y = -6.24)
  //    Seated cleanly inside dedicated SIM pocket above Haptic Engine & below horizontal rib!
  // =========================================================================
  const simGroup = new THREE.Group();
  simGroup.position.set(-PHONE.W / 2 - 0.145, -6.26, 0);

  const simCap = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.08, 0.88, 0.03), 0.20, { bevelSize: 0.014, bevelThickness: 0.014 }),
    matTitanium
  );
  simGroup.add(simCap);

  const simGasket = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.028, 0.84, 0.03), 0.18, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matRedGasket
  );
  simGasket.position.x = 0.072;
  simGroup.add(simGasket);

  const sledShape = createRoundedRectShape(1.42, 0.44, 0.05);
  sledShape.holes.push(createRoundedRectHole(1.12, 0.28, 0.03));
  const simSled = new THREE.Mesh(
    extrudePlate(sledShape, 0.058, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matMidframeAlloy
  );
  simSled.position.set(1.18, 0, 0);
  simGroup.add(simSled);

  root.add(simGroup);
  registerLayer(simGroup, [-1.85, 0, 0]);

  // =========================================================================
  // 5. DUAL 5G mmWAVE PHASED-ARRAY ANTENNA MODULES (seated cleanly inside inner titanium walls!)
  // =========================================================================
  const buildMmWaveModule = (sideSign, yPos, bodyLen = 1.60) => {
    const grp = new THREE.Group();
    grp.position.set(sideSign * (PHONE.W / 2 - 0.34), yPos, 0);

    const ceramicBody = new THREE.Mesh(new THREE.BoxGeometry(0.06, bodyLen, 0.30), matCeramicWhite);
    grp.add(ceramicBody);

    const pitch = (bodyLen - 0.36) / 3;
    for (let i = 0; i < 4; i++) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.28, 0.20), matGold);
      patch.position.set(sideSign * 0.038, -pitch * 1.5 + i * pitch, 0);
      grp.add(patch);
    }

    const rfBack = new THREE.Mesh(new THREE.BoxGeometry(0.032, bodyLen - 0.12, 0.26), matMidframeAlloy);
    rfBack.position.set(-sideSign * 0.046, 0, 0);
    grp.add(rfBack);

    root.add(grp);
    registerLayer(grp, [sideSign * 1.15, 0, 0]);
  };

  buildMmWaveModule(-1, 3.80, 1.50);  // Left Upper 5G mmWave Array (clears 59.6mm battery!)
  buildMmWaveModule( 1, -5.06, 1.52); // Right Lower 5G mmWave Array (clears motherboard -4.12 & horizontal rib -5.98!)

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
