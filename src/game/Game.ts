import * as THREE from 'three';
import { EngineSound } from '../audio/EngineSound';
import {
  AIM_POINT_X,
  BTS_RUNWAY,
  DANUBE,
  DANUBE_CANAL,
  GLIDE_SLOPE_DEG,
  LANDMARKS,
  OVERFLY_LIMIT_X,
  START_X,
  SUGGESTED_CRUISE_ALT,
  VIE_RUNWAY,
} from '../config';
import { Airplane } from '../render/Airplane';
import { atmosphere } from '../render/Billboards';
import { Sky, createPalette, samplePalette } from '../render/Sky';
import { World } from '../render/World';
import { FlightModel, type Touchdown } from '../sim/FlightModel';
import { buildReport, evaluateTouchdown, failureReport, onRunway, type ScoreItem } from '../sim/Landing';
import { acquireWakeLock, bindNativeLifecycle, isNativePlatform, releaseWakeLock } from '../native';
import { Hud, type WarningKey } from '../ui/Hud';
import { Input, type PressAction } from './Input';

type State = 'menu' | 'flying' | 'paused' | 'report';
type Phase = 'takeoff' | 'airborne' | 'rollout';
type Quality = 'low' | 'medium' | 'high';

const QUALITY: Record<Quality, { label: string; pixelRatio: number; shadowMap: number }> = {
  low: { label: 'Low', pixelRatio: 1, shadowMap: 0 },
  medium: { label: 'Medium', pixelRatio: 1.5, shadowMap: 1024 },
  high: { label: 'High', pixelRatio: 2, shadowMap: 2048 },
};
const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];

