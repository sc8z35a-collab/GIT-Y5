import * as THREE from 'three';
import { FOCUS_PRESETS } from '../scene/constants.js';
import { setAssemblyAlpha, smoothstep, easeOutCubic } from '../scene/geometryUtils.js';

/**
 * Pure UI-free 3D direct manipulation controller:
 *  - Drag anywhere: damped spherical 360° orbit with inertia
 *  - Scroll wheel: continuous 2-stage macro -> micro 3D disassembly (overview),
 *                  or focused module internal dissection depth (focus mode)
 *  - Pinch (Ctrl+Wheel / 2-finger touch): smooth macro zoom
 *  - Hover: subtle tactile physical micro-lift + pointer cursor
 *  - Click part: enter tailored macro focus dissection (or open phone if clicking closed body)
 *  - Click empty white space / Escape: return cleanly to full RK T4 overview
 *  - Double-click empty space: toggle assembled <-> full micro-exploded view
 */
export function createInteractionController({ canvas, camera, assemblies, shadowPlane }) {
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();

  // Map id -> assembly descriptor with dynamic animation state
  const byId = new Map();
  const pickTargets = [];

  assemblies.forEach((asm) => {
    asm.currentPos = asm.homePos.clone();
    asm.currentMicro = 0;
    asm.currentHover = 0;
    asm.currentAlpha = 1;
    byId.set(asm.id, asm);
    pickTargets.push(asm.root);
  });

  // --- Camera & Disassembly State ---
  // Hero default: 3/4 rear-left angle so the 45MP camera array shines upper-right,
  // opposite the minimal top-left RK / T4 / 2026.11.21 typography.
  const HERO_THETA = -2.50;
  const HERO_PHI = 1.38;
  const HERO_DIST_CLOSED = 34.5;
  const HERO_DIST_EXPLODED = 45.0;

  const state = {
    focusedId: null,
    hoveredId: null,
    userInteracted: false,

    // Overview disassembly [0..1]
    explode: 0.0,
    targetExplode: 0.0,

    // Focus-mode internal micro-dissection [0..1]
    focusMicro: 0.0,
    targetFocusMicro: 0.0,

    // Spherical orbit coordinates
    theta: HERO_THETA,
    targetTheta: HERO_THETA,
    phi: HERO_PHI,
    targetPhi: HERO_PHI,

    // Distance & lookAt target
    distance: HERO_DIST_CLOSED,
    targetDistance: HERO_DIST_CLOSED,
    zoomScale: 1.0,
    targetZoomScale: 1.0,

    lookAt: new THREE.Vector3(0, 0, 0),
    targetLookAt: new THREE.Vector3(0, 0, 0),

    // Saved overview orbit before entering focus mode
    savedOverview: {
      theta: HERO_THETA,
      phi: HERO_PHI,
      zoomScale: 1.0,
    },

    elapsed: 0,
  };

  // --- Pointer / Touch Tracking ---
  let isDragging = false;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let travelDist = 0;
  let lastTapTime = 0;

  const activeTouches = new Map();
  let lastPinchDist = 0;

  const updatePointerNDC = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  };

  const pickPart = (clientX, clientY) => {
    updatePointerNDC(clientX, clientY);
    raycaster.setFromCamera(pointerNDC, camera);
    const visibleRoots = pickTargets.filter((r) => r.visible);
    const hits = raycaster.intersectObjects(visibleRoots, true);
    for (let i = 0; i < hits.length; i++) {
      const partId = hits[i].object.userData.partId;
      if (partId && byId.has(partId)) {
        return partId;
      }
    }
    return null;
  };

  const enterFocus = (partId) => {
    if (!byId.has(partId)) return;
    if (state.focusedId === null) {
      state.savedOverview.theta = state.targetTheta;
      state.savedOverview.phi = state.targetPhi;
      state.savedOverview.zoomScale = state.targetZoomScale;
    }
    state.focusedId = partId;
    state.hoveredId = null;
    state.targetFocusMicro = 1.0;
    state.targetZoomScale = 1.0;
    canvas.classList.remove('is-hovering');

    const preset = FOCUS_PRESETS[partId] || { theta: -2.4, phi: 1.25, distance: 11.0, target: [0, 0, 0] };
    // Take shortest angular path to preset theta
    const deltaTheta = Math.atan2(
      Math.sin(preset.theta - state.theta),
      Math.cos(preset.theta - state.theta)
    );
    state.targetTheta = state.theta + deltaTheta;
    state.targetPhi = preset.phi;
    state.targetDistance = preset.distance;
    state.targetLookAt.set(...preset.target);
  };

  const exitFocus = () => {
    if (state.focusedId === null) return;
    state.focusedId = null;
    state.targetFocusMicro = 0.0;
    state.targetZoomScale = state.savedOverview.zoomScale;
    const deltaTheta = Math.atan2(
      Math.sin(state.savedOverview.theta - state.theta),
      Math.cos(state.savedOverview.theta - state.theta)
    );
    state.targetTheta = state.theta + deltaTheta;
    state.targetPhi = state.savedOverview.phi;
    state.targetLookAt.set(0, 0, 0);
  };

  const handleClick = (clientX, clientY) => {
    state.userInteracted = true;
    const now = performance.now();
    const isDoubleClick = now - lastTapTime < 320;
    lastTapTime = now;

    const hitId = pickPart(clientX, clientY);

    if (state.focusedId !== null) {
      if (hitId === null) {
        exitFocus();
      } else if (hitId === state.focusedId && isDoubleClick) {
        state.targetFocusMicro = state.targetFocusMicro > 0.5 ? 0.0 : 1.0;
      } else if (hitId !== state.focusedId) {
        enterFocus(hitId);
      }
      return;
    }

    // Overview mode click behavior
    if (hitId === null) {
      if (isDoubleClick) {
        state.targetExplode = state.targetExplode > 0.35 ? 0.0 : 1.0;
      }
      return;
    }

    // When phone is closed, clicking outer frame or rear ceramic opens the entire RK T4 cleanly
    // so all internal assemblies become immediately visible and individually clickable!
    if (state.targetExplode < 0.14 && (hitId === 'frame' || hitId === 'wireless')) {
      state.targetExplode = 0.56;
      return;
    }

    // Direct click on any distinct subsystem enters tailored macro dissection immediately!
    enterFocus(hitId);
  };

  // --- Pointer Events ---
  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    state.userInteracted = true;
    activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activeTouches.size === 2) {
      const pts = Array.from(activeTouches.values());
      lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      isDragging = false;
      canvas.classList.remove('is-dragging');
      return;
    }

    isDragging = true;
    pointerDownX = e.clientX;
    pointerDownY = e.clientY;
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    travelDist = 0;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.add('is-dragging');
    canvas.classList.remove('is-hovering');
  };

  const onPointerMove = (e) => {
    if (activeTouches.has(e.pointerId)) {
      activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // 2-finger touch pinch -> zoom + gentle vertical swipe -> explode
    if (activeTouches.size === 2) {
      const pts = Array.from(activeTouches.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (lastPinchDist > 0) {
        const ratio = lastPinchDist / Math.max(dist, 1);
        state.targetZoomScale = THREE.MathUtils.clamp(state.targetZoomScale * ratio, 0.45, 1.80);
      }
      lastPinchDist = dist;
      return;
    }

    if (isDragging) {
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      travelDist += Math.hypot(dx, dy);
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;

      const sensitivity = 0.0068;
      state.targetTheta -= dx * sensitivity;
      state.targetPhi = THREE.MathUtils.clamp(
        state.targetPhi - dy * sensitivity,
        0.18,
        Math.PI - 0.18
      );
      return;
    }

    // Hover feedback (only on desktop mouse when not dragging)
    if (e.pointerType === 'mouse') {
      const hitId = pickPart(e.clientX, e.clientY);
      state.hoveredId = hitId;
      if (hitId && (state.focusedId === null || hitId !== state.focusedId)) {
        canvas.classList.add('is-hovering');
      } else {
        canvas.classList.remove('is-hovering');
      }
    }
  };

  const onPointerUp = (e) => {
    activeTouches.delete(e.pointerId);
    if (activeTouches.size < 2) lastPinchDist = 0;

    if (isDragging) {
      isDragging = false;
      canvas.classList.remove('is-dragging');
      canvas.releasePointerCapture?.(e.pointerId);
      if (travelDist < 6) {
        handleClick(e.clientX, e.clientY);
      }
    }
  };

  // --- Wheel Event: Smooth Disassembly / Pinch-Zoom ---
  const onWheel = (e) => {
    e.preventDefault();
    state.userInteracted = true;

    // Trackpad pinch or Ctrl/Meta + wheel -> smooth zoom
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(e.deltaY * 0.0045);
      state.targetZoomScale = THREE.MathUtils.clamp(state.targetZoomScale * factor, 0.42, 1.85);
      return;
    }

    // Normal scroll wheel drives continuous anatomical disassembly depth!
    const step = e.deltaY * 0.00072;
    if (state.focusedId !== null) {
      state.targetFocusMicro = THREE.MathUtils.clamp(state.targetFocusMicro + step * 1.15, 0, 1);
    } else {
      state.targetExplode = THREE.MathUtils.clamp(state.targetExplode + step, 0, 1);
    }
  };

  // --- Invisible Keyboard Shortcuts ---
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      state.userInteracted = true;
      if (state.focusedId !== null) exitFocus();
      else state.targetExplode = 0.0;
    } else if (e.key === ' ') {
      e.preventDefault();
      state.userInteracted = true;
      if (state.focusedId !== null) {
        state.targetFocusMicro = state.targetFocusMicro > 0.5 ? 0.0 : 1.0;
      } else {
        state.targetExplode = state.targetExplode > 0.35 ? 0.0 : 1.0;
      }
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      state.userInteracted = true;
      if (state.focusedId !== null) {
        state.targetFocusMicro = THREE.MathUtils.clamp(state.targetFocusMicro + 0.14, 0, 1);
      } else {
        state.targetExplode = THREE.MathUtils.clamp(state.targetExplode + 0.14, 0, 1);
      }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      state.userInteracted = true;
      if (state.focusedId !== null) {
        state.targetFocusMicro = THREE.MathUtils.clamp(state.targetFocusMicro - 0.14, 0, 1);
      } else {
        state.targetExplode = THREE.MathUtils.clamp(state.targetExplode - 0.14, 0, 1);
      }
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  // --- Per-Frame Update Loop ---
  const tempTargetPos = new THREE.Vector3();

  function update(dt) {
    const safeDt = Math.min(dt, 0.05);
    state.elapsed += safeDt;

    // Gentle living gallery float before user first touches
    if (!state.userInteracted && state.focusedId === null) {
      state.targetTheta = HERO_THETA + Math.sin(state.elapsed * 0.28) * 0.22;
      state.targetPhi = HERO_PHI + Math.sin(state.elapsed * 0.21) * 0.04;
    }

    const dampCam = 1 - Math.exp(-7.5 * safeDt);
    const dampPart = 1 - Math.exp(-8.5 * safeDt);
    const dampAlpha = 1 - Math.exp(-10.0 * safeDt);

    state.explode = THREE.MathUtils.lerp(state.explode, state.targetExplode, dampPart);
    state.focusMicro = THREE.MathUtils.lerp(state.focusMicro, state.targetFocusMicro, dampPart);
    state.zoomScale = THREE.MathUtils.lerp(state.zoomScale, state.targetZoomScale, dampCam);

    // Overview distance scales gracefully as phone explodes so nothing clips viewport
    if (state.focusedId === null) {
      const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
      const portraitBoost = aspect < 0.85 ? 1.32 : aspect < 1.1 ? 1.12 : 1.0;
      const baseOverviewDist = THREE.MathUtils.lerp(
        HERO_DIST_CLOSED,
        HERO_DIST_EXPLODED,
        easeOutCubic(state.explode)
      );
      state.targetDistance = baseOverviewDist * portraitBoost;
      state.targetLookAt.set(0, 0, -state.explode * 1.1);
    }

    state.theta = THREE.MathUtils.lerp(state.theta, state.targetTheta, dampCam);
    state.phi = THREE.MathUtils.lerp(state.phi, state.targetPhi, dampCam);
    state.distance = THREE.MathUtils.lerp(
      state.distance,
      state.targetDistance * state.zoomScale,
      dampCam
    );
    state.lookAt.lerp(state.targetLookAt, dampCam);

    // Position camera on damped sphere
    const sinPhi = Math.sin(state.phi);
    camera.position.set(
      state.lookAt.x + state.distance * sinPhi * Math.sin(state.theta),
      state.lookAt.y + state.distance * Math.cos(state.phi),
      state.lookAt.z + state.distance * sinPhi * Math.cos(state.theta)
    );
    camera.lookAt(state.lookAt);

    // Two-phase disassembly curves in Overview mode
    const macroFactor = easeOutCubic(smoothstep(0.0, 0.52, state.explode));
    const microFactor = easeOutCubic(smoothstep(0.38, 1.0, state.explode));

    // Gentle weightless vertical hover float for the whole studio specimen
    const floatY = state.focusedId === null ? Math.sin(state.elapsed * 1.15) * 0.08 : 0;

    // Update all 11 hardware subsystems
    for (let i = 0; i < assemblies.length; i++) {
      const asm = assemblies[i];
      const isFocused = state.focusedId === asm.id;
      const someFocused = state.focusedId !== null;
      const isHovered = !someFocused && state.hoveredId === asm.id;

      // Subtle tactile hover micro-lift
      const wantHover = isHovered ? 1.0 : 0.0;
      asm.currentHover = THREE.MathUtils.lerp(asm.currentHover, wantHover, 1 - Math.exp(-12 * safeDt));

      if (isFocused) {
        // Focused subsystem glides seamlessly to world origin (0, 0, 0) for crisp 360° macro inspection
        tempTargetPos.set(0, 0, 0);
        asm.currentPos.lerp(tempTargetPos, dampPart);
        asm.currentMicro = THREE.MathUtils.lerp(asm.currentMicro, state.focusMicro, dampPart);
        asm.currentAlpha = THREE.MathUtils.lerp(asm.currentAlpha, 1.0, dampAlpha);
      } else if (someFocused) {
        // Non-focused assemblies gracefully glide further outward & dematerialize cleanly
        tempTargetPos
          .copy(asm.homePos)
          .addScaledVector(asm.macroOffset, 2.1);
        asm.currentPos.lerp(tempTargetPos, dampPart);
        asm.currentMicro = THREE.MathUtils.lerp(asm.currentMicro, microFactor, dampPart);
        asm.currentAlpha = THREE.MathUtils.lerp(asm.currentAlpha, 0.0, dampAlpha);
      } else {
        // Overview mode: precision multi-stage disassembly + hover micro-lift + studio float
        tempTargetPos
          .copy(asm.homePos)
          .addScaledVector(asm.macroOffset, macroFactor)
          .addScaledVector(asm.hoverOffset, asm.currentHover);
        tempTargetPos.y += floatY;
        asm.currentPos.lerp(tempTargetPos, dampPart);
        asm.currentMicro = THREE.MathUtils.lerp(asm.currentMicro, microFactor, dampPart);
        asm.currentAlpha = THREE.MathUtils.lerp(asm.currentAlpha, 1.0, dampAlpha);
      }

      asm.root.position.copy(asm.currentPos);
      asm.updateMicro(asm.currentMicro, isFocused ? 1.0 : macroFactor);
      setAssemblyAlpha(asm.root, asm.currentAlpha);
    }

    // Subtle shadow plane fades cleanly in focus macro mode so pure white space stays crisp
    if (shadowPlane) {
      const targetShadowOp = state.focusedId !== null ? 0.0 : 0.055 * (1 - state.explode * 0.35);
      shadowPlane.material.opacity = THREE.MathUtils.lerp(
        shadowPlane.material.opacity,
        targetShadowOp,
        dampAlpha
      );
    }
  }

  // Programmatic API (silent — zero UI, useful for testing & instant view verification)
  function snapState({ explode, focusId, focusMicro, theta, phi, distance, zoomScale } = {}) {
    state.userInteracted = true;
    if (focusId !== undefined) {
      if (focusId === null) {
        state.focusedId = null;
        state.targetLookAt.set(0, 0, 0);
      } else if (byId.has(focusId)) {
        enterFocus(focusId);
      }
    }
    if (explode !== undefined) {
      state.explode = state.targetExplode = THREE.MathUtils.clamp(explode, 0, 1);
    }
    if (focusMicro !== undefined) {
      state.focusMicro = state.targetFocusMicro = THREE.MathUtils.clamp(focusMicro, 0, 1);
    }
    if (theta !== undefined) state.theta = state.targetTheta = theta;
    if (phi !== undefined) state.phi = state.targetPhi = phi;
    if (distance !== undefined) state.distance = state.targetDistance = distance;
    if (zoomScale !== undefined) state.zoomScale = state.targetZoomScale = zoomScale;

    // Settle all springs cleanly in one deterministic burst
    for (let i = 0; i < 90; i++) {
      update(0.05);
    }
  }

  return {
    update,
    enterFocus,
    exitFocus,
    snapState,
    getState: () => ({
      focusedId: state.focusedId,
      explode: state.explode,
      focusMicro: state.focusMicro,
      parts: assemblies.map((a) => a.id),
    }),
    dispose: () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
