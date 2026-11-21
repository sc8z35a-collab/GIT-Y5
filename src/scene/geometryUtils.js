import * as THREE from 'three';

/**
 * Create a smooth rounded rectangle THREE.Shape centered at (cx, cy).
 */
export function createRoundedRectShape(w, h, r, cx = 0, cy = 0) {
  const shape = new THREE.Shape();
  const radius = Math.min(r, w * 0.499, h * 0.499);
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;

  shape.moveTo(x0 + radius, y0);
  shape.lineTo(x1 - radius, y0);
  shape.absarc(x1 - radius, y0 + radius, radius, -Math.PI / 2, 0, false);
  shape.lineTo(x1, y1 - radius);
  shape.absarc(x1 - radius, y1 - radius, radius, 0, Math.PI / 2, false);
  shape.lineTo(x0 + radius, y1);
  shape.absarc(x0 + radius, y1 - radius, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(x0, y0 + radius);
  shape.absarc(x0 + radius, y0 + radius, radius, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/**
 * Create a rounded rectangle THREE.Path (clockwise for holes) centered at (cx, cy).
 */
export function createRoundedRectHole(w, h, r, cx = 0, cy = 0) {
  const path = new THREE.Path();
  const radius = Math.min(r, w * 0.499, h * 0.499);
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;

  path.moveTo(x0 + radius, y0);
  path.absarc(x0 + radius, y0 + radius, radius, Math.PI * 1.5, Math.PI, true);
  path.lineTo(x0, y1 - radius);
  path.absarc(x0 + radius, y1 - radius, radius, Math.PI, Math.PI / 2, true);
  path.lineTo(x1 - radius, y1);
  path.absarc(x1 - radius, y1 - radius, radius, Math.PI / 2, 0, true);
  path.lineTo(x1, y0 + radius);
  path.absarc(x1 - radius, y0 + radius, radius, 0, -Math.PI / 2, true);
  path.closePath();
  return path;
}

/**
 * Create a circular THREE.Path hole centered at (cx, cy).
 */
export function createCircleHole(radius, cx = 0, cy = 0) {
  const path = new THREE.Path();
  path.absarc(cx, cy, radius, 0, Math.PI * 2, true);
  return path;
}

/**
 * Normalize planar XY UVs to [0, 1] across the bounding box of a BufferGeometry.
 * Crucial so procedural high-res canvas textures align 1:1 on extruded shapes.
 */
export function normalizePlanarUVs(geometry, flipX = false) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const sizeX = Math.max(box.max.x - box.min.x, 1e-5);
  const sizeY = Math.max(box.max.y - box.min.y, 1e-5);
  const pos = geometry.attributes.position;
  const uv = geometry.attributes.uv;

  for (let i = 0; i < pos.count; i++) {
    let u = (pos.getX(i) - box.min.x) / sizeX;
    if (flipX) u = 1.0 - u;
    const v = (pos.getY(i) - box.min.y) / sizeY;
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
  return geometry;
}

/**
 * Precision extruded plate centered cleanly at Z = 0, with normalized UVs.
 */
export function extrudePlate(shape, depth, {
  bevelSize = 0.012,
  bevelThickness = 0.012,
  bevelSegments = 4,
  curveSegments = 36,
  flipUVX = false,
} = {}) {
  const bevelEnabled = bevelSize > 0 && bevelThickness > 0;
  const coreDepth = Math.max(depth - (bevelEnabled ? bevelThickness * 2 : 0), 0.002);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: coreDepth,
    bevelEnabled,
    bevelSize,
    bevelThickness,
    bevelSegments,
    curveSegments,
  });
  geo.translate(0, 0, -coreDepth / 2);
  normalizePlanarUVs(geo, flipUVX);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Build a true precision spherical/aspherical optical glass lens using LatheGeometry.
 * Oriented along the Z-axis (optical axis = Z, front surface faces -Z for rear camera or +Z if flipped).
 * frontSag > 0 means convex outward toward -Z; < 0 means concave inward.
 * backSag  > 0 means convex outward toward +Z; < 0 means concave inward.
 */
export function createOpticalLensGeometry({
  radius = 0.72,
  edgeThickness = 0.08,
  frontSag = 0.14,
  backSag = 0.06,
  asphereFront = 0.0,
  asphereBack = 0.0,
  radialSteps = 24,
  circumSegments = 56,
} = {}) {
  const pts = [];
  const halfEdge = edgeThickness / 2;

  // Front optical surface (-Z side, going from axis r=0 out to rim r=radius)
  for (let i = 0; i <= radialSteps; i++) {
    const t = i / radialSteps;
    const r = t * radius;
    const r2 = t * t;
    const r4 = r2 * r2;
    const z = -halfEdge - frontSag * (1 - r2) - asphereFront * (r2 - r4);
    pts.push(new THREE.Vector2(r, z));
  }

  // Rim bevel + optical cylinder edge
  pts.push(new THREE.Vector2(radius, -halfEdge + 0.006));
  pts.push(new THREE.Vector2(radius, halfEdge - 0.006));

  // Back optical surface (+Z side, going from rim r=radius back to axis r=0)
  for (let i = radialSteps; i >= 0; i--) {
    const t = i / radialSteps;
    const r = t * radius;
    const r2 = t * t;
    const r4 = r2 * r2;
    const z = halfEdge + backSag * (1 - r2) + asphereBack * (r2 - r4);
    pts.push(new THREE.Vector2(r, z));
  }

  // LatheGeometry revolves around Y-axis; rotate +90deg around X so optical axis aligns with Z!
  const geo = new THREE.LatheGeometry(pts, circumSegments);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a precision stepped annular metal lens barrel/retainer ring along Z.
 */
export function createLensRingGeometry(innerR, outerR, height, bevel = 0.012, segments = 64) {
  const h = height / 2;
  const b = Math.min(bevel, (outerR - innerR) * 0.3, h * 0.4);
  const pts = [
    new THREE.Vector2(innerR, -h),
    new THREE.Vector2(outerR - b, -h),
    new THREE.Vector2(outerR, -h + b),
    new THREE.Vector2(outerR, h - b),
    new THREE.Vector2(outerR - b, h),
    new THREE.Vector2(innerR, h),
    new THREE.Vector2(innerR, -h),
  ];
  const geo = new THREE.LatheGeometry(pts, segments);
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Create a realistic 3D multi-turn planar spiral copper wire coil (XY plane).
 */
export function createSpiralCoilGeometry({
  innerR = 0.88,
  outerR = 1.92,
  turns = 14,
  wireRadius = 0.022,
  samplesPerTurn = 48,
  radialSegments = 8,
} = {}) {
  const totalSamples = Math.floor(turns * samplesPerTurn);
  const points = [];
  for (let i = 0; i <= totalSamples; i++) {
    const t = i / totalSamples;
    const angle = t * turns * Math.PI * 2;
    const r = innerR + (outerR - innerR) * t;
    points.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, 0));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  return new THREE.TubeGeometry(curve, totalSamples, wireRadius, radialSegments, false);
}

/**
 * Build delicate 3D arched micro gold bond wires connecting a silicon CMOS die to its ceramic package.
 */
export function createBondWiresGroup({
  dieW = 0.94,
  dieH = 0.74,
  pkgW = 1.24,
  pkgH = 1.04,
  wiresPerLongSide = 14,
  wiresPerShortSide = 10,
  arcHeight = 0.085,
  wireRadius = 0.0055,
  material,
}) {
  const group = new THREE.Group();
  const makeWire = (p0, p2) => {
    const mid1 = new THREE.Vector3(
      THREE.MathUtils.lerp(p0.x, p2.x, 0.25),
      THREE.MathUtils.lerp(p0.y, p2.y, 0.25),
      -arcHeight
    );
    const mid2 = new THREE.Vector3(
      THREE.MathUtils.lerp(p0.x, p2.x, 0.72),
      THREE.MathUtils.lerp(p0.y, p2.y, 0.72),
      -arcHeight * 0.78
    );
    const curve = new THREE.CubicBezierCurve3(p0, mid1, mid2, p2);
    const geo = new THREE.TubeGeometry(curve, 10, wireRadius, 5, false);
    return new THREE.Mesh(geo, material);
  };

  // Top & Bottom edges
  for (let i = 0; i < wiresPerLongSide; i++) {
    const t = (i + 0.5) / wiresPerLongSide - 0.5;
    const xDie = t * (dieW * 0.88);
    const xPkg = t * (pkgW * 0.88);
    group.add(makeWire(
      new THREE.Vector3(xDie, dieH * 0.47, -0.008),
      new THREE.Vector3(xPkg, pkgH * 0.44, 0.005)
    ));
    group.add(makeWire(
      new THREE.Vector3(xDie, -dieH * 0.47, -0.008),
      new THREE.Vector3(xPkg, -pkgH * 0.44, 0.005)
    ));
  }
  // Left & Right edges
  for (let i = 0; i < wiresPerShortSide; i++) {
    const t = (i + 0.5) / wiresPerShortSide - 0.5;
    const yDie = t * (dieH * 0.86);
    const yPkg = t * (pkgH * 0.86);
    group.add(makeWire(
      new THREE.Vector3(-dieW * 0.47, yDie, -0.008),
      new THREE.Vector3(-pkgW * 0.44, yPkg, 0.005)
    ));
    group.add(makeWire(
      new THREE.Vector3(dieW * 0.47, yDie, -0.008),
      new THREE.Vector3(pkgW * 0.44, yPkg, 0.005)
    ));
  }
  return group;
}

/**
 * Create a precision flat FPC flex ribbon following a 3D spline.
 */
export function createFlexRibbon(controlPoints, width = 0.34, thickness = 0.012, material) {
  const curve = new THREE.CatmullRomCurve3(controlPoints);
  const segs = 32;
  const frames = curve.computeFrenetFrames(segs, false);
  const positions = [];
  const uvs = [];
  const indices = [];

  const hw = width / 2;
  const ht = thickness / 2;

  for (let i = 0; i <= segs; i++) {
    const p = curve.getPointAt(i / segs);
    // Use stable cross-section normal so ribbon doesn't twist wildly
    const tangent = frames.tangents[i];
    let up = new THREE.Vector3(0, 0, 1);
    if (Math.abs(tangent.dot(up)) > 0.92) up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, tangent).normalize();
    const normal = new THREE.Vector3().crossVectors(tangent, right).normalize();

    const corners = [
      p.clone().addScaledVector(right, -hw).addScaledVector(normal, ht),
      p.clone().addScaledVector(right,  hw).addScaledVector(normal, ht),
      p.clone().addScaledVector(right,  hw).addScaledVector(normal, -ht),
      p.clone().addScaledVector(right, -hw).addScaledVector(normal, -ht),
    ];
    for (let c = 0; c < 4; c++) {
      positions.push(corners[c].x, corners[c].y, corners[c].z);
      uvs.push(c === 1 || c === 2 ? 1 : 0, i / segs);
    }
    if (i < segs) {
      const a = i * 4;
      const b = (i + 1) * 4;
      for (let c = 0; c < 4; c++) {
        const cn = (c + 1) % 4;
        indices.push(a + c, a + cn, b + cn);
        indices.push(a + c, b + cn, b + c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}

/**
 * Create a sinusoidal metallic leaf-spring flexure for the X-axis linear haptic engine.
 */
export function createLeafSpringGeometry(length = 1.25, height = 0.24, amplitude = 0.065, waves = 3.5) {
  const shape = new THREE.Shape();
  const steps = 48;
  const thick = 0.018;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = (t - 0.5) * length;
    const x = Math.sin(t * Math.PI * 2 * waves) * amplitude;
    if (i === 0) shape.moveTo(x - thick / 2, y);
    else shape.lineTo(x - thick / 2, y);
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps;
    const y = (t - 0.5) * length;
    const x = Math.sin(t * Math.PI * 2 * waves) * amplitude;
    shape.lineTo(x + thick / 2, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  geo.translate(0, 0, -height / 2);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Recursively tag all meshes under an assembly with a partId and clone/record
 * baseline material opacity/transparency so smooth focus-isolation fading never corrupts materials.
 */
export function prepareAssembly(rootGroup, partId) {
  const matSet = new Set();
  rootGroup.userData.partId = partId;
  rootGroup.traverse((obj) => {
    obj.userData.partId = partId;
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m) return;
        if (m.userData.baseOpacity === undefined) {
          m.userData.baseOpacity = m.opacity;
          m.userData.baseTransparent = m.transparent;
          m.userData.baseDepthWrite = m.depthWrite;
        }
        matSet.add(m);
      });
    }
  });
  rootGroup.userData.materials = Array.from(matSet);
  return rootGroup;
}

/**
 * Set normalized visibility alpha [0..1] for an entire subsystem smoothly.
 */
export function setAssemblyAlpha(rootGroup, alpha) {
  const clamped = THREE.MathUtils.clamp(alpha, 0, 1);
  if (clamped < 0.015) {
    rootGroup.visible = false;
    return;
  }
  rootGroup.visible = true;
  const mats = rootGroup.userData.materials || [];
  const faded = clamped < 0.992;
  for (let i = 0; i < mats.length; i++) {
    const m = mats[i];
    const baseOp = m.userData.baseOpacity ?? 1;
    const baseTr = m.userData.baseTransparent ?? false;
    const baseDw = m.userData.baseDepthWrite ?? true;
    const nextOp = baseOp * clamped;
    if (Math.abs(m.opacity - nextOp) > 0.002) {
      m.opacity = nextOp;
    }
    const wantTr = baseTr || faded;
    if (m.transparent !== wantTr) {
      m.transparent = wantTr;
      m.depthWrite = wantTr && !baseTr ? false : baseDw;
      m.needsUpdate = true;
    }
  }
}

export function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function easeOutCubic(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}
