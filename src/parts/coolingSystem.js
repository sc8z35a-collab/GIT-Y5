import * as THREE from 'three';
import { Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  extrudePlate,
  prepareAssembly,
} from '../scene/geometryUtils.js';

/**
 * Custom contoured Vapor Chamber thermal silhouette spanning from the SoC bay
 * cleanly down across the 6000mAh Battery heat-spreading region.
 */
function createVaporChamberShape() {
  const s = new THREE.Shape();
  // Local coordinates centered near (0.20, 0.60)
  s.moveTo(-2.55, -4.65);
  s.lineTo(1.95, -4.65);
  s.quadraticCurveTo(2.45, -4.65, 2.45, -4.15);
  s.lineTo(2.45, 5.05);
  s.quadraticCurveTo(2.45, 5.55, 1.95, 5.55);
  s.lineTo(-0.32, 5.55);
  s.quadraticCurveTo(-0.62, 5.55, -0.62, 5.10);
  s.lineTo(-0.62, 2.10);
  s.quadraticCurveTo(-0.62, 1.72, -1.05, 1.72);
  s.lineTo(-2.55, 1.72);
  s.quadraticCurveTo(-2.98, 1.72, -2.98, 1.28);
  s.lineTo(-2.98, -4.22);
  s.quadraticCurveTo(-2.98, -4.65, -2.55, -4.65);
  return s;
}

/**
 * RK T4 — Thermal Architecture: Pure-Copper Vapor Chamber (Internal Capillary Wick Dissection!)
 * & Multi-Layer Pyrolytic Graphite Thermal Film.
 */
export function buildCoolingSystem(textures) {
  const root = new THREE.Group();
  root.name = 'cooling';

  const anchorX = 0.25;
  const anchorY = 0.35;
  const anchorZ = Z_STACK.COOLING_VC_WICK;
  root.position.set(anchorX, anchorY, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  const matGraphite = new THREE.MeshStandardMaterial({
    color: 0x22252c,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.56,
    roughness: 0.36,
  });

  const matCopperShell = new THREE.MeshStandardMaterial({
    color: 0xd07a47,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.94,
    roughness: 0.24,
  });

  const matCopperWick = new THREE.MeshStandardMaterial({
    map: textures.vcWick,
    color: 0xffffff,
    metalness: 0.84,
    roughness: 0.42,
  });

  // 1. Pyrolytic Multi-Layer Graphite Thermal Film (0.12mm at +0.280 -> [+0.274..+0.286])
  const graphiteGroup = new THREE.Group();
  graphiteGroup.position.z = Z_STACK.COOLING_GRAPHITE - anchorZ;
  const graphiteMesh = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(6.28, 11.45, 0.36), 0.012, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matGraphite
  );
  graphiteMesh.position.set(-0.22, 0.08, 0);
  graphiteGroup.add(graphiteMesh);
  root.add(graphiteGroup);
  registerLayer(graphiteGroup, [0, 0, 2.45]);

  // 2. Pure-Copper Vapor Chamber — Stamped Upper Sealed Lid (0.12mm at +0.264 -> [+0.258..+0.270])
  const vcTopGroup = new THREE.Group();
  vcTopGroup.position.z = Z_STACK.COOLING_VC_TOP - anchorZ;
  const vcShape = createVaporChamberShape();
  const vcTopMesh = new THREE.Mesh(
    extrudePlate(vcShape, 0.012, { bevelSize: 0.005, bevelThickness: 0.004 }),
    matCopperShell
  );
  vcTopGroup.add(vcTopMesh);
  root.add(vcTopGroup);
  registerLayer(vcTopGroup, [0, 0, 1.05]);

  // 3. Vapor Chamber Internal Sintered Copper Capillary Wick Mesh & 3D Micro-Support Pillars (0.10mm at +0.248 -> [+0.243..+0.253])
  const vcWickGroup = new THREE.Group();
  vcWickGroup.position.z = 0;

  const wickPlate = new THREE.Mesh(
    extrudePlate(vcShape, 0.010, { bevelSize: 0.001, bevelThickness: 0.001 }),
    matCopperWick
  );
  wickPlate.scale.set(0.95, 0.96, 1);
  vcWickGroup.add(wickPlate);

  const pillarGeo = new THREE.CylinderGeometry(0.052, 0.052, 0.010, 10);
  pillarGeo.rotateX(Math.PI / 2);
  const pillarCoords = [];
  for (let y = -4.0; y <= 4.8; y += 0.62) {
    for (let x = -2.4; x <= 2.0; x += 0.56) {
      if (y > 1.5 && x < -0.5) continue;
      pillarCoords.push([x, y]);
    }
  }
  const pillarInst = new THREE.InstancedMesh(pillarGeo, matCopperShell, pillarCoords.length);
  const dummy = new THREE.Object3D();
  pillarCoords.forEach(([px, py], i) => {
    dummy.position.set(px, py, 0);
    dummy.updateMatrix();
    pillarInst.setMatrixAt(i, dummy.matrix);
  });
  pillarInst.instanceMatrix.needsUpdate = true;
  vcWickGroup.add(pillarInst);

  root.add(vcWickGroup);
  registerLayer(vcWickGroup, [0, 0, -0.22]);

  // 4. Stamped Copper Vapor Chamber Lower Brazed Base Plate (0.12mm at +0.232 -> [+0.226..+0.238])
  const vcBotGroup = new THREE.Group();
  vcBotGroup.position.z = Z_STACK.COOLING_VC_BOT - anchorZ;
  const vcBotMesh = new THREE.Mesh(
    extrudePlate(vcShape, 0.012, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matCopperShell
  );
  vcBotGroup.add(vcBotMesh);
  root.add(vcBotGroup);
  registerLayer(vcBotGroup, [0, 0, -1.48]);

  prepareAssembly(root, 'cooling');

  return {
    id: 'cooling',
    root,
    homePos: new THREE.Vector3(anchorX, anchorY, anchorZ),
    macroOffset: new THREE.Vector3(0.18, 0.08, 2.55),
    hoverOffset: new THREE.Vector3(0, 0, 0.25),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}
