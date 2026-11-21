import * as THREE from 'three';
import { BOTTOM_BAY, DISPLAY_DIM, Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  createRoundedRectHole,
  createCircleHole,
  extrudePlate,
  createOpticalLensGeometry,
  createLensRingGeometry,
  createLeafSpringGeometry,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * 1. BOTTOM STEREO ACOUSTIC SPEAKER MODULE — Internal Driver & Bass Chamber Dissection
 *    Upper Acoustic Enclosure -> Pleated Diaphragm -> Wound Copper Voice Coil ->
 *    Neodymium Magnet & Steel Yoke -> Acoustic Resonance Chamber with Micro Damping Spheres!
 */
export function buildSpeakerSystem(textures) {
  const root = new THREE.Group();
  root.name = 'speaker';

  const cfg = BOTTOM_BAY.SPEAKER;
  const anchorZ = Z_STACK.INTERNAL_MID;
  root.position.set(cfg.x, cfg.y, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const matComposite = new THREE.MeshStandardMaterial({
    color: 0x1b1e24,
    metalness: 0.24,
    roughness: 0.56,
  });
  const matSteel = new THREE.MeshStandardMaterial({
    color: 0xd0d4dc,
    metalness: 0.94,
    roughness: 0.20,
  });
  const matCopperCoil = new THREE.MeshStandardMaterial({
    color: 0xd47b42,
    map: textures.woundWire,
    metalness: 0.92,
    roughness: 0.26,
  });
  const matDiaphragm = new THREE.MeshPhysicalMaterial({
    color: 0x262a34,
    metalness: 0.35,
    roughness: 0.26,
    clearcoat: 0.65,
    iridescence: 0.35,
  });
  const matGold = new THREE.MeshStandardMaterial({
    color: 0xdcb45c,
    metalness: 0.96,
    roughness: 0.18,
  });
  const matBead = new THREE.MeshStandardMaterial({
    color: 0xebeef4,
    roughness: 0.42,
    metalness: 0.05,
  });

  // 1A. Upper Sealed Acoustic Enclosure Shell (local Z: [-0.180..-0.120])
  const topCover = new THREE.Group();
  topCover.position.z = -0.150;
  const coverPlate = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(cfg.w, cfg.h, 0.16), 0.060, { bevelSize: 0.012, bevelThickness: 0.012 }),
    matComposite
  );
  topCover.add(coverPlate);
  const portLip = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.08, 0.060), matSteel);
  portLip.position.set(0.15, -cfg.h / 2 - 0.01, 0);
  topCover.add(portLip);
  root.add(topCover);
  registerLayer(topCover, [0, 0, -1.65]);

  // 1B. Pleated Suspended Acoustic Diaphragm & Center Dust Dome (local Z: [-0.114..-0.083])
  const diaphragmGroup = new THREE.Group();
  diaphragmGroup.position.set(0.32, 0.04, -0.095);
  const surround = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.16, 1.24, 0.20), 0.024, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matDiaphragm
  );
  diaphragmGroup.add(surround);
  const centerDome = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.82, 0.92, 0.14), 0.020, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matSteel
  );
  centerDome.position.z = -0.008;
  diaphragmGroup.add(centerDome);
  root.add(diaphragmGroup);
  registerLayer(diaphragmGroup, [0, 0, -0.82]);

  // 1C. Rectangular Wound Copper Acoustic Voice Coil (local Z: [-0.076..-0.016])
  const voiceCoilGroup = new THREE.Group();
  voiceCoilGroup.position.set(0.32, 0.04, -0.046);
  const vcShape = createRoundedRectShape(0.76, 0.86, 0.12);
  vcShape.holes.push(createRoundedRectHole(0.62, 0.72, 0.08));
  const voiceCoil = new THREE.Mesh(
    extrudePlate(vcShape, 0.060, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matCopperCoil
  );
  voiceCoilGroup.add(voiceCoil);
  root.add(voiceCoilGroup);
  registerLayer(voiceCoilGroup, [0, 0, -0.22]);

  // 1D. Neodymium Core Magnet & Precision Steel Magnetic Yoke (local Z: [-0.006..+0.110])
  const magnetGroup = new THREE.Group();
  magnetGroup.position.set(0.32, 0.04, 0.036);
  const coreMag = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.56, 0.68, 0.08), 0.084, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matSteel
  );
  magnetGroup.add(coreMag);
  const yokeBase = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.04, 1.14, 0.14), 0.024, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matComposite
  );
  yokeBase.position.z = 0.058;
  magnetGroup.add(yokeBase);
  root.add(magnetGroup);
  registerLayer(magnetGroup, [0, 0, 0.42]);

  // 1E. Lower Acoustic Bass Chamber + 30 Micro Acoustic Damping Polymer Spheres (local Z: [+0.122..+0.174])
  const chamberGroup = new THREE.Group();
  chamberGroup.position.z = 0.148;
  const trayShape = createRoundedRectShape(cfg.w, cfg.h, 0.16);
  const trayBase = new THREE.Mesh(
    extrudePlate(trayShape, 0.050, { bevelSize: 0.010, bevelThickness: 0.010 }),
    matComposite
  );
  chamberGroup.add(trayBase);

  const wallShape = createRoundedRectShape(0.78, cfg.h - 0.24, 0.10);
  wallShape.holes.push(createRoundedRectHole(0.64, cfg.h - 0.38, 0.06));
  const bassWall = new THREE.Mesh(
    extrudePlate(wallShape, 0.10, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matComposite
  );
  bassWall.position.set(-0.66, 0, -0.078);
  chamberGroup.add(bassWall);

  const beadGeo = new THREE.SphereGeometry(0.048, 10, 10);
  const beadInst = new THREE.InstancedMesh(beadGeo, matBead, 30);
  const dummy = new THREE.Object3D();
  let bIdx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 3; col++) {
      for (let zLayer = 0; zLayer < 2; zLayer++) {
        dummy.position.set(
          -0.84 + col * 0.17 + (row % 2) * 0.03,
          -0.52 + row * 0.25,
          -0.056 - zLayer * 0.060
        );
        dummy.updateMatrix();
        beadInst.setMatrixAt(bIdx++, dummy.matrix);
      }
    }
  }
  beadInst.instanceMatrix.needsUpdate = true;
  chamberGroup.add(beadInst);

  [-0.98, -0.98].forEach((gx, idx) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.036), matGold);
    pad.position.set(gx, 0.36 - idx * 0.32, -0.05);
    chamberGroup.add(pad);
  });

  root.add(chamberGroup);
  registerLayer(chamberGroup, [0, 0, 1.05]);

  prepareAssembly(root, 'speaker');

  return {
    id: 'speaker',
    root,
    homePos: new THREE.Vector3(cfg.x, cfg.y, anchorZ),
    macroOffset: new THREE.Vector3(0.95, -1.45, -1.75),
    hoverOffset: new THREE.Vector3(0.18, -0.18, -0.22),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}

