import * as THREE from 'three';

const MM_PER_UNIT = 10.0;
const EPS_UNITS = 0.0005; // 0.005 mm penetration threshold

/**
 * Standard 2D ray-casting point-in-polygon test.
 */
function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    const intersect = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Minimum squared distance from point (px, py) to polygon edges (for bevel margin test).
 */
function distToPolyEdgesSq(px, py, pts) {
  let minSq = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const ax = pts[j][0];
    const ay = pts[j][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 1e-12 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const dSq = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (dSq < minSq) minSq = dSq;
  }
  return minSq;
}

/**
 * Exact 2D solid test for an extruded plate with outer contour, holes, and bevel.
 */
function isPointInExtrudeProfile(lx, ly, profile) {
  const bevel = profile.bevelSize || 0;
  const bevelSq = bevel * bevel;
  let inOuter = pointInPoly(lx, ly, profile.outer);
  if (!inOuter && bevel > 0 && distToPolyEdgesSq(lx, ly, profile.outer) <= bevelSq) {
    inOuter = true;
  }
  if (!inOuter) return false;
  for (let h = 0; h < profile.holes.length; h++) {
    const hole = profile.holes[h];
    if (pointInPoly(lx, ly, hole)) {
      if (bevel > 0 && distToPolyEdgesSq(lx, ly, hole) <= bevelSq) {
        return true; // on inward bevel lip of hole
      }
      return false;
    }
  }
  return true;
}

/**
 * Extract world-space solid collision entries for every mesh (including per-instance InstancedMeshes),
 * tagging each mesh with both its moduleId and its distinct sub-assembly layerId so BOTH inter-module
 * and intra-module (e.g., SoC vs mezzanine, lens vs lens, coil vs rear glass) collisions are caught!
 */
function collectSolidEntries(assemblies) {
  const entries = [];
  const tmpMat = new THREE.Matrix4();
  const worldMat = new THREE.Matrix4();

  assemblies.forEach((asm) => {
    asm.root.updateWorldMatrix(true, true);
    let meshIdx = 0;

    // Determine the logical rigid sub-assembly ancestor for any mesh inside an assembly
    const getLayerKey = (obj) => {
      let cur = obj;
      const chain = [];
      while (cur && cur !== asm.root) {
        if (cur.userData?.layerKey) {
          return `${asm.id}:${cur.userData.layerKey}`;
        }
        chain.push(cur);
        cur = cur.parent;
      }
      if (!chain.length) return `${asm.id}:root`;
      const topChild = chain[chain.length - 1];
      const topIdx = asm.root.children.indexOf(topChild);
      return `${asm.id}:L${topIdx}`;
    };

    asm.root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      meshIdx += 1;
      const geo = obj.geometry;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const baseBox = geo.boundingBox;
      if (!baseBox || baseBox.isEmpty()) return;

      const label = obj.name || `${asm.id}_mesh_${meshIdx}`;
      const layerId = getLayerKey(obj);

      if (obj.isInstancedMesh) {
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, tmpMat);
          worldMat.multiplyMatrices(obj.matrixWorld, tmpMat);
          const box = baseBox.clone().applyMatrix4(worldMat);
          entries.push({
            moduleId: asm.id,
            layerId,
            label: `${label}[${i}]`,
            mesh: obj,
            box,
            invWorld: worldMat.clone().invert(),
            profile: null,
          });
        }
        return;
      }

      const box = baseBox.clone().applyMatrix4(obj.matrixWorld);
      entries.push({
        moduleId: asm.id,
        layerId,
        label,
        mesh: obj,
        box,
        invWorld: obj.matrixWorld.clone().invert(),
        profile: geo.userData?.extrudeProfile || null,
        annular: geo.userData?.annularRing || null,
      });
    });
  });

  return entries;
}

function isPointInAnnular(lx, ly, ann) {
  const r2 = lx * lx + ly * ly;
  return r2 >= ann.innerR * ann.innerR && r2 <= ann.outerR * ann.outerR;
}

/**
 * Test if two entries actually overlap in solid 3D volume (accounting for extruded plate holes/shapes and annular ring bores).
 */
