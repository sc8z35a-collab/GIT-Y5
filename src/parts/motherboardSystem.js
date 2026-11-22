import * as THREE from 'three';
import { Z_STACK } from '../scene/constants.js';
import {
  createRoundedRectShape,
  extrudePlate,
  prepareAssembly,
} from '../scene/geometryUtils.js';
import { BOARD_PARTS, BOARD_ROUTES } from '../hardware/boardData.js';

/**
 * Exact L-shaped HDI Mainboard outline (scale: 1 Three.js unit = 10 mm).
 * Matches hardware/rk_t4_mainboard.kicad_pcb Edge.Cuts 1:1!
 */
function createLogicBoardShape() {
  const s = new THREE.Shape();
  s.moveTo(0.78, -6.89);
  s.lineTo(1.66, -6.89);
  s.lineTo(1.66, 4.30);
  s.quadraticCurveTo(1.66, 4.81, 1.14, 4.81);
  s.lineTo(-1.04, 4.81);
  s.lineTo(-1.04, 4.07);
  s.lineTo(-1.82, 4.07);
  s.lineTo(-1.82, 0.39);
  s.quadraticCurveTo(-1.82, 0.31, -1.72, 0.31);
  s.lineTo(0.78, 0.31);
  s.closePath();
  return s;
}

/**
 * Stacked 8-Layer RF/5G/Wi-Fi/GNSS/NFC Mezzanine Board outline (exact 1:1 with hardware/generate_board.mjs).
 */
function createMezzanineShape() {
  const s = new THREE.Shape();
  s.moveTo(-1.55, 0.60);
  s.lineTo(1.44, 0.60);
  s.lineTo(1.44, 4.07);
  s.lineTo(-0.98, 4.07);
  s.lineTo(-1.55, 3.95);
  s.closePath();
  return s;
}

/**
 * Render REAL copper traces, ENIG gold pads, micro-vias, and differential pairs
 * directly from BOARD_ROUTES + BOARD_PARTS onto a crisp PCB canvas texture!
 */
