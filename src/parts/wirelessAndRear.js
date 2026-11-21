import * as THREE from 'three';
import { PHONE, CAMERA_BAY, BATTERY_DIM, Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  createRoundedRectHole,
  extrudePlate,
  createSpiralCoilGeometry,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * RK T4 — Wireless Charging Copper Coil, NFC Antenna Loop, 18-Magnet Alignment Array,
 * Nanocrystalline Ferrite Shield, and Matte Micro-Textured Ceramic Rear Glass.
 */
export function buildWirelessAndRearSystem(textures) {
  const root = new THREE.Group();
  root.name = 'wireless';

  const anchorZ = Z_STACK.WIRELESS_COIL;
  root.position.set(0, 0, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const coilCx = BATTERY_DIM.CENTER_X;
  const coilCy = BATTERY_DIM.CENTER_Y - 0.05;

  const matRearCeramic = new THREE.MeshPhysicalMaterial({
    map: textures.rearCeramic.map,
    roughnessMap: textures.rearCeramic.roughnessMap,
    color: 0xffffff,
    metalness: 0.14,
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.32,
  });

  const matCopperWire = new THREE.MeshStandardMaterial({
    color: 0xd47d46,
    metalness: 0.95,
    roughness: 0.20,
  });

  const matFerrite = new THREE.MeshStandardMaterial({
    color: 0x181a20,
    metalness: 0.42,
    roughness: 0.56,
  });

  const matMagnet = new THREE.MeshStandardMaterial({
    color: 0xd0d5dc,
    metalness: 0.94,
    roughness: 0.20,
  });

  const matGold = new THREE.MeshStandardMaterial({
    color: 0xdcb45c,
    metalness: 0.96,
    roughness: 0.18,
  });

  // =========================================================================
  // 1. NANOCRYSTALLINE FERRITE MAGNETIC SHIELDING SHEET
  // =========================================================================
  const ferriteGroup = new THREE.Group();
  ferriteGroup.position.set(coilCx, coilCy, Z_STACK.WIRELESS_FERRITE - anchorZ);
  const ferritePlate = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(4.48, 4.92, 0.42), 0.014, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matFerrite
  );
  ferriteGroup.add(ferritePlate);
  root.add(ferriteGroup);
  registerLayer(ferriteGroup, [0, 0, 1.35]);

  // =========================================================================
  // 2. MULTI-TURN 3D SPIRAL COPPER WIRELESS CHARGING COIL + THERMAL PROBE
  // =========================================================================
  const coilGroup = new THREE.Group();
  coilGroup.position.set(coilCx, coilCy, 0);

  const spiralGeo = createSpiralCoilGeometry({
    innerR: 0.94,
    outerR: 1.98,
    turns: 14,
    wireRadius: 0.018,
    samplesPerTurn: 44,
    radialSegments: 8,
  });
  const spiralMesh = new THREE.Mesh(spiralGeo, matCopperWire);
  coilGroup.add(spiralMesh);

  // Dual copper lead-out wires + gold BTB contact pad running toward right motherboard spine
  const lead1 = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.06, 0.020), matCopperWire);
  lead1.position.set(2.38, 0.16, 0);
  const lead2 = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.06, 0.020), matCopperWire);
  lead2.position.set(2.22, -0.16, 0);
  const termPad = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.48, 0.024), matGold);
  termPad.position.set(2.94, 0, 0);
  coilGroup.add(lead1, lead2, termPad);

  const ntcDot = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.022), matGold);
  coilGroup.add(ntcDot);

  root.add(coilGroup);
  registerLayer(coilGroup, [0, 0, 0.35]);

  // =========================================================================
  // 3. ETCHED COPPER NFC LOOP ANTENNA (UPPER-RIGHT REAR PERIMETER)
  // =========================================================================
  const nfcGroup = new THREE.Group();
  nfcGroup.position.set(1.10, 4.45, Z_STACK.WIRELESS_NFC - anchorZ);
  for (let i = 0; i < 3; i++) {
    const w = 3.20 - i * 0.14;
    const h = 2.65 - i * 0.14;
    const loopShape = createRoundedRectShape(w, h, 0.28 - i * 0.03);
    loopShape.holes.push(createRoundedRectHole(w - 0.05, h - 0.05, 0.24 - i * 0.03));
    const loopMesh = new THREE.Mesh(
      extrudePlate(loopShape, 0.008, { bevelSize: 0, bevelThickness: 0 }),
      matCopperWire
    );
    nfcGroup.add(loopMesh);
  }
  root.add(nfcGroup);
  registerLayer(nfcGroup, [0, 0, -0.35]);

  // =========================================================================
  // 4. 18-SEGMENT NEODYMIUM MAGNETIC ALIGNMENT RING + ORIENTATION BAR
  // =========================================================================
  const magGroup = new THREE.Group();
  magGroup.position.set(coilCx, coilCy, Z_STACK.WIRELESS_MAG - anchorZ);

  const segCount = 18;
  const ringR = 2.18;
  for (let i = 0; i < segCount; i++) {
    const a = (i / segCount) * Math.PI * 2;
    const seg = new THREE.Mesh(
      extrudePlate(createRoundedRectShape(0.62, 0.24, 0.04), 0.022, { bevelSize: 0.003, bevelThickness: 0.003 }),
      matMagnet
    );
    seg.position.set(Math.cos(a) * ringR, Math.sin(a) * ringR, 0);
    seg.rotation.z = a + Math.PI / 2;
    magGroup.add(seg);
  }
  const alignBar = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.24, 0.96, 0.05), 0.022, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matMagnet
  );
  alignBar.position.set(0, -ringR - 0.82, 0);
  magGroup.add(alignBar);

  root.add(magGroup);
  registerLayer(magGroup, [0, 0, -1.12]);

  // =========================================================================
  // 5. MATTE MICRO-TEXTURED CERAMIC REAR GLASS (Z: [-0.440 .. -0.384], flush behind titanium rail!)
  // =========================================================================
  const rearGroup = new THREE.Group();
  rearGroup.position.z = Z_STACK.REAR_GLASS - anchorZ;

  const rearW = PHONE.W - 0.30;
  const rearH = PHONE.H - 0.30;
  const rearR = PHONE.R - 0.14;
  const rearShape = createRoundedRectShape(rearW, rearH, rearR);
  rearShape.holes.push(
    createRoundedRectHole(
      CAMERA_BAY.W + 0.03,
      CAMERA_BAY.H + 0.03,
      CAMERA_BAY.R + 0.015,
      CAMERA_BAY.CENTER_X,
      CAMERA_BAY.CENTER_Y
    )
  );

  const rearMesh = new THREE.Mesh(
    extrudePlate(rearShape, 0.056, {
      bevelSize: 0.022,
      bevelThickness: 0.020,
      bevelSegments: 4,
      curveSegments: 44,
      flipUVX: true,
    }),
    matRearCeramic
  );
  rearGroup.add(rearMesh);

  // Waterproof seal gasket seated cleanly inside rear glass perimeter & rail bore (Z: [-0.382..-0.376])
  const sealShape = createRoundedRectShape(rearW - 0.42, rearH - 0.42, rearR - 0.20);
  sealShape.holes.push(createRoundedRectHole(rearW - 0.56, rearH - 0.56, rearR - 0.26));
  const rearSeal = new THREE.Mesh(
    extrudePlate(sealShape, 0.008, { bevelSize: 0, bevelThickness: 0 }),
    matFerrite
  );
  rearSeal.position.z = 0.034;
  rearGroup.add(rearSeal);

  root.add(rearGroup);
  registerLayer(rearGroup, [0, 0, -2.55]);

  prepareAssembly(root, 'wireless');

  const sealedInternals = [ferriteGroup, coilGroup, nfcGroup, magGroup, rearSeal];
  let forceShowInternals = false;

  return {
    id: 'wireless',
    root,
    homePos: new THREE.Vector3(0, 0, anchorZ),
    macroOffset: new THREE.Vector3(0, 0, -6.40),
    hoverOffset: new THREE.Vector3(0, 0, -0.34),
    setForceShowInternals(v) {
      forceShowInternals = Boolean(v);
      if (forceShowInternals) {
        for (let i = 0; i < sealedInternals.length; i++) sealedInternals[i].visible = true;
      }
    },
    updateMicro(micro, macro = 1) {
      const showInternals = forceShowInternals || micro > 0.005 || macro > 0.005;
      for (let i = 0; i < sealedInternals.length; i++) {
        sealedInternals[i].visible = showInternals;
      }
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}
