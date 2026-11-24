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
 * Stacked 8-Layer RF/LTE/Wi-Fi/GNSS/NFC Mezzanine Board outline (exact 1:1 with hardware/route_mezzanine_rf.mjs).
 */
function createMezzanineShape() {
  const s = new THREE.Shape();
  s.moveTo(-1.80,  0.24);
  s.lineTo( 0.84,  0.24);
  s.lineTo( 0.84, -1.36);
  s.lineTo( 1.58, -1.36);
  s.lineTo( 1.58,  4.52);
  s.lineTo( 1.44,  4.68);
  s.lineTo( 1.14,  4.72);
  s.lineTo(-0.52,  4.72);
  s.lineTo(-0.52,  4.08);
  s.lineTo(-1.80,  4.08);
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
  const h = isMain ? 1536 : 1024;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // Bounding boxes in mm matching extrudePlate normalized planar UVs
  const minX = isMain ? -18.2 : -18.0;
  const maxX = isMain ? 16.6 : 15.8;
  const minY = isMain ? -68.9 : -13.6;
  const maxY = isMain ? 48.1 : 47.2;

  const mapX = (xMm) => ((xMm - minX) / (maxX - minX)) * w;
  const mapY = (yMm) => (1 - (yMm - minY) / (maxY - minY)) * h;

  if (mode === 'inner_copper') {
    // Exposed Inner 14-Layer 3+8+3 Staggered HDI Copper Plane (In7.Cu Split Power Plane: Zone A VDD2L + Zone B VSYS!)
    ctx.fillStyle = '#33281b'; // Shengyi S1000-2M TG170 translucent core dielectric
    ctx.fillRect(0, 0, w, h);

    // Split heavy 1oz (35um) copper power pour islands (VDD2L Zone A, RK3588S2 Core, RK806-1, 6000mAh VSYS/VBAT)
    const pours = [
      [-18.1, 15.5, 17.6, 20.0, '#b86c3b'], // In7.Cu Zone A: LPDDR5X VDD2L_0V9_DDR_S3 solid island
      [  0.2, 15.5, 15.9, 20.0, '#c87742'], // In7.Cu Zone B: RK3588S2 Core / VSYS pour (0.60mm moat)
      [ -3.2,  4.0, 18.8, 10.5, '#b46838'], // RK806-1 Buck power plane
      [  8.4,-22.0,  7.6, 24.0, '#d28048'], // 6000mAh VBAT / VSYS heavy 1oz copper plane
      [  8.4,-67.5,  7.6, 44.0, '#a65f33'], // Spine 3.3V / 1.8V / OLED split planes
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
    (p) =>
      p.board === boardName &&
      p.side === sideFilter &&
      p.kind !== 'interposer' &&
      !/^J901[AB](_MB)?$/.test(p.ref || '')
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
 * RK T4 — Commercial Android 14/15 Flagship 14-Layer 1.20mm 3+8+3 Staggered HDI Mainboard + 8L 0.80mm 5G RF Mezzanine (Rev 5.0 EVT)
 * 1:1 Data-Driven from hardware/rk_t4_netlist.json (741 Total Parts: 617 Main + 109 Mezz + 15 CamMod, 102/102 Real-Silicon ERC Passed!)
 *
 * Deep Dissection Layers:
 *   1. Mainboard Right-Spine Stamped EMI Shield Cans (RF modules use factory-integrated EMI shields)
 *   2. Stacked 8-Layer 0.80mm JLC08081H-1080A RF Mezzanine (111 parts: Quectel EG25-G/EC25-J LTE Cat 4 Dual-Ant, Ampak AP6275P Wi-Fi 6E/BT 5.4,
 *      u-blox MIA-M10Q GNSS, NXP PN7160 NFC, STSAFE-A110 eSE, Azoteq IQS7222A SAR)
 *   3. Dual Mated Hirose DF40C(1.5)-40DS/DP 0.40mm Pitch BTB Connectors (J901A / J901B, 1.50mm mated height)
 *   4. Primary 14-Layer 1.20mm HDI Mainboard Top Component Strata (RK3588S2 1253-ball, 16GB LPDDR5X 496-ball, 3.10mm DDR corridor,
 *      RK806-1 + 10 Buck Inductors, 3x RK860 6A Bucks, TI BQ25895 + BQ27Z561-R2, TUSB546-DCI + FUSB302B, ES8388 + Dual TAS2562YFPR 36-ball SmartPA)
 *   5. Exposed Inner 14-Layer 1oz/1oz Copper Routing & In7.Cu Split Power Plane Core (Zone A VDD2L + Zone B VSYS + 22 PDN Pours)
 *   6. Primary Mainboard Bottom Component Strata (256GB eMMC 5.1 153-FBGA, W25Q128JWPIQ, Dual SY8089, AW8697, ICM-42688-P, VCNL4040, MP34DT05)
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
  // 1. PRIMARY 14-LAYER 1.200mm 3+8+3 STAGGERED HDI MAINBOARD — TOP STRATUM
  //    0.46mm lamina at Z = -0.023 -> [-0.046..0.000]; Top parts face -Z (U101 0.92mm -> [-0.139..-0.047])
  // =========================================================================
  const mainTopGroup = new THREE.Group();
  mainTopGroup.position.z = -0.023;

  const logicShape = createLogicBoardShape();
  const topPcbPlate = new THREE.Mesh(
    extrudePlate(logicShape, 0.046, { bevelSize: 0.005, bevelThickness: 0.005 }),
    matMainPcb
  );
  mainTopGroup.add(topPcbPlate);

  populateRealComponents(mainTopGroup, 'main', 'top', -0.024, -1, textures, materials);

  // Dual Ultra-Fine 50-Ohm RF Micro-Coaxial Jumpers routing cleanly down the right spine!
  const makeCoax = (xOff, color) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(1.56 + xOff, 1.85, -0.064),
      new THREE.Vector3(1.58 + xOff, 0.15, -0.064),
      new THREE.Vector3(1.57 + xOff, -2.60, -0.064),
      new THREE.Vector3(1.55 + xOff, -6.45, -0.064),
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
  // 2. EXPOSED INNER 14-LAYER HDI COPPER CORE (0.24mm at Z = +0.015 -> [+0.003..+0.027])
  // =========================================================================
  const innerCuGroup = new THREE.Group();
  innerCuGroup.position.z = 0.015;
  const innerCuPlate = new THREE.Mesh(
    extrudePlate(logicShape, 0.024, { bevelSize: 0.002, bevelThickness: 0.002 }),
    matInnerCopperPlane
  );
  innerCuPlate.scale.set(0.985, 0.992, 1);
  innerCuGroup.add(innerCuPlate);
  root.add(innerCuGroup);
  registerLayer(innerCuGroup, [0, 0, 1.38]);

  // =========================================================================
  // 3. PRIMARY 14-LAYER HDI MAINBOARD — BOTTOM STRATUM (0.44mm at Z = +0.052 -> [+0.030..+0.074])
  //    Total 14L HDI Mainboard PCB envelope = [-0.046..+0.074] = 1.200 mm EXACT (JLCPCB 14L 3-step)!
  //    Bottom parts face +Z (MK801 0.92mm / eMMC 0.84mm -> [+0.075..+0.167], clears FRAME_WEB +0.171!)
  // =========================================================================
  const mainBotGroup = new THREE.Group();
  mainBotGroup.position.z = 0.052;
  const botPcbPlate = new THREE.Mesh(
    extrudePlate(logicShape, 0.044, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matMainPcb
  );
  mainBotGroup.add(botPcbPlate);
  populateRealComponents(mainBotGroup, 'main', 'bot', 0.023, +1, textures, materials);

  root.add(mainBotGroup);
  registerLayer(mainBotGroup, [0, 0, 2.08]);

  // =========================================================================
  // 4. DUAL HIROSE DF40C(1.5)-40DS/DP 0.4mm PITCH BTB SANDWICH CONNECTORS (J901A / J901B)
  //    Exact 1.50mm mated height between mainboard top (-0.047) & mezzanine bottom (-0.197)!
  // =========================================================================
  const interposerGroup = new THREE.Group();
  interposerGroup.position.z = -0.122;

  const df40Pairs = [
    [-0.96, 1.52], // J901A: Power / Audio / SIM / RFFE / GNSS / NFC / eSE 40-pin DF40C
    [ 0.06, 3.86], // J901B: PCIe Gen2 / USB / UART / SDIO / Wi-Fi / BT 40-pin DF40C
  ];
  const pinGeo = new THREE.BoxGeometry(0.018, 0.040, 0.036);
  const pinInst = new THREE.InstancedMesh(pinGeo, materials.gold, df40Pairs.length * 40);
  const dummy = new THREE.Object3D();
  let pIdx = 0;
  df40Pairs.forEach(([cx, cy]) => {
    // Mainboard Receptacle DF40C-40DS (10.6 x 3.38 x 0.74mm, sits on Mainboard -0.048 .. -0.122)
    const rcpt = new THREE.Mesh(
      extrudePlate(createRoundedRectShape(1.06, 0.338, 0.03), 0.072, { bevelSize: 0.002, bevelThickness: 0.002 }),
      materials.icEpoxy
    );
    rcpt.position.set(cx, cy, +0.037);
    interposerGroup.add(rcpt);

    // Mezzanine Plug DF40C-40DP (9.52 x 2.97 x 0.68mm, sits on Mezzanine -0.126 .. -0.196, 0.04mm mating gap!)
    const plug = new THREE.Mesh(
      extrudePlate(createRoundedRectShape(0.952, 0.297, 0.025), 0.068, { bevelSize: 0.002, bevelThickness: 0.002 }),
      materials.btbGold
    );
    plug.position.set(cx, cy, -0.038);
    interposerGroup.add(plug);

    // 40 gold 0.40mm-pitch gull-wing solder leads per connector
    for (let i = 0; i < 20; i++) {
      const lx = cx - 0.38 + i * 0.040;
      dummy.position.set(lx, cy + 0.165, +0.056);
      dummy.updateMatrix();
      pinInst.setMatrixAt(pIdx++, dummy.matrix);
      dummy.position.set(lx, cy - 0.165, +0.056);
      dummy.updateMatrix();
      pinInst.setMatrixAt(pIdx++, dummy.matrix);
    }
  });
  pinInst.instanceMatrix.needsUpdate = true;
  interposerGroup.add(pinInst);

  root.add(interposerGroup);
  registerLayer(interposerGroup, [0, 0, -0.08]);

  // =========================================================================
  // 5. STACKED 8-LAYER 0.800mm JLC08081H-1080A RF MEZZANINE BOARD (Z = -0.237 -> [-0.277..-0.197])
  //    Mezz bot (U716 0.55mm -> [-0.196..-0.141]) clears U101 (-0.139)!
  //    Mezz top (EG25-G/EC25-J 2.40mm integrated shield -> [-0.518..-0.278]) clears NFC (-0.530)!
  // =========================================================================
  const mezzGroup = new THREE.Group();
  mezzGroup.position.z = -0.237;
  const mezzPcb = new THREE.Mesh(
    extrudePlate(createMezzanineShape(), 0.080, { bevelSize: 0.006, bevelThickness: 0.006 }),
    matMezzPcb
  );
  mezzGroup.add(mezzPcb);
  populateRealComponents(mezzGroup, 'mezz', 'top', -0.041, -1, textures, materials);
  populateRealComponents(mezzGroup, 'mezz', 'bot', +0.041, +1, textures, materials);

  root.add(mezzGroup);
  registerLayer(mezzGroup, [0, 0, -1.05]);

  // =========================================================================
  // 6. MAINBOARD RIGHT-SPINE EMI SHIELD CANS (EG25-G/EC25-J, AP6275P & MIA-M10Q have integrated factory shields!)
  // =========================================================================
  const shieldsGroup = new THREE.Group();
  shieldsGroup.position.z = -0.164;

  // Charging / Dual Charge-Pump EMI & Thermal Shield Can on Right Spine (world Z: -0.164, clears tall spine inductors -0.139!)
  const shield2 = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.76, 2.38, 0.06), 0.022, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matEmiSteel
  );
  shield2.position.set(1.22, -1.35, 0);
  shieldsGroup.add(shield2);

  // Audio Codec + Dual SmartPA Shield Can on Lower Spine
  const shield3 = new THREE.Mesh(
    extrudePlate(createRoundedRectShape(0.76, 1.48, 0.05), 0.022, { bevelSize: 0.004, bevelThickness: 0.004 }),
    matEmiCopper
  );
  shield3.position.set(1.22, -4.18, 0);
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
