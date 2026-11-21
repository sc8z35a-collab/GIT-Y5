import * as THREE from 'three';
import { CAMERA_BAY, Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  createCircleHole,
  extrudePlate,
  createOpticalLensGeometry,
  createLensRingGeometry,
  createBondWiresGroup,
  createFlexRibbon,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * RK T4 — Commercial Flagship 45MP Camera Bay Deep Optical & Silicon Dissection
 * Real Commercial Components Modeled 1:1:
 *   - Main 45MP: Sony LYT-818 (1/1.28" Stacked BSI) + 1G+6P 7-Element Hybrid Optics
 *       + 7-Blade Continuously Variable Mechanical Aperture (brass cam ring, pins, SMA coil)
 *       + 3-Strata Closed-Loop 4-Wire Ball-Guide OIS/CLAF VCM (Permalloy EMI yoke,
 *         photo-etched BeCu spider leaf springs, 4 guide balls, 4 wires, 4 copper coils,
 *         4 NdFeB magnets, 3x AKM/Alps Hall sensors on OIS FPC)
 *       + AGC Blue-Glass Spin-Coated IR-Cut Filter + 48 3D Gold Bond Wires + 24 Perimeter MLCCs
 *       + Multi-Chip Rigid-Flex PCB (Rockchip RK1608B Visual Pre-ISP + 10x10 BGA Array,
 *         LPDDR Frame Buffer, Halo/Dongwoon DW9786 32-bit OIS MCU, Giantec GT24C64A EEPROM,
 *         Hirose BM28 40-Pin Gold BTB).
 *   - Ultra-Wide 16MP: Sony IMX355 + 5P Aspherical Optical Stack + Hollow Dissectible Mini-VCM
 *       (2 Copper AF Coils + 2 NdFeB Magnets + Dongwoon DW9714A) + Mini IR Filter + 24 Bond Wires + 30P BTB.
 *   - Dual-CRI Flash: Stepped Concentric Micro-Fresnel Diffuser + ams OSRAM KW CELNM2 (5700K)
 *       & KY CELNM2 (2700K) Phosphor Dies on AlN Ceramic MCPCB.
 *   - dToF & Flicker: ST VL53L8CX 8x8 Multizone 940nm dToF (IR Window + Dual-Aperture Optical Baffle +
 *       VCSEL Emitter + 8x8 SPAD Receiver Array) + ams OSRAM TCS3408 RGB/Flicker Photodiode.
 *   - Rear Audio-Zoom Mic: Knowles SPH0655LM4H-1 (PTFE Gore-Tex Acoustic Mesh + Gold EMI Shield Can +
 *       MEMS Silicon Diaphragm Die + ASIC Die with Micro Bond Wires).
 */
export function buildCameraSystem(textures) {
  const root = new THREE.Group();
  root.name = 'camera';

  // Local coordinate anchor = center of the camera bay
  const anchorX = CAMERA_BAY.CENTER_X;
  const anchorY = CAMERA_BAY.CENTER_Y;
  const anchorZ = Z_STACK.INTERNAL_MID;
  root.position.set(anchorX, anchorY, anchorZ);

  const mainLocalX = CAMERA_BAY.MAIN_X - anchorX;
  const mainLocalY = CAMERA_BAY.MAIN_Y - anchorY;
  const auxLocalX = CAMERA_BAY.AUX_X - anchorX;
  const auxLocalY = CAMERA_BAY.AUX_Y - anchorY;
  const flashLocalX = CAMERA_BAY.FLASH_X - anchorX;
  const flashLocalY = CAMERA_BAY.FLASH_Y - anchorY;
  const tofLocalX = CAMERA_BAY.TOF_X - anchorX;
  const tofLocalY = CAMERA_BAY.TOF_Y - anchorY;
  const micLocalX = CAMERA_BAY.MIC_X - anchorX;
  const micLocalY = CAMERA_BAY.MIC_Y - anchorY;

  // --- Shared physically accurate optical & micro-mechanical materials ---
  const matTitaniumPlateau = new THREE.MeshStandardMaterial({
    color: 0xbcb8b0,
    map: textures.titanium.map,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.90,
    roughness: 0.28,
  });

  const matPermalloy = new THREE.MeshStandardMaterial({
    color: 0x3b404b,
    map: textures.titanium.map,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.92,
    roughness: 0.26,
  });

  const matDarkAnodized = new THREE.MeshStandardMaterial({
    color: 0x191b20,
    metalness: 0.72,
    roughness: 0.34,
  });

  const matMatteBaffle = new THREE.MeshStandardMaterial({
    color: 0x101216,
    metalness: 0.22,
    roughness: 0.84,
  });

  const matBezelFace = new THREE.MeshStandardMaterial({
    map: textures.cameraBezel,
    metalness: 0.75,
    roughness: 0.28,
  });

  const matBrassSpacer = new THREE.MeshStandardMaterial({
    color: 0xc9a86a,
    metalness: 0.94,
    roughness: 0.22,
  });

  const matBeCuSpring = new THREE.MeshStandardMaterial({
    color: 0xd99b52,
    metalness: 0.96,
    roughness: 0.19,
  });

  const matCopperSpread = new THREE.MeshStandardMaterial({
    color: 0xcf7742,
    metalness: 0.93,
    roughness: 0.24,
  });

  const matSapphire = new THREE.MeshPhysicalMaterial({
    color: 0x050912,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    ior: 1.77,
    reflectivity: 1.0,
    roughness: 0.015,
    metalness: 0.12,
    clearcoat: 1.0,
    clearcoatRoughness: 0.015,
    envMapIntensity: 1.75,
    iridescence: 0.94,
    iridescenceIOR: 1.46,
    iridescenceThicknessMinimum: 190,
    iridescenceThicknessMaximum: 520,
  });

  const makeLensGlassMat = (tint, iridStrength, iridRange, isMoldedGlass = false) =>
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(tint).multiplyScalar(isMoldedGlass ? 0.18 : 0.14),
      transparent: true,
      opacity: isMoldedGlass ? 0.24 : 0.20,
      depthWrite: false,
      ior: isMoldedGlass ? 1.74 : 1.65,
      reflectivity: 1.0,
      roughness: isMoldedGlass ? 0.014 : 0.022,
      metalness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.015,
      envMapIntensity: isMoldedGlass ? 1.72 : 1.52,
      iridescence: Math.min(1.0, iridStrength + 0.26),
      iridescenceIOR: isMoldedGlass ? 1.54 : 1.48,
      iridescenceThicknessMinimum: iridRange[0],
      iridescenceThicknessMaximum: iridRange[1],
    });

  const matCopperCoil = new THREE.MeshStandardMaterial({
    color: 0xd0783e,
    map: textures.woundWire,
    metalness: 0.92,
    roughness: 0.28,
  });

  const matNeodymium = new THREE.MeshStandardMaterial({
    color: 0xd8dce3,
    metalness: 0.96,
    roughness: 0.16,
  });

  const matCeramicBall = new THREE.MeshStandardMaterial({
    color: 0xeaf0f7,
    metalness: 0.86,
    roughness: 0.08,
  });

  const matGold = new THREE.MeshStandardMaterial({
    color: 0xdcb45c,
    metalness: 0.96,
    roughness: 0.18,
  });

  const matOisFpc = new THREE.MeshStandardMaterial({
    color: 0xc2832b,
    metalness: 0.62,
    roughness: 0.30,
  });

  // AGC Blue-Glass Spin-Coated 650nm Dichroic IR-Cut Filter
  const matIrFilter = new THREE.MeshPhysicalMaterial({
    color: 0x3da8d8,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    ior: 1.58,
    reflectivity: 1.0,
    roughness: 0.025,
    metalness: 0.22,
    clearcoat: 1.0,
    envMapIntensity: 1.95,
    iridescence: 1.0,
    iridescenceIOR: 1.72,
    iridescenceThicknessMinimum: 260,
    iridescenceThicknessMaximum: 590,
  });

  const matCeramicPkg = new THREE.MeshStandardMaterial({
    color: 0x1c1e24,
    metalness: 0.28,
    roughness: 0.55,
  });

  const matAlnCeramic = new THREE.MeshStandardMaterial({
    color: 0xe6e7ea,
    metalness: 0.12,
    roughness: 0.38,
  });

  const matCmosDie = new THREE.MeshPhysicalMaterial({
    map: textures.cmosSensor,
    metalness: 0.72,
    roughness: 0.14,
    clearcoat: 0.85,
    clearcoatRoughness: 0.08,
    iridescence: 0.88,
    iridescenceIOR: 1.7,
    iridescenceThicknessMinimum: 220,
    iridescenceThicknessMaximum: 620,
  });

  const matIspDie = new THREE.MeshPhysicalMaterial({
    map: textures.ispDie,
    metalness: 0.78,
    roughness: 0.18,
    clearcoat: 0.6,
    iridescence: 0.48,
  });

  const matWlcspDie = new THREE.MeshPhysicalMaterial({
    color: 0x2a3444,
    metalness: 0.88,
    roughness: 0.12,
    clearcoat: 0.9,
    iridescence: 0.72,
  });

  const matMiniPcb = new THREE.MeshStandardMaterial({
    map: textures.pcb,
    metalness: 0.35,
    roughness: 0.48,
  });

  const matFlexKapton = new THREE.MeshStandardMaterial({
    color: 0x221b14,
    metalness: 0.42,
    roughness: 0.36,
  });

  const matSolderBall = new THREE.MeshStandardMaterial({
    color: 0xd6d9df,
    metalness: 0.95,
    roughness: 0.16,
  });

  const matMlccCap = new THREE.MeshStandardMaterial({
    color: 0x997046,
    metalness: 0.30,
    roughness: 0.42,
  });

  const matPtfeMesh = new THREE.MeshStandardMaterial({
    color: 0xdfe3ea,
    metalness: 0.08,
    roughness: 0.78,
  });

  // Track animated micro-layers: { obj, base, offset } and assign explicit rigid sub-assembly layerKey
  const layers = [];
  const registerLayer = (obj, explodeOffset, key) => {
    obj.userData.layerKey = key || `stratum_${layers.length}`;
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  // =========================================================================
  // 1. CNC TITANIUM CAMERA PLATEAU (local Z: [-0.552..-0.358], world [-0.607..-0.413], flush in rear glass!)
  // =========================================================================
  const plateauGroup = new THREE.Group();
  const plateauShape = createRoundedRectShape(CAMERA_BAY.W - 0.09, CAMERA_BAY.H - 0.09, CAMERA_BAY.R - 0.04);
  plateauShape.holes.push(createCircleHole(0.885, mainLocalX, mainLocalY));
  plateauShape.holes.push(createCircleHole(0.525, auxLocalX, auxLocalY));
  plateauShape.holes.push(createCircleHole(0.275, flashLocalX, flashLocalY));
  plateauShape.holes.push(createCircleHole(0.235, tofLocalX, tofLocalY));

  const plateauMesh = new THREE.Mesh(
    extrudePlate(plateauShape, 0.110, { bevelSize: 0.042, bevelThickness: 0.042, bevelSegments: 5 }),
    matTitaniumPlateau
  );
  plateauGroup.position.set(0, 0, -0.455);
  plateauGroup.add(plateauMesh);

  // Hollow precision dark bezel liner matching optical bores cleanly
  const backLinerShape = createRoundedRectShape(CAMERA_BAY.W - 0.18, CAMERA_BAY.H - 0.18, CAMERA_BAY.R - 0.08);
  backLinerShape.holes.push(createCircleHole(0.885, mainLocalX, mainLocalY));
  backLinerShape.holes.push(createCircleHole(0.525, auxLocalX, auxLocalY));
  backLinerShape.holes.push(createCircleHole(0.275, flashLocalX, flashLocalY));
  backLinerShape.holes.push(createCircleHole(0.235, tofLocalX, tofLocalY));
  const plateauBackPlate = new THREE.Mesh(
    extrudePlate(backLinerShape, 0.020, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matDarkAnodized
  );
  plateauBackPlate.position.z = 0.082;
  plateauGroup.add(plateauBackPlate);

  // Tiny rear microphone chamfered acoustic pinhole on titanium plateau
  const micRing = new THREE.Mesh(
    createLensRingGeometry(0.036, 0.078, 0.032, 0.006, 24),
    matDarkAnodized
  );
  micRing.position.set(micLocalX, micLocalY, -0.092);
  plateauGroup.add(micRing);

  root.add(plateauGroup);
  registerLayer(plateauGroup, [0, 0, -3.70], 'plateau');

  // =========================================================================
  // 2. 45MP MASTER OPTICAL STACK (SONY LYT-818 + 1G+6P + VARIABLE APERTURE + OIS/VCM + RK1608B)
  // =========================================================================
  const mainAxis = new THREE.Group();
  mainAxis.name = 'mainAxis';
  mainAxis.position.set(mainLocalX, mainLocalY, 0);
  root.add(mainAxis);

  // 2A. Stepped Titanium + Laser-Engraved 45MP Lens Bezel Ring (local Z: [-0.738..-0.566], proud of plateau -0.552!)
  const bezelGroup = new THREE.Group();
  bezelGroup.position.set(0, 0, -0.652);
  const outerBezel = new THREE.Mesh(
    createLensRingGeometry(0.810, 1.055, 0.172, 0.022, 64),
    matTitaniumPlateau
  );
  bezelGroup.add(outerBezel);
  const innerDarkBezel = new THREE.Mesh(
    createLensRingGeometry(0.785, 0.815, 0.146, 0.012, 64),
    matDarkAnodized
  );
  bezelGroup.add(innerDarkBezel);

  // Flat engraved specification ring facing -Z (rear)
  const engravedRingGeo = new THREE.RingGeometry(0.79, 1.01, 64);
  engravedRingGeo.rotateY(Math.PI); // face -Z
  const engravedRing = new THREE.Mesh(engravedRingGeo, matBezelFace);
  engravedRing.position.z = -0.087;
  bezelGroup.add(engravedRing);

  mainAxis.add(bezelGroup);
  registerLayer(bezelGroup, [0, 0, -4.95], 'main_bezel');

  // 2B. Multi-Coated Sapphire Crystal Protective Cover Lens + IP68 O-Ring (local Z: [-0.762..-0.712], r<=0.778 inside bezel bore!)
  const sapphireGroup = new THREE.Group();
  sapphireGroup.position.set(0, 0, -0.730);
  const sapphireMesh = new THREE.Mesh(
    createOpticalLensGeometry({
      radius: 0.755,
      edgeThickness: 0.036,
      frontSag: 0.014,
      backSag: -0.008,
    }),
    matSapphire
  );
  sapphireGroup.add(sapphireMesh);
  const sapphireSeal = new THREE.Mesh(
    createLensRingGeometry(0.755, 0.778, 0.034, 0.005, 48),
    matMatteBaffle
  );
  sapphireGroup.add(sapphireSeal);
  mainAxis.add(sapphireGroup);
  registerLayer(sapphireGroup, [0, 0, -5.55], 'main_sapphire');

  // 2C. Continuously Variable 7-Blade Mechanical Aperture (local Z: [-0.700..-0.660], strictly clear of sapphire & E1!)
  const irisGroup = new THREE.Group();
  irisGroup.position.set(0, 0, -0.680);

  const irisHousing = new THREE.Mesh(
    createLensRingGeometry(0.700, 0.778, 0.036, 0.004, 56),
    matDarkAnodized
  );
  irisGroup.add(irisHousing);

  const irisCamRing = new THREE.Mesh(
    createLensRingGeometry(0.670, 0.740, 0.014, 0.002, 56),
    matBrassSpacer
  );
  irisCamRing.position.z = -0.012;
  irisGroup.add(irisCamRing);

  const irisActuator = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.07, 0.030), matCopperCoil);
  irisActuator.position.set(0.66, 0.20, 0.0);
  irisActuator.rotation.z = 0.30;
  irisGroup.add(irisActuator);

  const bladeCount = 7;
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.68 * Math.cos(-0.14), 0.68 * Math.sin(-0.14));
  bladeShape.absarc(0, 0, 0.68, -0.14, 1.08, false);
  bladeShape.quadraticCurveTo(0.40, 0.28, 0.36, -0.06);
  bladeShape.quadraticCurveTo(0.50, -0.14, 0.68 * Math.cos(-0.14), 0.68 * Math.sin(-0.14));
  bladeShape.closePath();
  const bladeGeo = extrudePlate(bladeShape, 0.006, { bevelSize: 0.001, bevelThickness: 0.001, bevelSegments: 2 });
  const matIrisBlade = new THREE.MeshStandardMaterial({
    color: 0x14171e,
    metalness: 0.80,
    roughness: 0.28,
  });
  const dowelGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.022, 10);
  dowelGeo.rotateX(Math.PI / 2);

  const irisBlades = [];
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2;
    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(angle) * 0.63, Math.sin(angle) * 0.63, i * 0.0020 - 0.0060);
    pivot.rotation.z = angle + 0.16;

    const blade = new THREE.Mesh(bladeGeo, matIrisBlade);
    blade.position.set(-0.63, 0, 0);
    pivot.add(blade);

    const dowel = new THREE.Mesh(dowelGeo, matBrassSpacer);
    dowel.position.set(0, 0, -0.008);
    pivot.add(dowel);

    irisGroup.add(pivot);
    irisBlades.push({ pivot, baseRot: angle });
  }
  mainAxis.add(irisGroup);
  registerLayer(irisGroup, [0, 0, -4.25], 'main_iris');

  // 2D. True 1G+6P (7-Element!) Real Commercial Hybrid Glass + Polymer Optical Stack
  //     Strictly non-overlapping in Z AND radially <= 0.764 inside helical barrel bore (0.778)!
  const lensPrescription = [
    {
      // E1 (1G): Molded Aspherical Crown Glass Front Collector [-0.650..-0.563]
      z: -0.588, explodeZ: -3.55, radius: 0.68, edgeT: 0.044, frontSag: 0.038, backSag: -0.020,
      asphereFront: 0.010, tint: 0xdaf3ff, irid: 0.72, range: [160, 440], ringOuter: 0.752,
      isGlass: true, brass: false, baffle: true,
    },
    {
      // E2 (P1): High-Index Negative Dispersion Biconcave Flint [-0.556..-0.498]
      z: -0.526, explodeZ: -3.00, radius: 0.62, edgeT: 0.052, frontSag: -0.024, backSag: -0.020,
      asphereFront: 0.0, tint: 0xf4e4ff, irid: 0.76, range: [280, 520], ringOuter: 0.730,
      isGlass: false, brass: true, baffle: false,
    },
    {
      // E3 (P2): Positive Aspherical Meniscus Focusing Element [-0.494..-0.419]
      z: -0.440, explodeZ: -2.46, radius: 0.60, edgeT: 0.036, frontSag: 0.034, backSag: -0.026,
      asphereFront: 0.008, tint: 0xe0fff4, irid: 0.68, range: [200, 460], ringOuter: 0.715,
      isGlass: false, brass: false, baffle: true,
    },
    {
      // E4 (P3): Double-Convex High-Refraction Power Element [-0.413..-0.336]
      z: -0.372, explodeZ: -1.94, radius: 0.58, edgeT: 0.036, frontSag: 0.022, backSag: 0.018,
      asphereFront: 0.006, tint: 0xe4efff, irid: 0.62, range: [180, 410], ringOuter: 0.695,
      isGlass: false, brass: true, baffle: false,
    },
    {
      // E5 (P4): Aspherical Gull-Wing Coma & Astigmatism Corrector [-0.325..-0.262]
      z: -0.304, explodeZ: -1.44, radius: 0.56, edgeT: 0.032, frontSag: -0.016, backSag: 0.026,
      asphereFront: 0.020, tint: 0xffeef8, irid: 0.74, range: [250, 540], ringOuter: 0.680,
      isGlass: false, brass: false, baffle: true,
    },
    {
      // E6 (P5): Negative Chromatic Aberration & Distortion Corrector [-0.248..-0.196]
      z: -0.228, explodeZ: -0.96, radius: 0.57, edgeT: 0.032, frontSag: -0.018, backSag: 0.016,
      asphereFront: 0.016, tint: 0xf0e8ff, irid: 0.66, range: [220, 490], ringOuter: 0.680,
      isGlass: false, brass: true, baffle: false,
    },
    {
      // E7 (P6): Large Rear Field-Flattener matching 1/1.28" Sony LYT-818 [-0.191..-0.129]
      z: -0.148, explodeZ: -0.48, radius: 0.61, edgeT: 0.032, frontSag: 0.024, backSag: -0.016,
      asphereFront: 0.012, tint: 0xe6f8ff, irid: 0.60, range: [170, 440], ringOuter: 0.700,
      isGlass: false, brass: false, baffle: true,
    },
  ];

  lensPrescription.forEach((el, idx) => {
    const elGroup = new THREE.Group();
    elGroup.position.set(0, 0, el.z);

    const glassGeo = createOpticalLensGeometry({
      radius: el.radius,
      edgeThickness: el.edgeT,
      frontSag: el.frontSag,
      backSag: el.backSag,
      asphereFront: el.asphereFront,
    });
    const glassMesh = new THREE.Mesh(
      glassGeo,
      makeLensGlassMat(el.tint, el.irid, el.range, el.isGlass)
    );
    elGroup.add(glassMesh);

    const retainer = new THREE.Mesh(
      createLensRingGeometry(el.radius - 0.012, el.ringOuter, el.edgeT + 0.006, 0.006, 56),
      el.isGlass ? matDarkAnodized : matMatteBaffle
    );
    elGroup.add(retainer);

    if (el.isGlass) {
      const gRim = new THREE.Mesh(
        createLensRingGeometry(el.radius + 0.01, el.ringOuter + 0.010, 0.014, 0.003, 56),
        matTitaniumPlateau
      );
      gRim.position.z = -el.edgeT * 0.50;
      elGroup.add(gRim);
    }

    if (el.brass) {
      const shim = new THREE.Mesh(
        createLensRingGeometry(el.radius + 0.005, el.ringOuter - 0.008, 0.010, 0.002, 56),
        matBrassSpacer
      );
      shim.position.z = -el.edgeT * 0.48;
      elGroup.add(shim);
    }

    if (el.baffle && !el.isGlass) {
      const baffle = new THREE.Mesh(
        createLensRingGeometry(el.radius - 0.055, el.radius + 0.025, 0.008, 0.001, 56),
        matMatteBaffle
      );
      baffle.position.z = -el.edgeT * 0.48;
      elGroup.add(baffle);
    }

    mainAxis.add(elGroup);
    registerLayer(elGroup, [0, 0, el.explodeZ], `main_lens_E${idx + 1}`);
  });

  // 2E. Precision Anodized Helical Lens Barrel Sleeve (innerR=0.778, outerR=0.832, Z: [-0.560..-0.144])
  //     Strictly behind bezel (-0.566), outside E1..E7 retainers (<=0.762), and inside plateau (0.885), spider (0.842) & OIS (0.855)!
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0, 0, -0.352);
  const outerSleeve = new THREE.Mesh(
    createLensRingGeometry(0.778, 0.832, 0.416, 0.010, 64),
    matDarkAnodized
  );
  barrelGroup.add(outerSleeve);
  for (let g = 0; g < 4; g++) {
    const groove = new THREE.Mesh(
      createLensRingGeometry(0.768, 0.780, 0.014, 0.002, 48),
      matMatteBaffle
    );
    groove.position.z = -0.14 + g * 0.095;
    barrelGroup.add(groove);
  }
  // 3 Brass Focus Guide Cam Pins seated cleanly between plateau back (-0.358) and spider spring (-0.316)
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.036, 12), matBrassSpacer);
    pin.rotation.z = a - Math.PI / 2;
    pin.position.set(Math.cos(a) * 0.844, Math.sin(a) * 0.844, 0.016);
    barrelGroup.add(pin);
  }
  mainAxis.add(barrelGroup);
  registerLayer(barrelGroup, [0, 0, -2.18], 'main_barrel');

  // 2F. CLOSED-LOOP 4-WIRE BALL-GUIDE OIS + CLAF VCM GIMBAL (3 SEPARATING MECHANICAL STRATA!)
  //     Stratum 1: Photo-Etched Beryllium-Copper Upper Spider Leaf-Spring Flexure (local Z: [-0.316..-0.300])
  const spiderSpringGroup = new THREE.Group();
  spiderSpringGroup.position.set(0, 0, -0.308);
  const springOuterShape = createRoundedRectShape(2.04, 2.04, 0.18);
  springOuterShape.holes.push(createCircleHole(0.90, 0, 0));
  const springOuter = new THREE.Mesh(
    extrudePlate(springOuterShape, 0.012, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matBeCuSpring
  );
  spiderSpringGroup.add(springOuter);
  const springInner = new THREE.Mesh(
    createLensRingGeometry(0.842, 0.878, 0.012, 0.002, 48),
    matBeCuSpring
  );
  spiderSpringGroup.add(springInner);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * 0.872, Math.sin(a) * 0.872, 0),
      new THREE.Vector3(Math.cos(a + 0.16) * 0.96, Math.sin(a + 0.16) * 0.96, 0),
      new THREE.Vector3(Math.cos(a - 0.10) * 1.04, Math.sin(a - 0.10) * 1.04, 0),
      new THREE.Vector3(Math.cos(a) * 1.14, Math.sin(a) * 1.14, 0),
    ]);
    const arm = new THREE.Mesh(
      new THREE.TubeGeometry(armCurve, 14, 0.006, 6, false),
      matBeCuSpring
    );
    spiderSpringGroup.add(arm);
  }
  mainAxis.add(spiderSpringGroup);
  registerLayer(spiderSpringGroup, [0, 0, -0.32], 'main_spider');

  //     Stratum 2: Stamped Permalloy EMI Magnetic Shield Can (strictly surrounds OIS core without touching!)
  const yokeShieldGroup = new THREE.Group();
  yokeShieldGroup.position.set(0, 0, -0.200);
  const yokeTopShape = createRoundedRectShape(2.18, 2.18, 0.22);
  yokeTopShape.holes.push(createCircleHole(0.86, 0, 0));
  const yokeCan = new THREE.Mesh(
    extrudePlate(yokeTopShape, 0.018, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matPermalloy
  );
  yokeCan.position.z = -0.086;
  yokeShieldGroup.add(yokeCan);
  const wallSkirtGeo = new THREE.BoxGeometry(2.10, 0.032, 0.185);
  [
    [0, 1.072, 0],
    [0, -1.072, 0],
    [1.072, 0, Math.PI / 2],
    [-1.072, 0, Math.PI / 2],
  ].forEach(([wx, wy, rz]) => {
    const skirt = new THREE.Mesh(wallSkirtGeo, matPermalloy);
    skirt.position.set(wx, wy, 0.008);
    skirt.rotation.z = rz;
    yokeShieldGroup.add(skirt);
  });
  mainAxis.add(yokeShieldGroup);
  registerLayer(yokeShieldGroup, [0, 0, -0.68], 'main_yoke');

  //     Stratum 3: 4-Wire Ball-Guide OIS/VCM Magnetic Actuator Core + Golden OIS FPC + 3x Hall Sensors (local Z: [-0.256..-0.068])
  const oisGroup = new THREE.Group();
  oisGroup.position.set(0, 0, -0.178);

  const carrierShape = createRoundedRectShape(1.94, 1.94, 0.18);
  carrierShape.holes.push(createCircleHole(0.855, 0, 0));
  const carrierFrame = new THREE.Mesh(
    extrudePlate(carrierShape, 0.132, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matDarkAnodized
  );
  oisGroup.add(carrierFrame);

  const coilGeo = new THREE.BoxGeometry(0.72, 0.105, 0.14);
  const magGeo = new THREE.BoxGeometry(0.68, 0.075, 0.14);
  const cardinalOffsets = [
    { x: 0, y: 0.905, rotZ: 0, magY: 1.005 },
    { x: 0, y: -0.905, rotZ: 0, magY: -1.005 },
    { x: 0.905, y: 0, rotZ: Math.PI / 2, magX: 1.005 },
    { x: -0.905, y: 0, rotZ: Math.PI / 2, magX: -1.005 },
  ];
  cardinalOffsets.forEach((c) => {
    const coil = new THREE.Mesh(coilGeo, matCopperCoil);
    coil.position.set(c.x, c.y, 0.0);
    coil.rotation.z = c.rotZ;
    oisGroup.add(coil);

    const mag = new THREE.Mesh(magGeo, matNeodymium);
    mag.position.set(c.magX ?? c.x, c.magY ?? c.y, 0.0);
    mag.rotation.z = c.rotZ;
    oisGroup.add(mag);
  });

  const cornerSigns = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const wireGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.14, 8);
  wireGeo.rotateX(Math.PI / 2);
  const guideBallGeo = new THREE.SphereGeometry(0.036, 14, 14);
  cornerSigns.forEach(([sx, sy]) => {
    const suspWire = new THREE.Mesh(wireGeo, matGold);
    suspWire.position.set(sx * 0.90, sy * 0.90, 0.0);
    oisGroup.add(suspWire);

    const ball = new THREE.Mesh(guideBallGeo, matCeramicBall);
    ball.position.set(sx * 0.72, sy * 0.72, 0.025);
    oisGroup.add(ball);
  });

  const fpcRingShape = createRoundedRectShape(1.94, 1.94, 0.16);
  fpcRingShape.holes.push(createCircleHole(0.855, 0, 0));
  const oisFpcRing = new THREE.Mesh(
    extrudePlate(fpcRingShape, 0.012, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matOisFpc
  );
  oisFpcRing.position.z = 0.080;
  oisGroup.add(oisFpcRing);

  const hallGeo = new THREE.BoxGeometry(0.12, 0.12, 0.028);
  [
    [0.0, 0.905],
    [0.905, 0.0],
    [-0.905, 0.0],
  ].forEach(([hx, hy]) => {
    const hall = new THREE.Mesh(hallGeo, matCeramicPkg);
    hall.position.set(hx, hy, 0.096);
    oisGroup.add(hall);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.008), matGold);
    pad.position.set(hx, hy, 0.086);
    oisGroup.add(pad);
  });

  mainAxis.add(oisGroup);
  registerLayer(oisGroup, [0, 0, 0.06], 'main_ois');

  // 2G. AGC Blue-Glass Spin-Coated 650nm IR-Cut Filter in Matte Micro-Frame (local Z: [-0.058..-0.018])
  const irGroup = new THREE.Group();
  irGroup.position.set(0, 0, -0.038);
  const irFrameShape = createRoundedRectShape(1.32, 1.10, 0.08);
  const irHole = new THREE.Path();
  irHole.moveTo(-0.55, -0.44);
  irHole.lineTo(-0.55, 0.44);
  irHole.lineTo(0.55, 0.44);
  irHole.lineTo(0.55, -0.44);
  irHole.closePath();
  irFrameShape.holes.push(irHole);
  const irFrame = new THREE.Mesh(
    extrudePlate(irFrameShape, 0.032, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matMatteBaffle
  );
  irGroup.add(irFrame);
  const irGlass = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.88, 0.020), matIrFilter);
  irGroup.add(irGlass);

  mainAxis.add(irGroup);
  registerLayer(irGroup, [0, 0, 0.72], 'main_ir');

  // 2H. SONY LYT-818 1/1.28" 45MP STACKED BSI CMOS SENSOR (local Z: [-0.012..+0.111])
  const sensorGroup = new THREE.Group();
  sensorGroup.position.set(0, 0, 0.054);

  const pkgBase = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.56, 1.36, 0.08), 0.064, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matCeramicPkg
  );
  sensorGroup.add(pkgBase);

  const cuSpreader = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.42, 1.22, 0.06), 0.014, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matCopperSpread
  );
  cuSpreader.position.z = 0.048;
  sensorGroup.add(cuSpreader);

  const goldRingShape = createRoundedRectShape(1.44, 1.24, 0.05);
  const holeP = new THREE.Path();
  holeP.moveTo(-0.63, -0.53);
  holeP.lineTo(-0.63, 0.53);
  holeP.lineTo(0.63, 0.53);
  holeP.lineTo(0.63, -0.53);
  holeP.closePath();
  goldRingShape.holes.push(holeP);
  const goldRing = new THREE.Mesh(
    extrudePlate(goldRingShape, 0.012, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matGold
  );
  goldRing.position.z = -0.038;
  sensorGroup.add(goldRing);

  const dieGeo = new THREE.BoxGeometry(1.04, 0.84, 0.024);
  const dieMesh = new THREE.Mesh(dieGeo, matCmosDie);
  dieMesh.position.z = -0.038;
  sensorGroup.add(dieMesh);

  const bondWires = createBondWiresGroup({
    dieW: 1.02,
    dieH: 0.82,
    pkgW: 1.36,
    pkgH: 1.16,
    wiresPerLongSide: 14,
    wiresPerShortSide: 10,
    arcHeight: 0.042,
    wireRadius: 0.005,
    material: matGold,
  });
  bondWires.position.z = -0.042;
  sensorGroup.add(bondWires);

  const capGeo = new THREE.BoxGeometry(0.072, 0.038, 0.026);
  const capInst = new THREE.InstancedMesh(capGeo, matMlccCap, 24);
  const dummy = new THREE.Object3D();
  let cIdx = 0;
  for (let i = 0; i < 7; i++) {
    const x = -0.54 + i * 0.18;
    dummy.position.set(x, -0.61, -0.044);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);

    dummy.position.set(x, 0.61, -0.044);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);
  }
  for (let i = 0; i < 5; i++) {
    const y = -0.40 + i * 0.20;
    dummy.position.set(-0.71, y, -0.044);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);

    dummy.position.set(0.71, y, -0.044);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);
  }
  capInst.instanceMatrix.needsUpdate = true;
  sensorGroup.add(capInst);

  mainAxis.add(sensorGroup);
  registerLayer(sensorGroup, [0, 0, 1.52], 'main_sensor');

  // 2I. MULTI-CHIP CAMERA RIGID-FLEX PCB (local Z: [+0.116..+0.206]) + RK1608B Pre-ISP (local Z: [+0.175..+0.246])
  const ispGroup = new THREE.Group();
  ispGroup.position.set(0, 0, 0.144);

  const subPcb = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.96, 1.76, 0.12), 0.046, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matMiniPcb
  );
  ispGroup.add(subPcb);

  // Rockchip RK1608B Visual Pre-ISP Package (strictly seated behind subPcb +0.172, zero overlap!)
  const ispChipSub = new THREE.Group();
  ispChipSub.position.set(0, 0, 0.066);
  const ispSubstrate = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.96, 0.96, 0.05), 0.028, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matCeramicPkg
  );
  ispChipSub.add(ispSubstrate);

  const ispSiliconDie = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.84, 0.020), matIspDie);
  ispSiliconDie.position.z = 0.026;
  ispChipSub.add(ispSiliconDie);

  const ballGeo = new THREE.SphereGeometry(0.015, 8, 8);
  const bgaCount = 10;
  const bgaInst = new THREE.InstancedMesh(ballGeo, matSolderBall, bgaCount * bgaCount);
  let bIdx = 0;
  for (let gx = 0; gx < bgaCount; gx++) {
    for (let gy = 0; gy < bgaCount; gy++) {
      dummy.position.set(
        (gx / (bgaCount - 1) - 0.5) * 0.82,
        (gy / (bgaCount - 1) - 0.5) * 0.82,
        -0.020
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bgaInst.setMatrixAt(bIdx++, dummy.matrix);
    }
  }
  bgaInst.instanceMatrix.needsUpdate = true;
  ispChipSub.add(bgaInst);

  const dramBuf = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.58, 0.032), matCeramicPkg);
  dramBuf.position.set(-0.72, 0.12, 0.044);
  ispGroup.add(dramBuf);

  const dw9786 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.032), matWlcspDie);
  dw9786.position.set(0.68, 0.42, 0.044);
  ispGroup.add(dw9786);

  const eepromIc = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.20, 0.030), matCeramicPkg);
  eepromIc.position.set(0.68, -0.40, 0.043);
  ispGroup.add(eepromIc);

  for (let i = 0; i < 6; i++) {
    const tiny = new THREE.Mesh(capGeo, matMlccCap);
    tiny.position.set(0.68, -0.14 + i * 0.075, 0.041);
    ispGroup.add(tiny);
  }

  // Curved MIPI-CSI Flex Ribbon Cable + 40-Pin Hirose BM28 Gold BTB (passes cleanly through midframe MIPI slot!)
  const flexRibbon = createFlexRibbon(
    [
      new THREE.Vector3(0.88, -0.18, 0.01),
      new THREE.Vector3(1.22, -0.18, 0.02),
      new THREE.Vector3(1.52, -0.18, 0.00),
      new THREE.Vector3(1.68, -0.18, -0.01),
    ],
    0.58,
    0.014,
    matFlexKapton
  );
  ispGroup.add(flexRibbon);

  const btbHeader = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.042), matGold);
  btbHeader.position.set(1.72, -0.18, -0.01);
  ispGroup.add(btbHeader);

  ispGroup.add(ispChipSub);
  mainAxis.add(ispGroup);
  registerLayer(ispGroup, [0, 0, 2.40], 'main_isp_pcb');
  registerLayer(ispChipSub, [0, 0, 0.58], 'main_rk1608b');

  // =========================================================================
  // 3. AUXILIARY 16MP ULTRA-WIDE CAMERA (SONY IMX355 + 5P STACK + HOLLOW MINI-VCM + 24 BOND WIRES!)
  // =========================================================================
  const auxAxis = new THREE.Group();
  auxAxis.name = 'auxAxis';
  auxAxis.position.set(auxLocalX, auxLocalY, 0);
  root.add(auxAxis);

  const auxBezel = new THREE.Mesh(createLensRingGeometry(0.495, 0.625, 0.132, 0.018, 48), matTitaniumPlateau);
  auxBezel.position.z = -0.630;
  auxAxis.add(auxBezel);
  registerLayer(auxBezel, [0, 0, -4.65], 'aux_bezel');

  const auxSapphire = new THREE.Mesh(
    createOpticalLensGeometry({ radius: 0.482, edgeThickness: 0.036, frontSag: 0.012, backSag: -0.008 }),
    matSapphire
  );
  auxSapphire.position.z = -0.680;
  auxAxis.add(auxSapphire);
  registerLayer(auxSapphire, [0, 0, -5.20], 'aux_sapphire');

  // True 5P Aspherical Ultra-Wide Optical Stack (strictly non-overlapping in Z & r<=0.490 inside plateau hole 0.525!)
  const auxLensSpecs = [
    { z: -0.588, ex: -3.50, r: 0.43, frontSag: 0.034, backSag: -0.018, tint: 0xdff2ff, brass: false },
    { z: -0.528, ex: -2.85, r: 0.37, frontSag: -0.018, backSag: 0.018, tint: 0xf4e4ff, brass: true },
    { z: -0.454, ex: -2.22, r: 0.35, frontSag: 0.022, backSag: -0.016, tint: 0xe6fff5, brass: false },
    { z: -0.394, ex: -1.62, r: 0.34, frontSag: -0.014, backSag: 0.020, tint: 0xfff0f6, brass: true },
    { z: -0.312, ex: -1.04, r: 0.36, frontSag: 0.020, backSag: -0.012, tint: 0xe6f6ff, brass: false },
  ];
  auxLensSpecs.forEach((l, idx) => {
    const g = new THREE.Group();
    g.position.z = l.z;
    g.add(new THREE.Mesh(
      createOpticalLensGeometry({ radius: l.r, edgeThickness: 0.032, frontSag: l.frontSag, backSag: l.backSag }),
      makeLensGlassMat(l.tint, 0.62, [180, 460], false)
    ));
    g.add(new THREE.Mesh(createLensRingGeometry(l.r - 0.01, l.r + 0.055, 0.036, 0.004, 40), matMatteBaffle));
    if (l.brass) {
      const shim = new THREE.Mesh(createLensRingGeometry(l.r + 0.005, l.r + 0.048, 0.009, 0.002, 40), matBrassSpacer);
      shim.position.z = -0.015;
      g.add(shim);
    }
    auxAxis.add(g);
    registerLayer(g, [0, 0, l.ex], `aux_lens_E${idx + 1}`);
  });

  // Hollow Dissectible Mini-VCM Autofocus Actuator (Permalloy Can strictly surrounds Mini-VCM Core!)
  const auxVcmCan = new THREE.Group();
  auxVcmCan.position.z = -0.200;
  const auxCanTop = createRoundedRectShape(1.16, 1.16, 0.14);
  auxCanTop.holes.push(createCircleHole(0.50, 0, 0));
  const auxTopMesh = new THREE.Mesh(
    extrudePlate(auxCanTop, 0.016, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matPermalloy
  );
  auxTopMesh.position.z = -0.074;
  auxVcmCan.add(auxTopMesh);
  const auxWallGeo = new THREE.BoxGeometry(1.10, 0.030, 0.165);
  [
    [0, 0.565, 0],
    [0, -0.565, 0],
    [0.565, 0, Math.PI / 2],
    [-0.565, 0, Math.PI / 2],
  ].forEach(([wx, wy, rz]) => {
    const w = new THREE.Mesh(auxWallGeo, matPermalloy);
    w.position.set(wx, wy, 0.006);
    w.rotation.z = rz;
    auxVcmCan.add(w);
  });
  auxAxis.add(auxVcmCan);
  registerLayer(auxVcmCan, [0, 0, -0.45], 'aux_vcm_can');

  const auxVcmCore = new THREE.Group();
  auxVcmCore.position.z = -0.195;
  const auxCarrier = createRoundedRectShape(0.94, 0.94, 0.10);
  auxCarrier.holes.push(createCircleHole(0.44, 0, 0));
  auxVcmCore.add(new THREE.Mesh(
    extrudePlate(auxCarrier, 0.118, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matDarkAnodized
  ));
  const miniCoilGeo = new THREE.BoxGeometry(0.46, 0.095, 0.12);
  const miniMagGeo = new THREE.BoxGeometry(0.42, 0.060, 0.12);
  [-1, 1].forEach((dir) => {
    const c = new THREE.Mesh(miniCoilGeo, matCopperCoil);
    c.position.set(0, dir * 0.425, 0);
    auxVcmCore.add(c);
    const m = new THREE.Mesh(miniMagGeo, matNeodymium);
    m.position.set(0, dir * 0.505, 0);
    auxVcmCore.add(m);
  });
  auxVcmCore.add(new THREE.Mesh(createLensRingGeometry(0.41, 0.46, 0.010, 0.002, 36), matBeCuSpring));
  auxAxis.add(auxVcmCore);
  registerLayer(auxVcmCore, [0, 0, 0.05], 'aux_vcm_core');

  // Mini AGC Blue-Glass IR-Cut Filter for Sony IMX355 (local Z: [-0.107..-0.073])
  const auxIrGroup = new THREE.Group();
  auxIrGroup.position.z = -0.090;
  const auxIrFrameShape = createRoundedRectShape(0.76, 0.66, 0.05);
  const auxIrHole = new THREE.Path();
  auxIrHole.moveTo(-0.30, -0.25);
  auxIrHole.lineTo(-0.30, 0.25);
  auxIrHole.lineTo(0.30, 0.25);
  auxIrHole.lineTo(0.30, -0.25);
  auxIrHole.closePath();
  auxIrFrameShape.holes.push(auxIrHole);
  auxIrGroup.add(new THREE.Mesh(extrudePlate(auxIrFrameShape, 0.026, { bevelSize: 0.003, bevelThickness: 0.003 }), matMatteBaffle));
  auxIrGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.50, 0.016), matIrFilter));
  auxAxis.add(auxIrGroup);
  registerLayer(auxIrGroup, [0, 0, 0.62], 'aux_ir');

  // Sony IMX355 16MP CMOS Sensor + 24 Gold Bond Wires + DW9714A AF IC + Curved 30P Hirose BM28 Flex (local Z: [-0.065..+0.094])
  const auxSensor = new THREE.Group();
  auxSensor.position.z = 0.025;
  auxSensor.add(new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.96, 0.88, 0.06), 0.060, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matCeramicPkg
  ));
  const auxDie = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.48, 0.020), matCmosDie);
  auxDie.position.z = -0.036;
  auxSensor.add(auxDie);

  const auxBondWires = createBondWiresGroup({
    dieW: 0.56,
    dieH: 0.46,
    pkgW: 0.84,
    pkgH: 0.74,
    wiresPerLongSide: 7,
    wiresPerShortSide: 5,
    arcHeight: 0.042,
    wireRadius: 0.0045,
    material: matGold,
  });
  auxBondWires.position.z = -0.038;
  auxSensor.add(auxBondWires);

  const dw9714 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.028), matWlcspDie);
  dw9714.position.set(0.24, -0.22, 0.048);
  auxSensor.add(dw9714);

  const auxFlex = createFlexRibbon(
    [
      new THREE.Vector3(0.46, 0.04, 0.01),
      new THREE.Vector3(0.86, 0.14, 0.03),
      new THREE.Vector3(1.22, 0.24, -0.01),
    ],
    0.42,
    0.012,
    matFlexKapton
  );
  auxSensor.add(auxFlex);
  const auxBtb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.040), matGold);
  auxBtb.position.set(1.26, 0.24, -0.01);
  auxSensor.add(auxBtb);

  auxAxis.add(auxSensor);
  registerLayer(auxSensor, [0, 0, 1.48], 'aux_sensor');

  // =========================================================================
  // 4. DISSECTIBLE DUAL-CRI FLASH (ams OSRAM KW/KY CELNM2 + STEPPED MICRO-FRESNEL!)
  // =========================================================================
  const flashOpticsGroup = new THREE.Group();
  flashOpticsGroup.position.set(flashLocalX, flashLocalY, -0.600);
  flashOpticsGroup.add(new THREE.Mesh(createLensRingGeometry(0.21, 0.285, 0.074, 0.010, 36), matTitaniumPlateau));
  const fresnelLens = new THREE.Mesh(
    createOpticalLensGeometry({ radius: 0.21, edgeThickness: 0.024, frontSag: 0.022, backSag: 0 }),
    matSapphire
  );
  fresnelLens.position.z = -0.018;
  flashOpticsGroup.add(fresnelLens);
  for (let r = 0.045; r <= 0.19; r += 0.036) {
    const fRing = new THREE.Mesh(
      createLensRingGeometry(r, r + 0.014, 0.012, 0.002, 32),
      matSapphire
    );
    fRing.position.z = -0.010;
    flashOpticsGroup.add(fRing);
  }
  root.add(flashOpticsGroup);
  registerLayer(flashOpticsGroup, [0, 0, -2.95], 'flash_optics');

  // Dual AlN Ceramic MCPCB + OSRAM KW/KY CELNM2 Dies (local Z: [-0.344..-0.268], behind plateau -0.358!)
  const flashEmitterGroup = new THREE.Group();
  flashEmitterGroup.position.set(flashLocalX, flashLocalY, -0.305);
  flashEmitterGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.032, 32).rotateX(Math.PI / 2), matAlnCeramic));
  const flashCuBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.020, 32).rotateX(Math.PI / 2), matCopperSpread);
  flashCuBase.position.z = 0.026;
  flashEmitterGroup.add(flashCuBase);
  const warmLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.10, 0.028),
    new THREE.MeshStandardMaterial({ color: 0xf0be4e, roughness: 0.30, metalness: 0.08 })
  );
  warmLed.position.set(0, 0.068, -0.024);
  const coolLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.10, 0.028),
    new THREE.MeshStandardMaterial({ color: 0xf7f2d4, roughness: 0.30, metalness: 0.08 })
  );
  coolLed.position.set(0, -0.068, -0.024);
  flashEmitterGroup.add(warmLed, coolLed);
  [-0.095, 0.095].forEach((gx) => {
    [-0.068, 0.068].forEach((gy) => {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.065, 0.010), matGold);
      pad.position.set(gx, gy, -0.020);
      flashEmitterGroup.add(pad);
    });
  });
  root.add(flashEmitterGroup);
  registerLayer(flashEmitterGroup, [0, 0, -1.65], 'flash_emitter');

  // =========================================================================
  // 5. DISSECTIBLE ST VL53L8CX 8x8 dToF LASER AF + ams OSRAM TCS3408 FLICKER SENSOR
  // =========================================================================
  const tofWindowGroup = new THREE.Group();
  tofWindowGroup.position.set(tofLocalX, tofLocalY, -0.598);
  tofWindowGroup.add(new THREE.Mesh(createLensRingGeometry(0.18, 0.245, 0.070, 0.008, 32), matDarkAnodized));
  const tofGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.024, 32).rotateX(Math.PI / 2),
    new THREE.MeshPhysicalMaterial({
      color: 0x3b0e1e,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      metalness: 0.25,
      roughness: 0.05,
      clearcoat: 1.0,
      iridescence: 0.85,
    })
  );
  tofGlass.position.z = -0.016;
  tofWindowGroup.add(tofGlass);
  root.add(tofWindowGroup);
  registerLayer(tofWindowGroup, [0, 0, -2.70], 'tof_window');

  const tofBaffleGroup = new THREE.Group();
  tofBaffleGroup.position.set(tofLocalX, tofLocalY, -0.328);
  const tofBafShape = createRoundedRectShape(0.36, 0.24, 0.04);
  tofBafShape.holes.push(createCircleHole(0.055, -0.085, 0));
  tofBafShape.holes.push(createCircleHole(0.068, 0.075, 0));
  tofBaffleGroup.add(new THREE.Mesh(
    extrudePlate(tofBafShape, 0.032, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matMatteBaffle
  ));
  root.add(tofBaffleGroup);
  registerLayer(tofBaffleGroup, [0, 0, -1.92], 'tof_baffle');

  const tofSiliconGroup = new THREE.Group();
  tofSiliconGroup.position.set(tofLocalX, tofLocalY, -0.254);
  tofSiliconGroup.add(new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.42, 0.28, 0.04), 0.042, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matCeramicPkg
  ));
  const vcselRing = new THREE.Mesh(createLensRingGeometry(0.025, 0.058, 0.020, 0.003, 20), matGold);
  vcselRing.position.set(-0.095, 0.02, -0.028);
  tofSiliconGroup.add(vcselRing);
  const spadDie = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.135, 0.020), matCmosDie);
  spadDie.position.set(0.085, 0.02, -0.028);
  tofSiliconGroup.add(spadDie);
  const flickerPkg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.030), matCeramicPkg);
  flickerPkg.position.set(0, -0.22, -0.01);
  const flickerDie = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.065, 0.014), matWlcspDie);
  flickerDie.position.set(0, -0.22, -0.028);
  tofSiliconGroup.add(flickerPkg, flickerDie);
  root.add(tofSiliconGroup);
  registerLayer(tofSiliconGroup, [0, 0, -1.12], 'tof_silicon');

  // =========================================================================
  // 6. DISSECTIBLE REAR AUDIO-ZOOM MEMS MICROPHONE (KNOWLES SPH0655LM4H-1)
  // =========================================================================
  const micMeshGroup = new THREE.Group();
  micMeshGroup.position.set(micLocalX, micLocalY, -0.336);
  micMeshGroup.add(new THREE.Mesh(createLensRingGeometry(0.065, 0.105, 0.018, 0.003, 24), matBrassSpacer));
  micMeshGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.010, 24).rotateX(Math.PI / 2), matPtfeMesh));
  root.add(micMeshGroup);
  registerLayer(micMeshGroup, [0, 0, -2.42], 'mic_mesh');

  const micCanGroup = new THREE.Group();
  micCanGroup.position.set(micLocalX, micLocalY, -0.284);
  const micCanShape = createRoundedRectShape(0.34, 0.26, 0.03);
  micCanShape.holes.push(createCircleHole(0.042, -0.06, 0));
  micCanGroup.add(new THREE.Mesh(
    extrudePlate(micCanShape, 0.046, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matGold
  ));
  root.add(micCanGroup);
  registerLayer(micCanGroup, [0, 0, -1.72], 'mic_can');

  const micDieGroup = new THREE.Group();
  micDieGroup.position.set(micLocalX, micLocalY, -0.208);
  micDieGroup.add(new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.35, 0.27, 0.03), 0.030, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matMiniPcb
  ));
  const memsDiaphragm = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.016, 24).rotateX(Math.PI / 2), matWlcspDie);
  memsDiaphragm.position.set(-0.065, 0, -0.020);
  const memsAsic = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.018), matIspDie);
  memsAsic.position.set(0.080, 0, -0.020);
  const memsWire = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.008), matGold);
  memsWire.position.set(0.008, 0, -0.029);
  micDieGroup.add(memsDiaphragm, memsAsic, memsWire);
  root.add(micDieGroup);
  registerLayer(micDieGroup, [0, 0, -0.96], 'mic_die');

  prepareAssembly(root, 'camera');

  return {
    id: 'camera',
    root,
    homePos: new THREE.Vector3(anchorX, anchorY, anchorZ),
    macroOffset: new THREE.Vector3(-1.05, 0.65, -3.55),
    hoverOffset: new THREE.Vector3(0, 0, -0.32),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
      // Smooth continuously variable mechanical aperture actuation (f/1.4 open -> f/2.8 heptagon during dissection!)
      irisCamRing.rotation.z = micro * 0.28;
      const bladeSwing = 0.16 - micro * 0.22;
      for (let i = 0; i < irisBlades.length; i++) {
        irisBlades[i].pivot.rotation.z = irisBlades[i].baseRot + bladeSwing;
      }
    },
  };
}