function computeRealIntersection(a, b) {
  const minX = Math.max(a.box.min.x, b.box.min.x);
  const maxX = Math.min(a.box.max.x, b.box.max.x);
  const ovX = maxX - minX;
  if (ovX <= EPS_UNITS) return null;

  const minY = Math.max(a.box.min.y, b.box.min.y);
  const maxY = Math.min(a.box.max.y, b.box.max.y);
  const ovY = maxY - minY;
  if (ovY <= EPS_UNITS) return null;

  const minZ = Math.max(a.box.min.z, b.box.min.z);
  const maxZ = Math.min(a.box.max.z, b.box.max.z);
  const ovZ = maxZ - minZ;
  if (ovZ <= EPS_UNITS) return null;

  if (a.profile || b.profile || a.annular || b.annular) {
    const p = new THREE.Vector3();
    const la = new THREE.Vector3();
    const lb = new THREE.Vector3();
    const midZ = (minZ + maxZ) * 0.5;
    const steps = 11;
    let solidHits = 0;
    let hitMinX = Infinity, hitMaxX = -Infinity, hitMinY = Infinity, hitMaxY = -Infinity;

    for (let ix = 0; ix < steps; ix++) {
      const wx = minX + ((ix + 0.5) / steps) * ovX;
      for (let iy = 0; iy < steps; iy++) {
        const wy = minY + ((iy + 0.5) / steps) * ovY;
        p.set(wx, wy, midZ);

        if (a.profile || a.annular) {
          la.copy(p).applyMatrix4(a.invWorld);
          if (a.profile && !isPointInExtrudeProfile(la.x, la.y, a.profile)) continue;
          if (a.annular && !isPointInAnnular(la.x, la.y, a.annular)) continue;
        }
        if (b.profile || b.annular) {
          lb.copy(p).applyMatrix4(b.invWorld);
          if (b.profile && !isPointInExtrudeProfile(lb.x, lb.y, b.profile)) continue;
          if (b.annular && !isPointInAnnular(lb.x, lb.y, b.annular)) continue;
        }
        solidHits++;
        if (wx < hitMinX) hitMinX = wx;
        if (wx > hitMaxX) hitMaxX = wx;
        if (wy < hitMinY) hitMinY = wy;
        if (wy > hitMaxY) hitMaxY = wy;
      }
    }

    if (solidHits === 0) return null;

    const cellX = ovX / steps;
    const cellY = ovY / steps;
    const rMinX = Math.max(minX, hitMinX - cellX * 0.5);
    const rMaxX = Math.min(maxX, hitMaxX + cellX * 0.5);
    const rMinY = Math.max(minY, hitMinY - cellY * 0.5);
    const rMaxY = Math.min(maxY, hitMaxY + cellY * 0.5);
    const rOvX = rMaxX - rMinX;
    const rOvY = rMaxY - rMinY;
    if (rOvX <= EPS_UNITS || rOvY <= EPS_UNITS) return null;

    return {
      min: new THREE.Vector3(rMinX, rMinY, minZ),
      max: new THREE.Vector3(rMaxX, rMaxY, maxZ),
      ovX: rOvX,
      ovY: rOvY,
      ovZ,
    };
  }

  return {
    min: new THREE.Vector3(minX, minY, minZ),
    max: new THREE.Vector3(maxX, maxY, maxZ),
    ovX,
    ovY,
    ovZ,
  };
}

/**
 * Create the Real-Time X/Y/Z mm Cross-Section Slicer & Box3 Physical Interference Inspector.
 */
