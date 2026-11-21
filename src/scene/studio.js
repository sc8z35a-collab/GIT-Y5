import * as THREE from 'three';

/**
 * Build a custom high-contrast white cyclorama studio environment map
 * using PMREMGenerator. Includes overhead/side diffused softboxes AND
 * dark negative-fill studio flags so titanium, sapphire glass, copper,
 * silicon dies, and matte ceramic read with genuine photorealistic depth
 * against a pure #FFFFFF background.
 */
function createStudioEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0xf6f7f9);

  // Soft studio cyclorama dome
  const domeGeo = new THREE.SphereGeometry(40, 32, 24);
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0xeceef2,
    side: THREE.BackSide,
  });
  envScene.add(new THREE.Mesh(domeGeo, domeMat));

  const addPanel = (w, h, color, intensity, pos, lookAt = [0, 0, 0]) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(intensity),
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(...pos);
    mesh.lookAt(...lookAt);
    envScene.add(mesh);
  };

  // Large overhead diffused white softbox
  addPanel(24, 18, 0xffffff, 2.35, [0, 18, 2]);
  // Crisp vertical left strip softbox (titanium edge highlight)
  addPanel(4.5, 22, 0xf7faff, 2.8, [-16, 2, 10]);
  // Crisp vertical right warm key strip softbox
  addPanel(5.5, 22, 0xfffaf2, 2.6, [17, 4, 8]);
  // Rear-left vertical rim strip (illuminates rear camera sapphire & ceramic)
  addPanel(5.0, 20, 0xf2f6ff, 2.5, [-14, 5, -14]);
  // Rear-right broad softbox
  addPanel(14, 14, 0xffffff, 1.9, [13, 6, -15]);
  // Subtle lower white table bounce
  addPanel(28, 28, 0xf8f9fb, 1.15, [0, -16, 0]);

  // Negative-fill studio flags (critical for dark bevel contrast in chrome/titanium/glass)
  addPanel(7, 22, 0x101216, 1.0, [-19, 0, -2]);
  addPanel(7, 22, 0x121419, 1.0, [19, -1, -3]);
  addPanel(16, 5, 0x181a20, 1.0, [0, 11, 18]);
  addPanel(16, 5, 0x14171d, 1.0, [0, 9, -19]);
  addPanel(10, 8, 0x1d2026, 1.0, [-11, -7, 14]);

  const rt = pmrem.fromScene(envScene, 0.025);
  pmrem.dispose();
  domeGeo.dispose();
  domeMat.dispose();
  return rt.texture;
}

export function createStudio(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  // Transparent clear over CSS #FFFFFF prevents ACESFilmic from greying out pure white
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = null;

  const envMap = createStudioEnvironment(renderer);
  scene.environment = envMap;
  scene.environmentIntensity = 0.92;

  const camera = new THREE.PerspectiveCamera(
    32,
    window.innerWidth / window.innerHeight,
    0.85,
    140
  );

  // Key studio directional light (soft architectural shadow)
  const keyLight = new THREE.DirectionalLight(0xfffdf9, 1.45);
  keyLight.position.set(11, 17, 13);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 2;
  keyLight.shadow.camera.far = 48;
  keyLight.shadow.camera.left = -14;
  keyLight.shadow.camera.right = 14;
  keyLight.shadow.camera.top = 14;
  keyLight.shadow.camera.bottom = -14;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.015;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);

  // Cool architectural fill light
  const fillLight = new THREE.DirectionalLight(0xeef4ff, 0.65);
  fillLight.position.set(-14, 7, 8);
  scene.add(fillLight);

  // Crisp rear rim light (sculpts the 45MP optical stack & ceramic edges)
  const rimLight = new THREE.DirectionalLight(0xffffff, 1.05);
  rimLight.position.set(-7, 12, -16);
  scene.add(rimLight);

  // Soft bottom bounce light (prevents pitch-black undersides on pure white)
  const bounceLight = new THREE.HemisphereLight(0xffffff, 0xe8ecf2, 0.45);
  scene.add(bounceLight);

  // Whisper-soft infinite shadow catcher below the smartphone
  const shadowGeo = new THREE.PlaneGeometry(44, 44);
  const shadowMat = new THREE.ShadowMaterial({
    opacity: 0.055,
    color: 0x0f1218,
  });
  const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
  shadowPlane.rotation.x = -Math.PI / 2;
  shadowPlane.position.y = -9.6;
  shadowPlane.receiveShadow = true;
  scene.add(shadowPlane);

  const onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  };
  window.addEventListener('resize', onResize);

  return {
    renderer,
    scene,
    camera,
    shadowPlane,
    dispose: () => {
      window.removeEventListener('resize', onResize);
      envMap.dispose();
      renderer.dispose();
    },
  };
}
