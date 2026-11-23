import {
  ACESFilmicToneMapping,
  type BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Texture,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { AudioSystem } from '../audio/AudioSystem';
import { bakeToSingleGeometry, loadOptionalGlb } from '../render/AssetLoader';
import type { GameSettings, GraphicsQuality } from '../config/settings';
import { GameLoop } from '../core/GameLoop';
import { RAD2DEG } from '../core/math';
import { InputManager } from '../input/InputManager';
import type { GameAction } from '../input/actions';
import type { ParkConfig } from '../park/types';
import { CameraController } from '../render/CameraController';
import { createSnowMaterial } from '../render/materials';
import { ParkMeshes } from '../render/ParkMeshes';
import { SkiTracks } from '../render/SkiTracks';
import { SkierAnimator, type SkierPoseInput } from '../render/SkierAnimator';
import { SkierModel } from '../render/SkierModel';
import { SnowSpray, Snowfall } from '../render/SnowParticles';
import { buildBackdropMountains, buildTerrainMesh } from '../render/TerrainMesh';
import { Forest } from '../render/Trees';
import { createSnowNormalTexture, createSoftDotTexture } from '../render/textures';
import { Simulation } from '../sim/Simulation';
import type { SimEvents } from '../sim/events';

export interface GameCallbacks {
  onProgress: (progress: number, label: string) => void;
  onHud: (hud: HudSnapshot) => void;
  onEvent: <K extends keyof SimEvents>(type: K, payload: SimEvents[K]) => void;
  onPauseRequest: () => void;
  onError: (message: string) => void;
}

export interface HudSnapshot {
  speedKmh: number;
  state: SimEvents['stateChanged']['to'];
  score: number;
  comboTricks: number;
  comboMultiplier: number;
  comboPoints: number;
  charge: number;
  airTime: number;
  liveTrick: string;
  grinding: boolean;
  railLabel: string;
  balance: number;
  fps: number;
  runTime: number;
  hint: string;
}

interface QualityProfile {
  shadowMapSize: number;
  shadows: boolean;
  pixelRatioCap: number;
  terrainSpacing: number;
  featureResolution: number;
  treeFraction: number;
  spray: number;
  snowfall: number;
  sparkle: boolean;
  antialias: boolean;
}

const QUALITY: Record<GraphicsQuality, QualityProfile> = {
  low: {
    shadowMapSize: 1024,
    shadows: false,
    pixelRatioCap: 1,
    terrainSpacing: 3,
    featureResolution: 0.6,
    treeFraction: 0.45,
    spray: 600,
    snowfall: 0,
    sparkle: false,
    antialias: false,
  },
  medium: {
    shadowMapSize: 2048,
    shadows: true,
    pixelRatioCap: 1.5,
    terrainSpacing: 2,
    featureResolution: 0.4,
    treeFraction: 0.75,
    spray: 1200,
    snowfall: 1200,
    sparkle: true,
    antialias: true,
  },
  high: {
    shadowMapSize: 4096,
    shadows: true,
    pixelRatioCap: 2,
    terrainSpacing: 1.5,
    featureResolution: 0.3,
    treeFraction: 1,
    spray: 2000,
    snowfall: 2500,
    sparkle: true,
    antialias: true,
  },
};

const SUN_DIRECTION = new Vector3(-0.45, 0.62, -0.64).normalize();

const _v = new Vector3();
const _v2 = new Vector3();
const _fwd = new Vector3();

/**
 * Browser game orchestrator: owns the WebGL renderer, scene, simulation, input, audio and the fixed
 * timestep loop. React never touches any of this directly - it only receives HUD snapshots and events.
 */
export class Game {
  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(62, 16 / 9, 0.1, 6000);
  private sim: Simulation | null = null;
  private cameraCtl: CameraController | null = null;
  private skier: SkierModel | null = null;
  private readonly animator = new SkierAnimator();
  private parkMeshes: ParkMeshes | null = null;
  private forest: Forest | null = null;
  private spray: SnowSpray | null = null;
  private snowfall: Snowfall | null = null;
  private tracks: SkiTracks | null = null;
  private sun: DirectionalLight | null = null;
  private envTexture: Texture | null = null;
  private featureSnow: MeshStandardMaterial | null = null;
  private readonly disposables: { dispose(): void }[] = [];
  private loop: GameLoop | null = null;
  readonly input: InputManager;
  readonly audio: AudioSystem;
  private settings: GameSettings;
  private quality: QualityProfile;
  private readonly prevPos = new Vector3();
  private readonly currPos = new Vector3();
  private readonly prevQuat = new Quaternion();
  private readonly currQuat = new Quaternion();
  private hudTimer = 0;
  private renderTime = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  private paused = false;

  constructor(
    private readonly container: HTMLElement,
    settings: GameSettings,
    private readonly parkConfig: ParkConfig,
    private readonly callbacks: GameCallbacks,
  ) {
    this.settings = settings;
    this.quality = QUALITY[settings.graphics];
    this.input = new InputManager(settings.bindings);
    this.audio = new AudioSystem(settings.audio);
  }

  /**
   * Builds everything. Yields between heavy steps so the loading screen can update.
   *
   * The game can be disposed while this is still running (React StrictMode mounts, unmounts and re-mounts
   * effects in development; leaving the loading screen does the same). After every await we therefore check
   * `disposed` and release whatever was created in the meantime, so an abandoned init never attaches a canvas
   * or keeps a simulation alive. Returns false when initialisation was aborted.
   */
  async init(): Promise<boolean> {
    const report = this.callbacks.onProgress;
    const yieldFrame = () => new Promise<void>((r) => setTimeout(r, 0));
    const aborted = () => {
      if (!this.disposed) return false;
      this.releaseResources();
      return true;
    };
    report(0.02, 'Starting renderer');
    await yieldFrame();
    if (aborted()) return false;
    this.createRenderer();
    report(0.08, 'Shaping the mountain');
    await yieldFrame();
    if (aborted()) return false;
    this.sim = await Simulation.create(this.parkConfig, {}, (p, label) => report(0.08 + p * 0.3, label));
    if (aborted()) return false;
    this.sim.cfg.air.landingAssist = this.settings.landingAssist ? 9 : 0;
    report(0.38, 'Loading models');
    const treeModel = await loadOptionalGlb(`${import.meta.env.BASE_URL}models/pine.glb`);
    const treeGeometry = treeModel ? bakeToSingleGeometry(treeModel) : null;
    if (aborted()) {
      treeGeometry?.dispose();
      return false;
    }
    report(0.4, 'Building terrain');
    await yieldFrame();
    if (aborted()) return false;
    this.buildEnvironment(treeGeometry);
    report(0.75, 'Building the snowpark');
    await yieldFrame();
    if (aborted()) return false;
    this.buildPark();
    report(0.88, 'Waxing skis');
    await yieldFrame();
    if (aborted()) return false;
    this.buildSkier();
    this.wireEvents();
    this.input.attach();
    this.input.onAction = (a) => this.handleMetaAction(a);
    this.cameraCtl = new CameraController(this.camera, this.settings.camera, this.sim.park.surface);
    this.snapVisuals();
    // Compile shaders up front to avoid a hitch on the first frame.
    this.renderer!.compile(this.scene, this.camera);
    report(1, 'Ready');
    (window as unknown as { __FREESKI__?: unknown }).__FREESKI__ = { game: this, sim: this.sim };
    return true;
  }

  private createRenderer(): void {
    const q = this.quality;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        antialias: q.antialias,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch (e) {
      throw new Error(`WebGL is not available: ${(e as Error).message}`);
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.74;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.domElement.className = 'game-canvas';
    renderer.domElement.tabIndex = 0;
    this.container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.applyResolution();
    this.resizeObserver = new ResizeObserver(() => this.applyResolution());
    this.resizeObserver.observe(this.container);
    renderer.domElement.addEventListener('webglcontextlost', this.handleContextLost);
  }

  private readonly handleContextLost = (e: Event): void => {
    e.preventDefault();
    this.callbacks.onError('The graphics context was lost. Return to the menu and start again.');
    this.pause();
  };

  private applyResolution(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const ratio =
      Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap) * this.settings.resolutionScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const scale = (h * ratio) / 2;
    this.spray?.setPixelScale(scale);
    this.snowfall?.setPixelScale(scale);
  }

  private buildEnvironment(treeGeometry: BufferGeometry | null): void {
    const sim = this.sim!;
    const q = this.quality;
    const scene = this.scene;
    // Sky + image based lighting generated from it.
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIRECTION).multiplyScalar(1000);
    const pmrem = new PMREMGenerator(this.renderer!);
    const envScene = new Scene();
    envScene.add(sky);
    this.envTexture = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    envScene.remove(sky);
    scene.add(sky);
    this.disposables.push(sky.geometry, sky.material);
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.55;
    scene.fog = new FogExp2(new Color(0xc9d9ec), 0.0011);
    scene.background = null;

    const hemi = new HemisphereLight(0xdbe9ff, 0xf4f6fa, 0.55);
    scene.add(hemi);
    const sun = new DirectionalLight(0xfff3e0, 2.6);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(120);
    sun.castShadow = q.shadows;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    const normal = createSnowNormalTexture(256);
    this.disposables.push(normal);
    const snow = createSnowMaterial(normal, { sparkle: q.sparkle });
    const featureSnow = createSnowMaterial(normal, {
      sparkle: q.sparkle,
      roughness: 0.7,
      color: 0xffffff,
      repeat: 0.35,
    });
    const backdropMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.disposables.push(snow, featureSnow, backdropMat);
    this.featureSnow = featureSnow;
    const terrain = buildTerrainMesh(sim.park, snow, {
      spacing: q.terrainSpacing,
      chunkSize: 48,
      receiveShadow: q.shadows,
    });
    terrain.traverse((o) => {
      const g = (o as { geometry?: { dispose(): void } }).geometry;
      if (g) this.disposables.push(g);
    });
    scene.add(terrain);
    const backdrop = buildBackdropMountains(sim.park, backdropMat);
    this.disposables.push(backdrop.geometry);
    scene.add(backdrop);

    const trees = sim.park.trees.filter((_, i) => i % 100 < q.treeFraction * 100);
    this.forest = new Forest(trees, q.shadows, 150, treeGeometry);
    scene.add(this.forest.group);

    const dot = createSoftDotTexture();
    this.disposables.push(dot);
    this.spray = new SnowSpray(q.spray, dot);
    scene.add(this.spray.points);
    if (q.snowfall > 0) {
      this.snowfall = new Snowfall(q.snowfall, dot);
      scene.add(this.snowfall.points);
    }
    this.tracks = new SkiTracks();
    scene.add(this.tracks.mesh);
    this.applyResolution();
  }

  private buildPark(): void {
    this.parkMeshes = new ParkMeshes(this.sim!.park, this.featureSnow!, {
      shadows: this.quality.shadows,
      featureResolution: this.quality.featureResolution,
    });
    this.scene.add(this.parkMeshes.group);
  }

  private buildSkier(): void {
    this.skier = new SkierModel(undefined, this.quality.shadows);
    this.scene.add(this.skier.root);
  }

  private wireEvents(): void {
    const sim = this.sim!;
    const cb = this.callbacks;
    const forward = <K extends keyof SimEvents>(type: K) => {
      this.unsubscribers.push(sim.events.on(type, (p) => cb.onEvent(type, p)));
    };
    (
      [
        'trickLanded',
        'landed',
        'crash',
        'railStart',
        'railEnd',
        'grabStart',
        'comboEnded',
        'runFinished',
        'reset',
        'recovered',
        'takeoff',
      ] as const
    ).forEach(forward);
    this.unsubscribers.push(
      sim.events.on('takeoff', (e) => this.audio.playJump(e.pop)),
      sim.events.on('landed', (e) => {
        this.audio.playLanding(e.result.impactSpeed, e.result.quality);
        const b = sim.player.body;
        for (let i = 0; i < 2; i++)
          this.spray?.emit(
            b.skis[i].point,
            _v.copy(b.velocity).multiplyScalar(0.3),
            20 + Math.round(e.result.impactSpeed * 4),
            3,
            2.5,
            1.4,
          );
        this.cameraCtl?.addShake(Math.min(0.6, e.result.impactSpeed / 20));
      }),
      sim.events.on('crash', () => {
        this.audio.playCrash();
        this.spray?.emit(
          sim.player.body.position,
          _v.copy(sim.player.body.velocity).multiplyScalar(0.4),
          120,
          4,
          3,
          1.8,
        );
        this.cameraCtl?.addShake(0.8);
      }),
      sim.events.on('railStart', (e) => this.audio.playRailStart(e.kind)),
      sim.events.on('trickLanded', (e) => {
        if (e.scored.landing !== 'crash') this.audio.playTrickLanded(e.scored.points);
      }),
      sim.events.on('reset', () => this.snapVisuals()),
      sim.events.on('recovered', () => {
        this.copySimTransform(this.prevPos, this.prevQuat);
        this.copySimTransform(this.currPos, this.currQuat);
      }),
    );
  }

  private handleMetaAction(a: GameAction): void {
    if (a === 'pause') this.callbacks.onPauseRequest();
    else if (this.paused) return;
    else if (a === 'restart') this.restartRun();
    else if (a === 'reset') this.sim?.resetPlayerInPlace();
    else if (a === 'camera') this.cameraCtl?.cycleMode();
  }

  private copySimTransform(pos: Vector3, quat: Quaternion): void {
    const b = this.sim!.player.body;
    pos.copy(b.position);
    quat.copy(b.orientation);
  }

  /** Re-synchronises interpolation, camera and tracks (after a reset or restart). */
  private snapVisuals(): void {
    if (!this.sim) return;
    this.copySimTransform(this.prevPos, this.prevQuat);
    this.copySimTransform(this.currPos, this.currQuat);
    if (this.skier) {
      this.skier.root.position.copy(this.currPos);
      this.skier.root.quaternion.copy(this.currQuat);
    }
    this.tracks?.clear();
    if (this.cameraCtl) this.cameraCtl.snap(this.cameraTarget());
    if (this.forest) this.forest.update(this.camera.position, 0, true);
  }

  start(): void {
    if (!this.sim || this.loop) return;
    this.loop = new GameLoop(
      this.sim.dt,
      () => this.fixedUpdate(),
      (alpha, dt) => this.renderFrame(alpha, dt),
    );
    this.input.active = true;
    this.loop.start();
    document.addEventListener('visibilitychange', this.handleVisibility);
    // Browsers only allow audio after a user gesture: (re)unlock on the first key/pointer input.
    window.addEventListener('keydown', this.handleGesture);
    window.addEventListener('pointerdown', this.handleGesture);
  }

  private readonly handleGesture = (): void => {
    if (!this.paused) this.audio.unlock();
  };

  private readonly handleVisibility = (): void => {
    if (document.hidden) {
      if (!this.paused) this.callbacks.onPauseRequest();
    } else {
      this.loop?.resync();
    }
  };

  private fixedUpdate(): void {
    const sim = this.sim!;
    const input = this.input.sample();
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    sim.step(input);
    this.copySimTransform(this.currPos, this.currQuat);
  }

  private cameraTarget() {
    const p = this.sim!.player;
    const b = p.body;
    return {
      position: this.skier ? this.skier.root.position : b.position,
      velocity: b.velocity,
      heading: b.heading,
      airborne: p.state === 'AIRBORNE',
      grinding: p.state === 'RAIL_GRINDING',
      crashed: p.state === 'CRASHED',
      landingPoint: p.impact.valid ? p.impact.point : null,
    };
  }

  private renderFrame(alpha: number, frameDt: number): void {
    if (!this.renderer || !this.sim || !this.skier || !this.cameraCtl) return;
    const sim = this.sim;
    const player = sim.player;
    const body = player.body;
    const dt = Math.min(frameDt, 0.1);
    this.renderTime += dt;

    // Interpolated skier transform.
    this.skier.root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.skier.root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    const grab = player.grabs.poseDefinition;
    const g = player.rails.grind;
    const pose: SkierPoseInput = {
      state: player.state,
      edgeAngle: body.edgeAngle,
      brake: body.brakeAmount,
      speed: body.speed,
      tucking: body.tucking,
      charge: player.charge,
      landingCompression: player.landingCompression,
      groundGap: body.groundGap,
      grab: player.grabs.current ?? (player.grabs.blend > 0 ? grab : null),
      grabBlend: player.grabs.blend,
      railStance: g?.stance ?? null,
      railBalance: g?.balance ?? 0,
      railPress: g?.press ?? 'none',
      spinRate: body.angularVelocity.length(),
      time: this.renderTime,
    };
    if (!this.paused) this.animator.update(this.skier, pose, dt);

    if (!this.paused) {
      this.cameraCtl.update(this.cameraTarget(), dt);
      this.updateEffects(dt);
    }

    // Shadow frustum follows the skier.
    if (this.sun) {
      const c = this.skier.root.position;
      this.sun.target.position.copy(c);
      this.sun.position.copy(c).addScaledVector(SUN_DIRECTION, 150);
      this.sun.target.updateMatrixWorld();
    }
    this.forest?.update(this.camera.position, dt);
    this.renderer.render(this.scene, this.camera);

    this.hudTimer -= frameDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.callbacks.onHud(this.buildHud());
    }
  }

  private updateEffects(dt: number): void {
    const sim = this.sim!;
    const player = sim.player;
    const b = player.body;
    const grounded = player.fsm.onGround;
    // Snow spray from skidding/carving skis.
    if (grounded && this.spray) {
      const carveSpray = Math.abs(b.edgeAngle) * b.speed * 0.25;
      const skid = b.skidSpeed * 1.2 + b.brakeAmount * b.speed * 0.6;
      const intensity = carveSpray + skid;
      if (intensity > 1.2) {
        const count = Math.min(6, Math.floor(intensity * dt * 22) + (Math.random() < 0.5 ? 1 : 0));
        _v2.set(1, 0, 0).applyQuaternion(b.orientation);
        for (let i = 0; i < 2; i++) {
          const ski = b.skis[i];
          if (!ski.inContact) continue;
          const side = Math.sign(b.edgeAngle) || 1;
          _v.copy(b.velocity)
            .multiplyScalar(0.35)
            .addScaledVector(_v2, -side * Math.min(4, intensity * 0.4));
          this.spray.emit(ski.point, _v, count, 1.6, 1.5);
        }
      }
    }
    this.spray?.update(dt);
    this.snowfall?.update(this.camera.position, dt);
    // Ski tracks.
    if (this.tracks) {
      _v2.set(1, 0, 0).applyQuaternion(b.orientation);
      for (let i = 0; i < 2; i++) {
        const ski = b.skis[i];
        this.tracks.add(i as 0 | 1, ski.point, _v2, grounded && ski.inContact && b.speed > 0.5);
      }
    }
    // Audio.
    this.camera.getWorldDirection(_fwd);
    this.audio.update(
      {
        speed: b.speed,
        grounded,
        airborne: player.state === 'AIRBORNE',
        grinding: player.state === 'RAIL_GRINDING',
        railKind: player.rails.grind?.rail.kind ?? null,
        carve: Math.abs(b.edgeAngle) / 1.1,
        skid: b.skidSpeed,
        brake: b.brakeAmount,
        crashed: player.state === 'CRASHED',
      },
      this.camera.position,
      _fwd,
      b.position,
      dt,
    );
  }

  private buildHud(): HudSnapshot {
    const sim = this.sim!;
    const p = sim.player;
    const combo = sim.scoring.combo;
    let live = '';
    if (p.state === 'AIRBORNE' && p.rotation.active) {
      const spin = Math.abs(p.rotation.spin * RAD2DEG);
      const total = p.rotation.total * RAD2DEG;
      const parts: string[] = [];
      if (p.rotation.inversions > 0 && spin > 120)
        parts.push(`${p.rotation.inversions > 1 ? 'Double ' : ''}Cork ${Math.round(total / 10) * 10}°`);
      else if (p.rotation.inversions > 0) parts.push(`${p.rotation.inversions > 1 ? 'Double ' : ''}Flip`);
      else if (spin > 90) parts.push(`${Math.round(spin / 10) * 10}°`);
      const cur = p.grabs.current;
      if (cur) parts.push(cur.name);
      for (const gr of p.grabs.completed) if (!cur || gr.id !== cur.id) parts.push(gr.name);
      live = parts.join(' · ');
    } else if (p.state === 'RAIL_GRINDING' && p.rails.grind) {
      const gr = p.rails.grind;
      live =
        gr.press === 'nose'
          ? 'Nose Slide'
          : gr.press === 'tail'
            ? 'Tail Slide'
            : gr.stance === 'slide'
              ? 'Boardslide'
              : gr.stance === 'switchFifty'
                ? 'Switch 50-50'
                : '50-50';
      if (gr.entrySpinDeg > 0) live = `${gr.entrySpinDeg} On ${live}`;
    }
    let hint = '';
    if (p.state === 'IDLE' && sim.runTime < 6) hint = 'Hold W to push off · A/D to carve · SPACE to jump';
    else if (p.stillTime > 4) hint = 'Hold W to push · R to restart · Backspace to reset';
    return {
      speedKmh: p.body.speed * 3.6,
      state: p.state,
      score: sim.scoring.totalScore,
      comboTricks: combo.tricks,
      comboMultiplier: combo.multiplier,
      comboPoints: combo.points,
      charge: p.charge,
      airTime: p.state === 'AIRBORNE' ? p.rotation.airTime : 0,
      liveTrick: live,
      grinding: p.state === 'RAIL_GRINDING',
      railLabel: p.rails.grind?.rail.config.label ?? '',
      balance: p.railBalance,
      fps: Math.round(this.loop?.fps ?? 0),
      runTime: sim.runTime,
      hint,
    };
  }

  pause(): void {
    this.paused = true;
    if (this.loop) this.loop.paused = true;
    this.input.clear();
    this.audio.suspend();
  }

  resume(): void {
    this.paused = false;
    if (this.loop) {
      this.loop.paused = false;
      this.loop.resync();
    }
    this.input.clear();
    this.input.active = true;
    this.audio.resume();
    this.renderer?.domElement.focus();
  }

  restartRun(): void {
    this.sim?.restartRun();
    this.snapVisuals();
  }

  /** Must be called from a user gesture (click) so the AudioContext may start. */
  unlockAudio(): void {
    this.audio.unlock();
  }

  applySettings(s: GameSettings): void {
    const qualityChanged = s.graphics !== this.settings.graphics;
    this.settings = s;
    this.input.setBindings(s.bindings);
    this.audio.setSettings(s.audio);
    this.cameraCtl?.setSettings(s.camera);
    if (this.sim) this.sim.cfg.air.landingAssist = s.landingAssist ? 9 : 0;
    if (qualityChanged) {
      // Resolution-related quality can change live; geometry density applies on the next run.
      const q = QUALITY[s.graphics];
      this.quality = { ...this.quality, pixelRatioCap: q.pixelRatioCap, shadowMapSize: q.shadowMapSize };
      if (this.sun && this.renderer?.shadowMap.enabled) {
        this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.applyResolution();
  }

  /** Debug/test helper: place the skier somewhere with a speed and resync the visuals. */
  debugTeleport(x: number, z: number, speed: number, headingDeg = 0): void {
    if (!this.sim) return;
    this.sim.teleport(x, z, speed, headingDeg);
    this.snapVisuals();
  }

  /** Debug/test helper: current camera position. */
  debugCameraPosition(): { x: number; y: number; z: number } {
    const p = this.camera.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  get simulation(): Simulation | null {
    return this.sim;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseResources();
  }

  /** Frees every resource created so far. Idempotent: safe to call again from an aborted init. */
  private releaseResources(): void {
    this.loop?.stop();
    this.loop = null;
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('keydown', this.handleGesture);
    window.removeEventListener('pointerdown', this.handleGesture);
    this.input.detach();
    this.input.onAction = null;
    for (const u of this.unsubscribers) u();
    this.unsubscribers.length = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.audio.dispose();
    this.parkMeshes?.dispose();
    this.parkMeshes = null;
    this.forest?.dispose();
    this.forest = null;
    this.spray?.dispose();
    this.spray = null;
    this.snowfall?.dispose();
    this.snowfall = null;
    this.tracks?.dispose();
    this.tracks = null;
    this.skier?.dispose();
    this.skier = null;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.sun?.shadow.map?.dispose();
    this.sun = null;
    this.scene.clear();
    this.sim?.dispose();
    this.sim = null;
    if (this.renderer) {
      this.renderer.domElement.removeEventListener('webglcontextlost', this.handleContextLost);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    const w = window as unknown as { __FREESKI__?: unknown };
    if (w.__FREESKI__ && (w.__FREESKI__ as { game?: unknown }).game === this) delete w.__FREESKI__;
  }
}
