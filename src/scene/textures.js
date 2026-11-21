import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { canvas: c, ctx: c.getContext('2d') };
}

function toTexture(canvas, { color = true, anisotropy = 8, repeat = [1, 1], clamp = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.wrapS = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  tex.wrapT = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  if (!clamp) tex.repeat.set(repeat[0], repeat[1]);
  tex.needsUpdate = true;
  return tex;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fast pixel-buffer grain overlay onto an existing CanvasRenderingContext2D (~2ms).
 */
function addFastMicroGrain(ctx, x0, y0, w, h, amplitude, seed) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data;
  let s = seed >>> 0;
  for (let i = 0; i < d.length; i += 4) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const n = (((s >>> 24) / 255) - 0.5) * amplitude;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, x0, y0);
}

/**
 * Fine brushed Grade-5 titanium directional texture (albedo + roughness).
 */
export function createBrushedTitaniumTextures() {
  const w = 256, h = 256;
  const { canvas: cA, ctx: ctxA } = makeCanvas(w, h);
  const { canvas: cR, ctx: ctxR } = makeCanvas(w, h);
  const rand = mulberry32(101);

  for (let y = 0; y < h; y++) {
    const v = (rand() - 0.5) * 16;
    const base = Math.round(192 + v);
    ctxA.fillStyle = `rgb(${base + 2},${base},${base - 4})`;
    ctxA.fillRect(0, y, w, 1);

    const rv = Math.round(78 + (rand() - 0.5) * 28);
    ctxR.fillStyle = `rgb(${rv},${rv},${rv})`;
    ctxR.fillRect(0, y, w, 1);
  }
  for (let i = 0; i < 220; i++) {
    const x = rand() * w;
    const y = rand() * h;
    const len = 24 + rand() * 110;
    const alpha = 0.05 + rand() * 0.08;
    ctxA.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(38,40,44,${alpha})`;
    ctxA.fillRect(x, y, len, 1);
  }

  return {
    map: toTexture(cA, { color: true }),
    roughnessMap: toTexture(cR, { color: false }),
  };
}

/**
 * Matte satin architectural graphite ceramic rear glass with whisper-subtle glossy "RK" emblem.
 */
export function createRearCeramicTextures() {
  const w = 512, h = 1024;
  const { canvas: cA, ctx: ctxA } = makeCanvas(w, h);
  const { canvas: cR, ctx: ctxR } = makeCanvas(w, h);

  const grad = ctxA.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#2a2d34');
  grad.addColorStop(0.5, '#24272e');
  grad.addColorStop(1, '#1f2228');
  ctxA.fillStyle = grad;
  ctxA.fillRect(0, 0, w, h);
  addFastMicroGrain(ctxA, 0, 0, w, h, 3.5, 202);

  ctxR.fillStyle = '#6c6c6c';
  ctxR.fillRect(0, 0, w, h);
  addFastMicroGrain(ctxR, 0, 0, w, h, 7, 203);

  // Subtle mirror-gloss RK physical monogram on center-lower rear
  ctxA.fillStyle = 'rgba(208, 213, 224, 0.24)';
  ctxA.font = '300 40px "Helvetica Neue", Arial, sans-serif';
  ctxA.textAlign = 'center';
  ctxA.textBaseline = 'middle';
  ctxA.fillText('R K', w * 0.5, h * 0.53);

  ctxR.fillStyle = '#141414';
  ctxR.font = '300 40px "Helvetica Neue", Arial, sans-serif';
  ctxR.textAlign = 'center';
  ctxR.textBaseline = 'middle';
  ctxR.fillText('R K', w * 0.5, h * 0.53);

  return {
    map: toTexture(cA, { color: true, clamp: true }),
    roughnessMap: toTexture(cR, { color: false, clamp: true }),
  };
}

/**
 * Circular physical micro-engraved 45MP camera bezel ring texture.
 */
export function createCameraBezelRingTexture() {
  const size = 1024;
  const { canvas, ctx } = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#181a1f';
  ctx.fillRect(0, 0, size, size);

  for (let r = 240; r < 500; r += 5) {
    const shade = 26 + Math.round(Math.sin(r * 0.35) * 6);
    ctx.strokeStyle = `rgb(${shade},${shade + 1},${shade + 4})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Fine hairline champagne-titanium accent ring
  ctx.strokeStyle = 'rgba(205, 184, 148, 0.65)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 444, 0, Math.PI * 2);
  ctx.stroke();

  const drawArcText = (str, radius, startAngle, step) => {
    ctx.save();
    ctx.font = '500 26px "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = 'rgba(224, 227, 234, 0.84)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < str.length; i++) {
      const a = startAngle + i * step;
      ctx.save();
      ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
      ctx.rotate(a + Math.PI / 2);
      ctx.fillText(str[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  };

  drawArcText('RK OPTICS  45MP  f/1.6  1/1.28"  ASPH  OIS', 402, -Math.PI * 0.88, 0.062);

  ctx.strokeStyle = 'rgba(185, 190, 200, 0.50)';
  ctx.lineWidth = 2.2;
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * 0.22 + (i / 24) * Math.PI * 0.56;
    const r0 = 392;
    const r1 = i % 6 === 0 ? 418 : 406;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * 45MP Large-Format CMOS Image Sensor active silicon die texture:
 * Fast pixel-buffer Bayer RGGB micro-lens diffraction grid + column readout + gold bond pads.
 */
export function createCmosSensorTexture() {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);

  ctx.fillStyle = '#14171d';
  ctx.fillRect(0, 0, size, size);

  // Gold peripheral bond pads
  const padInset = 12;
  ctx.fillStyle = '#dab55e';
  const count = 20;
  for (let i = 0; i < count; i++) {
    const t = 44 + (i / (count - 1)) * (size - 88);
    ctx.fillRect(t - 4, padInset, 8, 14);
    ctx.fillRect(t - 4, size - padInset - 14, 8, 14);
    ctx.fillRect(padInset, t - 4, 14, 8);
    ctx.fillRect(size - padInset - 14, t - 4, 14, 8);
  }

  // Peripheral readout ADC bands
  ctx.fillStyle = '#202836';
  ctx.fillRect(36, 36, size - 72, size - 72);
  ctx.fillStyle = '#40566e';
  for (let x = 56; x < size - 56; x += 8) {
    ctx.fillRect(x, 42, 3, 22);
    ctx.fillRect(x, size - 64, 3, 22);
  }
  for (let y = 70; y < size - 70; y += 8) {
    ctx.fillRect(42, y, 20, 3);
    ctx.fillRect(size - 62, y, 20, 3);
  }

  // Fast pixel-buffer iridescent 45MP Bayer RGGB micro-lens active silicon die!
  const ax = 68, ay = 68, aw = size - 136, ah = size - 136;
  const img = ctx.createImageData(aw, ah);
  const d = img.data;
  for (let y = 0; y < ah; y++) {
    for (let x = 0; x < aw; x++) {
      const idx = (y * aw + x) * 4;
      const u = x / aw;
      const v = y / ah;
      // Spectral silicon wafer thin-film shimmer
      const diag = (u + v) * 3.2;
      let r = 28 + Math.sin(diag * 2.4 + 0.4) * 26 + 18;
      let g = 56 + Math.sin(diag * 2.4 + 2.2) * 34 + 22;
      let b = 82 + Math.sin(diag * 2.4 + 4.1) * 38 + 28;

      // Micro-lens Bayer RGGB sub-cell structure (4x4px cell)
      const mx = x & 3;
      const my = y & 3;
      if (mx === 0 || my === 0) {
        r *= 0.62; g *= 0.62; b *= 0.62;
      } else {
        const bx = (x >> 2) & 1;
        const by = (y >> 2) & 1;
        if (bx === 0 && by === 0) { r += 44; }
        else if (bx === 1 && by === 1) { b += 56; }
        else { g += 48; }
      }
      d[idx] = Math.min(255, Math.max(0, r));
      d[idx + 1] = Math.min(255, Math.max(0, g));
      d[idx + 2] = Math.min(255, Math.max(0, b));
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, ax, ay);

  ctx.strokeStyle = 'rgba(225, 192, 110, 0.80)';
  ctx.lineWidth = 2;
  ctx.strokeRect(ax, ay, aw, ah);

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * Dedicated RK-ISP45 Neural Imaging Processing Silicon Die Texture.
 */
export function createIspDieTexture() {
  const size = 512;
  const { canvas, ctx } = makeCanvas(size, size);
  const rand = mulberry32(303);

  ctx.fillStyle = '#181c24';
  ctx.fillRect(0, 0, size, size);

  const blocks = [
    [32, 32, 190, 130, '#2a3e56'],
    [234, 32, 246, 130, '#243548'],
    [32, 174, 140, 160, '#362d4f'],
    [184, 174, 150, 160, '#23404a'],
    [346, 174, 134, 160, '#2f3d54'],
    [32, 346, 270, 134, '#223344'],
    [314, 346, 166, 134, '#363b52'],
  ];

  blocks.forEach(([bx, by, bw, bh, col]) => {
    ctx.fillStyle = col;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(198, 168, 112, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = 'rgba(210, 228, 250, 0.12)';
    const sx = 8 + Math.floor(rand() * 8);
    const sy = 6 + Math.floor(rand() * 6);
    for (let y = by + 5; y < by + bh - 5; y += sy) {
      for (let x = bx + 5; x < bx + bw - 5; x += sx) {
        if (rand() > 0.25) ctx.fillRect(x, y, sx - 2, sy - 2);
      }
    }
  });

  // High-speed copper internal bus lines
  ctx.strokeStyle = 'rgba(222, 170, 98, 0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 10; i++) {
    const yy = 164 + i * 1.2;
    ctx.beginPath();
    ctx.moveTo(32, yy);
    ctx.lineTo(480, yy);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(232, 236, 244, 0.72)';
  ctx.font = '600 24px "Helvetica Neue", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('RK-ISP45', size * 0.5, size * 0.5);

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * High-Density Interconnect (HDI) Matte-Obsidian Motherboard PCB Texture
 * with dense ENIG gold traces, differential buses, micro-vias, and pads.
 */
export function createMotherboardPcbTexture() {
  const w = 512, h = 1024;
  const { canvas, ctx } = makeCanvas(w, h);
  const rand = mulberry32(404);

  ctx.fillStyle = '#15191e';
  ctx.fillRect(0, 0, w, h);

  // Internal copper pour islands beneath matte black solder mask
  ctx.fillStyle = '#1d252b';
  for (let i = 0; i < 36; i++) {
    ctx.fillRect(rand() * w, rand() * h, 28 + rand() * 90, 24 + rand() * 110);
  }

  const drawTraceBus = (x0, y0, count, len, horizontal, color, spacing = 5) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      if (horizontal) {
        const y = y0 + i * spacing;
        ctx.moveTo(x0, y);
        ctx.lineTo(x0 + len * 0.45, y);
        ctx.lineTo(x0 + len * 0.55, y + 10);
        ctx.lineTo(x0 + len, y + 10);
      } else {
        const x = x0 + i * spacing;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + len * 0.42);
        ctx.lineTo(x + 10, y0 + len * 0.52);
        ctx.lineTo(x + 10, y0 + len);
      }
    }
    ctx.stroke();
  };

  for (let i = 0; i < 32; i++) {
    const horiz = rand() > 0.5;
    const col = rand() > 0.35 ? 'rgba(72, 102, 96, 0.72)' : 'rgba(212, 172, 92, 0.48)';
    drawTraceBus(
      rand() * (w - 110),
      rand() * (h - 130),
      3 + Math.floor(rand() * 8),
      55 + rand() * 180,
      horiz,
      col,
      4.5
    );
  }

  // ENIG Gold-plated micro-vias
  ctx.fillStyle = '#d4ad5a';
  for (let i = 0; i < 420; i++) {
    const vx = 14 + rand() * (w - 28);
    const vy = 14 + rand() * (h - 28);
    ctx.fillRect(vx - 1.5, vy - 1.5, 3, 3);
  }

  // Gold test points
  for (let i = 0; i < 34; i++) {
    ctx.beginPath();
    ctx.arc(24 + rand() * (w - 48), 24 + rand() * (h - 48), 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Crisp subtle white technical silkscreen boxes
  ctx.strokeStyle = 'rgba(218, 224, 232, 0.28)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 28; i++) {
    ctx.strokeRect(20 + rand() * (w - 90), 20 + rand() * (h - 90), 18 + rand() * 60, 14 + rand() * 60);
  }

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * 6000mAh Dual-Cell Silicon-Carbon Battery Outer Aluminum-Laminated Pouch Texture.
 */
export function createBatteryPouchTexture() {
  const w = 768, h = 990;
  const { canvas: cA, ctx: ctxA } = makeCanvas(w, h);
  const { canvas: cR, ctx: ctxR } = makeCanvas(w, h);
  const rand = mulberry32(505);

  ctxA.fillStyle = '#1c1e24';
  ctxA.fillRect(0, 0, w, h);
  ctxR.fillStyle = '#686868';
  ctxR.fillRect(0, 0, w, h);

  // Dual-cell central molded seam
  const seamGrad = ctxA.createLinearGradient(w * 0.46, 0, w * 0.54, 0);
  seamGrad.addColorStop(0, 'rgba(0,0,0,0)');
  seamGrad.addColorStop(0.5, 'rgba(8,9,12,0.82)');
  seamGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctxA.fillStyle = seamGrad;
  ctxA.fillRect(w * 0.46, 52, w * 0.08, h - 104);

  // Heat-sealed foil border flange
  ctxA.strokeStyle = '#2a2e37';
  ctxA.lineWidth = 22;
  ctxA.strokeRect(14, 14, w - 28, h - 28);
  ctxR.strokeStyle = '#3a3a3a';
  ctxR.lineWidth = 22;
  ctxR.strokeRect(14, 14, w - 28, h - 28);

  addFastMicroGrain(ctxA, 0, 0, w, h, 7, 506);

  // Crisp laser-etched physical hardware specification printed directly on the 6000mAh cell
  ctxA.fillStyle = 'rgba(222, 226, 234, 0.88)';
  ctxA.font = '500 42px "Helvetica Neue", Arial, sans-serif';
  ctxA.textAlign = 'left';
  ctxA.fillText('RK', 68, 126);

  ctxA.fillStyle = 'rgba(238, 240, 245, 0.94)';
  ctxA.font = '400 56px "Helvetica Neue", Arial, sans-serif';
  ctxA.fillText('6000 mAh', 68, 214);

  ctxA.fillStyle = 'rgba(168, 174, 186, 0.82)';
  ctxA.font = '400 21px "Helvetica Neue", monospace';
  ctxA.fillText('TYP 23.22 Wh  ·  3.87 V', 68, 258);
  ctxA.fillText('DUAL-CELL SILICON-CARBON LI-ION', 68, 290);

  ctxA.strokeStyle = 'rgba(160, 168, 180, 0.38)';
  ctxA.lineWidth = 1.5;
  ctxA.beginPath();
  ctxA.moveTo(68, 322);
  ctxA.lineTo(w - 68, 322);
  ctxA.stroke();

  ctxA.fillStyle = 'rgba(155, 162, 174, 0.72)';
  ctxA.font = '500 18px "Helvetica Neue", monospace';
  ctxA.fillText('CELL A · 3000mAh', 68, 360);
  ctxA.fillText('CELL B · 3000mAh', w * 0.55, 360);

  ctxA.fillStyle = 'rgba(222, 168, 98, 0.80)';
  ctxA.font = '600 26px monospace';
  ctxA.fillText('+', 96, 74);
  ctxA.fillText('−', w - 114, 74);

  ctxA.fillStyle = 'rgba(176, 182, 194, 0.48)';
  for (let x = 68; x < 316; x += 6) {
    ctxA.fillRect(x, h - 134, rand() > 0.55 ? 3 : 1.5, 36);
  }
  ctxA.font = '400 17px monospace';
  ctxA.fillText('T4-B6000-SC26', 68, h - 78);

  return {
    map: toTexture(cA, { color: true, clamp: true }),
    roughnessMap: toTexture(cR, { color: false, clamp: true }),
  };
}

/**
 * Internal Battery Electrochemistry Textures (fast pixel buffer):
 *  - 'anode': Pure metallic copper foil margin + silicon-carbon active graphite coating
 *  - 'cathode': Brushed metallic aluminum foil margin + NMC slate-indigo active coating
 *  - 'separator': Translucent milky-white microporous ceramic-polymer separator membrane
 */
export function createBatteryElectrodeTexture(type) {
  const w = 256, h = 384;
  const { canvas, ctx } = makeCanvas(w, h);

  if (type === 'anode') {
    ctx.fillStyle = '#d47f48';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#202228';
    ctx.fillRect(18, 24, w - 36, h - 44);
    addFastMicroGrain(ctx, 18, 24, w - 36, h - 44, 18, 601);
    ctx.strokeStyle = 'rgba(212, 127, 72, 0.25)';
    ctx.lineWidth = 1;
    for (let y = 36; y < h - 30; y += 16) {
      ctx.beginPath();
      ctx.moveTo(22, y);
      ctx.lineTo(w - 22, y);
      ctx.stroke();
    }
  } else if (type === 'cathode') {
    ctx.fillStyle = '#d6dce4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#343d4c';
    ctx.fillRect(18, 24, w - 36, h - 44);
    addFastMicroGrain(ctx, 18, 24, w - 36, h - 44, 22, 602);
    ctx.strokeStyle = 'rgba(214, 220, 228, 0.18)';
    ctx.lineWidth = 1;
    for (let x = 28; x < w - 28; x += 14) {
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.lineTo(x, h - 24);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#f3f6fa';
    ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 4) {
      ctx.fillStyle = y % 8 === 0 ? 'rgba(204, 214, 226, 0.42)' : 'rgba(255, 255, 255, 0.48)';
      ctx.fillRect(0, y, w, 1.5);
    }
    addFastMicroGrain(ctx, 0, 0, w, h, 12, 603);
  }

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * Capacitive Touch Digitizer Copper/ITO Diamond Micro-Mesh Texture.
 */
export function createTouchDigitizerTexture() {
  const w = 512, h = 1024;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(205, 222, 242, 0.10)';
  ctx.fillRect(0, 0, w, h);

  const step = 28;
  ctx.strokeStyle = 'rgba(196, 152, 92, 0.52)';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  for (let y = 24; y < h - 24; y += step) {
    for (let x = 24; x < w - 24; x += step) {
      const r = step * 0.44;
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    }
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(216, 156, 86, 0.72)';
  ctx.lineWidth = 1.4;
  for (let i = 0; i < 6; i++) {
    const pad = 6 + i * 2.5;
    ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  }

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * LTPO OLED Emissive Diamond-Pentile RGB Micro-Subpixel Matrix Texture (fast pixel buffer!).
 */
export function createOledMatrixTexture() {
  const w = 512, h = 1024;
  const { canvas, ctx } = makeCanvas(w, h);

  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const inBezel = x < 14 || x >= w - 14 || y < 14 || y >= h - 14;
      if (inBezel) {
        d[idx] = 8; d[idx + 1] = 9; d[idx + 2] = 12; d[idx + 3] = 255;
        continue;
      }
      // Subtle radial obsidian sheen
      const dx = (x / w) - 0.36;
      const dy = (y / h) - 0.28;
      const glow = Math.max(0, 1 - Math.hypot(dx * 1.4, dy * 1.2)) * 26;
      let r = 11 + glow * 0.65;
      let g = 14 + glow * 0.85;
      let b = 20 + glow * 1.15;

      // Micro RGB Diamond-Pentile Subpixel pitch (8x8 cell)
      const px = x & 7;
      const py = y & 7;
      const odd = (((x >> 3) + (y >> 3)) & 1);
      if ((px === 1 || px === 5) && py >= 2 && py <= 5) {
        g += 58; // Green subpixel pair
      } else if (px >= 2 && px <= 4 && py >= 1 && py <= 3) {
        if (odd) r += 66; else b += 78;
      } else if (px >= 2 && px <= 4 && py >= 5 && py <= 6) {
        if (odd) b += 78; else r += 66;
      }

      d[idx] = Math.min(255, r);
      d[idx + 1] = Math.min(255, g);
      d[idx + 2] = Math.min(255, b);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * Sintered Copper Vapor Chamber Internal Capillary Wick & Vapor Channel Texture.
 */
export function createVaporChamberWickTexture() {
  const w = 512, h = 768;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = '#bd6d3d';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#8d4822';
  for (let x = 32; x < w - 32; x += 26) {
    ctx.fillRect(x, 36, 14, h - 72);
  }

  ctx.fillStyle = '#e59a64';
  for (let y = 48; y < h - 48; y += 22) {
    for (let x = 39; x < w - 39; x += 26) {
      ctx.beginPath();
      ctx.arc(x, y, 3.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  addFastMicroGrain(ctx, 0, 0, w, h, 24, 707);

  ctx.strokeStyle = '#dc8c56';
  ctx.lineWidth = 22;
  ctx.strokeRect(11, 11, w - 22, h - 22);

  return toTexture(canvas, { color: true, clamp: true });
}

/**
 * Fine Enameled Wound Copper Wire Texture for VCM/OIS, Speaker, and Haptic Coils.
 */
export function createWoundCopperWireTexture() {
  const { canvas, ctx } = makeCanvas(128, 128);
  for (let y = 0; y < 128; y += 4) {
    ctx.fillStyle = '#c86f38';
    ctx.fillRect(0, y, 128, 2);
    ctx.fillStyle = '#e89b62';
    ctx.fillRect(0, y + 1, 128, 1);
    ctx.fillStyle = '#6f3414';
    ctx.fillRect(0, y + 3, 128, 1);
  }
  return toTexture(canvas, { color: true, repeat: [1, 4] });
}

export function createTextureLibrary() {
  return {
    titanium: createBrushedTitaniumTextures(),
    rearCeramic: createRearCeramicTextures(),
    cameraBezel: createCameraBezelRingTexture(),
    cmosSensor: createCmosSensorTexture(),
    ispDie: createIspDieTexture(),
    pcb: createMotherboardPcbTexture(),
    batteryPouch: createBatteryPouchTexture(),
    anode: createBatteryElectrodeTexture('anode'),
    cathode: createBatteryElectrodeTexture('cathode'),
    separator: createBatteryElectrodeTexture('separator'),
    touchMesh: createTouchDigitizerTexture(),
    oledMatrix: createOledMatrixTexture(),
    vcWick: createVaporChamberWickTexture(),
    woundWire: createWoundCopperWireTexture(),
  };
}