export function createInspectionSystem({ renderer, scene, phoneGroup, assemblies, controller }) {
  renderer.localClippingEnabled = true;

  // Shared clipping planes (X, Y, Z in world units; 1 unit = 10 mm)
  const sliceState = {
    x: { enabled: false, mm: 0.0, dir: -1, min: -40.0, max: 40.0, step: 0.1 },
    y: { enabled: false, mm: 0.0, dir: -1, min: -83.0, max: 83.0, step: 0.1 },
    z: { enabled: false, mm: 0.0, dir: -1, min: -9.0, max: 5.2, step: 0.05 },
  };

  const planes = {
    x: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
    y: new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    z: new THREE.Plane(new THREE.Vector3(0, 0, -1), 0),
  };

  // Subtle architectural cut-plane indicator frames in 3D space
  const guideGroup = new THREE.Group();
  guideGroup.name = 'SLICE_GUIDES';
  scene.add(guideGroup);

  const makeGuide = (w, h, color) => {
    const grp = new THREE.Group();
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.055,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })
    );
    grp.add(fill, edge);
    grp.visible = false;
    guideGroup.add(grp);
    return grp;
  };

  const guides = {
    x: makeGuide(2.4, 16.4, 0xd63636),
    y: makeGuide(8.4, 2.4, 0x257a4a),
    z: makeGuide(8.4, 16.4, 0x2563c9),
  };
  guides.x.rotation.y = Math.PI / 2;
  guides.y.rotation.x = Math.PI / 2;

  // Collect all unique materials in phoneGroup and record original side
  const phoneMaterials = new Set();
  phoneGroup.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m) => {
      if (m.userData._origSide === undefined) {
        m.userData._origSide = m.side;
      }
      phoneMaterials.add(m);
    });
  });

  const wirelessAsm = assemblies.find((a) => a.id === 'wireless');

  const applySlicePlanes = () => {
    const activePlanes = [];
    (['x', 'y', 'z']).forEach((axis) => {
      const cfg = sliceState[axis];
      const u = cfg.mm / MM_PER_UNIT;
      const d = cfg.dir; // -1 keeps <= u, +1 keeps >= u
      if (axis === 'x') {
        planes.x.normal.set(d, 0, 0);
        planes.x.constant = -d * u;
        guides.x.position.set(u, 0, 0);
        guides.x.visible = cfg.enabled;
      } else if (axis === 'y') {
        planes.y.normal.set(0, d, 0);
        planes.y.constant = -d * u;
        guides.y.position.set(0, u, 0);
        guides.y.visible = cfg.enabled;
      } else {
        planes.z.normal.set(0, 0, d);
        planes.z.constant = -d * u;
        guides.z.position.set(0, 0, u);
        guides.z.visible = cfg.enabled;
      }
      if (cfg.enabled) activePlanes.push(planes[axis]);
    });

    const isSlicing = activePlanes.length > 0;
    wirelessAsm?.setForceShowInternals?.(isSlicing);

    phoneMaterials.forEach((mat) => {
      mat.clippingPlanes = activePlanes;
      mat.clipShadows = isSlicing;
      // Show solid interior cross-section walls cleanly while slicing
      if (!mat.transparent) {
        mat.side = isSlicing ? THREE.DoubleSide : mat.userData._origSide;
      }
      mat.needsUpdate = true;
    });
  };

  // --- Red 3D Collision Highlight Overlay Group ---
  const collisionGroup = new THREE.Group();
  collisionGroup.name = 'COLLISION_HIGHLIGHTS';
  collisionGroup.visible = false;
  scene.add(collisionGroup);

  const matRedFill = new THREE.MeshBasicMaterial({
    color: 0xff1744,
    transparent: true,
    opacity: 0.42,
    depthTest: false,
    side: THREE.DoubleSide,
  });
  const matRedWire = new THREE.LineBasicMaterial({
    color: 0xd50000,
    depthTest: false,
  });

  let lastAudit = null;
  let highlightEnabled = false;

  const rebuildCollisionVisuals = (audit) => {
    while (collisionGroup.children.length > 0) {
      const ch = collisionGroup.children.pop();
      ch.geometry?.dispose?.();
    }
    if (!audit || !audit.interferences.length) return;

    audit.interferences.forEach((it) => {
      const sx = Math.max(it.overlapXmm / MM_PER_UNIT, 0.03);
      const sy = Math.max(it.overlapYmm / MM_PER_UNIT, 0.03);
      const sz = Math.max(it.overlapZmm / MM_PER_UNIT, 0.03);
      const cx = ((it.boxMinMm[0] + it.boxMaxMm[0]) * 0.5) / MM_PER_UNIT;
      const cy = ((it.boxMinMm[1] + it.boxMaxMm[1]) * 0.5) / MM_PER_UNIT;
      const cz = ((it.boxMinMm[2] + it.boxMaxMm[2]) * 0.5) / MM_PER_UNIT;

      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const fill = new THREE.Mesh(geo, matRedFill);
      fill.position.set(cx, cy, cz);
      fill.renderOrder = 999;

      const wire = new THREE.LineSegments(new THREE.EdgesGeometry(geo), matRedWire);
      wire.position.set(cx, cy, cz);
      wire.renderOrder = 1000;

      collisionGroup.add(fill, wire);
    });
  };

  const auditIntersections = ({ forceClosed = true } = {}) => {
    // Save current state if forcing assembled closed inspection
    const prevState = controller.getState();
    const prevWirelessForce = sliceState.x.enabled || sliceState.y.enabled || sliceState.z.enabled;
    wirelessAsm?.setForceShowInternals?.(true);

    if (forceClosed) {
      controller.snapState({ focusId: null, explode: 0.0, focusMicro: 0.0 });
    }
    phoneGroup.updateWorldMatrix(true, true);

    // 1. Module-level Box3 bounds & thickness summary
    const moduleBounds = {};
    const bodyBox = new THREE.Box3();
    const fullBox = new THREE.Box3();
    const round3 = (n) => Math.round(n * 1000) / 1000;

    assemblies.forEach((asm) => {
      const b = new THREE.Box3().setFromObject(asm.root);
      moduleBounds[asm.id] = {
        minXmm: round3(b.min.x * MM_PER_UNIT),
        maxXmm: round3(b.max.x * MM_PER_UNIT),
        minYmm: round3(b.min.y * MM_PER_UNIT),
        maxYmm: round3(b.max.y * MM_PER_UNIT),
        minZmm: round3(b.min.z * MM_PER_UNIT),
        maxZmm: round3(b.max.z * MM_PER_UNIT),
        sizeXmm: round3((b.max.x - b.min.x) * MM_PER_UNIT),
        sizeYmm: round3((b.max.y - b.min.y) * MM_PER_UNIT),
        sizeZmm: round3((b.max.z - b.min.z) * MM_PER_UNIT),
      };
      fullBox.union(b);
      if (asm.id !== 'camera') {
        bodyBox.union(b);
      }
    });

    // 2. Solid-vs-Solid Inter-Module AND Intra-Module Layer-vs-Layer Interference Detection (ZERO exclusions!)
    const entries = collectSolidEntries(assemblies);
    const interferences = [];
    const intraInterferences = [];

    for (let i = 0; i < entries.length; i++) {
      const a = entries[i];
      for (let j = i + 1; j < entries.length; j++) {
        const b = entries[j];
        if (a.layerId === b.layerId) continue;

        const inter = computeRealIntersection(a, b);
        if (!inter) continue;

        const overlapXmm = round3(inter.ovX * MM_PER_UNIT);
        const overlapYmm = round3(inter.ovY * MM_PER_UNIT);
        const overlapZmm = round3(inter.ovZ * MM_PER_UNIT);
        const minPenetrationMm = round3(Math.min(overlapXmm, overlapYmm, overlapZmm));

        const record = {
          scope: a.moduleId === b.moduleId ? 'intra' : 'inter',
          aModule: a.moduleId,
          aLayer: a.layerId,
          aPart: a.label,
          bModule: b.moduleId,
          bLayer: b.layerId,
          bPart: b.label,
          overlapXmm,
          overlapYmm,
          overlapZmm,
          minPenetrationMm,
          boxMinMm: [
            round3(inter.min.x * MM_PER_UNIT),
            round3(inter.min.y * MM_PER_UNIT),
            round3(inter.min.z * MM_PER_UNIT),
          ],
          boxMaxMm: [
            round3(inter.max.x * MM_PER_UNIT),
            round3(inter.max.y * MM_PER_UNIT),
            round3(inter.max.z * MM_PER_UNIT),
          ],
        };
        interferences.push(record);
        if (record.scope === 'intra') intraInterferences.push(record);
      }
    }

    // Group pair summary by module pair
    const byPair = {};
    interferences.forEach((it) => {
      const key = it.scope === 'intra'
        ? `[INTRA] ${it.aModule} (${it.aLayer} <-> ${it.bLayer})`
        : [it.aModule, it.bModule].sort().join(' <-> ');
      if (!byPair[key]) {
        byPair[key] = { count: 0, maxPenetrationMm: 0, maxOverlapZmm: 0 };
      }
      byPair[key].count++;
      if (it.minPenetrationMm > byPair[key].maxPenetrationMm) {
        byPair[key].maxPenetrationMm = it.minPenetrationMm;
      }
      if (it.overlapZmm > byPair[key].maxOverlapZmm) {
        byPair[key].maxOverlapZmm = it.overlapZmm;
      }
    });

    interferences.sort((u, v) => v.minPenetrationMm - u.minPenetrationMm);

    // 3. Physical Anti-Squash Plausibility Checks (Real Commercial Smartphone Engineering Limits!)
    const batB = moduleBounds.battery;
    // Actual cell pouch footprint excludes upper flex ribbon tail slightly; use conservative pouch Box3 volume
    const batVolCm3 = round3((batB.sizeXmm * batB.sizeYmm * batB.sizeZmm) / 1000);
    const batWh = 23.22; // 6000mAh * 3.87V
    const batWhPerL = round3(batWh / (batVolCm3 / 1000));
    const physicalChecks = {
      batterySizeMm: `${batB.sizeXmm.toFixed(2)} x ${batB.sizeYmm.toFixed(2)} x ${batB.sizeZmm.toFixed(2)}`,
      batteryVolumeCm3: batVolCm3,
      batteryImpliedWhPerL: batWhPerL,
      batteryRealisticSiC: batWhPerL <= 860, // 2026 flagship 10% Si-C pack ceiling ~850 Wh/L
      displayThicknessMm: moduleBounds.display.sizeZmm,
      coolingThicknessMm: moduleBounds.cooling.sizeZmm,
      motherboardStackThicknessMm: moduleBounds.motherboard.sizeZmm,
      wirelessRearThicknessMm: moduleBounds.wireless.sizeZmm,
    };

    const report = {
      bodyWidthMm: round3((bodyBox.max.x - bodyBox.min.x) * MM_PER_UNIT),
      bodyHeightMm: round3((bodyBox.max.y - bodyBox.min.y) * MM_PER_UNIT),
      bodyThicknessMm: round3((bodyBox.max.z - bodyBox.min.z) * MM_PER_UNIT),
      maxThicknessWithCameraMm: round3((fullBox.max.z - fullBox.min.z) * MM_PER_UNIT),
      cameraProtrusionMm: round3((bodyBox.min.z - fullBox.min.z) * MM_PER_UNIT),
      totalCheckedMeshes: entries.length,
      interferenceCount: interferences.length,
      interModuleCount: interferences.length - intraInterferences.length,
      intraModuleCount: intraInterferences.length,
      physicalChecks,
      pairSummary: byPair,
      moduleBounds,
      interferences: interferences.slice(0, 200),
    };

    lastAudit = report;
    rebuildCollisionVisuals(report);

    if (forceClosed && (prevState.explode > 0.001 || prevState.focusedId !== null)) {
      controller.snapState({
        focusId: prevState.focusedId,
        explode: prevState.explode,
        focusMicro: prevState.focusMicro,
      });
    }
    wirelessAsm?.setForceShowInternals?.(prevWirelessForce);
    return report;
  };

  // --- Minimal Architectural Cross-Section & Interference Inspector Panel ---
  const panel = document.createElement('section');
  panel.className = 'slice-dock is-collapsed';
  panel.setAttribute('aria-label', '3D Cross-Section & Interference Inspector');
  panel.innerHTML = `
    <button type="button" class="slice-toggle" id="slice-toggle">断面 / 干渉</button>
    <div class="slice-body" id="slice-body">
      <div class="slice-row">
        <label class="slice-chk"><input type="checkbox" id="slice-x-en" /><span>X</span></label>
        <input type="range" id="slice-x-val" min="-40" max="40" step="0.1" value="0" />
        <span class="slice-mm" id="slice-x-mm">0.0 mm</span>
        <button type="button" class="slice-flip" id="slice-x-dir" title="Flip side">±</button>
      </div>
      <div class="slice-row">
        <label class="slice-chk"><input type="checkbox" id="slice-y-en" /><span>Y</span></label>
        <input type="range" id="slice-y-val" min="-83" max="83" step="0.1" value="0" />
        <span class="slice-mm" id="slice-y-mm">0.0 mm</span>
        <button type="button" class="slice-flip" id="slice-y-dir" title="Flip side">±</button>
      </div>
      <div class="slice-row">
        <label class="slice-chk"><input type="checkbox" id="slice-z-en" /><span>Z</span></label>
        <input type="range" id="slice-z-val" min="-9.0" max="5.2" step="0.05" value="0" />
        <span class="slice-mm" id="slice-z-mm">0.00 mm</span>
        <button type="button" class="slice-flip" id="slice-z-dir" title="Flip side">±</button>
      </div>
      <div class="slice-footer">
        <label class="slice-chk"><input type="checkbox" id="collision-hi" /><span>干渉ハイライト</span></label>
        <span class="slice-stat" id="collision-stat">--</span>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  // Isolate pointer/wheel events on the dock so dragging sliders never orbits the 3D scene
  ['pointerdown', 'pointermove', 'wheel', 'click', 'touchstart'].forEach((ev) => {
    panel.addEventListener(ev, (e) => e.stopPropagation());
  });

  const toggleBtn = panel.querySelector('#slice-toggle');
  const colCheck = panel.querySelector('#collision-hi');
  const colStat = panel.querySelector('#collision-stat');

  const updateStatBadge = (audit) => {
    if (!audit) return;
    const n = audit.interferenceCount;
    colStat.textContent = `${n} 件 · ${audit.bodyThicknessMm.toFixed(2)} / ${audit.maxThicknessWithCameraMm.toFixed(2)} mm`;
    colStat.classList.toggle('has-error', n > 0);
  };

  toggleBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed');
    if (!collapsed && !lastAudit) {
      updateStatBadge(auditIntersections({ forceClosed: false }));
    }
  });

  (['x', 'y', 'z']).forEach((axis) => {
    const en = panel.querySelector(`#slice-${axis}-en`);
    const slider = panel.querySelector(`#slice-${axis}-val`);
    const readout = panel.querySelector(`#slice-${axis}-mm`);
    const dirBtn = panel.querySelector(`#slice-${axis}-dir`);

    const syncUI = () => {
      const cfg = sliceState[axis];
      en.checked = cfg.enabled;
      slider.value = String(cfg.mm);
      readout.textContent = `${cfg.mm.toFixed(axis === 'z' ? 2 : 1)} mm`;
      dirBtn.textContent = cfg.dir < 0 ? '−' : '+';
    };

    en.addEventListener('change', () => {
      sliceState[axis].enabled = en.checked;
      applySlicePlanes();
    });
    slider.addEventListener('input', () => {
      sliceState[axis].mm = parseFloat(slider.value);
      if (!sliceState[axis].enabled) {
        sliceState[axis].enabled = true;
        en.checked = true;
      }
      syncUI();
      applySlicePlanes();
    });
    dirBtn.addEventListener('click', () => {
      sliceState[axis].dir *= -1;
      syncUI();
      applySlicePlanes();
    });
    syncUI();
  });

  const setCollisionHighlight = (enabled) => {
    highlightEnabled = Boolean(enabled);
    colCheck.checked = highlightEnabled;
    if (highlightEnabled) {
      const report = auditIntersections({ forceClosed: false });
      updateStatBadge(report);
      collisionGroup.visible = true;
    } else {
      collisionGroup.visible = false;
    }
  };

  colCheck.addEventListener('change', () => {
    setCollisionHighlight(colCheck.checked);
  });

  const setSlice = (opts = {}) => {
    if (opts.openPanel !== undefined) {
      panel.classList.toggle('is-collapsed', !opts.openPanel);
    }
    (['x', 'y', 'z']).forEach((axis) => {
      if (opts[axis]) {
        const cfg = sliceState[axis];
        if (opts[axis].enabled !== undefined) cfg.enabled = Boolean(opts[axis].enabled);
        if (opts[axis].mm !== undefined) cfg.mm = Number(opts[axis].mm);
        if (opts[axis].dir !== undefined) cfg.dir = opts[axis].dir >= 0 ? 1 : -1;
        panel.querySelector(`#slice-${axis}-en`).checked = cfg.enabled;
        panel.querySelector(`#slice-${axis}-val`).value = String(cfg.mm);
        panel.querySelector(`#slice-${axis}-mm`).textContent = `${cfg.mm.toFixed(axis === 'z' ? 2 : 1)} mm`;
        panel.querySelector(`#slice-${axis}-dir`).textContent = cfg.dir < 0 ? '−' : '+';
      }
    });
    applySlicePlanes();
  };

  // Run initial silent badge update once mounted so collapsed UI is immediately accurate
  return {
    auditIntersections,
    setSlice,
    setCollisionHighlight,
    updateStatBadge,
    getSliceState: () => JSON.parse(JSON.stringify(sliceState)),
  };
}