/**
 * 2. X-AXIS LINEAR HAPTIC ENGINE (TAPTIC ACTUATOR) — Internal Electromechanical Dissection
 */
export function buildHapticSystem(textures) {
  const root = new THREE.Group();
  root.name = 'haptic';

  const cfg = BOTTOM_BAY.HAPTIC;
  const anchorZ = Z_STACK.INTERNAL_MID;
  root.position.set(cfg.x, cfg.y, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const matSteelShell = new THREE.MeshStandardMaterial({
    color: 0xc2c6ce,
    map: textures.titanium.map,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.94,
    roughness: 0.22,
  });
  const matTungsten = new THREE.MeshStandardMaterial({
    color: 0x454a54,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.88,
    roughness: 0.32,
  });
  const matCopperCoil = new THREE.MeshStandardMaterial({
    color: 0xd47b42,
    map: textures.woundWire,
    metalness: 0.92,
    roughness: 0.26,
  });
  const matSpringTitanium = new THREE.MeshStandardMaterial({
    color: 0xdbe0e8,
    metalness: 0.96,
    roughness: 0.16,
  });
  const matGold = new THREE.MeshStandardMaterial({
    color: 0xdcb45c,
    metalness: 0.96,
    roughness: 0.18,
  });

  // 2A. Stamped Stainless-Steel Top Actuator Cover (local Z: [-0.172..-0.130])
  const topShell = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(cfg.w, cfg.h, 0.12), 0.042, { bevelSize: 0.009, bevelThickness: 0.009 }),
    matSteelShell
  );
  topShell.position.z = -0.151;
  root.add(topShell);
  registerLayer(topShell, [0, 0, -1.55]);

  // 2B. Heavy Brushed Tungsten Inertial Mass Block + Suspended Neodymium Core (local Z: [-0.115..+0.025])
  const massGroup = new THREE.Group();
  massGroup.position.z = -0.045;
  const massShape = createRoundedRectShape(1.26, 0.88, 0.07);
  massShape.holes.push(createRoundedRectHole(0.72, 0.30, 0.04, 0, 0.20));
  massShape.holes.push(createRoundedRectHole(0.72, 0.30, 0.04, 0, -0.20));
  const tungstenBlock = new THREE.Mesh(
    extrudePlate(massShape, 0.140, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matTungsten
  );
  massGroup.add(tungstenBlock);
  [0.20, -0.20].forEach((my) => {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.24, 0.12), matSpringTitanium);
    bar.position.y = my;
    massGroup.add(bar);
  });
  root.add(massGroup);
  registerLayer(massGroup, [0, 0, -0.58]);

  // 2C. Left & Right Precision Sinusoidal Leaf-Spring Flexures (strictly outside mass X = ±0.64!)
  const springsGroup = new THREE.Group();
  springsGroup.position.z = -0.045;
  const springGeo = createLeafSpringGeometry(0.86, 0.12, 0.056, 4.0);
  const springL = new THREE.Mesh(springGeo, matSpringTitanium);
  springL.position.x = -0.82;
  const springR = new THREE.Mesh(springGeo, matSpringTitanium);
  springR.position.x = 0.82;
  springsGroup.add(springL, springR);
  root.add(springsGroup);
  registerLayer(springsGroup, [0, 0, 0.05]);

  // 2D. Dual Flat Copper-Wound Electromagnetic Drive Coils (local Z: [+0.036..+0.088], strictly clear of mass +0.025!)
  const coilsGroup = new THREE.Group();
  coilsGroup.position.z = 0.062;
  [0.24, -0.24].forEach((cy) => {
    const cShape = createRoundedRectShape(1.10, 0.38, 0.08);
    cShape.holes.push(createRoundedRectHole(0.68, 0.14, 0.04));
    const coil = new THREE.Mesh(
      extrudePlate(cShape, 0.052, { bevelSize: 0.004, bevelThickness: 0.004 }),
      matCopperCoil
    );
    coil.position.y = cy;
    coilsGroup.add(coil);
  });
  root.add(coilsGroup);
  registerLayer(coilsGroup, [0, 0, 0.62]);

  // 2E. Lower Stamped Base Casing + Gold FPC Spring Contacts (local Z: [+0.106..+0.150])
  const baseGroup = new THREE.Group();
  baseGroup.position.z = 0.128;
  const botShell = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(cfg.w, cfg.h, 0.12), 0.044, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matSteelShell
  );
  baseGroup.add(botShell);
  const fpcPad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.38, 0.024), matGold);
  fpcPad.position.set(cfg.w / 2 + 0.02, 0.20, 0);
  baseGroup.add(fpcPad);
  root.add(baseGroup);
  registerLayer(baseGroup, [0, 0, 1.25]);

  prepareAssembly(root, 'haptic');

  return {
    id: 'haptic',
    root,
    homePos: new THREE.Vector3(cfg.x, cfg.y, anchorZ),
    macroOffset: new THREE.Vector3(-0.95, -1.45, -1.75),
    hoverOffset: new THREE.Vector3(-0.18, -0.18, -0.22),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}

