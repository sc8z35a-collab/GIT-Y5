import * as THREE from 'three';
import { DISPLAY_DIM, Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  createRoundedRectHole,
  createCircleHole,
  extrudePlate,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * RK T4 — LTPO OLED Display Assembly (6-Strata Internal Micro-Dissection):
 *   1. 2.5D Ceramic Shield Cover Glass + Ultra-Slim Black Perimeter Mask + Punch-Hole
 *   2. OCA Optical Bond & Capacitive Touch Digitizer Copper/ITO Diamond Micro-Mesh
 *   3. Circular Polarizer & Anti-Reflective Optical Film
 *   4. LTPO OLED Emissive Diamond-Pentile RGB Subpixel Matrix
 *   5. LTPO TFT Glass Backplane + Folded Gold-Kapton COF Display Driver IC (DDIC)
 *   6. Embossed Satin Copper EMI/Thermal Shielding Foil + Under-Display Ultrasonic 3D Fingerprint Sensor
 */
export function buildDisplaySystem(textures) {
  const root = new THREE.Group();
  root.name = 'display';

  const anchorZ = Z_STACK.DISPLAY_OLED;
  root.position.set(0, 0, anchorZ);

  const W = DISPLAY_DIM.W;
  const H = DISPLAY_DIM.H;
  const R = DISPLAY_DIM.R;
  const punchY = DISPLAY_DIM.PUNCH_Y;
  const punchR = DISPLAY_DIM.PUNCH_R;
  const fpY = DISPLAY_DIM.FP_Y;

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  // =========================================================================
  // 1. 2.5D CERAMIC SHIELD COVER GLASS + ULTRA-SLIM BEZEL MASK
  // =========================================================================
  const glassGroup = new THREE.Group();
  glassGroup.position.z = Z_STACK.DISPLAY_GLASS - anchorZ;

  const coverGlassShape = createRoundedRectShape(W, H, R);
  const matCoverGlass = new THREE.MeshPhysicalMaterial({
    color: 0x0e121a,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    ior: 1.56,
    reflectivity: 1.0,
    roughness: 0.02,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.015,
    envMapIntensity: 2.3,
    iridescence: 0.28,
    iridescenceIOR: 1.38,
  });
  const coverGlass = new THREE.Mesh(
    extrudePlate(coverGlassShape, 0.044, { bevelSize: 0.024, bevelThickness: 0.020, bevelSegments: 4 }),
    matCoverGlass
  );
  glassGroup.add(coverGlass);

  // Ultra-slim matte obsidian perimeter bezel border printed inside cover glass (strictly above rail Z=+0.376!)
  const bezelShape = createRoundedRectShape(W - 0.03, H - 0.03, R - 0.015);
  bezelShape.holes.push(createRoundedRectHole(W - 0.28, H - 0.28, R - 0.13));
  const matBezelMask = new THREE.MeshStandardMaterial({
    color: 0x07080b,
    metalness: 0.18,
    roughness: 0.22,
  });
  const bezelMask = new THREE.Mesh(
    extrudePlate(bezelShape, 0.006, { bevelSize: 0, bevelThickness: 0 }),
    matBezelMask
  );
  bezelMask.position.z = -0.024;
  glassGroup.add(bezelMask);

  // Clean subtle punch-hole camera mask ring at top-center
  const punchRingGeo = new THREE.RingGeometry(punchR * 0.82, punchR * 1.18, 36);
  const punchRing = new THREE.Mesh(punchRingGeo, matBezelMask);
  punchRing.position.set(0, punchY, -0.023);
  glassGroup.add(punchRing);

  root.add(glassGroup);
  registerLayer(glassGroup, [0, 0, 3.65]);

  // =========================================================================
  // 2. OCA OPTICAL BOND + CAPACITIVE TOUCH DIGITIZER COPPER/ITO MICRO-MESH
  //    Sized strictly inside CNC titanium rail inner aperture (6.72 x 14.96)
  // =========================================================================
  const touchGroup = new THREE.Group();
  touchGroup.position.z = Z_STACK.DISPLAY_TOUCH - anchorZ;

  const touchShape = createRoundedRectShape(W - 0.34, H - 0.34, R - 0.16);
  touchShape.holes.push(createCircleHole(punchR * 1.05, 0, punchY));

  const matTouchLayer = new THREE.MeshPhysicalMaterial({
    map: textures.touchMesh,
    color: 0xffffff,
    transparent: true,
    opacity: 0.03,
    depthWrite: false,
    roughness: 0.14,
    metalness: 0.58,
    clearcoat: 0.6,
    side: THREE.DoubleSide,
  });
  const touchMesh = new THREE.Mesh(
    extrudePlate(touchShape, 0.008, { bevelSize: 0, bevelThickness: 0 }),
    matTouchLayer
  );
  touchGroup.add(touchMesh);
  root.add(touchGroup);
  registerLayer(touchGroup, [0, 0, 2.65]);

  // =========================================================================
  // 3. CIRCULAR POLARIZER & ANTI-REFLECTIVE OPTICAL FILM
  // =========================================================================
  const polarGroup = new THREE.Group();
  polarGroup.position.z = Z_STACK.DISPLAY_POLAR - anchorZ;

  const polarShape = createRoundedRectShape(W - 0.36, H - 0.36, R - 0.17);
  polarShape.holes.push(createCircleHole(punchR * 1.05, 0, punchY));

  const matPolarizer = new THREE.MeshPhysicalMaterial({
    color: 0x0b0e15,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    roughness: 0.08,
    metalness: 0.24,
    clearcoat: 0.95,
    iridescence: 0.68,
    iridescenceIOR: 1.52,
    iridescenceThicknessMinimum: 190,
    iridescenceThicknessMaximum: 480,
  });
  const polarMesh = new THREE.Mesh(
    extrudePlate(polarShape, 0.008, { bevelSize: 0, bevelThickness: 0 }),
    matPolarizer
  );
  polarGroup.add(polarMesh);
  root.add(polarGroup);
  registerLayer(polarGroup, [0, 0, 1.72]);

  // =========================================================================
  // 4. LTPO OLED EMISSIVE DIAMOND-PENTILE RGB PIXEL MATRIX
  // =========================================================================
  const oledGroup = new THREE.Group();
  oledGroup.position.z = 0;

  const oledShape = createRoundedRectShape(W - 0.38, H - 0.38, R - 0.18);
  oledShape.holes.push(createCircleHole(punchR * 1.06, 0, punchY));

  const matOled = new THREE.MeshPhysicalMaterial({
    map: textures.oledMatrix,
    color: 0xffffff,
    metalness: 0.22,
    roughness: 0.10,
    clearcoat: 0.92,
    clearcoatRoughness: 0.06,
    iridescence: 0.26,
  });
  const oledMesh = new THREE.Mesh(
    extrudePlate(oledShape, 0.012, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matOled
  );
  oledGroup.add(oledMesh);
  root.add(oledGroup);
  registerLayer(oledGroup, [0, 0, 0.78]);

  // =========================================================================
  // 5. LTPO TFT GLASS BACKPLANE + COF (CHIP-ON-FILM) DISPLAY DRIVER IC (DDIC)
  // =========================================================================
  const tftGroup = new THREE.Group();
  tftGroup.position.z = Z_STACK.DISPLAY_TFT - anchorZ;

  const tftShape = createRoundedRectShape(W - 0.40, H - 0.40, R - 0.19);
  tftShape.holes.push(createCircleHole(punchR * 1.12, 0, punchY));

  const matTft = new THREE.MeshPhysicalMaterial({
    color: 0x222c38,
    metalness: 0.62,
    roughness: 0.22,
    clearcoat: 0.5,
    iridescence: 0.48,
  });
  const tftMesh = new THREE.Mesh(
    extrudePlate(tftShape, 0.012, { bevelSize: 0, bevelThickness: 0 }),
    matTft
  );
  tftGroup.add(tftMesh);

  // Delicate metallic gate/source busbars along left & right edges of TFT glass
  const matBusGold = new THREE.MeshStandardMaterial({ color: 0xcfa452, metalness: 0.94, roughness: 0.22 });
  const sideBusGeo = new THREE.BoxGeometry(0.07, H - 1.8, 0.014);
  const busL = new THREE.Mesh(sideBusGeo, matBusGold);
  busL.position.set(-(W - 0.56) / 2, 0, 0);
  const busR = new THREE.Mesh(sideBusGeo, matBusGold);
  busR.position.set(+(W - 0.56) / 2, 0, 0);
  tftGroup.add(busL, busR);

  // Folded COF (Chip-On-Film) Amber-Copper Display Driver Ribbon:
  // Novatek NT37705 LTPO DDIC + Goodix GT9916S 240Hz Touch IC + 40-Pin Hirose BM28 Gold BTB!
  const matCofAmber = new THREE.MeshStandardMaterial({ color: 0xb8732a, metalness: 0.65, roughness: 0.30 });
  const matIcDark = new THREE.MeshStandardMaterial({ color: 0x1a1e25, metalness: 0.38, roughness: 0.44 });
  const cofFilm = new THREE.Mesh(new THREE.BoxGeometry(3.60, 0.78, 0.010), matCofAmber);
  cofFilm.position.set(0, -H / 2 + 0.68, -0.010);
  tftGroup.add(cofFilm);

  const ddicChip = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 0.18, 0.018),
    new THREE.MeshPhysicalMaterial({
      color: 0x263242,
      metalness: 0.88,
      roughness: 0.12,
      iridescence: 0.65,
    })
  );
  ddicChip.position.set(-0.22, -H / 2 + 0.62, -0.018);
  tftGroup.add(ddicChip);

  const touchIc = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.020), matIcDark);
  touchIc.position.set(1.24, -H / 2 + 0.64, -0.019);
  tftGroup.add(touchIc);

  const dispBtb = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.18, 0.022), matBusGold);
  dispBtb.position.set(0.32, -H / 2 + 0.94, -0.020);
  tftGroup.add(dispBtb);

  root.add(tftGroup);
  registerLayer(tftGroup, [0, 0, -0.15]);

  // =========================================================================
  // 6. EMBOSSED SATIN COPPER EMI/THERMAL FOIL + ULTRASONIC FP + UNDER-OLED ALS/IR PROX
  // =========================================================================
  const shieldGroup = new THREE.Group();
  shieldGroup.position.z = Z_STACK.DISPLAY_SHIELD - anchorZ;

  const foilShape = createRoundedRectShape(W - 0.44, H - 0.46, R - 0.20);
  foilShape.holes.push(createCircleHole(punchR * 1.3, 0, punchY));
  foilShape.holes.push(createRoundedRectHole(0.44, 0.24, 0.05, 0.72, punchY + 0.04));
  foilShape.holes.push(createRoundedRectHole(1.16, 1.16, 0.10, 0, fpY));

  const matCopperFoil = new THREE.MeshStandardMaterial({
    color: 0xc97644,
    metalness: 0.90,
    roughness: 0.28,
  });
  const foilMesh = new THREE.Mesh(
    extrudePlate(foilShape, 0.014, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matCopperFoil
  );
  shieldGroup.add(foilMesh);
  root.add(shieldGroup);
  registerLayer(shieldGroup, [0, 0, -1.08]);

  // Under-OLED ams OSRAM TCS3701 Ambient Light / Call-Proximity + SFH 4059 940nm IR Emitter Module!
  const alsGroup = new THREE.Group();
  alsGroup.position.set(0.72, punchY + 0.04, Z_STACK.DISPLAY_SHIELD - anchorZ);
  alsGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.20, 0.016), matIcDark));
  const alsDie = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.12, 0.012),
    new THREE.MeshPhysicalMaterial({ color: 0x2c4b74, metalness: 0.85, roughness: 0.14, iridescence: 0.8 })
  );
  alsDie.position.set(-0.08, 0, 0.010);
  const irEmit = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.11, 0.012),
    new THREE.MeshPhysicalMaterial({ color: 0x56162c, metalness: 0.55, roughness: 0.12, iridescence: 0.7 })
  );
  irEmit.position.set(0.09, 0, 0.010);
  alsGroup.add(alsDie, irEmit);
  root.add(alsGroup);
  registerLayer(alsGroup, [0, 0.18, -1.62]);

  // Independent Under-Display Goodix GM2 Ultrasonic 3D Fingerprint Sensor Module
  const fpGroup = new THREE.Group();
  fpGroup.position.set(0, fpY, Z_STACK.DISPLAY_SHIELD - anchorZ);

  const fpHousing = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.06, 1.06, 0.08), 0.018, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matIcDark
  );
  fpGroup.add(fpHousing);

  const fpPiezo = new THREE.Mesh(
    new THREE.BoxGeometry(0.84, 0.84, 0.010),
    new THREE.MeshPhysicalMaterial({
      color: 0x3a526e,
      metalness: 0.82,
      roughness: 0.14,
      iridescence: 0.78,
    })
  );
  fpPiezo.position.z = 0.010;
  fpGroup.add(fpPiezo);

  for (let r = 0.12; r <= 0.36; r += 0.08) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.018, 32), matBusGold);
    ring.position.z = 0.016;
    fpGroup.add(ring);
  }

  const fpFlex = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.45, 0.008), matCofAmber);
  fpFlex.position.set(0, -1.12, -0.006);
  const fpBtb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.018), matBusGold);
  fpBtb.position.set(0, -1.80, -0.008);
  fpGroup.add(fpFlex, fpBtb);

  root.add(fpGroup);
  registerLayer(fpGroup, [0, 0, -1.85]);

  prepareAssembly(root, 'display');

  return {
    id: 'display',
    root,
    homePos: new THREE.Vector3(0, 0, anchorZ),
    macroOffset: new THREE.Vector3(0, 0, 5.45),
    hoverOffset: new THREE.Vector3(0, 0, 0.32),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
      // Dynamically reveal the copper ITO touch digitizer grid as the display opens!
      matTouchLayer.userData.baseOpacity = THREE.MathUtils.lerp(0.025, 0.86, Math.min(1, micro * 2.2));
    },
  };
}
