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

  // Track animated micro-layers: { obj, base, offset }
  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  // =========================================================================
  // 1. CNC TITANIUM CAMERA PLATEAU (mounts flush through rear ceramic glass)
  // =========================================================================
  const plateauGroup = new THREE.Group();
  const plateauShape = createRoundedRectShape(CAMERA_BAY.W, CAMERA_BAY.H, CAMERA_BAY.R);
  plateauShape.holes.push(createCircleHole(CAMERA_BAY.MAIN_R * 0.90, mainLocalX, mainLocalY));
  plateauShape.holes.push(createCircleHole(CAMERA_BAY.AUX_R * 0.88, auxLocalX, auxLocalY));
  plateauShape.holes.push(createCircleHole(CAMERA_BAY.FLASH_R * 0.95, flashLocalX, flashLocalY));
  plateauShape.holes.push(createCircleHole(CAMERA_BAY.TOF_R * 0.92, tofLocalX, tofLocalY));

  const plateauMesh = new THREE.Mesh(
    extrudePlate(plateauShape, 0.24, { bevelSize: 0.055, bevelThickness: 0.055, bevelSegments: 5 }),
    matTitaniumPlateau
  );
  plateauGroup.position.set(0, 0, -0.425);
  plateauGroup.add(plateauMesh);

  // Hollow precision dark bezel liner matching optical bores cleanly
  const backLinerShape = createRoundedRectShape(CAMERA_BAY.W - 0.14, CAMERA_BAY.H - 0.14, CAMERA_BAY.R - 0.06);
  backLinerShape.holes.push(createCircleHole(CAMERA_BAY.MAIN_R * 0.88, mainLocalX, mainLocalY));
  backLinerShape.holes.push(createCircleHole(CAMERA_BAY.AUX_R * 0.86, auxLocalX, auxLocalY));
  backLinerShape.holes.push(createCircleHole(CAMERA_BAY.FLASH_R * 0.94, flashLocalX, flashLocalY));
  backLinerShape.holes.push(createCircleHole(CAMERA_BAY.TOF_R * 0.90, tofLocalX, tofLocalY));
  const plateauBackPlate = new THREE.Mesh(
    extrudePlate(backLinerShape, 0.028, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matDarkAnodized
  );
  plateauBackPlate.position.z = 0.095;
  plateauGroup.add(plateauBackPlate);

  // Tiny rear microphone chamfered acoustic pinhole on titanium plateau
  const micRing = new THREE.Mesh(
    createLensRingGeometry(0.036, 0.078, 0.04, 0.008, 24),
    matDarkAnodized
  );
  micRing.position.set(micLocalX, micLocalY, -0.105);
  plateauGroup.add(micRing);

  root.add(plateauGroup);
  registerLayer(plateauGroup, [0, 0, -3.70]);

  // =========================================================================
  // 2. 45MP MASTER OPTICAL STACK (SONY LYT-818 + 1G+6P + VARIABLE APERTURE + OIS/VCM + RK1608B)
  // =========================================================================
  const mainAxis = new THREE.Group();
  mainAxis.position.set(mainLocalX, mainLocalY, 0);
  root.add(mainAxis);

  // 2A. Stepped Titanium + Laser-Engraved 45MP Lens Bezel Ring
  const bezelGroup = new THREE.Group();
  bezelGroup.position.set(0, 0, -0.585);
  const outerBezel = new THREE.Mesh(
    createLensRingGeometry(0.84, 1.07, 0.18, 0.028, 64),
    matTitaniumPlateau
  );
  bezelGroup.add(outerBezel);
  const innerDarkBezel = new THREE.Mesh(
    createLensRingGeometry(0.76, 0.86, 0.15, 0.015, 64),
    matDarkAnodized
  );
  innerDarkBezel.position.z = -0.01;
  bezelGroup.add(innerDarkBezel);

  // Flat engraved specification ring facing -Z (rear)
  const engravedRingGeo = new THREE.RingGeometry(0.75, 1.01, 64);
  engravedRingGeo.rotateY(Math.PI); // face -Z
  const engravedRing = new THREE.Mesh(engravedRingGeo, matBezelFace);
  engravedRing.position.z = -0.092;
  bezelGroup.add(engravedRing);

  mainAxis.add(bezelGroup);
  registerLayer(bezelGroup, [0, 0, -4.95]);

  // 2B. Multi-Coated Sapphire Crystal Protective Cover Lens + IP68 O-Ring
  const sapphireGroup = new THREE.Group();
  sapphireGroup.position.set(0, 0, -0.605);
  const sapphireMesh = new THREE.Mesh(
    createOpticalLensGeometry({
      radius: 0.78,
      edgeThickness: 0.055,
      frontSag: 0.018,
      backSag: -0.012,
    }),
    matSapphire
  );
  sapphireGroup.add(sapphireMesh);
  const sapphireSeal = new THREE.Mesh(
    createLensRingGeometry(0.775, 0.815, 0.05, 0.006, 48),
    matMatteBaffle
  );
  sapphireGroup.add(sapphireSeal);
  mainAxis.add(sapphireGroup);
  registerLayer(sapphireGroup, [0, 0, -5.55]);

  // 2C. Continuously Variable 7-Blade Mechanical Aperture (f/1.4 - f/4.0)
  //     Slotted Brass Cam Actuation Ring + 7 Dowel Pins + Micro-Coil Actuator + 7 DLC Blades!
  const irisGroup = new THREE.Group();
  irisGroup.position.set(0, 0, -0.515);

  const irisHousing = new THREE.Mesh(
    createLensRingGeometry(0.70, 0.81, 0.044, 0.006, 56),
    matDarkAnodized
  );
  irisGroup.add(irisHousing);

  // Precision slotted brushed-brass cam drive ring
  const irisCamRing = new THREE.Mesh(
    createLensRingGeometry(0.67, 0.745, 0.020, 0.003, 56),
    matBrassSpacer
  );
  irisCamRing.position.z = -0.018;
  irisGroup.add(irisCamRing);

  // Compact SMA / Micro-Coil Aperture Actuator mounted cleanly on housing rim
  const irisActuator = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.044), matCopperCoil);
  irisActuator.position.set(0.71, 0.22, 0.004);
  irisActuator.rotation.z = 0.30;
  irisGroup.add(irisActuator);

  const bladeCount = 7;
  // Seamless overlapping 7-blade photographic iris crescent (angular span ~1.22 rad > 2pi/7 = 0.90 rad!)
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.69 * Math.cos(-0.14), 0.69 * Math.sin(-0.14));
  bladeShape.absarc(0, 0, 0.69, -0.14, 1.08, false);
  bladeShape.quadraticCurveTo(0.40, 0.28, 0.36, -0.06);
  bladeShape.quadraticCurveTo(0.50, -0.14, 0.69 * Math.cos(-0.14), 0.69 * Math.sin(-0.14));
  bladeShape.closePath();
  const bladeGeo = extrudePlate(bladeShape, 0.008, { bevelSize: 0.002, bevelThickness: 0.002, bevelSegments: 2 });
  const matIrisBlade = new THREE.MeshStandardMaterial({
    color: 0x14171e,
    metalness: 0.80,
    roughness: 0.28,
  });
  const dowelGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.028, 10);
  dowelGeo.rotateX(Math.PI / 2);

  const irisBlades = [];
  for (let i = 0; i < bladeCount; i++) {
    const angle = (i / bladeCount) * Math.PI * 2;
    const pivot = new THREE.Group();
    // Stagger each shingled blade slightly in Z to prevent z-fighting across overlaps
    pivot.position.set(Math.cos(angle) * 0.64, Math.sin(angle) * 0.64, i * 0.0022 - 0.0066);
    pivot.rotation.z = angle + 0.16;

    const blade = new THREE.Mesh(bladeGeo, matIrisBlade);
    blade.position.set(-0.64, 0, 0);
    pivot.add(blade);

    // Brass cam guide dowel pin engaging the slotted brass cam ring
    const dowel = new THREE.Mesh(dowelGeo, matBrassSpacer);
    dowel.position.set(0, 0, -0.014);
    pivot.add(dowel);

    irisGroup.add(pivot);
    irisBlades.push({ pivot, baseRot: angle });
  }
  mainAxis.add(irisGroup);
  registerLayer(irisGroup, [0, 0, -4.25]);

  // 2D. True 1G+6P (7-Element!) Real Commercial Hybrid Glass + Polymer Optical Stack
  //     E1 = Molded Aspherical Glass (1G), E2..E7 = Precision Aspherical High-Index Polymer (6P)
  //     Alternating precision brass optical spacing shims & knife-edge matte stray-light baffles!
  const lensPrescription = [
    {
      // E1 (1G): Large Molded Aspherical Crown Glass Front Collector (low dispersion, thick edge!)
      z: -0.468, explodeZ: -3.55, radius: 0.71, edgeT: 0.062, frontSag: 0.155, backSag: -0.048,
      asphereFront: 0.022, tint: 0xdaf3ff, irid: 0.72, range: [160, 440], ringOuter: 0.79,
      isGlass: true, brass: false, baffle: true,
    },
    {
      // E2 (P1): High-Index Negative Dispersion Biconcave Flint Element + Brass Spacing Shim
      z: -0.402, explodeZ: -3.00, radius: 0.63, edgeT: 0.088, frontSag: -0.056, backSag: -0.046,
      asphereFront: 0.0, tint: 0xf4e4ff, irid: 0.76, range: [280, 520], ringOuter: 0.73,
      isGlass: false, brass: true, baffle: false,
    },
    {
      // E3 (P2): Positive Aspherical Meniscus Focusing Element + Matte Stray-Light Baffle
      z: -0.342, explodeZ: -2.46, radius: 0.61, edgeT: 0.048, frontSag: 0.118, backSag: -0.082,
      asphereFront: 0.018, tint: 0xe0fff4, irid: 0.68, range: [200, 460], ringOuter: 0.71,
      isGlass: false, brass: false, baffle: true,
    },
    {
      // E4 (P3): Double-Convex High-Refraction Power Element + Brass Spacing Shim
      z: -0.284, explodeZ: -1.94, radius: 0.58, edgeT: 0.064, frontSag: 0.088, backSag: 0.056,
      asphereFront: 0.010, tint: 0xe4efff, irid: 0.62, range: [180, 410], ringOuter: 0.69,
      isGlass: false, brass: true, baffle: false,
    },
    {
      // E5 (P4): Aspherical Gull-Wing Coma & Astigmatism Corrector + Knife-Edge Baffle
      z: -0.228, explodeZ: -1.44, radius: 0.56, edgeT: 0.044, frontSag: -0.036, backSag: 0.098,
      asphereFront: 0.046, tint: 0xffeef8, irid: 0.74, range: [250, 540], ringOuter: 0.67,
      isGlass: false, brass: false, baffle: true,
    },
    {
      // E6 (P5): Negative Chromatic Aberration & Distortion Corrector + Brass Spacing Shim
      z: -0.172, explodeZ: -0.96, radius: 0.57, edgeT: 0.046, frontSag: -0.042, backSag: 0.038,
      asphereFront: 0.032, tint: 0xf0e8ff, irid: 0.66, range: [220, 490], ringOuter: 0.67,
      isGlass: false, brass: true, baffle: false,
    },
    {
      // E7 (P6): Large Rear Field-Flattener Optical Collector matching 1/1.28" Sony LYT-818 Circle!
      z: -0.114, explodeZ: -0.48, radius: 0.61, edgeT: 0.044, frontSag: 0.064, backSag: -0.038,
      asphereFront: 0.028, tint: 0xe6f8ff, irid: 0.60, range: [170, 440], ringOuter: 0.69,
      isGlass: false, brass: false, baffle: true,
    },
  ];

  lensPrescription.forEach((el) => {
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

    // Precision black anodized / molded retainer ring (titanium accent rim on 1G molded glass!)
    const retainer = new THREE.Mesh(
      createLensRingGeometry(el.radius - 0.015, el.ringOuter, el.edgeT + 0.020, 0.008, 56),
      el.isGlass ? matDarkAnodized : matMatteBaffle
    );
    elGroup.add(retainer);

    if (el.isGlass) {
      // Machined titanium press-fit bezel collar exclusively on the 1G Molded Glass element
      const gRim = new THREE.Mesh(
        createLensRingGeometry(el.radius + 0.01, el.ringOuter + 0.012, 0.018, 0.004, 56),
        matTitaniumPlateau
      );
      gRim.position.z = -el.edgeT * 0.55;
      elGroup.add(gRim);
    }

    // Precision brass optical air-gap spacing shim
    if (el.brass) {
      const shim = new THREE.Mesh(
        createLensRingGeometry(el.radius + 0.005, el.ringOuter - 0.008, 0.013, 0.002, 56),
        matBrassSpacer
      );
      shim.position.z = -el.edgeT * 0.56;
      elGroup.add(shim);
    }

    // Thin knife-edge matte black internal stray-light baffle aperture ring
    if (el.baffle && !el.isGlass) {
      const baffle = new THREE.Mesh(
        createLensRingGeometry(el.radius - 0.055, el.radius + 0.025, 0.009, 0.001, 56),
        matMatteBaffle
      );
      baffle.position.z = -el.edgeT * 0.54;
      elGroup.add(baffle);
    }

    mainAxis.add(elGroup);
    registerLayer(elGroup, [0, 0, el.explodeZ]);
  });

  // 2E. Precision Anodized Helical Lens Barrel Sleeve (slides cleanly out along optical axis)
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0, 0, -0.29);
  const outerSleeve = new THREE.Mesh(
    createLensRingGeometry(0.785, 0.848, 0.37, 0.012, 64),
    matDarkAnodized
  );
  barrelGroup.add(outerSleeve);
  // Internal stepped stray-light anti-glare grooves inside barrel
  for (let g = 0; g < 4; g++) {
    const groove = new THREE.Mesh(
      createLensRingGeometry(0.765, 0.788, 0.016, 0.002, 48),
      matMatteBaffle
    );
    groove.position.z = -0.13 + g * 0.085;
    barrelGroup.add(groove);
  }
  // 3 Brass Focus Guide Cam Pins around exterior of barrel
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.085, 12), matBrassSpacer);
    pin.rotation.z = a - Math.PI / 2;
    pin.position.set(Math.cos(a) * 0.855, Math.sin(a) * 0.855, 0.02);
    barrelGroup.add(pin);
  }
  mainAxis.add(barrelGroup);
  registerLayer(barrelGroup, [0, 0, -2.18]);

  // 2F. CLOSED-LOOP 4-WIRE BALL-GUIDE OIS + CLAF VCM GIMBAL (3 SEPARATING MECHANICAL STRATA!)
  //     Stratum 1: Stamped Permalloy EMI Magnetic Shield Can (lifts off forward!)
  const yokeShieldGroup = new THREE.Group();
  yokeShieldGroup.position.set(0, 0, -0.155);
  const yokeShape = createRoundedRectShape(1.98, 1.98, 0.24);
  yokeShape.holes.push(createCircleHole(0.87, 0, 0));
  const yokeCan = new THREE.Mesh(
    extrudePlate(yokeShape, 0.24, { bevelSize: 0.015, bevelThickness: 0.015 }),
    matPermalloy
  );
  yokeShieldGroup.add(yokeCan);
  // 4 Side-wall magnetic shielding skirts with alignment cutouts
  const wallSkirtGeo = new THREE.BoxGeometry(1.52, 0.036, 0.26);
  [
    [0, 0.97, 0],
    [0, -0.97, 0],
    [0.97, 0, Math.PI / 2],
    [-0.97, 0, Math.PI / 2],
  ].forEach(([wx, wy, rz]) => {
    const skirt = new THREE.Mesh(wallSkirtGeo, matPermalloy);
    skirt.position.set(wx, wy, 0.02);
    skirt.rotation.z = rz;
    yokeShieldGroup.add(skirt);
  });
  mainAxis.add(yokeShieldGroup);
  registerLayer(yokeShieldGroup, [0, 0, -0.68]);

  //     Stratum 2: Photo-Etched Beryllium-Copper Upper Spider Leaf-Spring Flexure!
  const spiderSpringGroup = new THREE.Group();
  spiderSpringGroup.position.set(0, 0, -0.23);
  const springOuterShape = createRoundedRectShape(1.78, 1.78, 0.18);
  springOuterShape.holes.push(createCircleHole(0.81, 0, 0));
  const springOuter = new THREE.Mesh(
    extrudePlate(springOuterShape, 0.012, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matBeCuSpring
  );
  spiderSpringGroup.add(springOuter);
  // Inner movable lens-carrier BeCu ring + 4 serpentine flexure bridges
  const springInner = new THREE.Mesh(
    createLensRingGeometry(0.71, 0.77, 0.012, 0.002, 48),
    matBeCuSpring
  );
  spiderSpringGroup.add(springInner);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const armCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * 0.75, Math.sin(a) * 0.75, 0),
      new THREE.Vector3(Math.cos(a + 0.24) * 0.84, Math.sin(a + 0.24) * 0.84, 0),
      new THREE.Vector3(Math.cos(a - 0.16) * 0.92, Math.sin(a - 0.16) * 0.92, 0),
      new THREE.Vector3(Math.cos(a) * 1.06, Math.sin(a) * 1.06, 0),
    ]);
    const arm = new THREE.Mesh(
      new THREE.TubeGeometry(armCurve, 14, 0.013, 6, false),
      matBeCuSpring
    );
    spiderSpringGroup.add(arm);
  }
  mainAxis.add(spiderSpringGroup);
  registerLayer(spiderSpringGroup, [0, 0, -0.32]);

  //     Stratum 3: 4-Wire Ball-Guide OIS/VCM Magnetic Actuator Core + Golden OIS FPC + 3x Hall Sensors!
  const oisGroup = new THREE.Group();
  oisGroup.position.set(0, 0, -0.13);

  // Dark LCP polymer gimbal carrier ring holding the moving coils
  const carrierShape = createRoundedRectShape(1.80, 1.80, 0.20);
  carrierShape.holes.push(createCircleHole(0.84, 0, 0));
  const carrierFrame = new THREE.Mesh(
    extrudePlate(carrierShape, 0.16, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matDarkAnodized
  );
  oisGroup.add(carrierFrame);

  // 4 Copper-Wound Rectangular Electromagnetic OIS/VCM Coils + 4 Sintered NdFeB Magnets
  const coilGeo = new THREE.BoxGeometry(0.76, 0.16, 0.20);
  const magGeo = new THREE.BoxGeometry(0.72, 0.11, 0.19);
  const cardinalOffsets = [
    { x: 0, y: 0.77, rotZ: 0, magY: 0.89 },
    { x: 0, y: -0.77, rotZ: 0, magY: -0.89 },
    { x: 0.77, y: 0, rotZ: Math.PI / 2, magX: 0.89 },
    { x: -0.77, y: 0, rotZ: Math.PI / 2, magX: -0.89 },
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

  // 4 Corner Gold-Phosphor OIS Suspension Flexure Wires + 4 Precision Ceramic Ball-Bearing Guide Balls!
  const cornerSigns = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const wireGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8);
  wireGeo.rotateX(Math.PI / 2);
  const guideBallGeo = new THREE.SphereGeometry(0.044, 14, 14);
  cornerSigns.forEach(([sx, sy]) => {
    const suspWire = new THREE.Mesh(wireGeo, matGold);
    suspWire.position.set(sx * 0.82, sy * 0.82, -0.01);
    oisGroup.add(suspWire);

    // Gleaming precision ceramic guide ball seated in corner V-groove race!
    const ball = new THREE.Mesh(guideBallGeo, matCeramicBall);
    ball.position.set(sx * 0.69, sy * 0.69, 0.035);
    oisGroup.add(ball);
  });

  // Golden Kapton OIS Flexible Circuit Ring underneath coils carrying 3x AKM/Alps Hall Sensors (X, Y, Z)!
  const fpcRingShape = createRoundedRectShape(1.76, 1.76, 0.16);
  fpcRingShape.holes.push(createCircleHole(0.76, 0, 0));
  const oisFpcRing = new THREE.Mesh(
    extrudePlate(fpcRingShape, 0.016, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matOisFpc
  );
  oisFpcRing.position.z = 0.092;
  oisGroup.add(oisFpcRing);

  // 3x Real Hall-Effect Position Sensors (CAM_H1 X-OIS, CAM_H2 Y-OIS, CAM_H3 Z-CLAF) on OIS FPC!
  const hallGeo = new THREE.BoxGeometry(0.13, 0.13, 0.042);
  [
    [0.0, 0.77],   // X-OIS Hall
    [0.77, 0.0],   // Y-OIS Hall
    [-0.77, 0.0],  // Z-CLAF Hall
  ].forEach(([hx, hy]) => {
    const hall = new THREE.Mesh(hallGeo, matCeramicPkg);
    hall.position.set(hx, hy, 0.108);
    oisGroup.add(hall);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.012), matGold);
    pad.position.set(hx, hy, 0.098);
    oisGroup.add(pad);
  });

  mainAxis.add(oisGroup);
  registerLayer(oisGroup, [0, 0, 0.06]);

  // 2G. AGC Blue-Glass Spin-Coated 650nm IR-Cut Filter in Matte Micro-Frame
  const irGroup = new THREE.Group();
  irGroup.position.set(0, 0, -0.012);
  const irFrameShape = createRoundedRectShape(1.32, 1.10, 0.08);
  const irHole = new THREE.Path();
  irHole.moveTo(-0.55, -0.44);
  irHole.lineTo(-0.55, 0.44);
  irHole.lineTo(0.55, 0.44);
  irHole.lineTo(0.55, -0.44);
  irHole.closePath();
  irFrameShape.holes.push(irHole);
  const irFrame = new THREE.Mesh(
    extrudePlate(irFrameShape, 0.036, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matMatteBaffle
  );
  irGroup.add(irFrame);
  const irGlass = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.88, 0.022), matIrFilter);
  irGroup.add(irGlass);

  mainAxis.add(irGroup);
  registerLayer(irGroup, [0, 0, 0.72]);

  // 2H. SONY LYT-818 1/1.28" 45MP STACKED BSI CMOS SENSOR
  //     Ceramic LGA + Gold Kovar Seal Ring + 48 3D Gold Bond Wires + 24 Perimeter MLCCs + Copper Spreader!
  const sensorGroup = new THREE.Group();
  sensorGroup.position.set(0, 0, 0.056);

  const pkgBase = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.56, 1.36, 0.08), 0.075, { bevelSize: 0.008, bevelThickness: 0.008 }),
    matCeramicPkg
  );
  sensorGroup.add(pkgBase);

  // Rear satin copper thermal heat-spreader bonded behind Sony LYT-818 ceramic substrate
  const cuSpreader = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.42, 1.22, 0.06), 0.018, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matCopperSpread
  );
  cuSpreader.position.z = 0.044;
  sensorGroup.add(cuSpreader);

  // Gold Kovar perimeter hermetic seal ring
  const goldRingShape = createRoundedRectShape(1.44, 1.24, 0.05);
  const holeP = new THREE.Path();
  holeP.moveTo(-0.63, -0.53);
  holeP.lineTo(-0.63, 0.53);
  holeP.lineTo(0.63, 0.53);
  holeP.lineTo(0.63, -0.53);
  holeP.closePath();
  goldRingShape.holes.push(holeP);
  const goldRing = new THREE.Mesh(
    extrudePlate(goldRingShape, 0.014, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matGold
  );
  goldRing.position.z = -0.042;
  sensorGroup.add(goldRing);

  // Active 1/1.28" Sony LYT-818 Stacked BSI Silicon CMOS Die (Quad-Bayer micro-lens shimmer!)
  const dieGeo = new THREE.BoxGeometry(1.04, 0.84, 0.028);
  const dieMesh = new THREE.Mesh(dieGeo, matCmosDie);
  dieMesh.position.z = -0.044;
  sensorGroup.add(dieMesh);

  // 48 Actual 3D Arched Micro Gold Bond Wires (14 top/bot + 10 left/right)
  const bondWires = createBondWiresGroup({
    dieW: 1.02,
    dieH: 0.82,
    pkgW: 1.36,
    pkgH: 1.16,
    wiresPerLongSide: 14,
    wiresPerShortSide: 10,
    arcHeight: 0.095,
    wireRadius: 0.0055,
    material: matGold,
  });
  bondWires.position.z = -0.046;
  sensorGroup.add(bondWires);

  // 24 Real Perimeter 01005/0201 MLCC Decoupling Capacitors around ALL 4 edges of Sony LYT-818!
  const capGeo = new THREE.BoxGeometry(0.072, 0.038, 0.030);
  const capInst = new THREE.InstancedMesh(capGeo, matMlccCap, 24);
  const dummy = new THREE.Object3D();
  let cIdx = 0;
  for (let i = 0; i < 7; i++) {
    const x = -0.54 + i * 0.18;
    // Bottom edge & Top edge
    dummy.position.set(x, -0.61, -0.048);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);

    dummy.position.set(x, 0.61, -0.048);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);
  }
  for (let i = 0; i < 5; i++) {
    const y = -0.40 + i * 0.20;
    // Left edge & Right edge
    dummy.position.set(-0.71, y, -0.048);
    dummy.rotation.set(0, 0, Math.PI / 2);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);

    dummy.position.set(0.71, y, -0.048);
    dummy.updateMatrix();
    capInst.setMatrixAt(cIdx++, dummy.matrix);
  }
  capInst.instanceMatrix.needsUpdate = true;
  sensorGroup.add(capInst);

  mainAxis.add(sensorGroup);
  registerLayer(sensorGroup, [0, 0, 1.52]);

  // 2I. MULTI-CHIP CAMERA RIGID-FLEX PCB (cam_mod)
  //     Rockchip RK1608B Pre-ISP (with 10x10 = 100 BGA Solder Balls!) + LPDDR Buffer +
  //     Halo/Dongwoon DW9786 32-Bit OIS MCU + Giantec GT24C64A Calibration EEPROM + 40P Hirose BM28 BTB!
  const ispGroup = new THREE.Group();
  ispGroup.position.set(0, 0, 0.138);

  const subPcb = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.96, 1.76, 0.12), 0.055, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matMiniPcb
  );
  ispGroup.add(subPcb);

  // Rockchip RK1608B Visual Pre-ISP Package (lifts off sensor PCB during deep dissection to reveal 100 BGA balls!)
  const ispChipSub = new THREE.Group();
  ispChipSub.position.set(0, 0, 0.055);
  const ispSubstrate = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.96, 0.96, 0.05), 0.032, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matCeramicPkg
  );
  ispChipSub.add(ispSubstrate);

  const ispSiliconDie = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.84, 0.022), matIspDie);
  ispSiliconDie.position.z = 0.024;
  ispChipSub.add(ispSiliconDie);

  // 10x10 = 100 Gleaming BGA Solder Ball Matrix underneath Rockchip RK1608B!
  const ballGeo = new THREE.SphereGeometry(0.019, 8, 8);
  const bgaCount = 10;
  const bgaInst = new THREE.InstancedMesh(ballGeo, matSolderBall, bgaCount * bgaCount);
  let bIdx = 0;
  for (let gx = 0; gx < bgaCount; gx++) {
    for (let gy = 0; gy < bgaCount; gy++) {
      dummy.position.set(
        (gx / (bgaCount - 1) - 0.5) * 0.82,
        (gy / (bgaCount - 1) - 0.5) * 0.82,
        -0.022
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bgaInst.setMatrixAt(bIdx++, dummy.matrix);
    }
  }
  bgaInst.instanceMatrix.needsUpdate = true;
  ispChipSub.add(bgaInst);

  // Companion Image Buffer DRAM chip on left side of RK1608B
  const dramBuf = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.58, 0.036), matCeramicPkg);
  dramBuf.position.set(-0.72, 0.12, 0.036);
  ispGroup.add(dramBuf);

  // Halo/Dongwoon DW9786 32-Bit OIS + CLAF MCU (WLCSP-25 mirror silicon die!) on upper-right
  const dw9786 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.036), matWlcspDie);
  dw9786.position.set(0.68, 0.42, 0.036);
  ispGroup.add(dw9786);

  // Giantec GT24C64A 64Kb Camera Calibration EEPROM (UDFN-8) on lower-right
  const eepromIc = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.20, 0.032), matCeramicPkg);
  eepromIc.position.set(0.68, -0.40, 0.034);
  ispGroup.add(eepromIc);

  // Micro passives flanking DW9786 & EEPROM
  for (let i = 0; i < 6; i++) {
    const tiny = new THREE.Mesh(capGeo, matMlccCap);
    tiny.position.set(0.68, -0.14 + i * 0.075, 0.034);
    ispGroup.add(tiny);
  }

  // Curved MIPI-CSI Flex Ribbon Cable + 40-Pin Hirose BM28 Gold BTB Connector toward Mainboard (+X)
  const flexRibbon = createFlexRibbon(
    [
      new THREE.Vector3(0.88, 0.0, 0.01),
      new THREE.Vector3(1.26, 0.05, 0.03),
      new THREE.Vector3(1.54, 0.12, -0.02),
      new THREE.Vector3(1.76, 0.16, -0.01),
    ],
    0.60,
    0.014,
    matFlexKapton
  );
  ispGroup.add(flexRibbon);

  const btbHeader = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.64, 0.046), matGold);
  btbHeader.position.set(1.80, 0.16, -0.01);
  ispGroup.add(btbHeader);

  ispGroup.add(ispChipSub);
  mainAxis.add(ispGroup);
  registerLayer(ispGroup, [0, 0, 2.40]);
  registerLayer(ispChipSub, [0, 0, 0.58]);

  // =========================================================================
  // 3. AUXILIARY 16MP ULTRA-WIDE CAMERA (SONY IMX355 + 5P STACK + HOLLOW MINI-VCM + 24 BOND WIRES!)
  // =========================================================================
  const auxAxis = new THREE.Group();
  auxAxis.position.set(auxLocalX, auxLocalY, 0);
  root.add(auxAxis);

  const auxBezel = new THREE.Mesh(createLensRingGeometry(0.45, 0.63, 0.16, 0.022, 48), matTitaniumPlateau);
  auxBezel.position.z = -0.565;
  auxAxis.add(auxBezel);
  registerLayer(auxBezel, [0, 0, -4.65]);

  const auxSapphire = new THREE.Mesh(
    createOpticalLensGeometry({ radius: 0.45, edgeThickness: 0.045, frontSag: 0.015, backSag: -0.01 }),
    matSapphire
  );
  auxSapphire.position.z = -0.58;
  auxAxis.add(auxSapphire);
  registerLayer(auxSapphire, [0, 0, -5.20]);

  // True 5P Aspherical Ultra-Wide Optical Stack (E1..E5 + matte baffles + 2 brass shims!)
  const auxLensSpecs = [
    { z: -0.455, ex: -3.50, r: 0.43, frontSag: 0.095, backSag: -0.045, tint: 0xdff2ff, brass: false },
    { z: -0.390, ex: -2.85, r: 0.37, frontSag: -0.042, backSag: 0.052, tint: 0xf4e4ff, brass: true },
    { z: -0.325, ex: -2.22, r: 0.35, frontSag: 0.068, backSag: -0.036, tint: 0xe6fff5, brass: false },
    { z: -0.262, ex: -1.62, r: 0.34, frontSag: -0.028, backSag: 0.044, tint: 0xfff0f6, brass: true },
    { z: -0.200, ex: -1.04, r: 0.36, frontSag: 0.048, backSag: -0.024, tint: 0xe6f6ff, brass: false },
  ];
  auxLensSpecs.forEach((l) => {
    const g = new THREE.Group();
    g.position.z = l.z;
    g.add(new THREE.Mesh(
      createOpticalLensGeometry({ radius: l.r, edgeThickness: 0.040, frontSag: l.frontSag, backSag: l.backSag }),
      makeLensGlassMat(l.tint, 0.62, [180, 460], false)
    ));
    g.add(new THREE.Mesh(createLensRingGeometry(l.r - 0.01, l.r + 0.06, 0.050, 0.005, 40), matMatteBaffle));
    if (l.brass) {
      const shim = new THREE.Mesh(createLensRingGeometry(l.r + 0.005, l.r + 0.052, 0.011, 0.002, 40), matBrassSpacer);
      shim.position.z = -0.022;
      g.add(shim);
    }
    auxAxis.add(g);
    registerLayer(g, [0, 0, l.ex]);
  });

  // Hollow Dissectible Mini-VCM Autofocus Actuator (Permalloy Can + 2 Wound Copper Coils + 2 NdFeB Magnets + DW9714A!)
  const auxVcmCan = new THREE.Group();
  auxVcmCan.position.z = -0.135;
  const auxCanShape = createRoundedRectShape(1.14, 1.14, 0.14);
  auxCanShape.holes.push(createCircleHole(0.45, 0, 0));
  auxVcmCan.add(new THREE.Mesh(
    extrudePlate(auxCanShape, 0.18, { bevelSize: 0.010, bevelThickness: 0.010 }),
    matPermalloy
  ));
  auxAxis.add(auxVcmCan);
  registerLayer(auxVcmCan, [0, 0, -0.45]);

  const auxVcmCore = new THREE.Group();
  auxVcmCore.position.z = -0.095;
  const auxCarrier = createRoundedRectShape(0.98, 0.98, 0.11);
  auxCarrier.holes.push(createCircleHole(0.43, 0, 0));
  auxVcmCore.add(new THREE.Mesh(
    extrudePlate(auxCarrier, 0.14, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matDarkAnodized
  ));
  // Dual opposing wound copper AF coils + NdFeB magnets inside mini-VCM!
  const miniCoilGeo = new THREE.BoxGeometry(0.48, 0.11, 0.15);
  const miniMagGeo = new THREE.BoxGeometry(0.44, 0.08, 0.14);
  [-1, 1].forEach((dir) => {
    const c = new THREE.Mesh(miniCoilGeo, matCopperCoil);
    c.position.set(0, dir * 0.45, 0);
    auxVcmCore.add(c);
    const m = new THREE.Mesh(miniMagGeo, matNeodymium);
    m.position.set(0, dir * 0.53, 0);
    auxVcmCore.add(m);
  });
  // Mini BeCu spider flexure ring
  auxVcmCore.add(new THREE.Mesh(createLensRingGeometry(0.41, 0.47, 0.010, 0.002, 36), matBeCuSpring));
  auxAxis.add(auxVcmCore);
  registerLayer(auxVcmCore, [0, 0, 0.05]);

  // Mini AGC Blue-Glass IR-Cut Filter for Sony IMX355
  const auxIrGroup = new THREE.Group();
  auxIrGroup.position.z = -0.012;
  const auxIrFrameShape = createRoundedRectShape(0.76, 0.66, 0.05);
  const auxIrHole = new THREE.Path();
  auxIrHole.moveTo(-0.30, -0.25);
  auxIrHole.lineTo(-0.30, 0.25);
  auxIrHole.lineTo(0.30, 0.25);
  auxIrHole.lineTo(0.30, -0.25);
  auxIrHole.closePath();
  auxIrFrameShape.holes.push(auxIrHole);
  auxIrGroup.add(new THREE.Mesh(extrudePlate(auxIrFrameShape, 0.028, { bevelSize: 0.003, bevelThickness: 0.003 }), matMatteBaffle));
  auxIrGroup.add(new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.50, 0.018), matIrFilter));
  auxAxis.add(auxIrGroup);
  registerLayer(auxIrGroup, [0, 0, 0.62]);

  // Sony IMX355 16MP CMOS Sensor + 24 Gold Bond Wires + DW9714A AF IC + Curved 30P Hirose BM28 Flex!
  const auxSensor = new THREE.Group();
  auxSensor.position.z = 0.082;
  auxSensor.add(new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.96, 0.88, 0.06), 0.064, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matCeramicPkg
  ));
  const auxDie = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.48, 0.022), matCmosDie);
  auxDie.position.z = -0.036;
  auxSensor.add(auxDie);

  const auxBondWires = createBondWiresGroup({
    dieW: 0.56,
    dieH: 0.46,
    pkgW: 0.84,
    pkgH: 0.74,
    wiresPerLongSide: 7,
    wiresPerShortSide: 5,
    arcHeight: 0.065,
    wireRadius: 0.0045,
    material: matGold,
  });
  auxBondWires.position.z = -0.038;
  auxSensor.add(auxBondWires);

  // Dongwoon DW9714A AF VCM Driver die on backside of IMX355 sub-PCB
  const dw9714 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.028), matWlcspDie);
  dw9714.position.set(0.24, -0.22, 0.044);
  auxSensor.add(dw9714);

  // Curved Kapton 30-Pin MIPI Flex & Hirose BM28 Gold BTB toward Mainboard
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
  registerLayer(auxSensor, [0, 0, 1.48]);

  // =========================================================================
  // 4. DISSECTIBLE DUAL-CRI FLASH (ams OSRAM KW/KY CELNM2 + STEPPED MICRO-FRESNEL!)
  // =========================================================================
  const flashOpticsGroup = new THREE.Group();
  flashOpticsGroup.position.set(flashLocalX, flashLocalY, -0.48);
  flashOpticsGroup.add(new THREE.Mesh(createLensRingGeometry(0.21, 0.29, 0.14, 0.012, 36), matTitaniumPlateau));
  // Base glass Fresnel lens dome + 5 stepped concentric micro-Fresnel optical rings!
  const fresnelLens = new THREE.Mesh(
    createOpticalLensGeometry({ radius: 0.21, edgeThickness: 0.028, frontSag: 0.032, backSag: 0 }),
    matSapphire
  );
  fresnelLens.position.z = -0.055;
  flashOpticsGroup.add(fresnelLens);
  for (let r = 0.045; r <= 0.19; r += 0.036) {
    const fRing = new THREE.Mesh(
      createLensRingGeometry(r, r + 0.014, 0.014, 0.002, 32),
      matSapphire
    );
    fRing.position.z = -0.042;
    flashOpticsGroup.add(fRing);
  }
  root.add(flashOpticsGroup);
  registerLayer(flashOpticsGroup, [0, 0, -2.95]);

  // Dual AlN Ceramic MCPCB + OSRAM KW CELNM2 (5700K Cool) & KY CELNM2 (2700K Warm) Dies!
  const flashEmitterGroup = new THREE.Group();
  flashEmitterGroup.position.set(flashLocalX, flashLocalY, -0.34);
  // Copper thermal slug + white AlN ceramic MCPCB
  flashEmitterGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.034, 32).rotateX(Math.PI / 2), matAlnCeramic));
  const flashCuBase = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.022, 32).rotateX(Math.PI / 2), matCopperSpread);
  flashCuBase.position.z = 0.026;
  flashEmitterGroup.add(flashCuBase);
  // Warm 2700K Amber & Cool 5700K White OSRAM OSLON Compact PL 1616 phosphor dies
  const warmLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.10, 0.030),
    new THREE.MeshStandardMaterial({ color: 0xf0be4e, roughness: 0.30, metalness: 0.08 })
  );
  warmLed.position.set(0, 0.068, -0.024);
  const coolLed = new THREE.Mesh(
    new THREE.BoxGeometry(0.14, 0.10, 0.030),
    new THREE.MeshStandardMaterial({ color: 0xf7f2d4, roughness: 0.30, metalness: 0.08 })
  );
  coolLed.position.set(0, -0.068, -0.024);
  flashEmitterGroup.add(warmLed, coolLed);
  // Gold anode/cathode micro-bond pads flanking both LEDs
  [-0.095, 0.095].forEach((gx) => {
    [-0.068, 0.068].forEach((gy) => {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.065, 0.012), matGold);
      pad.position.set(gx, gy, -0.020);
      flashEmitterGroup.add(pad);
    });
  });
  root.add(flashEmitterGroup);
  registerLayer(flashEmitterGroup, [0, 0, -1.65]);

  // =========================================================================
  // 5. DISSECTIBLE ST VL53L8CX 8x8 dToF LASER AF + ams OSRAM TCS3408 FLICKER SENSOR
  // =========================================================================
  // 5A. Ruby 940nm IR-Pass Optical Window & Dark Bezel
  const tofWindowGroup = new THREE.Group();
  tofWindowGroup.position.set(tofLocalX, tofLocalY, -0.47);
  tofWindowGroup.add(new THREE.Mesh(createLensRingGeometry(0.18, 0.25, 0.12, 0.01, 32), matDarkAnodized));
  const tofGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.028, 32).rotateX(Math.PI / 2),
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
  tofGlass.position.z = -0.044;
  tofWindowGroup.add(tofGlass);
  root.add(tofWindowGroup);
  registerLayer(tofWindowGroup, [0, 0, -2.70]);

  // 5B. Dual-Aperture Optical Isolation Baffle (isolates 940nm VCSEL Tx from 8x8 SPAD Rx!)
  const tofBaffleGroup = new THREE.Group();
  tofBaffleGroup.position.set(tofLocalX, tofLocalY, -0.37);
  const tofBafShape = createRoundedRectShape(0.36, 0.24, 0.04);
  tofBafShape.holes.push(createCircleHole(0.055, -0.085, 0));
  tofBafShape.holes.push(createCircleHole(0.068, 0.075, 0));
  tofBaffleGroup.add(new THREE.Mesh(
    extrudePlate(tofBafShape, 0.036, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matMatteBaffle
  ));
  root.add(tofBaffleGroup);
  registerLayer(tofBaffleGroup, [0, 0, -1.92]);

  // 5C. ST VL53L8CX OLGA-12 Carrier (940nm VCSEL Laser Emitter + 8x8 SPAD Array) + ams TCS3408 RGB/Flicker!
  const tofSiliconGroup = new THREE.Group();
  tofSiliconGroup.position.set(tofLocalX, tofLocalY, -0.27);
  tofSiliconGroup.add(new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.42, 0.28, 0.04), 0.045, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matCeramicPkg
  ));
  // 940nm VCSEL Emitter Gold Ring & Micro-Aperture
  const vcselRing = new THREE.Mesh(createLensRingGeometry(0.025, 0.058, 0.022, 0.003, 20), matGold);
  vcselRing.position.set(-0.095, 0.02, -0.030);
  tofSiliconGroup.add(vcselRing);
  // 8x8 SPAD Photodiode Receiver Array Silicon Die (shimmering iridescent blue-violet die!)
  const spadDie = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.135, 0.022), matCmosDie);
  spadDie.position.set(0.085, 0.02, -0.030);
  tofSiliconGroup.add(spadDie);
  // Adjacent ams OSRAM TCS3408 Spectral Color + 50/60Hz Flicker Photodiode IC
  const flickerPkg = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.032), matCeramicPkg);
  flickerPkg.position.set(0, -0.22, -0.01);
  const flickerDie = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.065, 0.016), matWlcspDie);
  flickerDie.position.set(0, -0.22, -0.030);
  tofSiliconGroup.add(flickerPkg, flickerDie);
  root.add(tofSiliconGroup);
  registerLayer(tofSiliconGroup, [0, 0, -1.12]);

  // =========================================================================
  // 6. DISSECTIBLE REAR AUDIO-ZOOM MEMS MICROPHONE (KNOWLES SPH0655LM4H-1)
  // =========================================================================
  // 6A. Microporous Waterproof PTFE Gore-Tex Acoustic Membrane + Brass Seal Ring
  const micMeshGroup = new THREE.Group();
  micMeshGroup.position.set(micLocalX, micLocalY, -0.35);
  micMeshGroup.add(new THREE.Mesh(createLensRingGeometry(0.065, 0.105, 0.020, 0.003, 24), matBrassSpacer));
  micMeshGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 24).rotateX(Math.PI / 2), matPtfeMesh));
  root.add(micMeshGroup);
  registerLayer(micMeshGroup, [0, 0, -2.42]);

  // 6B. Gold-Plated EMI Acoustic Shield Can Lid with Top Acoustic Port
  const micCanGroup = new THREE.Group();
  micCanGroup.position.set(micLocalX, micLocalY, -0.26);
  const micCanShape = createRoundedRectShape(0.34, 0.26, 0.03);
  micCanShape.holes.push(createCircleHole(0.042, -0.06, 0));
  micCanGroup.add(new THREE.Mesh(
    extrudePlate(micCanShape, 0.048, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matGold
  ));
  root.add(micCanGroup);
  registerLayer(micCanGroup, [0, 0, -1.72]);

  // 6C. Exposed Knowles SPH0655LM4H-1 LGA-5 Substrate: MEMS Silicon Diaphragm + CMOS ASIC Die!
  const micDieGroup = new THREE.Group();
  micDieGroup.position.set(micLocalX, micLocalY, -0.17);
  micDieGroup.add(new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.35, 0.27, 0.03), 0.032, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matMiniPcb
  ));
  // Circular MEMS capacitive silicon diaphragm die aligned to acoustic port
  const memsDiaphragm = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.018, 24).rotateX(Math.PI / 2), matWlcspDie);
  memsDiaphragm.position.set(-0.065, 0, -0.022);
  // Adjacent PDM ADC / Amplifier CMOS ASIC Die
  const memsAsic = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.020), matIspDie);
  memsAsic.position.set(0.080, 0, -0.022);
  // Gold bonding bridge connecting MEMS diaphragm to ASIC
  const memsWire = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.008), matGold);
  memsWire.position.set(0.008, 0, -0.032);
  micDieGroup.add(memsDiaphragm, memsAsic, memsWire);
  root.add(micDieGroup);
  registerLayer(micDieGroup, [0, 0, -0.96]);

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