/**
 * 3. USB-C 3.2 PORT & CHARGING/AUDIO SUB-PCB DAUGHTERBOARD
 */
export function buildUsbcSystem(textures) {
  const root = new THREE.Group();
  root.name = 'usbc';

  const cfg = BOTTOM_BAY.USBC;
  const anchorZ = Z_STACK.INTERNAL_MID;
  root.position.set(cfg.x, cfg.y, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const matSteel = new THREE.MeshStandardMaterial({
    color: 0xcad0d8,
    metalness: 0.95,
    roughness: 0.18,
  });
  const matRedSeal = new THREE.MeshStandardMaterial({
    color: 0xb0342f,
    roughness: 0.52,
    metalness: 0.05,
  });
  const matTongue = new THREE.MeshStandardMaterial({
    color: 0x17191f,
    metalness: 0.25,
    roughness: 0.45,
  });
  const matGold = new THREE.MeshStandardMaterial({
    color: 0xe0b85e,
    metalness: 0.97,
    roughness: 0.16,
  });
  const matPcb = new THREE.MeshStandardMaterial({
    map: textures.pcb,
    metalness: 0.35,
    roughness: 0.46,
  });

  // 3A. Stainless-Steel Shielded USB-C Shroud (world Y: [-7.78..-7.24], strictly inside bottom rail -7.86!)
  const shroudGroup = new THREE.Group();
  shroudGroup.position.set(0, -0.65, 0.02);
  const shroudShape = createRoundedRectShape(0.86, 0.28, 0.13);
  shroudShape.holes.push(createRoundedRectHole(0.74, 0.18, 0.08));
  const shroudMesh = new THREE.Mesh(
    extrudePlate(shroudShape, 0.54, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matSteel
  );
  shroudMesh.rotation.x = Math.PI / 2;
  shroudGroup.add(shroudMesh);
  root.add(shroudGroup);
  registerLayer(shroudGroup, [0, -1.55, 0]);

  // 3B. Red IP68 Waterproof Silicone O-Ring Gasket (world Y: [-7.84..-7.79], flush in front of shroud!)
  const gasketGroup = new THREE.Group();
  gasketGroup.position.set(0, -0.955, 0.02);
  const gShape = createRoundedRectShape(0.92, 0.34, 0.15);
  gShape.holes.push(createRoundedRectHole(0.82, 0.24, 0.11));
  const gasketMesh = new THREE.Mesh(
    extrudePlate(gShape, 0.05, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matRedSeal
  );
  gasketMesh.rotation.x = Math.PI / 2;
  gasketGroup.add(gasketMesh);
  root.add(gasketGroup);
  registerLayer(gasketGroup, [0, -2.18, 0]);

  // 3C. Central USB-C Contact Tongue with ALL 24 Individual Gleaming Gold Pins (strictly inside shroud cavity!)
  const tongueGroup = new THREE.Group();
  tongueGroup.position.set(0, -0.62, 0.02);

  const tongueCore = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.046), matTongue);
  tongueGroup.add(tongueCore);

  const pinGeo = new THREE.BoxGeometry(0.024, 0.40, 0.012);
  for (let i = 0; i < 12; i++) {
    const px = -0.275 + i * 0.050;
    const pinFront = new THREE.Mesh(pinGeo, matGold);
    pinFront.position.set(px, 0.01, 0.028);
    const pinRear = new THREE.Mesh(pinGeo, matGold);
    pinRear.position.set(px, 0.01, -0.028);
    tongueGroup.add(pinFront, pinRear);
  }
  root.add(tongueGroup);
  registerLayer(tongueGroup, [0, -0.58, 0]);

  // 3D. Bottom Charging / Audio Sub-PCB Daughterboard (world Y: [-7.18..-6.06], clears shroud & horizontal rib!)
  const subPcbGroup = new THREE.Group();
  subPcbGroup.position.set(0, 0.24, 0.03);

  const pcbMesh = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.30, 1.10, 0.09), 0.068, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matPcb
  );
  subPcbGroup.add(pcbMesh);

  const memsMic = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, 0.072), matGold);
  memsMic.position.set(-0.38, -0.30, -0.064);
  subPcbGroup.add(memsMic);
  const micPortHole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.014, 16).rotateX(Math.PI / 2), matTongue);
  micPortHole.position.set(-0.38, -0.30, -0.102);
  subPcbGroup.add(micPortHole);

  const pdIc = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.048), matTongue);
  pdIc.position.set(0.28, -0.24, -0.056);
  subPcbGroup.add(pdIc);

  const simCage = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.96, 0.56, 0.05), 0.044, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matSteel
  );
  simCage.position.set(-0.04, 0.08, 0.062);
  subPcbGroup.add(simCage);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 3; c++) {
      const contact = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.016), matGold);
      contact.position.set(-0.26 + c * 0.22, -0.02 + r * 0.20, 0.042);
      subPcbGroup.add(contact);
    }
  }

  const btbTop = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.14, 0.050), matGold);
  btbTop.position.set(0.18, 0.42, -0.058);
  subPcbGroup.add(btbTop);
  [-0.44, -0.26].forEach((rx) => {
    const antSpring = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.16, 0.052), matGold);
    antSpring.position.set(rx, 0.40, -0.056);
    subPcbGroup.add(antSpring);
  });

  root.add(subPcbGroup);
  registerLayer(subPcbGroup, [0, 0.48, 0.35]);

  prepareAssembly(root, 'usbc');

  return {
    id: 'usbc',
    root,
    homePos: new THREE.Vector3(cfg.x, cfg.y, anchorZ),
    macroOffset: new THREE.Vector3(0, -1.85, -1.55),
    hoverOffset: new THREE.Vector3(0, -0.26, -0.18),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}

