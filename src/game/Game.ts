import * as THREE from 'three';
import { EngineSound } from '../audio/EngineSound';
import { GLIDE_SLOPE_DEG, START_X } from '../config';
import { airportByIata } from '../meta/airports';
import { distanceKm, formatCredits, isWithinRange, settleCrash, settleSuccess } from '../meta/economy';
import { aimPointX, remapCorridorX, targetFlightSec } from '../meta/flightLength';
import { loadProgress, recordCrash } from '../meta/progress';
import { DEFAULT_ROUTE, getRoute, layoutRoute, type FlightRoute } from '../meta/routes';
import type { AircraftModel } from '../render/Airplane';
import { createAircraftModel } from '../render/aircraftModels';
import { aircraftById } from '../sim/aircraft';
import { CHT_RED, CHT_YELLOW, tempGaugeLabel } from '../sim/Engine';
import { atmosphere } from '../render/Billboards';
import { Sky, createPalette, samplePalette } from '../render/Sky';
import { Passengers } from '../render/Passengers';
import { Storms } from '../render/Storms';
import { Trails } from '../render/Trails';
import { World } from '../render/World';
import { FlightModel, type Touchdown } from '../sim/FlightModel';
import { fullThrust, maxFlapDeg } from '../sim/aircraft/AircraftConfig';
import { plannedLoad } from '../sim/LoadSheet';
import { Weather } from '../sim/Weather';
import { buildReport, evaluateTouchdown, failureReport, onRunway, type ScoreItem } from '../sim/Landing';
import { initAds, showInterstitialThen } from '../ads/admob';
import { initIap } from '../iap/playBilling';
import { acquireWakeLock, bindNativeLifecycle, isNativePlatform, releaseWakeLock } from '../native';
import { FlightControls } from '../ui/FlightControls';
import { HubMenu } from '../ui/HubMenu';
import { Hud, type ChecklistView, type WarningKey } from '../ui/Hud';
import type { CoachCue } from '../ui/Coach';
import { RegisterScreen } from '../ui/RegisterScreen';
import { flushPendingPlayer, hasPlayer, loadPlayer } from '../meta/player';
import { onLangChange, t } from '../i18n';
import { Atc } from './Atc';
import { Input, type PressAction } from './Input';

type State = 'menu' | 'flying' | 'paused' | 'report';
type Phase = 'preflight' | 'takeoff' | 'airborne' | 'rollout' | 'falling';
type Quality = 'low' | 'medium' | 'high';

const QUALITY: Record<Quality, { pixelRatio: number; shadowMap: number }> = {
  low: { pixelRatio: 1, shadowMap: 0 },
  medium: { pixelRatio: 1.5, shadowMap: 1024 },
  high: { pixelRatio: 2, shadowMap: 2048 },
};
const QUALITY_ORDER: Quality[] = ['low', 'medium', 'high'];

const CP_KEY = 'airways.copilot';
const LEGACY_AP_KEY = 'airways.autopilot';
const BASE_FOV = 38;
const CAMERA_PITCH = -0.045;

