import * as THREE from 'three';
import { EngineSound } from '../audio/EngineSound';
import { DANUBE, DANUBE_CANAL, GLIDE_SLOPE_DEG, START_X, SUGGESTED_CRUISE_ALT } from '../config';
import { airportByIata } from '../meta/airports';
import { loadProgress, recordCrash, recordSuccess } from '../meta/progress';
import { DEFAULT_ROUTE, getRoute, type FlightRoute } from '../meta/routes';
import { Airplane } from '../render/Airplane';
import { atmosphere } from '../render/Billboards';
import { Sky, createPalette, samplePalette } from '../render/Sky';
import { Passengers } from '../render/Passengers';
import { Storms } from '../render/Storms';
import { Trails } from '../render/Trails';
import { World } from '../render/World';
import { FlightModel, type Touchdown } from '../sim/FlightModel';
import { computeLoadSheet } from '../sim/LoadSheet';
import { Weather } from '../sim/Weather';
import { buildReport, evaluateTouchdown, failureReport, onRunway, type ScoreItem } from '../sim/Landing';
import { acquireWakeLock, bindNativeLifecycle, isNativePlatform, releaseWakeLock } from '../native';
import { FlightControls } from '../ui/FlightControls';
import { HubMenu } from '../ui/HubMenu';
import { Hud, type ChecklistView, type WarningKey } from '../ui/Hud';
import { Atc } from './Atc';
import { Input, type PressAction } from './Input';