const BASE_FOV = 38;
const CAMERA_PITCH = -0.045;
const PAPI_THRESHOLDS = [3.0, 3.33, 3.67, 4.0];

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 7000);
  private readonly world: World;
  private readonly plane: Airplane;
  private readonly sky = new Sky();
  private readonly palette = createPalette();
  private readonly fm = new FlightModel();
  private readonly input = new Input();
  private readonly hud: Hud;
  private readonly sound = new EngineSound();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly blob: THREE.Mesh;
  private readonly sunOffset = new THREE.Vector3(26, 52, 34).normalize().multiplyScalar(60);

  private state: State = 'menu';
  private phase: Phase = 'takeoff';
  private quality: Quality;
  private touchdownItems: ScoreItem[] | null = null;
  private overran = false;
  private tailStrike = false;
  private flightTime = 0;
  private crashed = false;
  private crashTilt = 0;

  private camY = 4.2;
  private camDist = 29;
  private lead = 3.5;
  private shake = 0;
  private time = 0;
  private lastFrame = 0;
  private flashText = '';
  private flashTimer = 0;
  private hudTimer = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;

  private readonly warnings: Record<WarningKey, boolean> = { stall: false, overspeed: false, gear: false, sink: false, flaps: false, terrain: false };
  private readonly controls = { pitch: 0, throttle: 0, brake: 0 };

  private readonly app: HTMLElement;

  constructor(app: HTMLElement) {
    this.app = app;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    app.prepend(this.renderer.domElement);

    // Mobile WebView starts on Low; desktop keeps High. A saved preference always wins.
    const saved = localStorage.getItem('airways.quality') as Quality | null;
    this.quality = saved && saved in QUALITY ? saved : isNativePlatform() ? 'low' : 'high';

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.world = new World(Math.min(4, maxAniso));
    this.scene.add(this.world.root);
    this.scene.add(this.sky.mesh);
    this.scene.fog = new THREE.Fog(0xbccfdc, 450, 3200);

    this.plane = new Airplane(this.createEnvironmentMap());
    this.scene.add(this.plane.root);

    this.hemi = new THREE.HemisphereLight(0xbcd6f0, 0x6f7f52, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2de, 2.6);
    this.sun.shadow.camera.left = -16;
    this.sun.shadow.camera.right = 16;
    this.sun.shadow.camera.top = 16;
    this.sun.shadow.camera.bottom = -16;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.blob = this.createBlobShadow();
    this.scene.add(this.blob);

    this.camera.rotation.set(CAMERA_PITCH, 0, 0);

    this.hud = new Hud(app, this.input);
    this.input.onPress((a) => this.onPress(a));
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'flying') this.setPaused(true);
      if (document.hidden) releaseWakeLock();
      else if (this.state === 'flying') void acquireWakeLock();
    });
    void bindNativeLifecycle({
      onPause: () => {
        if (this.state === 'flying') this.setPaused(true);
        releaseWakeLock();
      },
      onResume: () => {
        this.lastFrame = performance.now();
        if (this.state === 'flying' || this.state === 'paused') void this.sound.resume();
        if (this.state === 'flying') void acquireWakeLock();
      },
      onBack: () => {
        if (this.state === 'flying') {
          this.setPaused(true);
          return true;
        }
        if (this.state === 'paused') {
          this.setPaused(false);
          return true;
        }
        if (this.state === 'report') {
          this.hud.show('report', false);
          this.hud.show('menu', true);
          this.state = 'menu';
          return true;
        }
        return false;
      },
    });

    this.applyQuality();
    this.resize();
    this.reset();
    this.hud.setMuted(false);
    this.hud.show('loading', false);
    this.hud.show('menu', true);
    this.hud.show('hud', true);
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ setup

  private createEnvironmentMap(): THREE.Texture {
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
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const env = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    return env;
  }

  private createBlobShadow(): THREE.Mesh {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -4 }),
    );
    mesh.scale.set(7, 1, 10);
    mesh.renderOrder = 2;
    return mesh;
  }

  private applyQuality(): void {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    const shadows = q.shadowMap > 0;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    if (shadows) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => (mm.needsUpdate = true));
    });
    this.hud.setQuality(q.label);
    localStorage.setItem('airways.quality', this.quality);
    this.resize();
  }

  private resize(): void {
    const w = this.app.clientWidth || window.innerWidth;
    const h = this.app.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep horizontal coverage on narrow (portrait) screens.
    const minAspect = 1.45;
    const base = THREE.MathUtils.degToRad(BASE_FOV / 2);
    this.camera.fov = this.camera.aspect < minAspect ? THREE.MathUtils.radToDeg(2 * Math.atan((Math.tan(base) * minAspect) / this.camera.aspect)) : BASE_FOV;
    this.camera.updateProjectionMatrix();
  }

  private reset(): void {
    this.fm.reset(START_X);
    this.phase = 'takeoff';
    this.touchdownItems = null;
    this.overran = false;
    this.tailStrike = false;
    this.flightTime = 0;
    this.crashed = false;
    this.crashTilt = 0;
    this.shake = 0;
    this.camY = 4.2;
    this.camDist = 29;
    this.lead = 3.5;
    this.flashText = '';
    this.flashTimer = 0;
  }

  // ------------------------------------------------------------------ input

  private onPress(a: PressAction): void {
    switch (a) {
      case 'start':
        if (this.state === 'menu') this.begin();
        else if (this.state === 'report') this.restart();
        else if (this.state === 'paused') this.setPaused(false);
        break;
      case 'restart':
        this.restart();
        break;
      case 'pause':
        if (this.state === 'flying') this.setPaused(true);
        else if (this.state === 'paused') this.setPaused(false);
        break;
      case 'mute':
        this.sound.setMuted(!this.sound.muted);
        this.hud.setMuted(this.sound.muted);
        break;
      case 'quality':
        this.quality = QUALITY_ORDER[(QUALITY_ORDER.indexOf(this.quality) + 1) % QUALITY_ORDER.length];
        this.applyQuality();
        break;
      case 'flaps':
      case 'flapsDown':
      case 'flapsUp': {
        if (this.state !== 'flying') break;
        const fm = this.fm;
        const before = fm.flapIndex;
        if (a === 'flaps') fm.cycleFlaps();
        else if (a === 'flapsDown') fm.flapsDown();
        else fm.flapsUp();
        if (fm.flapIndex === before) this.flash(a === 'flapsDown' ? 'Flaps are fully down' : 'Flaps are already up');
        else this.flash(fm.flapIndex === 0 ? 'Flaps retracting' : `Flaps ${fm.flapTargetDeg}°`);
        break;
      }
      case 'gear':
        if (this.state !== 'flying') break;
        if (!this.fm.toggleGear()) this.flash('The gear cannot retract with weight on the wheels');
        else this.flash(this.fm.gearTarget > 0.5 ? 'Gear down' : 'Gear up');
        break;
    }
  }

  private begin(): void {
    this.sound.start();
    this.sound.resume();
    this.hud.show('menu', false);
    this.state = 'flying';
    void acquireWakeLock();
  }

  private restart(): void {
    this.reset();
    this.hud.show('report', false);
    this.hud.show('pause', false);
    this.hud.show('menu', false);
    this.sound.start();
    this.sound.resume();
    this.state = 'flying';
    void acquireWakeLock();
  }

  private setPaused(p: boolean): void {
    this.state = p ? 'paused' : 'flying';
    this.hud.show('pause', p);
    if (p) {
      this.sound.suspend();
      releaseWakeLock();
    } else {
      this.sound.resume();
      void acquireWakeLock();
    }
    this.lastFrame = performance.now();
  }

  private flash(text: string, seconds = 2.2): void {
    this.flashText = text;
    this.flashTimer = seconds;
  }

  // ------------------------------------------------------------------ loop

  private frame(now: number): void {
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;

    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.hud.setFps(this.fps);
    }

    if (this.state === 'flying') this.simulate(dt);
    if (this.state !== 'paused') {
      this.time += dt;
      this.updateVisuals(dt);
    }
    this.renderer.render(this.scene, this.camera);
  }

  private simulate(dt: number): void {
    const fm = this.fm;
    const c = this.controls;
    c.pitch = this.input.pitch;
    c.throttle = this.input.throttle;
    c.brake = this.input.brake;
    fm.update(dt, c);
    this.flightTime += dt;

    if (fm.touchdown) {
      const td = fm.touchdown;
      fm.touchdown = null;
      this.onTouchdown(td);
      if (this.state !== 'flying') return;
    }

    if (this.phase === 'takeoff') {
      if (!fm.onGround && fm.y > 3) this.phase = 'airborne';
      else if (fm.onGround && fm.x > BTS_RUNWAY.x1) {
        this.fail('Runway overrun', 'You ran out of runway in Bratislava. Use full power and lift the nose (W) at about 110 km/h.');
        return;
      }
    } else if (this.phase === 'rollout') {
      if (!fm.onGround && fm.y > 3) {
        this.phase = 'airborne';
        this.touchdownItems = null;
        this.tailStrike = false;
        this.flash('Go-around! Climb away and try again');
      } else if (fm.onGround) {
        if (fm.x > VIE_RUNWAY.x1) {
          if (fm.airspeed > 15) {
            this.fail('Runway overrun', 'The aircraft left the end of runway 29 at speed. Touch down earlier and keep the power at idle to brake.');
            return;
          }
          this.overran = true;
        }
        if (fm.airspeed < 1 && this.touchdownItems) {
          this.state = 'report';
          this.hud.showReport(buildReport(this.touchdownItems, this.overran, this.tailStrike), this.statsLine());
        }
      }
    }

    if (!fm.onGround && fm.x > OVERFLY_LIMIT_X) {
      this.fail('Missed Vienna', 'You flew past Vienna International Airport. Start the descent earlier and follow the PAPI lights to the runway.');
    }
  }

  private onTouchdown(td: Touchdown): void {
    const vs = -td.verticalSpeed;
    this.sound.touchdown(Math.min(1, vs / 4));
    this.shake = Math.min(1, 0.15 + vs / 3);

    if (onRunway(td.x, BTS_RUNWAY)) {
      if (this.fm.maxAltitude < 8 && vs < 2) return;
      const v = evaluateTouchdown(td, BTS_RUNWAY);
      if (v.crash) this.crash(v.crash);
      else this.flash('Touch-and-go in Bratislava – Vienna is the other way… well, ahead!');
      return;
    }
    if (onRunway(td.x, VIE_RUNWAY)) {
      const v = evaluateTouchdown(td, VIE_RUNWAY);
      if (v.crash) {
        this.crash(v.crash);
        return;
      }
      this.touchdownItems = v.items;
      this.tailStrike = td.pitch > this.fm.config.geometry.tailStrikePitch + 0.02;
      this.phase = 'rollout';
      this.flash(vs < 1 ? 'Butter! Idle power to brake' : 'Touchdown – idle power to brake');
      return;
    }
    const inWater = (td.x > DANUBE.x0 && td.x < DANUBE.x1) || (td.x > DANUBE_CANAL.x0 && td.x < DANUBE_CANAL.x1);
    this.crash(inWater ? 'You ditched in the river. The Danube is beautiful, but not a runway.' : 'You touched down outside the runway.');
  }

  private crash(reason: string): void {
    this.crashed = true;
    this.shake = 1;
    this.fm.vx = 0;
    this.fm.vy = 0;
    this.fm.throttle = 0;
    this.fail('Crash landing', reason);
  }

  private fail(title: string, message: string): void {
    this.state = 'report';
    this.hud.showReport(failureReport(title, message), this.statsLine());
  }

  private statsLine(): string {
    const m = Math.floor(this.flightTime / 60);
    const s = Math.floor(this.flightTime % 60).toString().padStart(2, '0');
    return `Flight time ${m}:${s} · Max altitude ${Math.round(this.fm.maxAltitude)} m · Distance ${(Math.max(0, this.fm.x - START_X) / 1000).toFixed(1)} km`;
  }

  // ------------------------------------------------------------------ visuals

  private updateVisuals(dt: number): void {
    const fm = this.fm;
    const V = fm.airspeed;

    if (this.crashed) this.crashTilt = Math.min(1, this.crashTilt + dt * 2);
    this.plane.update(dt, fm.x, fm.y, fm.pitch - this.crashTilt * 0.12, {
      throttle: this.crashed ? 0 : fm.throttle,
      flaps: fm.flaps,
      gear: fm.gear,
      elevator: fm.elevator,
      groundSpeed: fm.vx,
      onGround: fm.onGround,
    });

    // Camera: plane slightly left of centre, gentle vertical lag, zoom out with speed and altitude
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    this.lead += (3.5 + V * 0.08 - this.lead) * k(1.5);
    this.camY += (Math.max(fm.y + 2.6, 4.2) - this.camY) * k(3.5);
    const targetDist = 29 + Math.min(V * 0.09, 6) + Math.min(fm.y * 0.025, 16);
    this.camDist += (targetDist - this.camDist) * k(0.8);
    const buffet = !fm.onGround && fm.stallMargin < 0.1 && V > 5 ? 0.25 : 0;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const amp = this.shake * 0.5 + buffet;
    const sx = amp ? Math.sin(this.time * 47) * amp * 0.35 : 0;
    const sy = amp ? Math.sin(this.time * 61 + 1.3) * amp * 0.45 : 0;
    this.camera.position.set(fm.x + this.lead + sx, this.camY + sy, this.camDist);

    this.world.update(this.time, this.camera.position.y);

    // Time of day along the route
    const progress = (this.camera.position.x - 1500) / (VIE_RUNWAY.x0 - 1500);
    const p = this.palette;
    samplePalette(progress, p);
    atmosphere.tint.value.copy(p.tint);
    atmosphere.haze.value.copy(p.haze);
    (this.scene.fog as THREE.Fog).color.copy(p.haze);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.sun.color.copy(p.sunLight);
    this.sun.intensity = p.sunIntensity;
    this.sky.update(p, this.camera);

    const groundY = 0;
    this.sun.target.position.set(fm.x, (fm.y + groundY) * 0.5, 0);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.blob.position.set(fm.x + 0.4, 0.05, 0.6);
    const blobFade = Math.max(0, 1 - fm.y / 45);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.32 * blobFade;
    this.blob.visible = blobFade > 0;

    // PAPI and approach guidance
    let whites = -1;
    const toAim = AIM_POINT_X - fm.x;
    if (toAim > 30) {
      const angle = THREE.MathUtils.radToDeg(Math.atan2(fm.y, toAim));
      whites = 0;
      for (const t of PAPI_THRESHOLDS) if (angle > t) whites++;
    }
    this.world.setPapi(Math.max(0, whites));

    if (this.state === 'flying') this.sound.update(fm.throttle, V);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 1 / 20;
      this.updateHud(whites, toAim);
    }
  }

  private updateHud(whites: number, toAim: number): void {
    const fm = this.fm;
    const kmh = fm.airspeed * 3.6;
    const flying = this.state === 'flying';
    const routeLen = AIM_POINT_X - START_X;
    this.hud.update({
      speedKmh: kmh,
      altitude: fm.y,
      verticalSpeed: fm.vy,
      power: fm.throttle,
      flapsDeg: fm.flapDeg,
      flapsTargetDeg: fm.flapTargetDeg,
      gear: fm.gear,
      gearTarget: fm.gearTarget,
      progress: (fm.x - START_X) / routeLen,
      distanceKm: Math.max(0, VIE_RUNWAY.x0 - fm.x) / 1000,
      phase: this.phaseLabel(toAim),
    });
    this.hud.setControlLit('flaps', fm.flapIndex > 0);
    this.hud.setControlLit('gear', fm.gearTarget > 0.5);

    const airborne = !fm.onGround;
    const nearAirport = (fm.x > VIE_RUNWAY.x0 - 1500 && fm.x < VIE_RUNWAY.x1) || fm.x < BTS_RUNWAY.x1 + 600;
    const w = this.warnings;
    w.stall = flying && airborne && fm.stallMargin < 0.12 && fm.airspeed > 5;
    w.overspeed = flying && fm.overspeed;
    w.gear = flying && airborne && fm.gearTarget < 0.5 && fm.y < 120 && fm.vy < -0.5 && fm.x > VIE_RUNWAY.x0 - 6000;
    w.sink = flying && airborne && fm.y < 200 && fm.vy < -6;
    w.flaps = flying && fm.flapOverspeed;
    w.terrain = flying && airborne && fm.y < 40 && fm.vy < -3 && !nearAirport;
    this.hud.setWarnings(w);

    this.hud.setPapi(flying && airborne && toAim > 30 && toAim < 6500 ? whites : -1);

    const camX = this.camera.position.x;
    const lm = flying || this.state === 'menu' ? LANDMARKS.find((l) => camX >= l.x0 && camX <= l.x1) : undefined;
    this.hud.setLandmark(lm?.title ?? '', lm?.subtitle ?? '');

    if (this.flashTimer > 0) {
      this.flashTimer -= 1 / 20;
      this.hud.setHint(this.flashText);
    } else {
      this.hud.setHint(flying ? this.hint(toAim) : '');
    }
  }

  private phaseLabel(toAim: number): string {
    const fm = this.fm;
    if (this.state === 'menu') return 'Ready for departure';
    if (this.crashed) return 'Flight ended';
    if (this.phase === 'takeoff') return fm.airspeed < 1 ? 'Holding on runway 31' : 'Take-off roll';
    if (this.phase === 'rollout') return fm.airspeed < 1 ? 'Arrived in Vienna' : 'Landing roll';
    const glideStart = fm.y / Math.tan(THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG));
    if (toAim < 2500) return 'Final approach';
    if (toAim < glideStart + 300) return 'Descent';
    return fm.vy > 1.5 ? 'Climb' : 'Cruise';
  }

  private hint(toAim: number): string {
    const fm = this.fm;
    const kmh = fm.airspeed * 3.6;
    if (this.phase === 'takeoff') {
      if (fm.throttleLever < 0.95) return 'Hold Shift (or +) for full take-off power';
      if (kmh < 100) return `Accelerating… lift the nose at 110 km/h`;
      return 'Rotate! Hold W (or ↑) to raise the nose';
    }
    if (this.phase === 'rollout') return fm.airspeed > 1 ? 'Power to idle (X) and brake (B)' : '';
    if (fm.overspeed) return 'Overspeed! Reduce power and raise the nose';
    const glideStart = fm.y / Math.tan(THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG));
    const descending = toAim < glideStart + 200;
    if (!descending) {
      if (fm.gearTarget > 0.5 && fm.y > 15) return 'Positive climb – retract the landing gear (G)';
      if (fm.flapIndex > 0 && fm.y > 60) return 'Retract the flaps (V) for cruise';
      if (fm.y < SUGGESTED_CRUISE_ALT - 60) return `Climb to about ${SUGGESTED_CRUISE_ALT} m`;
      if (fm.y > SUGGESTED_CRUISE_ALT + 250) return 'You are high – Vienna is close, plan your descent';
      if (toAim < glideStart + 1200) return 'Top of descent ahead – get ready to reduce power';
      return 'Cruise around 350 m at ~200 km/h (about 70% power)';
    }
    if (toAim > 0) {
      if (fm.y < 14 && fm.x > VIE_RUNWAY.x0 - 300) return 'Flare: cut the power (X) and gently raise the nose (W)';
      if (fm.flapOverspeed) return 'Too fast for this flap setting – slow down or retract (V)';
      if (fm.gearTarget < 0.5 && toAim < 5000) return 'Landing gear down (G)';
      if (fm.flapsTarget < 1 && toAim < 3500) return `Flaps ${fm.flapIndex === 0 ? 'down' : 'further'} (F) for landing – full is 30°`;
      if (kmh > 170 && toAim < 3000) return 'Too fast – reduce power, aim for ~120 km/h';
      return 'Descend on the glide path: 2 white + 2 red PAPI lights';
    }
    return fm.y < 14 ? 'Flare and touch down on the runway' : 'You are long – land now or go around';
  }
}