/**
 * 4. TOP FRONT PUNCH-HOLE SELFIE CAMERA (SONY IMX615 32MP 5P STACK) + EARPIECE + TOP ANC MIC
 */
export function buildSelfieSystem(textures) {
  const root = new THREE.Group();
  root.name = 'selfie';

  const anchorY = DISPLAY_DIM.PUNCH_Y;
  const anchorZ = 0.05;
  root.position.set(0, anchorY, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const matDark = new THREE.MeshStandardMaterial({ color: 0x16181e, metalness: 0.68, roughness: 0.34 });
  const matGlass = new THREE.MeshPhysicalMaterial({
    color: 0xdcf0ff,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    ior: 1.62,
    reflectivity: 1.0,
    roughness: 0.025,
    metalness: 0.12,
    clearcoat: 1.0,
    envMapIntensity: 2.0,
    iridescence: 0.78,
  });
  const matIr = new THREE.MeshPhysicalMaterial({
    color: 0x3ea8da,
    transparent: true,
    opacity: 0.54,
    depthWrite: false,
    roughness: 0.03,
    metalness: 0.20,
    clearcoat: 1.0,
    iridescence: 0.95,
  });
  const matCmos = new THREE.MeshPhysicalMaterial({
    map: textures.cmosSensor,
    metalness: 0.74,
    roughness: 0.15,
    iridescence: 0.85,
  });
  const matCopper = new THREE.MeshStandardMaterial({ color: 0xd07842, metalness: 0.92, roughness: 0.25 });
  const matSteel = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, metalness: 0.92, roughness: 0.22 });
  const matGold = new THREE.MeshStandardMaterial({ color: 0xe0b85e, metalness: 0.96, roughness: 0.16 });
  const matFlex = new THREE.MeshStandardMaterial({ color: 0x221b14, metalness: 0.40, roughness: 0.36 });

  // 4A. Sony IMX615 32MP Front Selfie 5P Aspherical Optical Stack (strictly non-overlapping Z strata!)
  const miniLenses = [
    { z: 0.214, ex: 2.25, r: 0.164, sag: 0.012 },
    { z: 0.170, ex: 1.76, r: 0.150, sag: -0.008 },
    { z: 0.126, ex: 1.28, r: 0.146, sag: 0.010 },
    { z: 0.082, ex: 0.82, r: 0.142, sag: -0.008 },
    { z: 0.038, ex: 0.40, r: 0.146, sag: 0.010 },
  ];
  miniLenses.forEach((l) => {
    const grp = new THREE.Group();
    grp.position.z = l.z;
    const lens = new THREE.Mesh(
      createOpticalLensGeometry({ radius: l.r, edgeThickness: 0.014, frontSag: -l.sag, backSag: l.sag }),
      matGlass
    );
    const ring = new THREE.Mesh(createLensRingGeometry(l.r - 0.008, l.r + 0.030, 0.018, 0.003, 32), matDark);
    grp.add(lens, ring);
    root.add(grp);
    registerLayer(grp, [0, 0, l.ex]);
  });

  // Mini AGC Blue-Glass IR-Cut Filter for Sony IMX615 (local [-0.006..+0.006])
  const selfieIr = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.012), matIr);
  selfieIr.position.z = 0.000;
  root.add(selfieIr);
  registerLayer(selfieIr, [0, 0, 0.06]);

  // Sony IMX615 32MP Quad-Bayer CMOS Sensor Package + Gold Seal Ring + 24P Hirose Flex
  const selfieSensor = new THREE.Group();
  selfieSensor.position.z = -0.056;
  selfieSensor.add(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.044), matDark));
  const selfieDie = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.014), matCmos);
  selfieDie.position.z = 0.028;
  const selfieSeal = new THREE.Mesh(createLensRingGeometry(0.18, 0.21, 0.008, 0.002, 24), matGold);
  selfieSeal.position.z = 0.026;
  const selfieFlex = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.012), matFlex);
  selfieFlex.position.set(0.38, 0.34, -0.01);
  const selfieBtb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.026), matGold);
  selfieBtb.position.set(0.62, 0.34, -0.012);
  selfieSensor.add(selfieDie, selfieSeal, selfieFlex, selfieBtb);
  root.add(selfieSensor);
  registerLayer(selfieSensor, [0, 0, -0.38]);

  // 4B. Top Linear Earpiece Micro-Speaker + Knowles SPH0655LM4H-1 Top ANC Mic + ams TCS3701 IR Bar
  const earCover = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.74, 0.16, 0.05), 0.032, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matSteel
  );
  earCover.position.set(0, 0.32, 0.17);
  root.add(earCover);
  registerLayer(earCover, [0, 0.42, 1.45]);

  const earDriver = new THREE.Group();
  earDriver.position.set(0, 0.32, 0.07);
  earDriver.add(new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.13, 0.052), matDark));
  const earCoil = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.08, 0.032), matCopper);
  earCoil.position.z = 0.036;
  earDriver.add(earCoil);
  const topAncMic = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.15, 0.052), matGold);
  topAncMic.position.set(1.06, 0.0, 0.02);
  earDriver.add(topAncMic);
  [-0.64, 0.64].forEach((px) => {
    const diode = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.056, 0.042, 16), matGlass);
    diode.rotation.x = Math.PI / 2;
    diode.position.set(px, -0.26, 0.05);
    earDriver.add(diode);
  });
  root.add(earDriver);
  registerLayer(earDriver, [0, 0.32, 0.62]);

  prepareAssembly(root, 'selfie');

  return {
    id: 'selfie',
    root,
    homePos: new THREE.Vector3(0, anchorY, anchorZ),
    macroOffset: new THREE.Vector3(0, 1.25, 3.05),
    hoverOffset: new THREE.Vector3(0, 0.18, 0.25),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}