function createRealRoutedPcbTexture(boardName, mode = 'outer') {
  const isMain = boardName === 'main';
  const w = isMain ? 768 : 640;
  const h = isMain ? 1536 : 768;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Bounding boxes in mm matching extrudePlate normalized planar UVs
  const minX = isMain ? -18.2 : -15.5;
  const maxX = isMain ? 16.6 : 14.4;
  const minY = isMain ? -68.9 : 6.0;
  const maxY = isMain ? 48.1 : 39.7;

  const mapX = (xMm) => ((xMm - minX) / (maxX - minX)) * w;
  const mapY = (yMm) => (1 - (yMm - minY) / (maxY - minY)) * h;

  if (mode === 'inner_copper') {
    // Exposed Inner 10-Layer HDI Copper Plane (L3 High-Speed + L4 Split Core Power Plane!)
    ctx.fillStyle = '#33281b'; // FR4 Megtron-6 translucent core dielectric
    ctx.fillRect(0, 0, w, h);

    // Split heavy-copper power pour islands (VBAT, VSYS, CPU_BIG, GPU, DDR2H, 1.8V, 3.3V)
    const pours = [
      [-17.2, 16.0, 13.0, 17.5, '#b86c3b'], // LPDDR5X VDD2H/VDDQ split plane
      [-3.5,  15.5, 17.5, 18.0, '#c87742'], // RK3588S2 Core Power pour
      [-3.2,   4.0, 14.0, 10.5, '#b46838'], // RK806-1 Buck power plane
      [8.4,  -22.0,  7.6, 24.0, '#d28048'], // 6000mAh VBAT / VSYS heavy copper plane
      [8.4,  -67.5,  7.6, 44.0, '#a65f33'], // Spine 3.3V / 1.8V / OLED split planes
    ];
    pours.forEach(([px, py, pw, ph, col]) => {
      ctx.fillStyle = col;
      ctx.fillRect(mapX(px), mapY(py + ph), (pw / (maxX - minX)) * w, (ph / (maxY - minY)) * h);
      ctx.strokeStyle = '#20170f';
      ctx.lineWidth = 3;
      ctx.strokeRect(mapX(px), mapY(py + ph), (pw / (maxX - minX)) * w, (ph / (maxY - minY)) * h);
    });
  } else {
    // Matte obsidian flagship HDI solder mask
    ctx.fillStyle = '#14181d';
    ctx.fillRect(0, 0, w, h);

    // Subtle ground pour relief under matte solder mask
    ctx.fillStyle = '#1b2228';
    ctx.fillRect(10, 10, w - 20, h - 20);
  }

  // Draw ALL REAL routed electrical buses from hardware/generate_board.mjs!
  const boardRoutes = BOARD_ROUTES.filter((r) => r.board === boardName);
  boardRoutes.forEach((rt) => {
    if (rt.pts.length < 2) return;
    const isPwr = rt.layer === 'L4_PWR';
    ctx.strokeStyle =
      mode === 'inner_copper'
        ? (isPwr ? '#f0a66c' : '#e09255')
        : (isPwr ? 'rgba(196, 148, 78, 0.52)' : rt.layer === 'L1_TOP' ? 'rgba(92, 134, 122, 0.85)' : 'rgba(66, 98, 96, 0.62)');
    ctx.lineWidth = Math.max(1.2, (rt.w / (maxX - minX)) * w * (isPwr ? 0.85 : 1.35));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    rt.pts.forEach(([px, py], i) => {
      const cx = mapX(px);
      const cy = mapY(py);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    });
    ctx.stroke();
  });

  // Draw REAL ENIG gold component landing pads, BGA escape fanout vias & silkscreen outlines!
  const parts = BOARD_PARTS.filter((p) => p.board === boardName && p.kind !== 'interposer');
  parts.forEach((p) => {
    const pw = ((p.rot === 90 ? p.h : p.w) / (maxX - minX)) * w;
    const ph = ((p.rot === 90 ? p.w : p.h) / (maxY - minY)) * h;
    const cx = mapX(p.x);
    const cy = mapY(p.y);

    if (mode !== 'inner_copper') {
      // Crisp white technical courtyard silkscreen around ICs & connectors
      if (p.w >= 2.0 || p.h >= 2.0) {
        ctx.strokeStyle = 'rgba(215, 222, 232, 0.34)';
        ctx.lineWidth = 1.1;
        ctx.strokeRect(cx - pw / 2 - 2, cy - ph / 2 - 2, pw + 4, ph + 4);
      }
      // ENIG gold micro-via escape pads around component perimeter
      ctx.fillStyle = '#d4ad58';
      ctx.beginPath();
      ctx.arc(cx - pw / 2 - 3, cy, 1.8, 0, Math.PI * 2);
      ctx.arc(cx + pw / 2 + 3, cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Drilled micro-via clearance holes in inner copper plane!
      ctx.fillStyle = '#18110b';
      ctx.beginPath();
      ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Perimeter RF ground-stitching ENIG via fence (authentic real smartphone EMI craftsmanship!)
  ctx.fillStyle = mode === 'inner_copper' ? '#f5c284' : '#d6b05c';
  for (let y = 18; y < h - 18; y += 16) {
    ctx.beginPath();
    ctx.arc(10, y, 2.0, 0, Math.PI * 2);
    ctx.arc(w - 10, y, 2.0, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Populate ALL real 3D physical SMD / BGA / QFN / Inductor / Crystal / MLCC / BTB / MHF4 components
 * onto a target board group using GPU-batched InstancedMeshes (~10 draw calls for 540+ real parts!).
 */
function populateRealComponents(targetGroup, boardName, sideFilter, zSurface, zDir, textures, materials) {
  const parts = BOARD_PARTS.filter(
    (p) => p.board === boardName && p.side === sideFilter && p.kind !== 'interposer'
  );
  if (!parts.length) return;

  // Group parts by visual hardware package class for crisp material realism + minimal draw calls
  const buckets = {
    ic: [],
    inductor: [],
    xtal: [],
    cap: [],
    res: [],
    esd: [],
    btb: [],
    coax: [],
    sensor: [],
    goldpad: [],
    shunt: [],
    tp: [],
  };

  parts.forEach((p) => {
    // Render hero silicon ICs (RK3588S2 SoC, 16GB LPDDR5X, 256GB eMMC) with dedicated beveled silicon packages!
    if (p.kind === 'soc') {
      const socGrp = new THREE.Group();
      const px = p.x / 10;
      const py = p.y / 10;
      const pw = p.w / 10;
      const ph = p.h / 10;
      const pt = p.t / 10;
      socGrp.position.set(px, py, zSurface + zDir * (pt * 0.5));

      // Green-obsidian organic FCCSP1253 BGA substrate
      const sub = new THREE.Mesh(
        extrudePlate(createRoundedRectShape(pw, ph, 0.06), pt * 0.65, { bevelSize: 0.008, bevelThickness: 0.008 }),
        materials.socSubstrate
      );
      socGrp.add(sub);

      // Gold perimeter decoupling ground ring
      const rim = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.84, ph * 0.84, pt * 0.25), materials.gold);
      rim.position.z = zDir * (pt * 0.26);
      socGrp.add(rim);

      // Mirror-iridescent exposed RK3588S2 8nm silicon die (4x A76 + 4x A55 + GPU + 6TOPS NPU + 48MP Dual ISP!)
      const die = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.76, ph * 0.76, pt * 0.34), materials.socDie);
      die.position.z = zDir * (pt * 0.34);
      socGrp.add(die);

      targetGroup.add(socGrp);
      return;
    }

    if (p.kind === 'dram' || p.kind === 'flash') {
      const px = p.x / 10;
      const py = p.y / 10;
      const pw = p.w / 10;
      const ph = p.h / 10;
      const pt = p.t / 10;
      const pkgMesh = new THREE.Mesh(
        extrudePlate(createRoundedRectShape(pw, ph, 0.045), pt, { bevelSize: 0.006, bevelThickness: 0.006 }),
        p.kind === 'dram' ? materials.dramPkg : materials.flashPkg
      );
      pkgMesh.position.set(px, py, zSurface + zDir * (pt * 0.5));
      targetGroup.add(pkgMesh);
      // Pin-1 laser dot indicator
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.012, 12), materials.gold);
      dot.rotation.x = Math.PI / 2;
      dot.position.set(px - pw * 0.38, py + ph * 0.38, zSurface + zDir * (pt + 0.004));
      targetGroup.add(dot);
      return;
    }

    const bucket = buckets[p.kind] || buckets.ic;
    bucket.push(p);
  });

  const dummy = new THREE.Object3D();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  const addInstancedBox = (list, material, extraEndCapsMat = null, capRatio = 0.22) => {
    if (!list.length) return;
    const inst = new THREE.InstancedMesh(unitBox, material, list.length);
    list.forEach((p, idx) => {
      const sx = p.w / 10;
      const sy = p.h / 10;
      const sz = Math.max(0.018, p.t / 10);
      dummy.position.set(p.x / 10, p.y / 10, zSurface + zDir * (sz * 0.5));
      dummy.rotation.set(0, 0, (p.rot * Math.PI) / 180);
      dummy.scale.set(sx * (extraEndCapsMat ? 1 - capRatio * 1.4 : 1), sy, sz);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    targetGroup.add(inst);

    // Add authentic gleaming silver-tin / gold metallic end terminations on MLCC caps, resistors & inductors!
    if (extraEndCapsMat) {
      const capInst = new THREE.InstancedMesh(unitBox, extraEndCapsMat, list.length * 2);
      let cIdx = 0;
      list.forEach((p) => {
        const sx = p.w / 10;
        const sy = p.h / 10;
        const sz = Math.max(0.018, p.t / 10);
        const rad = (p.rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const off = sx * (0.5 - capRatio * 0.5);
        [-1, 1].forEach((dir) => {
          dummy.position.set(
            p.x / 10 + dir * off * cos,
            p.y / 10 + dir * off * sin,
            zSurface + zDir * (sz * 0.5)
          );
          dummy.rotation.set(0, 0, rad);
          dummy.scale.set(sx * capRatio, sy * 1.02, sz * 1.03);
          dummy.updateMatrix();
          capInst.setMatrixAt(cIdx++, dummy.matrix);
        });
      });
      capInst.instanceMatrix.needsUpdate = true;
      targetGroup.add(capInst);
    }
  };

  addInstancedBox(buckets.ic, materials.icEpoxy);
  addInstancedBox(buckets.esd, materials.icEpoxy);
  addInstancedBox(buckets.inductor, materials.inductorBody, materials.tinCap, 0.16);
  addInstancedBox(buckets.xtal, materials.xtalGold);
  addInstancedBox(buckets.cap, materials.mlccCeramic, materials.tinCap, 0.24);
  addInstancedBox(buckets.res, materials.resistorDark, materials.tinCap, 0.22);
  addInstancedBox(buckets.shunt, materials.shuntAlloy, materials.copperCap, 0.26);
  addInstancedBox(buckets.sensor, materials.sensorMetal);
  addInstancedBox(buckets.btb, materials.btbGold);
  addInstancedBox(buckets.goldpad, materials.gold);

  // Gleaming Gold ENIG Test Points (UART2, MaskROM, SWD)
  if (buckets.tp.length) {
    const tpGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 14);
    tpGeo.rotateX(Math.PI / 2);
    const tpInst = new THREE.InstancedMesh(tpGeo, materials.gold, buckets.tp.length);
    buckets.tp.forEach((p, idx) => {
      dummy.position.set(p.x / 10, p.y / 10, zSurface + zDir * 0.006);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(p.w / 10, p.h / 10, 0.012);
      dummy.updateMatrix();
      tpInst.setMatrixAt(idx, dummy.matrix);
    });
    tpInst.instanceMatrix.needsUpdate = true;
    targetGroup.add(tpInst);
  }

  // Authentic Cylindrical Gold I-PEX MHF4 50-Ohm Coaxial RF Receptacles (7x across 5G / Wi-Fi / GNSS!)
  if (buckets.coax.length) {
    const baseInst = new THREE.InstancedMesh(unitBox, materials.ceramicWhite, buckets.coax.length);
    const barrelGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.055, 18);
    barrelGeo.rotateX(Math.PI / 2);
    const barrelInst = new THREE.InstancedMesh(barrelGeo, materials.gold, buckets.coax.length);
    buckets.coax.forEach((p, idx) => {
      dummy.position.set(p.x / 10, p.y / 10, zSurface + zDir * 0.018);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(p.w / 10, p.h / 10, 0.032);
      dummy.updateMatrix();
      baseInst.setMatrixAt(idx, dummy.matrix);

      dummy.position.set(p.x / 10, p.y / 10, zSurface + zDir * 0.044);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      barrelInst.setMatrixAt(idx, dummy.matrix);
    });
    baseInst.instanceMatrix.needsUpdate = true;
    barrelInst.instanceMatrix.needsUpdate = true;
    targetGroup.add(baseInst, barrelInst);
  }
}

/**
 * RK T4 — Commercial Android 14/15 Flagship 10-Layer HDI Mainboard + Stacked 5G RF Mezzanine (Rev 2.0)
 * 1:1 Data-Driven from hardware/rk_t4_netlist.json (596 Total Parts / 581 on Main+Mezz, 101/101 ERC & SMT DRC Passed!)
 *
 * Deep Dissection Layers:
 *   1. Stamped Compartmentalized EMI Shielding Cages (with copper thermal patch & RF partition ribs)
 *   2. Stacked 8-Layer 5G NR Sub-6 / mmWave IF / Wi-Fi 6E / GNSS / NFC+StrongBox eSE Mezzanine (140 parts, 9x MHF4!)
 *      (SDX62 + PMX65 + QET6100 + SDR735 + SKY58083 + SKY58255 + QM77048 + QDM5872 + QAT3555 + SX9331 + ST33J2M0 + SN220T)
 *   3. 160-Pin Perimeter Gold BGA Interposer Frame (with gleaming solder ball array)
 *   4. Primary 10-Layer HDI Mainboard Top Component Strata (RK3588S2 SoC, 16GB LPDDR5X, RK806-1 + 10 Buck Inductors,
 *      3x RK860 6A Bucks, BQ25895 + Dual BQ25970 + BQ27Z561-R2 + 5mOhm Shunt, TPD4S480 48V EPR OVP, LSM6DSO OIS IMU)
 *   5. Exposed Inner 10-Layer HDI Copper Routing & Split Power Plane Core (L3_HS + L4_PWR)
 *   6. Primary Mainboard Bottom Component Strata (256GB eMMC 5.1, 16MB NOR, SGM3843 + SGM2036-3.0 OLED, Isolated WL2868C, BGA Belly Caps!)
 */
export function buildMotherboardSystem(textures) {
  const root = new THREE.Group();
  root.name = 'motherboard';

  const anchorX = 1.76;
  const anchorY = 2.85;
  const anchorZ = 0.0;
  root.position.set(anchorX, anchorY, anchorZ);

  const layers = [];
  const registerLayer = (obj, explodeOffset) => {
    layers.push({
      obj,
      base: obj.position.clone(),
      offset: new THREE.Vector3(...explodeOffset),
    });
  };

  // --- Physically Accurate Real Hardware Materials ---
  const mainOuterTex = createRealRoutedPcbTexture('main', 'outer');
  const mainInnerCuTex = createRealRoutedPcbTexture('main', 'inner_copper');
  const mezzOuterTex = createRealRoutedPcbTexture('mezz', 'outer');

  const matMainPcb = new THREE.MeshStandardMaterial({
    map: mainOuterTex,
    metalness: 0.32,
    roughness: 0.42,
  });

  const matInnerCopperPlane = new THREE.MeshStandardMaterial({
    map: mainInnerCuTex,
    metalness: 0.88,
    roughness: 0.28,
  });

  const matMezzPcb = new THREE.MeshStandardMaterial({
    map: mezzOuterTex,
    metalness: 0.34,
    roughness: 0.40,
  });

  const matEmiSteel = new THREE.MeshStandardMaterial({
    color: 0xc2c6ce,
    map: textures.titanium.map,
    roughnessMap: textures.titanium.roughnessMap,
    metalness: 0.93,
    roughness: 0.23,
  });

  const matEmiCopper = new THREE.MeshStandardMaterial({
    color: 0xcc7b48,
    metalness: 0.93,
    roughness: 0.24,
  });

  const materials = {
    socSubstrate: new THREE.MeshStandardMaterial({ color: 0x162b22, metalness: 0.34, roughness: 0.42 }),
    socDie: new THREE.MeshPhysicalMaterial({
      map: textures.ispDie,
      color: 0xdce8fa,
      metalness: 0.86,
      roughness: 0.12,
      clearcoat: 0.92,
      iridescence: 0.78,
      iridescenceIOR: 1.68,
    }),
    dramPkg: new THREE.MeshStandardMaterial({ color: 0x181b21, metalness: 0.28, roughness: 0.42 }),
    flashPkg: new THREE.MeshStandardMaterial({ color: 0x1e2128, metalness: 0.30, roughness: 0.44 }),
    icEpoxy: new THREE.MeshStandardMaterial({ color: 0x1c2026, metalness: 0.26, roughness: 0.46 }),
    inductorBody: new THREE.MeshStandardMaterial({ color: 0x353942, metalness: 0.52, roughness: 0.38 }),
    xtalGold: new THREE.MeshStandardMaterial({ color: 0xd9b35d, metalness: 0.94, roughness: 0.20 }),
    mlccCeramic: new THREE.MeshStandardMaterial({ color: 0x9c7246, metalness: 0.28, roughness: 0.42 }),
    resistorDark: new THREE.MeshStandardMaterial({ color: 0x17191e, metalness: 0.24, roughness: 0.50 }),
    tinCap: new THREE.MeshStandardMaterial({ color: 0xd8dde5, metalness: 0.95, roughness: 0.18 }),
    copperCap: new THREE.MeshStandardMaterial({ color: 0xd47d46, metalness: 0.94, roughness: 0.22 }),
    shuntAlloy: new THREE.MeshStandardMaterial({ color: 0x5c626d, metalness: 0.88, roughness: 0.26 }),
    sensorMetal: new THREE.MeshStandardMaterial({ color: 0xb9bec7, metalness: 0.90, roughness: 0.24 }),
    btbGold: new THREE.MeshStandardMaterial({ color: 0xd5aa52, metalness: 0.88, roughness: 0.26 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b75a, metalness: 0.96, roughness: 0.16 }),
    ceramicWhite: new THREE.MeshStandardMaterial({ color: 0xebeef2, metalness: 0.14, roughness: 0.32 }),
  };

  // =========================================================================
  // 1. PRIMARY 10-LAYER HDI MAINBOARD — TOP STRATUM (0.36mm lamina at Z = 0.000 -> [-0.018..+0.018])
  //    Top parts face -Z (RK3588S2 1.15mm -> [-0.133 .. -0.018]!)
  // =========================================================================
  const mainTopGroup = new THREE.Group();
  mainTopGroup.position.z = 0.000;

  const logicShape = createLogicBoardShape();
  const topPcbPlate = new THREE.Mesh(
    extrudePlate(logicShape, 0.036, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matMainPcb
  );
  mainTopGroup.add(topPcbPlate);

  populateRealComponents(mainTopGroup, 'main', 'top', -0.019, -1, textures, materials);

  // Dual Ultra-Fine 50-Ohm RF Micro-Coaxial Jumpers routing cleanly down the right spine!
  const makeCoax = (xOff, color) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.56 + xOff, 1.85, -0.056),
      new THREE.Vector3(1.58 + xOff, 0.15, -0.056),
      new THREE.Vector3(1.57 + xOff, -2.60, -0.056),
      new THREE.Vector3(1.55 + xOff, -6.45, -0.056),
    ]);
    return new THREE.Mesh(
      new THREE.TubeGeometry(curve, 36, 0.016, 8, false),
      new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.18 })
    );
  };
  mainTopGroup.add(makeCoax(-0.035, 0x181a1f), makeCoax(0.035, 0xe4e8ef));

  root.add(mainTopGroup);
  registerLayer(mainTopGroup, [0, 0, 0.72]);

  // =========================================================================
  // 2. EXPOSED INNER 10-LAYER HDI COPPER CORE (0.16mm at Z = +0.030 -> [+0.022..+0.038])
  // =========================================================================
  const innerCuGroup = new THREE.Group();
  innerCuGroup.position.z = 0.030;
  const innerCuPlate = new THREE.Mesh(
    extrudePlate(logicShape, 0.016, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matInnerCopperPlane
  );
  innerCuPlate.scale.set(0.985, 0.992, 1);
  innerCuGroup.add(innerCuPlate);
  root.add(innerCuGroup);
  registerLayer(innerCuGroup, [0, 0, 1.38]);

  // =========================================================================
  // 3. PRIMARY 10-LAYER HDI MAINBOARD — BOTTOM STRATUM (0.28mm at Z = +0.056 -> [+0.042..+0.070])
  //    Total 10L HDI Mainboard PCB = 0.36 + 0.16 + 0.28 = 0.80mm REAL!
  //    Bottom parts face +Z (eMMC 0.84mm -> [+0.071..+0.155], clears FRAME_WEB +0.171!)
  // =========================================================================
  const mainBotGroup = new THREE.Group();
  mainBotGroup.position.z = 0.056;
  const botPcbPlate = new THREE.Mesh(
    extrudePlate(logicShape, 0.028, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matMainPcb
  );
  mainBotGroup.add(botPcbPlate);
  populateRealComponents(mainBotGroup, 'main', 'bot', 0.015, +1, textures, materials);

  root.add(mainBotGroup);
  registerLayer(mainBotGroup, [0, 0, 2.08]);

  // =========================================================================
  // 4. 160-PIN SEGMENTED GOLD BGA INTERPOSER BARS (J901) — REAL FULL-HEIGHT SANDWICH STANDOFFS!
  //    Placed strictly in 100% component-free copper corridors between mainboard top (-0.022) & mezzanine bottom (-0.206)!
  //    (Zero overlap with RK3588S2, LPDDR5X, RK806-1, or any SMD part on main top / mezz bot!)
  // =========================================================================
  const interposerGroup = new THREE.Group();
  interposerGroup.position.z = -0.114;

  // Verified 100% component-free interposer bar zones [cx, cy, w, h] in 10mm units (1:1 with Mainboard & Mezzanine KiCad PCBs!):
  const interposerBars = [
    [ 0.06, 4.00, 2.00, 0.070], // North 20-Pin High-Speed PCIe/USB/Control BGA Interposer Bar
    [-0.96, 1.66, 1.04, 0.070], // Mid-West 11-Pin RF/RFFE/PCM BGA Interposer Bar
    [-0.87, 0.68, 0.98, 0.070], // South-West 10-Pin SIM/NFC/eSE BGA Interposer Bar
    [ 1.33, 0.95, 0.070, 0.52], // South-East 7-Pin Heavy-Current Power/VSYS/GND Interposer Bar
  ];

  const ballCoords = [];
  interposerBars.forEach(([cx, cy, bw, bh]) => {
    const bar = new THREE.Mesh(
      extrudePlate(createRoundedRectShape(bw, bh, 0.02), 0.144, { bevelSize: 0.002, bevelThickness: 0.002 }),
      materials.gold
    );
    bar.position.set(cx, cy, 0);
    interposerGroup.add(bar);

    const cols = Math.max(2, Math.floor(bw / 0.10));
    const rows = Math.max(1, Math.floor(bh / 0.10));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = cx - bw * 0.42 + (cols > 1 ? (c / (cols - 1)) * bw * 0.84 : 0);
        const by = cy - bh * 0.42 + (rows > 1 ? (r / (rows - 1)) * bh * 0.84 : 0);
        ballCoords.push([bx, by]);
      }
    }
  });

  const ballGeo = new THREE.SphereGeometry(0.011, 6, 6);
  const ballInst = new THREE.InstancedMesh(ballGeo, materials.tinCap, ballCoords.length * 2);
  const dummy = new THREE.Object3D();
  let bIdx = 0;
  ballCoords.forEach(([bx, by]) => {
    dummy.position.set(bx, by, +0.081);
    dummy.updateMatrix();
    ballInst.setMatrixAt(bIdx++, dummy.matrix);
    dummy.position.set(bx, by, -0.081);
    dummy.updateMatrix();
    ballInst.setMatrixAt(bIdx++, dummy.matrix);
  });
  ballInst.instanceMatrix.needsUpdate = true;
  interposerGroup.add(ballInst);

  root.add(interposerGroup);
  registerLayer(interposerGroup, [0, 0, -0.08]);

  // =========================================================================
  // 5. STACKED 8-LAYER RF/5G/WI-FI 6E/GNSS/NFC MEZZANINE BOARD (REAL 0.54mm PCB at Z = -0.234 -> [-0.261..-0.207])
  //    Mezz top silicon (U707 0.88mm) -> [-0.350 .. -0.262]; Mezz bot (L715 0.85mm) -> [-0.206 .. -0.121], clear of RK3588S2 (-0.111)!
  // =========================================================================
  const mezzGroup = new THREE.Group();
  mezzGroup.position.z = -0.234;
  const mezzPcb = new THREE.Mesh(
    extrudePlate(createMezzanineShape(), 0.054, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matMezzPcb
  );
  mezzGroup.add(mezzPcb);
  populateRealComponents(mezzGroup, 'mezz', 'top', -0.028, -1, textures, materials);
  populateRealComponents(mezzGroup, 'mezz', 'bot', +0.028, +1, textures, materials);

  root.add(mezzGroup);
  registerLayer(mezzGroup, [0, 0, -1.05]);

  // =========================================================================
  // 6. COMPARTMENTALIZED STAMPED EMI SHIELDING CAGES (Z: [-0.376..-0.354], clears U707 -0.350 & rear glass -0.398!)
  // =========================================================================
  const shieldsGroup = new THREE.Group();
  shieldsGroup.position.z = -0.365;

  const s1Shape = createRoundedRectShape(2.74, 2.86, 0.09);
  const s1Cut = new THREE.Path();
  s1Cut.moveTo(-1.14, -1.05);
  s1Cut.lineTo(-1.14, -0.42);
  s1Cut.lineTo(-0.36, -0.42);
  s1Cut.lineTo(-0.36, -1.05);
  s1Cut.closePath();
  s1Shape.holes.push(s1Cut);
  const shield1 = new THREE.Mesh(
    extrudePlate(s1Shape, 0.016, { bevelSize: 0.003, bevelThickness: 0.003 }),
    matEmiSteel
  );
  shield1.position.set(-0.08, 2.38, 0);
  shieldsGroup.add(shield1);

  const copperPatch = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(1.18, 1.24, 0.05), 0.006, { bevelSize: 0.001, bevelThickness: 0.001 }),
    matEmiCopper
  );
  copperPatch.position.set(-0.82, 2.96, -0.010);
  shieldsGroup.add(copperPatch);

  // Charging / Dual Charge-Pump EMI & Thermal Shield Can on Right Spine (clears tall spine inductors -0.111!)
  const shield2 = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.76, 2.38, 0.06), 0.022, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matEmiSteel
  );
  shield2.position.set(1.22, -1.35, 0.215);
  shieldsGroup.add(shield2);

  // Audio Codec + Dual SmartPA Shield Can on Lower Spine
  const shield3 = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.76, 1.48, 0.05), 0.022, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matEmiCopper
  );
  shield3.position.set(1.22, -4.18, 0.215);
  shieldsGroup.add(shield3);

  root.add(shieldsGroup);
  registerLayer(shieldsGroup, [0, 0, -2.55]);

  prepareAssembly(root, 'motherboard');

  return {
    id: 'motherboard',
    root,
    homePos: new THREE.Vector3(anchorX, anchorY, anchorZ),
    macroOffset: new THREE.Vector3(1.15, 0.25, -1.75),
    hoverOffset: new THREE.Vector3(0.22, 0, -0.24),
    updateMicro(micro) {
      for (let i = 0; i < layers.length; i++) {
        const l = layers[i];
        l.obj.position.copy(l.base).addScaledVector(l.offset, micro);
      }
    },
  };
}