type State = 'menu' | 'flying' | 'paused' | 'report';
type Phase = 'preflight' | 'takeoff' | 'airborne' | 'rollout' | 'falling';
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
  private readonly hub: HubMenu;
  private route: FlightRoute = DEFAULT_ROUTE;
  private readonly sound = new EngineSound();
  private readonly hemi: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly blob: THREE.Mesh;
  private readonly storms: Storms;
  private readonly passengers = new Passengers();
  private readonly trails = new Trails();
  private readonly atc = new Atc();
  private readonly controlsUi: FlightControls;
  private weather = new Weather({ seed: 1 });
  private readonly tipR = new THREE.Vector3();
  private readonly tipL = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly baseFog = { near: 450, far: 3200 };
  private readonly stormHaze = new THREE.Color(0x5d6670);
  private readonly sunOffset = new THREE.Vector3(26, 52, 34).normalize().multiplyScalar(60);

  private state: State = 'menu';
  private phase: Phase = 'preflight';
  private passengerCount = 1;
  private belts = false;
  private boardingStarted = false;
  /** Random day / night departure for this flight. */
  private nightFlight = false;
  private takeoffFlapsAtLiftoff = -1;
  private stormEncounter: 'none' | 'light' | 'moderate' | 'severe' = 'none';
  private atcTimer = 0;
  private routeStormTimer = 0;
  private quality: Quality;
  private touchdownItems: ScoreItem[] | null = null;
  private overran = false;
  private tailStrike = false;
  private flightTime = 0;
  private crashed = false;
  private crashTilt = 0;
  /** Pending debrief after the wreck finishes falling / settling. */
  private crashTitle = '';
  private crashReason = '';
  /** Seconds to hold on the wreck after impact before the report UI. */
  private crashImpactHold = 0;
  /** Signed roll rate during an uncontrolled descent (rad/s). */
  private crashSpin = 0;

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

  private readonly warnings: Record<WarningKey, boolean> = {
    stall: false,
    overspeed: false,
    gear: false,
    sink: false,
    flaps: false,
    terrain: false,
    cht: false,
  };
  private readonly controls = { pitch: 0, roll: 0, throttle: 0, brake: 0 };

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

    this.storms = new Storms(Math.min(4, maxAniso));
    this.scene.add(this.storms.root, this.passengers.root, this.trails.mesh);

    this.camera.rotation.set(CAMERA_PITCH, 0, 0);

    this.hud = new Hud(app, this.input);
    this.hub = new HubMenu(document.getElementById('menu')!, (req) => this.begin(req.from, req.to));
    this.controlsUi = new FlightControls(
      app,
      (v) => this.fm.setThrottleLever(v),
      (pitch, roll) => {
        this.input.yoke.pitch = pitch;
        this.input.yoke.roll = roll;
      },
    );
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
          this.returnToHub();
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
    this.hud.show('hud', true);
    this.hub.show(true);
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
    const seed = (Math.random() * 2 ** 31) | 0;
    this.nightFlight = (seed >>> 8) % 100 < 42;
    this.weather = new Weather({ seed });
    this.fm.weather = this.weather;
    this.fm.reset(START_X, false);
    this.storms.setWeather(this.weather);
    this.atc.reset(this.weather);
    // 1–3 passengers; fuel is planned so the take-off mass stays within MTOW.
    this.passengerCount = 1 + (seed % 3);
    const cfg = this.fm.config;
    const baggageKg = 15 * this.passengerCount;
    const withoutFuel = computeLoadSheet(cfg, { passengers: this.passengerCount, baggageKg, fuelKg: 0 }).massKg;
    const fuelKg = Math.max(30, Math.min(140, cfg.mass.mtowKg - withoutFuel));
    this.fm.setLoad({ passengers: this.passengerCount, baggageKg, fuelKg });
    this.plane.doorOpen = false;
    this.plane.lightsOn = false;
    this.belts = false;
    this.boardingStarted = false;
    this.passengers.clear();
    this.trails.reset();
    this.takeoffFlapsAtLiftoff = -1;
    this.stormEncounter = 'none';
    this.atcTimer = 0;
    this.routeStormTimer = 0;
    this.input.yoke.pitch = this.input.yoke.roll = 0;
    this.phase = 'preflight';
    this.touchdownItems = null;
    this.overran = false;
    this.tailStrike = false;
    this.flightTime = 0;
    this.crashed = false;
    this.crashTilt = 0;
    this.crashTitle = '';
    this.crashReason = '';
    this.crashImpactHold = 0;
    this.crashSpin = 0;
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
        if (this.state === 'menu') this.hub.tryFlyFromKeyboard();
        else if (this.state === 'report') this.returnToHub();
        else if (this.state === 'paused') this.setPaused(false);
        break;
      case 'restart':
        if (this.state === 'report' || this.state === 'paused' || this.state === 'flying') this.returnToHub();
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
      case 'flapsTakeoff':
        if (this.state !== 'flying') break;
        this.fm.setFlapIndex(1);
        this.flash('Flaps 10° for take-off');
        break;
      case 'door':
        if (this.state === 'flying' && this.phase === 'preflight') this.toggleDoor();
        break;
      case 'lights':
        if (this.state !== 'flying') break;
        this.plane.lightsOn = !this.plane.lightsOn;
        this.flash(this.plane.lightsOn ? 'Beacon, strobes and navigation lights on' : 'Lights off');
        break;
      case 'belts':
        if (this.state !== 'flying') break;
        this.belts = !this.belts;
        this.flash(this.belts ? 'Fasten seatbelts sign on' : 'Seatbelt sign off');
        break;
      case 'engineStart':
        if (this.state === 'flying' && this.phase === 'preflight') this.startEngine();
        break;
      case 'reply1':
      case 'reply2':
        if (this.state === 'flying') this.atc.reply(a === 'reply1' ? 0 : 1);
        break;
    }
  }

  private toggleDoor(): void {
    const p = this.plane;
    if (this.fm.engine.state !== 'off') {
      this.flash('Shut down the engine before opening the door');
      return;
    }
    if (p.doorOpen) {
      if (this.boardingStarted && this.passengers.boarded < this.passengers.total) {
        this.flash('Wait until all passengers are on board');
        return;
      }
      p.doorOpen = false;
      this.flash('Cabin door closed and locked');
      return;
    }
    p.doorOpen = true;
    if (!this.boardingStarted) {
      this.boardingStarted = true;
      const door = p.doorSill(this.tmpV);
      this.passengers.start(this.passengerCount, new THREE.Vector3(door.x - 16, 0, door.z + 7), door.clone());
      this.flash(`Boarding ${this.passengerCount} passenger${this.passengerCount > 1 ? 's' : ''}`);
    }
  }

  private preflightReady(): string | null {
    if (!this.boardingStarted || this.passengers.boarded < this.passengers.total) return 'Board the passengers first (open the cabin door)';
    if (this.plane.doorOpen || !this.plane.doorFullyClosed) return 'Close the cabin door before starting the engine';
    if (!this.belts) return 'Switch on the seatbelt sign first';
    if (!this.plane.lightsOn) return 'Switch on the beacon before starting the engine';
    return null;
  }

  private startEngine(): void {
    const blocked = this.preflightReady();
    if (blocked) {
      this.flash(blocked);
      return;
    }
    if (this.fm.engine.start()) {
      this.fm.setThrottleLever(0);
      this.flash('Engine starting…');
    }
  }

  private begin(from: string, to: string): void {
    const route = getRoute(from, to);
    if (!route) {
      this.hub.show(true);
      return;
    }
    this.route = route;
    const origin = airportByIata(route.from);
    const dest = airportByIata(route.to);
    this.hud.setMissionRoute(route.from, origin?.city ?? route.from, route.to, dest?.city ?? route.to);
    this.world.setRouteAirports(route.from, route.to);
    this.reset();
    this.hub.show(false);
    this.hud.show('menu', false);
    this.hud.show('report', false);
    this.hud.show('pause', false);
    this.sound.start();
    this.sound.resume();
    this.state = 'flying';
    void acquireWakeLock();
  }

  /** Leave the flight / report and reopen the map hub (selection remembered). */
  private returnToHub(): void {
    this.reset();
    this.hud.show('report', false);
    this.hud.show('pause', false);
    this.sound.suspend();
    releaseWakeLock();
    this.state = 'menu';
    this.hub.show(true);
    this.lastFrame = performance.now();
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
    c.roll = this.input.roll;
    c.throttle = this.input.throttle;
    c.brake = this.input.brake;
    if (this.phase === 'preflight') {
      // Parked: brakes set, power stays at idle until the engine runs.
      c.brake = 1;
      if (fm.engine.state !== 'running') fm.setThrottleLever(0);
    }
    if (this.phase === 'falling') {
      this.simulateFall(dt);
      return;
    }

    fm.update(dt, c);
    if (this.phase !== 'preflight') this.flightTime += dt;

    if (fm.structuralFailure) {
      this.crash(fm.structuralFailure, 'Structural failure');
      return;
    }

    if (this.phase === 'preflight' && fm.engine.state === 'running') {
      this.phase = 'takeoff';
      this.flash('Engine running – wait for the take-off clearance, then full power', 4);
    }

    // Weather encountered, for the debrief.
    if (!fm.onGround && fm.air.cloud > 0.4) {
      const sev = fm.air.turbulence > 2 ? 'severe' : fm.air.turbulence > 1.1 ? 'moderate' : 'light';
      const rank = { none: 0, light: 1, moderate: 2, severe: 3 };
      if (rank[sev] > rank[this.stormEncounter]) this.stormEncounter = sev;
    }

    this.atcTimer -= dt;
    if (this.atcTimer <= 0) {
      this.atcTimer = 0.25;
      this.atc.update(0.25, {
        phase: this.phase,
        engineRunning: fm.engine.state === 'running',
        x: fm.x,
        y: fm.y,
        groundSpeed: fm.vx,
        climbRate: this.estimateClimbRate(),
        toAim: this.route.dest.x0 + 300 - fm.x,
        time: fm.time,
        originCity: airportByIata(this.route.from)?.city ?? this.route.from,
        destCity: airportByIata(this.route.to)?.city ?? this.route.to,
        originRunway: this.route.origin.designator,
        destRunway: this.route.dest.designator,
      });
    }

    if (fm.touchdown) {
      const td = fm.touchdown;
      fm.touchdown = null;
      this.onTouchdown(td);
      if (this.state !== 'flying') return;
    }

    if (this.phase === 'takeoff') {
      if (!fm.onGround && fm.y > 3) {
        this.phase = 'airborne';
        this.takeoffFlapsAtLiftoff = fm.flapIndex;
      } else if (fm.onGround && fm.x > this.route.origin.x1) {
        const city = airportByIata(this.route.from)?.city ?? this.route.from;
        this.fail('Runway overrun', `You ran out of runway in ${city}. Use full power and lift the nose (W) at about 110 km/h.`);
        return;
      }
    } else if (this.phase === 'rollout') {
      if (!fm.onGround && fm.y > 3) {
        this.phase = 'airborne';
        this.touchdownItems = null;
        this.tailStrike = false;
        this.flash('Go-around! Climb away and try again');
      } else if (fm.onGround) {
        if (fm.x > this.route.dest.x1) {
          if (fm.vx > 15) {
            this.fail(
              'Runway overrun',
              `The aircraft left the end of runway ${this.route.dest.designator} at speed. Touch down earlier and keep the power at idle to brake.`,
            );
            return;
          }
          this.overran = true;
        }
        if (fm.vx < 0.5 && this.touchdownItems) {
          recordSuccess(loadProgress(), this.route.to);
          this.state = 'report';
          this.hud.showReport(
            buildReport([...this.touchdownItems, ...this.flightItems()], this.overran, this.tailStrike, {
              title: this.route.welcomeTitle,
              message: this.route.welcomeMessage,
            }),
            this.statsLine(),
          );
        }
      }
    }

    if (!fm.onGround && fm.x > this.route.dest.x1 + 2600) {
      const city = airportByIata(this.route.to)?.city ?? this.route.to;
      this.fail(`Missed ${city}`, `You flew past the destination. Start the descent earlier and follow the PAPI lights to the runway.`);
    }
  }

  private onTouchdown(td: Touchdown): void {
    const vs = -td.verticalSpeed;
    this.sound.touchdown(Math.min(1, vs / 4));
    this.shake = Math.min(1, 0.15 + vs / 3);

    if (onRunway(td.x, this.route.origin)) {
      if (this.fm.maxAltitude < 8 && vs < 2) return;
      const v = evaluateTouchdown(td, this.route.origin);
      if (v.crash) this.crash(v.crash);
      else this.flash(`Touch-and-go at ${this.route.from} – your destination is ahead.`);
      return;
    }
    if (Math.abs(td.roll) > 0.3) {
      this.crash(`The wing tip hit the ground – the wings were banked ${Math.round(THREE.MathUtils.radToDeg(Math.abs(td.roll)))}° at touchdown. Keep the wings level (A/D or the yoke).`);
      return;
    }
    if (onRunway(td.x, this.route.dest)) {
      const v = evaluateTouchdown(td, this.route.dest);
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

  private crash(reason: string, title = 'Crash landing'): void {
    if (this.crashed || this.phase === 'falling') return;
    this.crashed = true;
    this.crashTitle = title;
    this.crashReason = reason;
    this.fm.throttle = 0;
    this.fm.setThrottleLever(0);
    // Everyone on board counts: passengers plus the pilot.
    recordCrash(loadProgress(), this.passengerCount + 1);

    const airborne = !this.fm.onGround && this.fm.y > 1.5;
    if (airborne) {
      // Broken airframe: kill lift feel, tumble, and fall — report only after impact.
      this.phase = 'falling';
      this.crashSpin = (Math.random() < 0.5 ? -1 : 1) * (1.1 + Math.random() * 0.9);
      this.fm.pitchRate = Math.min(this.fm.pitchRate, -0.35);
      this.fm.vy = Math.min(this.fm.vy, -2);
      this.shake = 0.85;
      this.flash('Mayday – airframe failure', 3);
      return;
    }

    // Already on the ground: short settle, then the report.
    this.shake = 1;
    this.fm.vx *= 0.35;
    this.fm.vy = 0;
    this.crashImpactHold = 0.7;
    this.phase = 'falling';
  }

  /** Ballistic wreck after mid-air breakup (or brief ground settle). */
  private simulateFall(dt: number): void {
    const fm = this.fm;
    this.flightTime += dt;
    this.crashTilt = Math.min(1, this.crashTilt + dt * 1.4);

    if (this.crashImpactHold > 0) {
      fm.vx *= Math.exp(-4 * dt);
      fm.x += fm.vx * dt;
      fm.y = 0;
      fm.onGround = true;
      fm.pitch = THREE.MathUtils.damp(fm.pitch, -0.35, 4, dt);
      fm.roll = THREE.MathUtils.damp(fm.roll, Math.sign(this.crashSpin || 1) * 0.85, 3, dt);
      this.crashImpactHold -= dt;
      if (this.crashImpactHold <= 0) this.finishCrashReport();
      return;
    }

    // No lift after breakup — gravity + drag, nose down, wing over.
    fm.vy -= 9.81 * dt;
    if (fm.y > 8) fm.vy -= 3.5 * dt;
    fm.vx *= Math.exp(-0.12 * dt);
    fm.x += fm.vx * dt;
    fm.y += fm.vy * dt;
    fm.pitchRate = THREE.MathUtils.damp(fm.pitchRate, -1.35, 2.2, dt);
    fm.pitch += fm.pitchRate * dt;
    fm.pitch = Math.max(-1.15, Math.min(0.55, fm.pitch));
    fm.rollRate = this.crashSpin;
    fm.roll += fm.rollRate * dt;
    if (Math.abs(fm.roll) > 2.4) this.crashSpin *= -0.4;
    this.shake = Math.min(1, this.shake + dt * 0.35);

    if (fm.y <= 0) {
      fm.y = 0;
      fm.onGround = true;
      const impact = Math.min(1, 0.35 + Math.abs(fm.vy) / 35);
      this.sound.touchdown(impact);
      this.shake = 1;
      fm.vx *= 0.25;
      fm.vy = 0;
      this.crashImpactHold = 0.9;
    }
  }

  private finishCrashReport(): void {
    this.fm.vx = 0;
    this.fm.vy = 0;
    this.state = 'report';
    this.hud.showReport(failureReport(this.crashTitle || 'Crash landing', this.crashReason), this.statsLine());
  }

  /** Flight-quality items for the debrief beyond the touchdown itself. */
  private flightItems(): ScoreItem[] {
    const fm = this.fm;
    const items: ScoreItem[] = [];
    if (this.takeoffFlapsAtLiftoff === 0) items.push({ label: 'Take-off flaps', value: 'Not set – 10° recommended', score: -5, max: 0 });
    if (fm.overspeedTime > 0) items.push({ label: 'Overspeed', value: `${fm.overspeedTime.toFixed(1)} s above Vne`, score: -10, max: 0 });
    if (fm.maxLoadFactor > fm.config.limits.limitLoadG) items.push({ label: 'Over-stress', value: `${fm.maxLoadFactor.toFixed(1)} g`, score: -10, max: 0 });
    if (fm.engine.chtHotTime > 0.5) {
      items.push({
        label: 'Engine heat',
        value: `${fm.engine.chtHotTime.toFixed(1)} s in red CHT`,
        score: fm.engine.chtHotTime > 8 ? -10 : -5,
        max: 0,
      });
    }
    if (this.stormEncounter !== 'none') {
      const score = this.stormEncounter === 'severe' ? -15 : this.stormEncounter === 'moderate' ? -8 : -3;
      items.push({ label: 'Thunderstorm', value: `Flew through ${this.stormEncounter} storm`, score, max: 0 });
    }
    return items;
  }

  /** Sustained climb rate available now at full power (energy method, best-rate speed). */
  private estimateClimbRate(): number {
    const fm = this.fm;
    const cfg = fm.config;
    const v = 49;
    const W = fm.mass * 9.81;
    const qS = 0.5 * 1.225 * v * v * cfg.geometry.wingAreaM2;
    const cl = W / qS;
    const drag = qS * (cfg.aero.cd0 + cfg.aero.inducedK * cl * cl);
    const thrust = Math.min(cfg.engine.staticThrustN, cfg.engine.maxPowerW / v);
    return Math.max(0, ((thrust - drag) * v) / W);
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
    this.plane.update(dt, fm.x, fm.y, fm.pitch - this.crashTilt * 0.12, fm.roll, {
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
    const buffet = (!fm.onGround && fm.stallMargin < 0.1 && V > 5 ? 0.25 : 0) + (fm.onGround ? 0 : Math.min(0.18, fm.air.turbulence * fm.air.cloud * 0.08));
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const amp = this.shake * 0.5 + buffet;
    const sx = amp ? Math.sin(this.time * 47) * amp * 0.35 : 0;
    const sy = amp ? Math.sin(this.time * 61 + 1.3) * amp * 0.45 : 0;
    this.camera.position.set(fm.x + this.lead + sx, this.camY + sy, this.camDist);

    this.world.update(this.time, this.camera.position.y);

    // Time of day along the route
    const progress = (this.camera.position.x - 1500) / (this.route.dest.x0 - 1500);
    const p = this.palette;
    samplePalette(progress, p, this.nightFlight);
    // Storms darken the existing atmosphere around them; inside the cloud the view closes in.
    const gloom = this.stormGloom(this.camera.position.x);
    const inCloud = this.state === 'menu' ? 0 : fm.air.cloud;
    this.storms.update(dt, this.time, fm.time, this.camera, fm.x, fm.y, this.state === 'menu' ? 0 : fm.air.rain);
    if (this.storms.strike !== null && this.state === 'flying') this.sound.thunder(Math.min(6, this.storms.strike / 340), this.storms.flash);
    const flash = this.storms.flash;
    p.tint.multiplyScalar(1 - 0.32 * gloom - 0.25 * inCloud).addScalar(flash * 0.35);
    p.haze.lerp(this.stormHaze, Math.min(1, 0.45 * gloom + 0.7 * inCloud)).addScalar(flash * 0.25);
    p.sunIntensity *= 1 - 0.55 * Math.max(gloom, inCloud);
    const skyDim = Math.min(0.75, 0.4 * gloom + 0.6 * inCloud);
    if (skyDim > 0) {
      p.skyTop.lerp(this.stormHaze, skyDim * 0.7);
      p.skyMid.lerp(this.stormHaze, skyDim);
      p.horizon.lerp(this.stormHaze, skyDim);
      p.sun.lerp(p.skyMid, Math.min(1, skyDim * 1.3));
    }
    atmosphere.tint.value.copy(p.tint);
    atmosphere.haze.value.copy(p.haze);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(p.haze);
    const night = this.nightFlight ? 1 : 0;
    fog.near = this.baseFog.near * (1 - 0.92 * inCloud) * (1 - 0.35 * night);
    fog.far = this.baseFog.far * (1 - 0.88 * inCloud) * (1 - 0.3 * gloom) * (1 - 0.45 * night);
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = (this.nightFlight ? 0.55 : 1.25) * (1 - 0.3 * gloom) + flash * 1.2;
    this.sun.color.copy(p.sunLight);
    this.sun.intensity = p.sunIntensity;
    this.renderer.toneMappingExposure = this.nightFlight ? 0.85 : 1.0;
    this.sky.update(p, this.camera);

    // Passengers boarding and the wing-tip trails.
    this.passengers.update(dt);
    this.plane.getWingTips(this.tipR, this.tipL);
    const humid = Math.max(fm.air.cloud, fm.air.rain * 0.6);
    const trail = fm.onGround || this.crashed ? 0 : Math.min(1, 0.35 + Math.max(0, fm.aoa) * 4 + humid * 0.6) * Math.min(1, V / 30);
    this.trails.update(dt, this.tipR, this.tipL, trail);

    const groundY = 0;
    this.sun.target.position.set(fm.x, (fm.y + groundY) * 0.5, 0);
    this.sun.position.copy(this.sun.target.position).add(this.sunOffset);
    this.blob.position.set(fm.x + 0.4, 0.05, 0.6);
    const blobFade = Math.max(0, 1 - fm.y / 45);
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.32 * blobFade;
    this.blob.visible = blobFade > 0;

    // PAPI and approach guidance
    let whites = -1;
    const toAim = this.route.dest.x0 + 300 - fm.x;
    if (toAim > 30) {
      const angle = THREE.MathUtils.radToDeg(Math.atan2(fm.y, toAim));
      whites = 0;
      for (const t of PAPI_THRESHOLDS) if (angle > t) whites++;
    }
    this.world.setPapi(Math.max(0, whites));

    if (this.state === 'flying') {
      const e = fm.engine;
      const level = e.state === 'running' ? 1 : e.state === 'starting' ? 0.4 + 0.6 * Math.abs(Math.sin(this.time * 9)) : 0;
      this.sound.update(fm.throttle, V, level, fm.air.rain);
    }

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
    const routeLen = this.route.dest.x0 + 300 - START_X;
    this.hud.update({
      speedKmh: kmh,
      altitude: fm.y,
      verticalSpeed: fm.vy,
      power: fm.throttle,
      cht: fm.engine.cht,
      flapsDeg: fm.flapDeg,
      flapsTargetDeg: fm.flapTargetDeg,
      gear: fm.gear,
      gearTarget: fm.gearTarget,
      progress: (fm.x - START_X) / routeLen,
      distanceKm: Math.max(0, this.route.dest.x0 - fm.x) / 1000,
      phase: this.phaseLabel(toAim),
      destCode: this.route.to,
      destRunway: this.route.dest.designator,
    });
    this.routeStormTimer -= 1 / 20;
    if (this.routeStormTimer <= 0) {
      this.routeStormTimer = 1;
      this.hud.setRouteStorms(
        this.weather.storms.map((s) => {
          const x = this.weather.stormX(s, fm.time);
          return { from: (x - s.radius - START_X) / routeLen, to: (x + s.radius - START_X) / routeLen, severity: s.severity };
        }),
      );
    }
    this.hud.setControlLit('flapsDown', fm.flapIndex > 0);
    this.hud.setControlLit('gear', fm.gearTarget > 0.5);
    this.hud.setBrakeLit(fm.braking || this.input.brake > 0.05);
    this.controlsUi.sync(fm.throttleLever);
    this.hud.setChecklist(flying && this.phase === 'preflight' ? this.checklist() : null);
    const msg = flying ? this.atc.current : null;
    this.hud.setAtc(msg ? msg.station : null, msg?.text, msg?.replies);
    const assigned = this.atc.assignedAltitude;
    this.hud.setAltitudeNote(assigned !== null && !fm.onGround ? `ATC ${assigned} m` : 'AGL');

    const airborne = !fm.onGround;
    const nearAirport =
      (fm.x > this.route.dest.x0 - 1500 && fm.x < this.route.dest.x1) || fm.x < this.route.origin.x1 + 600;
    const w = this.warnings;
    w.stall = flying && airborne && fm.stallMargin < 0.12 && fm.airspeed > 5;
    w.overspeed = flying && fm.overspeed;
    w.gear = flying && airborne && fm.gearTarget < 0.5 && fm.y < 120 && fm.vy < -0.5 && fm.x > this.route.dest.x0 - 6000;
    w.sink = flying && airborne && fm.y < 200 && fm.vy < -6;
    w.flaps = flying && fm.flapOverspeed;
    w.terrain = flying && airborne && fm.y < 40 && fm.vy < -3 && !nearAirport;
    w.cht = flying && fm.engine.state === 'running' && fm.engine.cht >= 0.78;
    this.hud.setWarnings(w, fm.engine.cht >= 0.9);

    this.hud.setPapi(flying && airborne && toAim > 30 && toAim < 6500 ? whites : -1);

    const camX = this.camera.position.x;
    const lm = flying || this.state === 'menu' ? this.route.landmarks.find((l) => camX >= l.x0 && camX <= l.x1) : undefined;
    this.hud.setLandmark(lm?.title ?? '', lm?.subtitle ?? '');

    if (this.flashTimer > 0) {
      this.flashTimer -= 1 / 20;
      this.hud.setHint(this.flashText);
    } else {
      this.hud.setHint(flying ? this.hint(toAim) : '');
    }
  }

  private checklist(): ChecklistView {
    const fm = this.fm;
    const p = this.plane;
    const boarded = this.passengers.boarded;
    const total = this.passengerCount;
    const allAboard = this.boardingStarted && boarded >= total;
    const doorClosed = !p.doorOpen && p.doorFullyClosed;
    const done = {
      door: allAboard && doorClosed,
      boarding: allAboard,
      lights: p.lightsOn,
      flaps: fm.flapIndex === 1,
      belts: this.belts,
      engine: fm.engine.state === 'running',
    };
    const order: (keyof typeof done)[] = ['boarding', 'door', 'lights', 'flaps', 'belts', 'engine'];
    let next = order.find((k) => !done[k]) ?? null;
    if (next === 'boarding' && p.doorOpen) next = this.boardingStarted && allAboard ? 'door' : 'boarding';
    else if (next === 'boarding') next = 'door';
    return {
      load: `${Math.round(fm.mass)} / ${fm.config.mass.mtowKg} kg`,
      door: p.doorOpen ? 'OPEN' : 'CLOSED',
      doorButton: p.doorOpen ? 'Close' : 'Open',
      doorEnabled: fm.engine.state === 'off' && (!p.doorOpen || allAboard),
      boarding: `${boarded} / ${total}`,
      lights: p.lightsOn,
      flaps: fm.flapIndex === 0 ? 'UP' : `${fm.flapTargetDeg}°`,
      belts: this.belts,
      engine: fm.engine.state === 'running' ? 'RUNNING' : fm.engine.state === 'starting' ? 'STARTING' : 'OFF',
      engineEnabled: fm.engine.state === 'off' && this.preflightReady() === null,
      done,
      next,
    };
  }

  /** 0..1 how much the storms around camera x darken the scene. */
  private stormGloom(x: number): number {
    let g = 0;
    for (const s of this.weather.storms) {
      const d = Math.abs(x - this.weather.stormX(s, this.fm.time)) / s.radius;
      const k = s.severity === 'severe' ? 1 : s.severity === 'moderate' ? 0.75 : 0.45;
      g = Math.max(g, k * (1 - Math.min(1, Math.max(0, (d - 0.6) / 2.4))));
    }
    return g;
  }

  private phaseLabel(toAim: number): string {
    const fm = this.fm;
    if (this.state === 'menu') return 'Ready for departure';
    if (this.phase === 'falling') return this.crashImpactHold > 0 ? 'Impact' : 'Uncontrolled descent';
    if (this.crashed) return 'Flight ended';
    const tod = this.nightFlight ? ' · Night' : '';
    if (this.phase === 'preflight') return `Pre-flight at runway ${this.route.origin.designator}${tod}`;
    if (this.phase === 'takeoff') {
      return (Math.abs(fm.vx) < 0.5 ? `Holding on runway ${this.route.origin.designator}` : 'Take-off roll') + tod;
    }
    if (this.phase === 'rollout') {
      const city = airportByIata(this.route.to)?.city ?? this.route.to;
      return (Math.abs(fm.vx) < 0.5 ? `Arrived in ${city}` : 'Landing roll') + tod;
    }
    const glideStart = fm.y / Math.tan(THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG));
    if (toAim < 2500) return 'Final approach';
    if (toAim < glideStart + 300) return 'Descent';
    return fm.vy > 1.5 ? 'Climb' : 'Cruise';
  }

  private hint(toAim: number): string {
    const fm = this.fm;
    const kmh = fm.airspeed * 3.6;
    if (this.phase === 'preflight') {
      const c = this.checklist();
      if (!this.boardingStarted || !c.done.boarding) return this.plane.doorOpen ? 'Passengers are boarding…' : 'Open the cabin door (O) to board the passengers';
      if (!c.done.door) return 'Close the cabin door (O)';
      if (!c.done.lights) return this.nightFlight ? 'Night departure – switch on the beacon and navigation lights (L)' : 'Switch on the beacon and navigation lights (L)';
      if (!c.done.flaps) return 'Set take-off flaps 10°';
      if (!c.done.belts) return 'Switch on the seatbelt sign (N)';
      return fm.engine.state === 'starting' ? 'Engine starting…' : 'Start the engine (I)';
    }
    if (this.phase === 'takeoff') {
      if (fm.throttleLever < 0.95) return 'Push the throttle lever to full power (Shift)';
      if (kmh < 100) return `Accelerating… lift the nose at 110 km/h`;
      return 'Rotate! Pull the yoke (W / ↑) to raise the nose';
    }
    if (this.phase === 'rollout') {
      if (Math.abs(fm.vx) <= 0.5) return '';
      if (fm.throttleLever > 0.05) return 'Idle the throttle (X), then hold Brake';
      return fm.braking ? 'Braking…' : 'Hold the Brake pedal to stop';
    }
    if (this.phase === 'falling') return '';
    if (fm.stalled) return 'STALL! Nose down and add power – do not pull!';
    if (fm.overspeed) return 'Overspeed! Reduce power and raise the nose';
    if (fm.engine.cht >= 0.9) return 'Engine heat – reduce throttle';
    if (fm.engine.cht >= 0.78) return 'CHT rising – ease power or gain speed for cooling';
    if (fm.loadFactor > fm.config.limits.limitLoadG * 0.85) return 'Too many g – ease off the yoke!';
    if (Math.abs(fm.roll) > 0.45) return 'Steep bank – level the wings (A / D)';
    if (fm.air.cloud > 0.3 && fm.air.turbulence > 1.2 && kmh > 200) return 'Severe turbulence – slow below 200 km/h to protect the airframe';
    const glideStart = fm.y / Math.tan(THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG));
    const descending = toAim < glideStart + 200;
    if (!descending) {
      if (fm.gearTarget > 0.5 && fm.y > 15) return 'Positive climb – retract the landing gear (G)';
      if (fm.flapIndex > 0 && fm.y > 60) return 'Retract the flaps (V) for cruise';
      const target = this.atc.assignedAltitude ?? SUGGESTED_CRUISE_ALT;
      if (fm.y < target - 60) return `Climb to ${target} m${this.atc.assignedAltitude !== null ? ' as assigned by ATC' : ''}`;
      if (this.atc.assignedAltitude !== null && fm.y > target + 80) return `Descend to ${target} m as assigned by ATC`;
      if (this.atc.assignedAltitude === null && fm.y > SUGGESTED_CRUISE_ALT + 250 && toAim < glideStart + 3000) {
        const city = airportByIata(this.route.to)?.city ?? this.route.to;
        return `You are high – ${city} is close, plan your descent`;
      }
      if (toAim < glideStart + 1200) return 'Top of descent ahead – get ready to reduce power';
      return 'Cruise around 350 m at ~200 km/h (about 70% power)';
    }
    if (toAim > 0) {
      if (fm.y < 14 && fm.x > this.route.dest.x0 - 300) return 'Flare: cut the power (X) and gently raise the nose (W) – do not let the speed decay below ~110 km/h';
      if (fm.stallMargin < 0.18 && fm.y < 80) return 'Too slow on approach – add a little power or lower the nose';
      if (fm.flapOverspeed) return 'Too fast for this flap setting – slow down or retract (V)';
      if (fm.gearTarget < 0.5 && toAim < 5000) return 'Landing gear down (G)';
      if (fm.flapsTarget < 1 && toAim < 3500) return `Flaps ${fm.flapIndex === 0 ? 'down' : 'further'} (F) for landing – full is 30°`;
      if (kmh > 170 && toAim < 3000) return 'Too fast – reduce power, aim for ~120 km/h';
      if (kmh < 105 && toAim < 2500 && fm.flapIndex < 2) return 'Too slow without enough flaps – add power or set flaps';
      return 'Descend on the glide path: 2 white + 2 red PAPI lights';
    }
    return fm.y < 14 ? 'Flare and touch down on the runway' : 'You are long – land now or go around';
  }
}
