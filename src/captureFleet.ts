import * as THREE from 'three';
import { createAircraftModel } from './render/aircraftModels';
import { AIRCRAFT } from './sim/aircraft';

const W = 1280;
const H = 640;

function environmentMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const envScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top: { value: new THREE.Color('#4a82cc') },
      horizon: { value: new THREE.Color('#e3edf3') },
      ground: { value: new THREE.Color('#5f6f45') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 ground;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y > 0.0 ? mix(horizon, top, pow(y, 0.6)) : mix(horizon * 0.8, ground, pow(-y, 0.4));
        c += vec3(1.0, 0.95, 0.85) * pow(max(dot(vDir, normalize(vec3(0.4, 0.6, 0.5))), 0.0), 64.0) * 4.0;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return env;
}

function frameCamera(camera: THREE.PerspectiveCamera, root: THREE.Object3D, sun: THREE.DirectionalLight): void {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z);
  const dist = span * 1.7;
  camera.position.set(center.x + dist * 0.55, center.y + dist * 0.18, center.z + dist * 0.92);
  camera.near = Math.max(0.2, dist / 40);
  camera.far = dist * 20;
  camera.lookAt(center.x - span * 0.04, center.y + size.y * 0.02, center.z);
  camera.updateProjectionMatrix();
  sun.position.set(center.x + span, center.y + span * 1.6, center.z + span * 0.8);
  sun.target.position.copy(center);
  sun.target.updateMatrixWorld();
}

async function capture(): Promise<void> {
  const status = document.getElementById('status');
  const preview = document.getElementById('preview');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xbcd6f0, 0x6f7f52, 1.25));
  const sun = new THREE.DirectionalLight(0xfff2de, 2.6);
  scene.add(sun, sun.target);
  const envMap = environmentMap(renderer);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.2, 400);

  const shots: Record<string, string> = {};
  for (const cfg of AIRCRAFT) {
    const plane = createAircraftModel(cfg, envMap);
    plane.lightsOn = false;
    plane.doorOpen = false;
    plane.update(8, 0, 0, 0, 0, {
      throttle: 0.08,
      flaps: 0,
      gear: 1,
      elevator: 0,
      groundSpeed: 0,
      onGround: true,
    });
    scene.add(plane.root);
    frameCamera(camera, plane.root, sun);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    shots[cfg.id] = url;
    if (preview) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = cfg.id;
      preview.appendChild(img);
    }
    scene.remove(plane.root);
    plane.dispose();
  }

  (window as unknown as { fleetShots: Record<string, string> }).fleetShots = shots;
  document.body.dataset.ready = '1';
  if (status) status.textContent = `Captured ${Object.keys(shots).length} aircraft.`;
}

void capture();
