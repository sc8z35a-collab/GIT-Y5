import './style.css';
import * as THREE from 'three';
import { createStudio } from './scene/studio.js';
import { createTextureLibrary } from './scene/textures.js';
import { buildDisplaySystem } from './parts/displaySystem.js';
import { buildCoolingSystem } from './parts/coolingSystem.js';
import { buildFrameSystem } from './parts/frameSystem.js';
import { buildMotherboardSystem } from './parts/motherboardSystem.js';
import { buildCameraSystem } from './parts/cameraSystem.js';
import { buildBatterySystem } from './parts/batterySystem.js';
import { buildWirelessAndRearSystem } from './parts/wirelessAndRear.js';
import {
  buildSpeakerSystem,
  buildHapticSystem,
  buildUsbcSystem,
  buildSelfieSystem,
} from './parts/electromechanical.js';
import { createInteractionController } from './interaction/controller.js';

function init() {
  const canvas = document.getElementById('stage');
  if (!canvas) return;

  const studio = createStudio(canvas);
  const textures = createTextureLibrary();

  // Assemble all 11 precision hardware subsystems of the RK T4
  const assemblies = [
    buildDisplaySystem(textures),
    buildCoolingSystem(textures),
    buildFrameSystem(textures),
    buildMotherboardSystem(textures),
    buildCameraSystem(textures),
    buildBatterySystem(textures),
    buildWirelessAndRearSystem(textures),
    buildSpeakerSystem(textures),
    buildHapticSystem(textures),
    buildUsbcSystem(textures),
    buildSelfieSystem(textures),
  ];

  const phoneGroup = new THREE.Group();
  phoneGroup.name = 'RK_T4';
  assemblies.forEach((asm) => phoneGroup.add(asm.root));
  studio.scene.add(phoneGroup);

  const controller = createInteractionController({
    canvas,
    camera: studio.camera,
    assemblies,
    shadowPlane: studio.shadowPlane,
  });

  let paused = false;

  // Expose minimal silent inspection hook (no UI)
  window.__RKT4 = {
    setPaused: (v) => {
      paused = Boolean(v);
    },
    snap: (opts) => {
      controller.snapState(opts);
      studio.renderer.render(studio.scene, studio.camera);
    },
    getState: () => controller.getState(),
  };

  let lastTime = performance.now();
  const animate = (now) => {
    requestAnimationFrame(animate);
    if (paused) return;
    const dt = Math.max(0, Math.min((now - lastTime) * 0.001, 0.05));
    lastTime = now;
    controller.update(dt);
    studio.renderer.render(studio.scene, studio.camera);
  };
  requestAnimationFrame(animate);
}

init();