function loadCopilot(): boolean {
  const v = localStorage.getItem(CP_KEY) ?? localStorage.getItem(LEGACY_AP_KEY);
  if (v === 'on') return true;
  if (v === 'off') return false;
  return loadProgress().successfulFlights === 0;
}
const PAPI_THRESHOLDS = [3.0, 3.33, 3.67, 4.0];
/** Walkers drawn on the apron; airliner loads board as a representative group. */
const MAX_VISIBLE_PASSENGERS = 12;
const round10 = (v: number) => Math.round(v / 10) * 10;

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 28000);
  private readonly world: World;
  private plane: AircraftModel;
  private readonly envMap: THREE.Texture;
  /** Camera / shadow scale for the current aircraft (1 = C172). */
  private sizeK = 1;
  private readonly sky = new Sky();
  private readonly palette = createPalette();
  private readonly fm = new FlightModel();
  private readonly input = new Input();
  private readonly hud: Hud;
  private readonly hub: HubMenu;
  private readonly register: RegisterScreen;
  private route: FlightRoute = layoutRoute(DEFAULT_ROUTE, this.fm.config.performance);
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
  private readonly seamHaze = new THREE.Color(0xd8e4ee);
  private readonly sunOffset = new THREE.Vector3(26, 52, 34).normalize().multiplyScalar(60);

  private state: State = 'menu';
  private phase: Phase = 'preflight';
  private passengerCount = 1;
  private belts = false;
  private boardingStarted = false;
  private lastDoorClosed = true;
  /** Random day / night departure for this flight. */
  private nightFlight = false;
  private takeoffFlapsAtLiftoff = -1;
  private stormEncounter: 'none' | 'light' | 'moderate' | 'severe' = 'none';
  /** Corridor x positions where a cruise meal service may start. */
  private mealAt: number[] = [];
  private meal: { left: number; dur: number; rough: number } | null = null;
  private mealResults: { ok: boolean; rough: number; dur: number }[] = [];
  /** Seconds a trolley run lasts on this hop (scales with cruise). */
  private mealDur = 10;
  /** Smoothed glide angle for airliner PAPI (deg). Light types skip the filter. */
  private papiAngle = GLIDE_SLOPE_DEG;
  private papiWhitesHeld = 2;
  /** Corridor x of a one-shot cruise engine failure; 0 = none this hop. */
  private engineFailX = 0;
  private engineFailed = false;
  private engineRelit = false;
  /** Seconds of cruise with the seatbelt sign off / still on. */
  private beltCruiseOffS = 0;
  private beltCruiseOnS = 0;
  private beltDescentOffS = 0;
  private beltWxOffS = 0;
  private beltHintCruise = false;
  private beltHintDescent = false;
  private beltWxHintCool = 0;
  private atcTimer = 0;
  private routeStormTimer = 0;
  private quality: Quality;
  /** Coach overlay that points at the next control. On by default for the first flight. */
  private copilot: boolean;
  private touchdownItems: ScoreItem[] | null = null;
  private overran = false;
  private tailStrike = false;
  private flightTime = 0;
  private crashed = false;
  private crashTilt = 0;
  /** Pending debrief after the wreck finishes falling / settling. */
  private crashTitle = '';
  private crashReason = '';
  /** Repair bill settled at crash time, shown on the debrief. */
  private crashBill = 0;
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
  private beltSign: 'on' | 'off' | null = null;
  private beltSignTimer = 0;
  /** Once near the destination, Copilot stays on landing config even if the nose comes up. */
  private coachLanding = false;
  /** After TOD, never ask to climb or retract gear/flaps — even if altitude makes the TOD window shrink. */
  private arrivalCommitted = false;
  /** Gear and take-off flaps are up. Until then, Copilot stays on climb-out even on a 3-minute hop. */
  private climbOutComplete = false;

  private readonly warnings: Record<WarningKey, boolean> = {
    stall: false,
    overspeed: false,
    gear: false,
    sink: false,
    flaps: false,
    terrain: false,
    cht: false,
    engine: false,
  };
  private readonly controls = { pitch: 0, roll: 0, throttle: 0, brake: 0, speedBrake: 0 };

  private readonly app: HTMLElement;

  constructor(app: HTMLElement) {
    const bootAt = performance.now();
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

    this.envMap = this.createEnvironmentMap();
    this.plane = createAircraftModel(this.fm.config, this.envMap);
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
    this.register = new RegisterScreen(document.getElementById('register')!, (player) => {
      this.hub.setAirline(player.airline);
      this.hub.maybeStartTour();
    });
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
    void initAds();
    void initIap();

    this.applyQuality();
    this.resize();
    this.setAircraft(loadProgress().activeAircraft);
    this.route = layoutRoute(DEFAULT_ROUTE, this.fm.config.performance);
    this.world.setCorridor(this.route.layout);
    this.reset();
    this.copilot = loadCopilot();
    this.hud.setMuted(false);
    this.hud.setCopilot(this.copilot);
    onLangChange(() => this.onLanguageChange());
    const hold = Math.max(0, 1600 - (performance.now() - bootAt));
    window.setTimeout(() => this.hud.show('loading', false), hold);
    this.hud.show('hud', true);
    this.hub.show(true);
    const player = loadPlayer();
    if (player) {
      this.hub.setAirline(player.airline);
      flushPendingPlayer();
    } else this.register.show();
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
    this.hud.setQuality(t(`hub.quality.${this.quality}`));
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
    this.sound.setFlapsMoving(false);
    const seed = (Math.random() * 2 ** 31) | 0;
    this.nightFlight = (seed >>> 8) % 100 < 42;
    this.weather = new Weather({ seed });
    // Storm slots are authored on the reference corridor — place them on this hop.
    for (const cell of this.weather.storms) cell.x0 = remapCorridorX(cell.x0, this.route.layout);
    this.fm.weather = this.weather;
    this.fm.reset(START_X, false);
    this.storms.setWeather(this.weather);
    const cfg = this.fm.config;
    this.atc.reset(this.weather, {
      callsign: cfg.registration,
      cruiseAlt: this.route.layout.cruiseAltM,
      // Storm climbs stay near the hop's cruise — never the brochure ceiling on a short leg.
      ceiling: this.route.layout.cruiseAltM + 200,
      turbulenceKmh: round10(cfg.limits.vnoKmh * 0.74),
    });
    // 55–95 % of the seats sold; fuel is planned so the take-off mass stays within MTOW.
    const load = plannedLoad(this.fm.config, 0.55 + ((seed >>> 4) % 41) / 100);
    this.passengerCount = load.passengers;
    this.fm.setLoad(load);
    this.plane.doorOpen = false;
    this.plane.lightsOn = false;
    this.belts = false;
    this.boardingStarted = false;
    this.lastDoorClosed = true;
    this.passengers.clear();
    this.trails.reset();
    this.takeoffFlapsAtLiftoff = -1;
    this.stormEncounter = 'none';
    this.scheduleCabinEvents(seed);
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
    this.crashBill = 0;
    this.crashImpactHold = 0;
    this.crashSpin = 0;
    this.shake = 0;
    this.camY = 4.2 * this.sizeK;
    this.camDist = 29 * this.sizeK;
    this.lead = 3.5 * this.sizeK;
    this.flashText = '';
    this.flashTimer = 0;
    this.beltSign = null;
    this.beltSignTimer = 0;
    this.coachLanding = false;
    this.arrivalCommitted = false;
    this.climbOutComplete = false;
    this.papiAngle = GLIDE_SLOPE_DEG;
    this.papiWhitesHeld = 2;
  }

  // ------------------------------------------------------------------ input

  private onPress(a: PressAction): void {
    switch (a) {
      case 'start':
        if (this.register.visible) break;
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
      case 'copilot':
        this.setCopilotEnabled(!this.copilot);
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
        if (fm.flapIndex === before) this.flash(a === 'flapsDown' ? t('flash.flapsFullDown') : t('flash.flapsAlreadyUp'));
        else {
          this.sound.flapSelect();
          this.flash(fm.flapIndex === 0 ? t('flash.flapsRetracting') : t('flash.flapsDeg', { deg: fm.flapTargetDeg }));
        }
        break;
      }
      case 'gear':
        if (this.state !== 'flying') break;
        if (!this.fm.toggleGear()) this.flash(t('flash.gearNoRetract'));
        else this.flash(this.fm.gearTarget > 0.5 ? t('flash.gearDownNow') : t('flash.gearUpNow'));
        break;
      case 'flapsTakeoff':
        if (this.state !== 'flying') break;
        if (this.fm.flapIndex !== 1) this.sound.flapSelect();
        this.fm.setFlapIndex(1);
        this.flash(t('flash.flapsTakeoffNow', { deg: this.takeoffFlapDeg }));
        break;
      case 'door':
        if (this.state === 'flying' && this.phase === 'preflight') this.toggleDoor();
        break;
      case 'lights':
        if (this.state !== 'flying') break;
        this.plane.lightsOn = !this.plane.lightsOn;
        this.flash(this.plane.lightsOn ? t('flash.lightsOnNow') : t('flash.lightsOff'));
        break;
      case 'belts':
        if (this.state !== 'flying') break;
        this.belts = !this.belts;
        this.sound.seatbeltChime();
        this.beltSign = this.belts ? 'on' : 'off';
        this.beltSignTimer = 2.6;
        this.flash(this.belts ? t('flash.beltsOn') : t('flash.beltsOff'));
        break;
      case 'engineStart':
        if (this.state !== 'flying') break;
        if (this.phase === 'preflight') this.startEngine();
        else this.relightEngine();
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
      this.flash(t('flash.shutEngineDoor', { engine: this.engineWord }));
      return;
    }
    if (p.doorOpen) {
      if (this.boardingStarted && this.passengers.boarded < this.passengers.total) {
        this.flash(t('flash.waitPax'));
        return;
      }
      p.doorOpen = false;
      this.sound.doorClose();
      this.flash(t('flash.doorLocked'));
      return;
    }
    p.doorOpen = true;
    this.sound.doorOpen();
    if (!this.boardingStarted) {
      this.boardingStarted = true;
      const door = p.doorSill(this.tmpV);
      const run = this.plane.stairRun;
      this.passengers.start(
        Math.min(this.passengerCount, MAX_VISIBLE_PASSENGERS),
        new THREE.Vector3(door.x - 16 - run, 0, door.z + 7 + run),
        door.clone(),
        run,
      );
      this.flash(
        this.passengerCount > 1
          ? t('flash.boardingMany', { n: this.passengerCount })
          : t('flash.boardingOne'),
      );
    }
  }

  private preflightReady(): string | null {
    if (!this.boardingStarted || this.passengers.boarded < this.passengers.total) return t('flash.boardFirst');
    if (this.plane.doorOpen || !this.plane.doorFullyClosed) return t('flash.closeDoorStart', { engine: this.engineWord });
    if (!this.belts) return t('flash.beltsFirst');
    if (!this.plane.lightsOn) return t('flash.beaconFirst', { engine: this.engineWord });
    return null;
  }

  private get aimX(): number {
    return aimPointX(this.route.layout);
  }

  private get engineWord(): string {
    return this.fm.config.engineCount > 1 ? t('word.engines') : t('word.engine');
  }

  private onLanguageChange(): void {
    this.hud.refreshLang();
    this.hud.setQuality(t(`hub.quality.${this.quality}`));
    this.hud.setMuted(this.sound.muted);
    this.hud.setCopilot(this.copilot);
    this.hud.setAircraft(
      tempGaugeLabel(this.fm.config),
      this.fm.config.limits.vneKmh * 1.05,
      this.takeoffFlapDeg,
      this.fm.config.engineCount,
      !!this.fm.config.speedBrake,
    );
    this.hub.refreshLang();
  }

  private get takeoffFlapDeg(): number {
    return this.fm.config.flaps.detents[1]?.deg ?? 0;
  }

  /** Passengers on board, in real heads (only a handful walk out to the aircraft). */
  private get boardedCount(): number {
    const p = this.passengers;
    if (p.total === 0) return 0;
    return p.boarded >= p.total ? this.passengerCount : Math.floor((p.boarded / p.total) * this.passengerCount);
  }

  private startEngine(): void {
    const blocked = this.preflightReady();
    if (blocked) {
      this.flash(blocked);
      return;
    }
    if (this.fm.engine.start()) {
      this.fm.setThrottleLever(0);
      this.flash(this.fm.config.engineCount > 1 ? t('flash.enginesStarting') : t('flash.engineStarting'));
    }
  }

  /** Airborne restart after a cruise cutoff — skip the boarding checklist. */
  private relightEngine(): void {
    if (this.fm.engine.state !== 'off') return;
    if (this.plane.doorOpen || !this.plane.doorFullyClosed) {
      this.flash(t('flash.closeDoorStart', { engine: this.engineWord }));
      return;
    }
    if (this.fm.engine.start(true)) {
      this.flash(this.fm.config.engineCount > 1 ? t('flash.relightingMany') : t('flash.relightingOne'));
    }
  }

  /** 0 on light types (C172–King Air). ATR and up get a wider, slower PAPI. */
  private papiEase(): number {
    const b = this.fm.config.controls.flareBoost ?? 0;
    if (b <= 0) return 0;
    return Math.min(1, 0.5 + ((b - 0.08) / 0.04) * 0.5);
  }

  /**
   * Count white PAPI lamps (0..4, or -1 if too close). Light aircraft keep the original
   * 0.17° on-path window. Faster types filter the angle and need a clearer miss to leave
   * two-white / two-red, so the lights stop flickering on every bump.
   */
  private stepPapi(dt: number, toAim: number): number {
    if (toAim <= 30) {
      this.papiWhitesHeld = -1;
      return -1;
    }
    const raw = THREE.MathUtils.radToDeg(Math.atan2(this.fm.y, toAim));
    const ease = this.papiEase();
    if (ease <= 0) {
      this.papiAngle = raw;
      let whites = 0;
      for (const t of PAPI_THRESHOLDS) if (raw > t) whites++;
      this.papiWhitesHeld = whites;
      return whites;
    }

    const tau = 0.2 + 0.35 * ease;
    this.papiAngle += (raw - this.papiAngle) * (1 - Math.exp(-dt / tau));
    const inner = 0.17 + 0.28 * ease;
    const outer = 0.5 + 0.42 * ease;
    const c = GLIDE_SLOPE_DEG;
    const thresholds = [c - outer, c - inner, c + inner, c + outer];
    const hyst = 0.06 + 0.12 * ease;
    const prev = Math.max(0, this.papiWhitesHeld);
    let whites = 0;
    for (let i = 0; i < 4; i++) {
      if (prev > i ? this.papiAngle > thresholds[i] - hyst : this.papiAngle > thresholds[i]) whites++;
    }
    this.papiWhitesHeld = whites;
    return whites;
  }

  /** Place meal service (and maybe an engine cut) in proportion to this hop's cruise. */
  private scheduleCabinEvents(seed: number): void {
    this.mealAt = [];
    this.meal = null;
    this.mealResults = [];
    this.engineFailX = 0;
    this.engineFailed = false;
    this.engineRelit = false;
    this.beltCruiseOffS = 0;
    this.beltCruiseOnS = 0;
    this.beltDescentOffS = 0;
    this.beltWxOffS = 0;
    this.beltHintCruise = false;
    this.beltHintDescent = false;
    this.beltWxHintCool = 0;

    const km = distanceKm(this.route.from, this.route.to);
    const cruiseSec = Math.max(30, targetFlightSec(km) - this.fm.config.performance.padTimeS);
    const origin = this.route.layout.originEnd;
    const dest = this.route.layout.destX0;
    const span = Math.max(1000, dest - origin);
    let s = seed | 0;
    const rnd = () => {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      return (s >>> 0) / 4294967296;
    };

    // 3-min hops stay mostly quiet. One trolley once cruise has room, two on the 5–7 min legs.
    this.mealDur = Math.round(Math.min(14, Math.max(8, cruiseSec * 0.05)));
    if (cruiseSec >= 90) this.mealAt.push(origin + span * 0.32);
    if (cruiseSec >= 175) this.mealAt.push(origin + span * 0.55);
    const failChance = cruiseSec >= 200 ? 0.55 : 0.4;
    if (cruiseSec >= 110 && rnd() < failChance) {
      const mealFrac = this.mealDur / cruiseSec;
      const gap = Math.max(span * 0.08, span * mealFrac * 1.8);
      for (const f of [0.44, 0.4, 0.5, 0.62, 0.36]) {
        const x = origin + span * f;
        if (this.mealAt.every((m) => Math.abs(m - x) > gap)) {
          this.engineFailX = x;
          break;
        }
      }
    }
  }

  private weatherNeedsBelts(): boolean {
    const a = this.fm.air;
    return a.rain > 0.12 || a.cloud > 0.35 || a.turbulence > 0.85;
  }

  /** Planned top-of-descent distance from the aim point, from this hop's cruise height. */
  private todRangeM(): number {
    return this.route.layout.cruiseAltM / Math.tan(THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG));
  }

  /** Level cruise, well before top of descent. */
  private inCruise(toAim: number): boolean {
    if (this.phase !== 'airborne' || this.fm.onGround || !this.climbOutComplete) return false;
    if (toAim < this.todRangeM() + 1500) return false;
    return this.fm.y > this.route.layout.cruiseAltM * 0.55 && this.fm.vy < 2.8;
  }

  private inDescent(toAim: number): boolean {
    if (this.phase !== 'airborne' || this.fm.onGround || !this.climbOutComplete) return false;
    return toAim < this.todRangeM() + 400;
  }

  /** Last stretch to the arrival runway. Must not fire on take-off: short hops are only a few km long. */
  private onLandingApproach(toAim: number): boolean {
    if (this.coachLanding) return true;
    if (this.phase !== 'airborne' || this.fm.onGround) return false;
    // Climb-out / go-around: keep asking gear up, not landing flaps.
    if (!this.climbOutComplete && this.fm.vy >= 0) return false;
    const originEnd = this.route.origin.x1;
    const destX0 = this.route.dest.x0;
    if (this.fm.x < originEnd + 800) return false;
    const hop = Math.max(2000, destX0 - originEnd);
    const window = Math.min(2800, Math.max(1400, hop * 0.32));
    if (toAim < window || this.fm.x > destX0 - window) this.coachLanding = true;
    return this.coachLanding;
  }

  /**
   * True once climb-out is done and we have reached TOD or short final.
   * Latches so Copilot cannot flip back to "gear up / climb".
   */
  private isArrival(toAim: number): boolean {
    if (this.arrivalCommitted) return true;
    if (this.phase !== 'airborne' || this.fm.onGround) return false;
    if (!this.climbOutComplete && !this.onLandingApproach(toAim)) return false;
    if (this.inDescent(toAim) || this.onLandingApproach(toAim)) {
      this.arrivalCommitted = true;
      return true;
    }
    return false;
  }

  private noteClimbOut(): void {
    if (this.climbOutComplete || this.phase !== 'airborne' || this.fm.onGround) return;
    const gearUp = !this.fm.config.gear.retractable || this.fm.gearTarget < 0.5;
    if (this.fm.y > 12 && gearUp && this.fm.flapIndex === 0) this.climbOutComplete = true;
  }

  private stepCabin(dt: number): void {
    if (this.phase !== 'airborne' || this.crashed) return;
    const fm = this.fm;
    const toAim = this.aimX - fm.x;
    const cruise = this.inCruise(toAim);
    const descent = this.inDescent(toAim);
    const wx = this.weatherNeedsBelts();

    if (cruise && !wx) {
      if (this.belts) this.beltCruiseOnS += dt;
      else this.beltCruiseOffS += dt;
    }
    if (descent && !this.belts) this.beltDescentOffS += dt;
    if (wx && !this.belts) this.beltWxOffS += dt;

    if (cruise && !wx && this.belts && !this.beltHintCruise && this.beltCruiseOnS > 8) {
      this.beltHintCruise = true;
      this.flash(t('flash.beltsCruiseOff'), 5);
    }
    if (descent && !this.belts && !this.beltHintDescent) {
      this.beltHintDescent = true;
      this.flash(t('flash.beltsDescentOn'), 5);
    }
    this.beltWxHintCool = Math.max(0, this.beltWxHintCool - dt);
    if (wx && !this.belts && this.beltWxHintCool <= 0) {
      this.beltWxHintCool = 18;
      this.flash(t('flash.beltsWx'), 4);
    }

    if (
      this.engineFailX > 0 &&
      !this.engineFailed &&
      cruise &&
      fm.x >= this.engineFailX &&
      fm.engine.state === 'running'
    ) {
      this.engineFailed = true;
      if (this.meal) this.finishMeal(false);
      fm.engine.fail();
      this.shake = Math.max(this.shake, 0.5);
      this.flash(t('flash.engineFailRelight', { engine: this.engineWord }), 6);
    }
    if (this.engineFailed && !this.engineRelit && fm.engine.state === 'running') {
      this.engineRelit = true;
      this.flash(this.fm.config.engineCount > 1 ? t('flash.enginesAliveAgain') : t('flash.engineAliveAgain'), 3);
    }

    if (this.meal) {
      if (!cruise || fm.engine.state !== 'running') {
        this.finishMeal(false);
      } else {
        this.meal.left -= dt;
        const bank = Math.abs(fm.roll) * (180 / Math.PI);
        const pitch = Math.abs(fm.pitch) * (180 / Math.PI);
        if (bank > 10 || pitch > 12 || Math.abs(fm.vy) > 2.8) this.meal.rough += dt;
        if (bank > 22 || pitch > 20 || Math.abs(fm.vy) > 6) this.finishMeal(false);
        else if (this.meal.left <= 0) this.finishMeal(this.meal.rough < this.meal.dur * 0.2);
      }
    } else if (
      cruise &&
      fm.engine.state === 'running' &&
      !wx &&
      this.mealAt.length > 0 &&
      fm.x >= this.mealAt[0]
    ) {
      // Late into cruise: keep at most one overdue service so they do not stack.
      while (this.mealAt.length > 1 && fm.x >= this.mealAt[1]) this.mealAt.shift();
      this.mealAt.shift();
      this.meal = { left: this.mealDur, dur: this.mealDur, rough: 0 };
      this.flash(t('flash.mealServe'), 5);
    } else if (this.mealAt.length > 0 && descent && fm.x >= this.mealAt[0]) {
      this.mealAt.shift();
    }
  }

  private finishMeal(ok: boolean): void {
    if (!this.meal) return;
    const { rough, dur } = this.meal;
    this.mealResults.push({ ok, rough, dur });
    this.meal = null;
    this.flash(ok ? (rough < dur * 0.06 ? t('flash.mealWell') : t('flash.mealFinished')) : t('flash.mealMove'), 4);
  }

  /** Fly a different type: flight model, 3D model, engine voice, gauges and camera scale. */
  private setAircraft(id: string): void {
    const cfg = aircraftById(id);
    const changed = cfg !== this.fm.config;
    this.fm.setAircraft(cfg);
    if (changed) {
      this.scene.remove(this.plane.root);
      this.plane.dispose();
      this.plane = createAircraftModel(cfg, this.envMap);
      this.scene.add(this.plane.root);
    }
    const len = cfg.visual?.lengthM ?? 8.3;
    this.sizeK = Math.max(1, ((0.6 * len + 0.4 * cfg.roll.wingSpanM) / 9.4) ** 0.85);
    const sh = 16 * Math.max(1, this.sizeK * 0.9);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -sh;
    cam.right = cam.top = sh;
    cam.far = 150 * this.sizeK;
    cam.updateProjectionMatrix();
    this.sunOffset.normalize().multiplyScalar(60 * this.sizeK);
    this.blob.scale.set(cfg.visual ? len * 0.85 : 7, 1, cfg.roll.wingSpanM * 0.9);
    this.world.setLightScale(this.sizeK);
    this.sound.setProfile(cfg.propulsion);
    this.hud.setAircraft(
      tempGaugeLabel(cfg),
      cfg.limits.vneKmh * 1.05,
      this.takeoffFlapDeg,
      cfg.engineCount,
      !!cfg.speedBrake,
    );
  }

  private async begin(from: string, to: string): Promise<void> {
    if (!hasPlayer()) {
      this.register.show();
      return;
    }
    const authored = getRoute(from, to);
    const progress = loadProgress();
    if (!authored || !isWithinRange(from, to, progress.activeAircraft)) {
      this.hub.show(true);
      return;
    }
    await showInterstitialThen();
    this.setAircraft(progress.activeAircraft);
    if (localStorage.getItem(CP_KEY) === null && localStorage.getItem(LEGACY_AP_KEY) === null && progress.successfulFlights === 0) {
      this.setCopilotEnabled(true);
    }
    const route = layoutRoute(authored, this.fm.config.performance);
    this.route = route;
    const origin = airportByIata(route.from);
    const dest = airportByIata(route.to);
    this.hud.setMissionRoute(route.from, origin?.city ?? route.from, route.to, dest?.city ?? route.to);
    this.world.setCorridor(route.layout);
    this.world.setRouteScenery(route.scenery);
    this.world.setRouteAirports(route.from, route.to);
    this.world.setRouteGeography(route.from, route.to);
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

  /** Leave the flight / report and reopen the map hub with a fresh route pick. */
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
    c.speedBrake = this.input.speedBrake;
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
      this.flash(this.fm.config.engineCount > 1 ? t('flash.enginesWaitToga') : t('flash.engineWaitToga'), 4);
    }

    // Weather encountered, for the debrief.
    if (!fm.onGround && fm.air.cloud > 0.4) {
      const sev = fm.air.turbulence > 2 ? 'severe' : fm.air.turbulence > 1.1 ? 'moderate' : 'light';
      const rank = { none: 0, light: 1, moderate: 2, severe: 3 };
      if (rank[sev] > rank[this.stormEncounter]) this.stormEncounter = sev;
    }

    this.stepCabin(dt);

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
        toAim: this.aimX - fm.x,
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
        this.climbOutComplete = false;
      } else if (fm.onGround && fm.x > this.route.origin.x1) {
        const city = airportByIata(this.route.from)?.city ?? this.route.from;
        this.fail(
          t('fail.overrun'),
          t('fail.overrunTo', { city, vr: this.fm.config.limits.vrKmh }),
        );
        return;
      }
    } else if (this.phase === 'rollout') {
      if (!fm.onGround && fm.y > 3) {
        this.phase = 'airborne';
        this.touchdownItems = null;
        this.tailStrike = false;
        this.coachLanding = false;
        this.arrivalCommitted = false;
        this.climbOutComplete = false;
        this.flash(t('flash.goAround'));
      } else if (fm.onGround) {
        if (fm.x > this.route.dest.x1) {
          if (fm.vx > 15) {
            this.fail(
              t('fail.overrun'),
              t('fail.overrunLand', { rwy: this.route.dest.designator }),
            );
            return;
          }
          this.overran = true;
        }
        if (fm.vx < 0.5 && this.touchdownItems) {
          const report = buildReport([...this.touchdownItems, ...this.flightItems()], this.overran, this.tailStrike, {
            title: this.route.welcomeTitle,
            message: this.route.welcomeMessage.replace('OM-BTV', this.fm.config.registration),
          });
          const { payout } = settleSuccess(loadProgress(), this.route.from, this.route.to, report.total);
          this.state = 'report';
          this.hud.showReport(report, this.statsLine(), `+${formatCredits(payout.net)}`);
        }
      }
    }

    this.noteClimbOut();

    // Past the far end with no landing — scrub the charter, not a crash.
    if (!fm.onGround && fm.x > this.route.dest.x1 + 900) {
      const city = airportByIata(this.route.to)?.city ?? this.route.to;
      this.fail(
        t('fail.overshot'),
        t('fail.overshotCity', { rwy: this.route.dest.designator, city }),
      );
    }
  }

  private onTouchdown(td: Touchdown): void {
    const vs = -td.verticalSpeed;
    this.sound.touchdown(Math.min(1, vs / 4));
    this.shake = Math.min(1, 0.15 + vs / 3);

    if (onRunway(td.x, this.route.origin)) {
      if (this.fm.maxAltitude < 8 && vs < 2) return;
      const v = evaluateTouchdown(td, this.route.origin, this.fm.config);
      if (v.crash) this.crash(v.crash);
      else this.flash(t('flash.touchGo', { code: this.route.from }));
      return;
    }
    if (Math.abs(td.roll) > 0.3) {
      this.crash(t('fail.wingTip', { deg: Math.round(THREE.MathUtils.radToDeg(Math.abs(td.roll))) }));
      return;
    }
    if (onRunway(td.x, this.route.dest)) {
      const v = evaluateTouchdown(td, this.route.dest, this.fm.config);
      if (v.crash) {
        this.crash(v.crash);
        return;
      }
      this.touchdownItems = v.items;
      this.tailStrike = td.pitch > this.fm.config.geometry.tailStrikePitch + 0.02;
      this.phase = 'rollout';
      this.flash(vs < 1 ? t('flash.butterIdle') : t('flash.touchIdle'));
      return;
    }
    // Longitudinally past the far threshold — scrubbed charter, not a wreck.
    if (td.x > this.route.dest.x1) {
      this.fail(
        t('fail.overshot'),
        t('fail.overshotEarly', { rwy: this.route.dest.designator }),
      );
      return;
    }
    const waterSpans = this.world.waterHazards(this.route.scenery);
    const inWater = waterSpans.some(([a, b]) => td.x > a && td.x < b);
    const seaish = waterSpans.some(([a, b]) => b - a > 1500);
    const waterMsg = seaish ? t('fail.ditchSea') : t('fail.ditchRiver');
    this.crash(inWater ? waterMsg : t('fail.offRunway'));
  }

  private crash(reason: string, title = t('fail.crashTitle')): void {
    if (this.crashed || this.phase === 'falling') return;
    this.crashed = true;
    this.crashTitle = title;
    this.crashReason = reason;
    this.fm.throttle = 0;
    this.fm.setThrottleLever(0);
    // Everyone on board counts: passengers plus the pilot.
    let progress = recordCrash(loadProgress(), this.passengerCount + 1);
    const settled = settleCrash(progress);
    progress = settled.progress;
    this.crashBill = settled.bill;

    const airborne = !this.fm.onGround && this.fm.y > 1.5;
    if (airborne) {
      // Broken airframe: kill lift feel, tumble, and fall — report only after impact.
      this.phase = 'falling';
      this.crashSpin = (Math.random() < 0.5 ? -1 : 1) * (1.1 + Math.random() * 0.9);
      this.fm.pitchRate = Math.min(this.fm.pitchRate, -0.35);
      this.fm.vy = Math.min(this.fm.vy, -2);
      this.shake = 0.85;
      this.flash(t('flash.mayday'), 3);
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
    const money = this.crashBill > 0 ? `−${formatCredits(this.crashBill)} repair` : '';
    this.hud.showReport(
      failureReport(this.crashTitle || 'Crash landing', this.crashReason),
      this.statsLine(),
      money,
    );
  }

  /** Flight-quality items for the debrief beyond the touchdown itself. */
  private flightItems(): ScoreItem[] {
    const fm = this.fm;
    const items: ScoreItem[] = [];
    if (this.takeoffFlapsAtLiftoff === 0) {
      items.push({ label: t('item.takeoffFlaps'), value: t('item.takeoffFlapsVal', { deg: this.takeoffFlapDeg }), score: -5, max: 0 });
    }
    if (fm.overspeedTime > 0) {
      items.push({ label: t('item.overspeed'), value: t('item.overspeedVal', { s: fm.overspeedTime.toFixed(1) }), score: -10, max: 0 });
    }
    if (fm.maxLoadFactor > fm.config.limits.limitLoadG) {
      items.push({ label: t('item.overstress'), value: t('item.overstressVal', { g: fm.maxLoadFactor.toFixed(1) }), score: -10, max: 0 });
    }
    if (fm.engine.chtHotTime > 0.5) {
      items.push({
        label: t('item.engineHeat'),
        value: t('item.engineHeatVal', { s: fm.engine.chtHotTime.toFixed(1), gauge: tempGaugeLabel(fm.config) }),
        score: fm.engine.chtHotTime > 8 ? -10 : -5,
        max: 0,
      });
    }
    if (this.stormEncounter !== 'none') {
      const score = this.stormEncounter === 'severe' ? -15 : this.stormEncounter === 'moderate' ? -8 : -3;
      items.push({
        label: t('item.storm'),
        value: t('item.stormVal', { sev: t(`atc.sev.${this.stormEncounter}`) }),
        score,
        max: 0,
      });
    }
    for (let i = 0; i < this.mealResults.length; i++) {
      const r = this.mealResults[i];
      const label = this.mealResults.length > 1 ? t('item.mealN', { n: i + 1 }) : t('item.meal');
      if (!r.ok) items.push({ label, value: t('item.mealInterrupted'), score: -3, max: 0 });
      else if (r.rough < r.dur * 0.06) items.push({ label, value: t('item.mealSmooth'), score: 8, max: 8 });
      else items.push({ label, value: t('item.mealDone'), score: 3, max: 8 });
    }
    if (this.engineFailed) {
      if (this.engineRelit) items.push({ label: t('item.relight'), value: t('item.relightVal'), score: 8, max: 8 });
      else items.push({ label: t('item.engineOut'), value: t('item.engineOutVal', { engine: this.engineWord }), score: -10, max: 0 });
    }
    if (this.beltCruiseOffS + this.beltCruiseOnS > 12) {
      if (this.beltCruiseOffS >= 20) items.push({ label: t('item.belts'), value: t('item.beltsOffCruise'), score: 4, max: 4 });
      else if (this.beltCruiseOnS > this.beltCruiseOffS) {
        items.push({ label: t('item.belts'), value: t('item.beltsOnCruise'), score: -2, max: 0 });
      }
    }
    if (this.beltDescentOffS > 4) {
      items.push({ label: t('item.beltsDescent'), value: t('item.beltsDescentVal', { s: this.beltDescentOffS.toFixed(0) }), score: -8, max: 0 });
    }
    if (this.beltWxOffS > 3) {
      items.push({ label: t('item.beltsWx'), value: t('item.beltsWxVal'), score: -6, max: 0 });
    }
    return items;
  }

  /** Sustained climb rate available now at full power (energy method, best-rate speed). */
  private estimateClimbRate(): number {
    const fm = this.fm;
    const cfg = fm.config;
    const v = (cfg.limits.vs1Kmh * 1.55) / 3.6;
    const W = fm.mass * 9.81;
    const qS = 0.5 * 1.225 * v * v * cfg.geometry.wingAreaM2;
    const cl = W / qS;
    const drag = qS * (cfg.aero.cd0 + cfg.aero.inducedK * cl * cl);
    const thrust = fullThrust(cfg.propulsion, cfg.engine, v);
    return Math.max(0, ((thrust - drag) * v) / W);
  }

  /** Mission scrubbed without a wreck — no pay, no crash/death counters. */
  private fail(title: string, message: string): void {
    this.state = 'report';
    this.hud.showReport(failureReport(title, message), this.statsLine(), t('fail.noPay'));
  }

  private statsLine(): string {
    const m = Math.floor(this.flightTime / 60);
    const s = Math.floor(this.flightTime % 60).toString().padStart(2, '0');
    return t('hud.stats', {
      time: `${m}:${s}`,
      alt: Math.round(this.fm.maxAltitude),
      km: (Math.max(0, this.fm.x - START_X) / 1000).toFixed(1),
    });
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
      speedBrake: fm.speedBrake,
    });

    // Camera: plane slightly left of centre, gentle vertical lag, zoom out with speed and altitude
    const k = (rate: number) => 1 - Math.exp(-rate * dt);
    const K = this.sizeK;
    this.lead += (3.5 * K + V * 0.08 - this.lead) * k(1.5);
    this.camY += (Math.max(fm.y + 2.6 * K, 4.2 * K) - this.camY) * k(3.5);
    const targetDist = 29 * K + Math.min(V * 0.09, 6 * K) + Math.min(fm.y * 0.025, 16 * K);
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
    const fog = this.scene.fog as THREE.Fog;
    const night = this.nightFlight ? 1 : 0;
    const bank = this.state === 'flying' ? this.world.seamFog(fm.x) : 0;
    p.haze.lerp(this.seamHaze, bank * 0.72);
    p.horizon.lerp(this.seamHaze, bank * 0.55);
    p.skyMid.lerp(this.seamHaze, bank * 0.28);
    atmosphere.tint.value.copy(p.tint);
    atmosphere.haze.value.copy(p.haze);
    atmosphere.seam.value = bank;
    fog.color.copy(p.haze);
    // Bigger aircraft pull the camera back; push the fog back with it so the scenery stays crisp.
    const fogPush = this.camDist - 29;
    fog.near = (this.baseFog.near + fogPush) * (1 - 0.92 * inCloud) * (1 - 0.35 * night) * (1 - 0.88 * bank);
    fog.far = (this.baseFog.far + fogPush * 2) * (1 - 0.88 * inCloud) * (1 - 0.3 * gloom) * (1 - 0.45 * night) * (1 - 0.7 * bank);
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
    const blobFade = Math.max(0, 1 - fm.y / (45 * this.sizeK));
    (this.blob.material as THREE.MeshBasicMaterial).opacity = 0.32 * blobFade;
    this.blob.visible = blobFade > 0;

    // PAPI and approach guidance
    const toAim = this.aimX - fm.x;
    const whites = this.stepPapi(dt, toAim);
    this.world.setPapi(Math.max(0, whites));

    if (this.state === 'flying') {
      const e = fm.engine;
      const level = e.state === 'running' ? 1 : e.state === 'starting' ? e.startProgress : 0;
      this.sound.update(fm.throttle, V, level, fm.air.rain);
      this.sound.setFlapsMoving(Math.abs(fm.flapDeg - fm.flapTargetDeg) > 0.35);
      const closed = this.plane.doorFullyClosed;
      if (closed && !this.lastDoorClosed) this.sound.doorLatch();
      this.lastDoorClosed = closed;
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
    const routeLen = this.aimX - START_X;
    const progress = Math.min(1, Math.max(0, (fm.x - START_X) / routeLen));
    const realKm = distanceKm(this.route.from, this.route.to);
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
      progress,
      distanceKm: realKm * (1 - progress),
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
    this.hud.setFlightBelts(
      (this.state === 'flying' || this.state === 'paused') && this.phase !== 'preflight',
      this.belts,
    );
    const engineOut = this.engineFailed && fm.engine.state !== 'running';
    if (engineOut) {
      this.hud.setCabin({
        kind: 'engine',
        tag: t('hud.cabinEngine'),
        text:
          fm.engine.state === 'starting'
            ? t('hud.cabinRelighting', { engine: this.engineWord })
            : t('hud.cabinEngineFail', { engine: this.engineWord }),
        start: fm.engine.state === 'off',
        urgent: true,
      });
    } else if (this.meal) {
      this.hud.setCabin({
        kind: 'meal',
        tag: t('hud.cabinCabin'),
        text: t('hud.cabinMeal', { s: Math.ceil(this.meal.left) }),
        start: false,
        timer: this.meal.left / this.meal.dur,
      });
    } else {
      this.hud.setCabin(null);
    }
    if (this.beltSignTimer > 0) {
      this.beltSignTimer -= 1 / 20;
      if (this.beltSignTimer <= 0) this.beltSign = null;
    }
    this.hud.setBeltSign(this.beltSign);
    this.hud.setBrakeLit(fm.braking || this.input.brake > 0.05);
    this.hud.setSpeedBrakeLit(fm.speedBrake > 0.15 || this.input.speedBrake > 0.05);
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
    w.cht = flying && fm.engine.state === 'running' && fm.engine.cht >= CHT_YELLOW;
    w.engine = flying && airborne && this.engineFailed && fm.engine.state !== 'running';
    this.hud.setWarnings(w, fm.engine.cht >= CHT_RED);

    // Show PAPI from before top-of-descent: big jets start down much further out than a C172.
    const glideRad = THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG);
    const papiFar = Math.max(6500, this.route.layout.cruiseAltM / Math.tan(glideRad) + 4000);
    this.hud.setPapi(flying && airborne && toAim > 30 && toAim < papiFar ? whites : -1);

    const camX = this.camera.position.x;
    const lm = flying || this.state === 'menu' ? this.route.landmarks.find((l) => camX >= l.x0 && camX <= l.x1) : undefined;
    this.hud.setLandmark(lm?.title ?? '', lm?.subtitle ?? '');

    const cue = this.copilot && (flying || this.state === 'paused') ? this.coachCue(toAim) : null;
    this.hud.setCoach(cue);
    if (this.flashTimer > 0) {
      this.flashTimer -= 1 / 20;
      this.hud.setHint(this.flashText);
    } else {
      this.hud.setHint(flying && !cue ? this.hint(toAim) : '');
    }
  }

  private setCopilotEnabled(on: boolean): void {
    this.copilot = on;
    localStorage.setItem(CP_KEY, on ? 'on' : 'off');
    localStorage.removeItem(LEGACY_AP_KEY);
    this.hud.setCopilot(on);
    const flying = this.state === 'flying' || this.state === 'paused';
    this.hud.setCoach(on && flying ? this.coachCue(this.aimX - this.fm.x) : null);
  }

  /** Next control to press, with a short why — used by the Copilot coach. */
  private coachCue(toAim: number): CoachCue | null {
    const fm = this.fm;
    if (this.state !== 'flying' && this.state !== 'paused') return null;
    if (this.crashed || this.phase === 'falling') return null;
    this.noteClimbOut();
    const kmh = fm.airspeed * 3.6;
    const lim = fm.config.limits;
    const atc = this.atc.current;

    if (this.engineFailed && !this.engineRelit && fm.engine.state === 'off') {
      return { id: 'relight', text: t('coach.relightCut', { engine: this.engineWord }) };
    }
    if (this.phase === 'preflight') {
      const c = this.checklist();
      if (!this.boardingStarted) return { id: 'door', text: t('coach.openDoor') };
      if (!c.done.boarding) return { id: 'boarding', text: t('coach.waitBoard') };
      if (!c.done.door) return { id: 'door', text: t('coach.closeDoor') };
      if (!c.done.lights) return { id: 'lights', text: t('coach.beaconOn') };
      if (!c.done.flaps) return { id: 'flapsTakeoff', text: t('coach.flapsLift', { deg: this.takeoffFlapDeg }) };
      if (!c.done.belts) return { id: 'beltsCl', text: t('coach.beltsTaxi') };
      if (fm.engine.state === 'starting') return null;
      return { id: 'engine', text: t('coach.startRoll', { engine: this.engineWord }) };
    }
    if (this.phase === 'takeoff') {
      if (fm.throttleLever < 0.95) return { id: 'throttle', text: t('coach.fullToga') };
      if (kmh < lim.vrKmh * 0.9) return { id: 'throttle', text: t('coach.holdVr', { vr: lim.vrKmh }) };
      return { id: 'yoke', text: t('coach.pullYoke') };
    }
    if (this.phase === 'rollout') {
      if (Math.abs(fm.vx) <= 0.5) return null;
      if (fm.throttleLever > 0.05) return { id: 'throttle', text: t('coach.idleStop') };
      return { id: 'brake', text: t('coach.holdBrake') };
    }
    if (fm.stalled) return { id: 'yoke', text: t('coach.stallPush') };
    if (fm.overspeed) return { id: 'throttle', text: t('coach.overspeed') };

    // Short final first — never "gear up" once the runway is close.
    if (this.onLandingApproach(toAim)) {
      if (!this.belts) return { id: 'belts', text: t('coach.beltsDescent') };
      if (fm.gearTarget < 0.5) return { id: 'gear', text: t('coach.gearLand') };
      if (fm.flapsTarget < 1) return { id: 'flapsDown', text: t('coach.landingFlaps', { deg: maxFlapDeg(fm.config) }) };
      if (toAim <= 0 || (fm.y < 14 && fm.x > this.route.dest.x0 - 300)) {
        return { id: 'yoke', text: t('coach.flareCut') };
      }
      return null;
    }

    // Climb-out must finish before any descent talk, even on a 3-minute hop.
    if (this.phase === 'airborne' && !this.climbOutComplete) {
      if (fm.config.gear.retractable && fm.gearTarget > 0.5 && fm.y > 12) {
        return { id: 'gear', text: t('coach.gearClimb') };
      }
      if (fm.flapIndex > 0 && fm.y > 18) {
        return { id: 'flapsUp', text: t('coach.flapsCruise') };
      }
    }

    if (this.isArrival(toAim)) {
      if (!this.belts) return { id: 'belts', text: t('coach.beltsDescent') };
      if (fm.throttleLever > 0.82) return { id: 'throttle', text: t('coach.descent') };
      return null;
    }

    if (this.climbOutComplete && fm.throttleLever > 0.82) {
      return { id: 'throttle', text: t('coach.cruise70') };
    }

    if (this.weatherNeedsBelts() && !this.belts) return { id: 'belts', text: t('coach.beltsWx') };
    if (this.meal) return { id: 'yoke', text: t('coach.mealYoke') };
    if (atc && atc.replies.length) {
      const label = atc.replies[0];
      return {
        id: 'atc',
        text: label === t('atc.wilco') ? t('coach.tapWilcoAtc') : t('coach.tapReply', { label }),
      };
    }
    if (this.belts && this.beltCruiseOnS > 8 && this.inCruise(toAim) && !this.weatherNeedsBelts()) {
      return { id: 'belts', text: t('coach.beltsOffCruise') };
    }
    return null;
  }

  private checklist(): ChecklistView {
    const fm = this.fm;
    const p = this.plane;
    const boarded = this.boardedCount;
    const total = this.passengerCount;
    const allAboard = this.boardingStarted && this.passengers.boarded >= this.passengers.total;
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
      door: p.doorOpen ? t('hud.openState') : t('hud.closedState'),
      doorButton: p.doorOpen ? t('hud.close') : t('hud.open'),
      doorEnabled: fm.engine.state === 'off' && (!p.doorOpen || allAboard),
      boarding: `${boarded} / ${total}`,
      lights: p.lightsOn,
      flaps: fm.flapIndex === 0 ? t('hud.up') : `${fm.flapTargetDeg}°`,
      belts: this.belts,
      engine: fm.engine.state === 'running' ? t('hud.running') : fm.engine.state === 'starting' ? t('hud.starting') : t('hud.engineOff'),
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
    if (this.state === 'menu') return t('phase.ready');
    if (this.phase === 'falling') return this.crashImpactHold > 0 ? t('phase.impact') : t('phase.falling');
    if (this.crashed) return t('phase.ended');
    const tod = this.nightFlight ? t('hud.night') : '';
    if (this.phase === 'preflight') return t('phase.preflightRwy', { rwy: this.route.origin.designator }) + tod;
    if (this.phase === 'takeoff') {
      return (Math.abs(fm.vx) < 0.5 ? t('phase.holdingRwy', { rwy: this.route.origin.designator }) : t('phase.takeoffRoll')) + tod;
    }
    if (this.phase === 'rollout') {
      const city = airportByIata(this.route.to)?.city ?? this.route.to;
      return (Math.abs(fm.vx) < 0.5 ? t('phase.arrived', { city }) : t('phase.landingRoll')) + tod;
    }
    const glideStart = fm.y / Math.tan(THREE.MathUtils.degToRad(GLIDE_SLOPE_DEG));
    if (toAim < 2500) return t('phase.final');
    if (toAim < glideStart + 300) return t('phase.descent');
    return fm.vy > 1.5 ? t('phase.climb') : t('phase.cruise');
  }

  private hint(toAim: number): string {
    const fm = this.fm;
    const kmh = fm.airspeed * 3.6;
    const lim = fm.config.limits;
    const cruiseAlt = this.route.layout.cruiseAltM;
    const turbulenceKmh = round10(lim.vnoKmh * 0.74);
    const temp = tempGaugeLabel(fm.config);
    if (this.phase === 'preflight') {
      const c = this.checklist();
      if (!this.boardingStarted || !c.done.boarding) return this.plane.doorOpen ? t('hint.boarding') : t('hint.openDoor');
      if (!c.done.door) return t('hint.closeDoor');
      if (!c.done.lights) return this.nightFlight ? t('hint.lightsNight') : t('hint.lightsDay');
      if (!c.done.flaps) return t('hint.flapsSet', { deg: this.takeoffFlapDeg });
      if (!c.done.belts) return t('hint.beltsOn');
      if (fm.engine.state === 'starting') return fm.config.engineCount > 1 ? t('flash.enginesStarting') : t('flash.engineStarting');
      return t('hint.startEngine', { engine: this.engineWord });
    }
    if (this.phase === 'takeoff') {
      if (fm.throttleLever < 0.95) return t('hint.fullPower');
      if (kmh < lim.vrKmh * 0.9) return t('hint.accel', { vr: lim.vrKmh });
      return t('hint.rotateYoke');
    }
    if (this.phase === 'rollout') {
      if (Math.abs(fm.vx) <= 0.5) return '';
      if (fm.throttleLever > 0.05) return t('hint.idleThenBrake');
      return fm.braking ? t('hint.braking') : t('hint.holdBrake');
    }
    if (this.phase === 'falling') return '';
    if (this.engineFailed && !this.engineRelit && fm.engine.state !== 'running') {
      return fm.engine.state === 'starting'
        ? t('hint.relightingNose')
        : t('hint.engineFailI', { engine: this.engineWord });
    }
    if (this.meal) return t('hint.mealHold', { s: Math.ceil(this.meal.left) });
    if (fm.stalled) return t('hint.stall');
    if (fm.overspeed) return t('hint.overspeed');
    if (fm.engine.cht >= CHT_RED) return t('hint.engineHeat');
    if (fm.engine.cht >= CHT_YELLOW) {
      return fm.config.propulsion === 'piston' ? t('hint.chtPiston') : t('hint.chtOther', { gauge: temp });
    }
    if (fm.loadFactor > fm.config.limits.limitLoadG * 0.85) return t('hint.tooManyG');
    if (Math.abs(fm.roll) > 0.45) return t('hint.steepBank');
    if (this.inDescent(toAim) && !this.belts) return t('hint.beltsDescent');
    if (this.weatherNeedsBelts() && !this.belts) return t('hint.beltsWx');
    if (fm.air.cloud > 0.3 && fm.air.turbulence > 1.2 && kmh > turbulenceKmh) {
      return t('hint.turbSlow', { spd: turbulenceKmh });
    }
    const glideStart = this.todRangeM();
    const descending = this.climbOutComplete && (toAim < glideStart + 400 || this.isArrival(toAim));
    if (this.onLandingApproach(toAim)) {
      if (fm.gearTarget < 0.5) return t('hint.gearLanding');
      if (fm.flapsTarget < 1) return t('hint.flapsLanding', { deg: maxFlapDeg(fm.config) });
      if (fm.y < 14) return t('hint.flareSpeed', { spd: round10(lim.vs1Kmh * 1.18) });
      return t('hint.finalPapi');
    }
    if (!descending) {
      if (fm.gearTarget > 0.5 && fm.y > 12) return t('hint.posClimb');
      if (fm.flapIndex > 0 && fm.y > 18) return t('hint.retractFlaps');
      const target = this.atc.assignedAltitude ?? cruiseAlt;
      if (fm.y < target - 60) return t(this.atc.assignedAltitude !== null ? 'hint.climbAtc' : 'hint.climbTo', { alt: target });
      if (this.atc.assignedAltitude !== null && fm.y > target + 80) return t('hint.descendAtc', { alt: target });
      if (this.atc.assignedAltitude === null && fm.y > cruiseAlt + 250 && toAim < glideStart + 3000) {
        const city = airportByIata(this.route.to)?.city ?? this.route.to;
        return t('hint.highCity', { city });
      }
      const vApp = round10(lim.vrefKmh * 1.3);
      const decel = fm.config.propulsion === 'jet' ? 0.8 : 0.45;
      const slowDist = Math.max(0, (fm.airspeed ** 2 - (vApp / 3.6) ** 2) / (2 * decel));
      if (kmh > vApp + 20 && toAim < glideStart + slowDist + 1500) {
        if (fm.config.speedBrake && fm.speedBrake < 0.4) return t('hint.slowSpdBrk', { spd: vApp });
        return t('hint.slowApp', { spd: vApp });
      }
      if (toAim < glideStart + 1200) return t('hint.tod');
      if (this.belts && this.beltCruiseOnS > 8 && !this.weatherNeedsBelts()) return t('hint.beltsOffOk');
      return t('hint.cruiseHold', { alt: cruiseAlt, spd: fm.config.performance.cruiseKmh });
    }
    if (toAim > 0) {
      if (fm.y < 14 && fm.x > this.route.dest.x0 - 300) {
        return t('hint.flareSpeed', { spd: round10(lim.vs1Kmh * 1.18) });
      }
      if (fm.stallMargin < 0.18 && fm.y < 80) return t('hint.tooSlowApp');
      if (fm.flapOverspeed) return t('hint.flapOverspeed');
      if (fm.gearTarget < 0.5 && toAim < 5000) return t('hint.gearLanding');
      if (fm.flapsTarget < 1 && toAim < 3500) {
        return t(fm.flapIndex === 0 ? 'hint.flapsDownLand' : 'hint.flapsFurther', { deg: maxFlapDeg(fm.config) });
      }
      if (kmh > lim.vrefKmh * 1.4 && toAim < 3000) {
        if (fm.config.speedBrake && fm.speedBrake < 0.4) return t('hint.tooFastBrk', { spd: lim.vrefKmh });
        return t('hint.tooFast', { spd: lim.vrefKmh });
      }
      if (kmh < lim.vrefKmh * 0.88 && toAim < 2500 && fm.flapIndex < 2) return t('hint.tooSlowFlaps');
      return t('hint.glidePapi');
    }
    return fm.y < 14 ? t('hint.flareLand') : t('hint.long');
  }
}
