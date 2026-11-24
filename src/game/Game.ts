import {
  ACESFilmicToneMapping,
  type BufferGeometry,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { buildAudioState } from '../audio/audioInput';
import { AudioSystem } from '../audio/AudioSystem';
import { bakeToSingleGeometry, loadOptionalGlb } from '../render/AssetLoader';
import type { GameSettings } from '../config/settings';
import { GameLoop } from '../core/GameLoop';
import { InputManager } from '../input/InputManager';
import type { GameAction } from '../input/actions';
import type { ParkConfig } from '../park/types';
import { CameraController } from '../render/CameraController';
import { buildCameraTarget } from '../render/cameraTarget';
import { Effects } from '../render/Effects';
import { Environment } from '../render/Environment';
import { ParkMeshes } from '../render/ParkMeshes';
import { buildSkierPose } from '../render/poseFromSim';
import { QUALITY, type QualityProfile } from '../render/quality';
import { SkierAnimator } from '../render/SkierAnimator';
import { SkierModel } from '../render/SkierModel';
import { Simulation } from '../sim/Simulation';
import type { SimEvents } from '../sim/events';
import { liveTrickLabel } from '../tricks/liveTrick';

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
  private environment: Environment | null = null;
  private effects: Effects | null = null;
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
    this.effects?.setPixelScale((h * ratio) / 2);
    this.environment?.resize(w, h, ratio);
  }

  private buildEnvironment(treeGeometry: BufferGeometry | null): void {
    this.environment = new Environment(
      this.renderer!,
      this.scene,
      this.sim!.park,
      this.quality,
      treeGeometry,
    );
    this.effects = new Effects(this.scene, this.quality);
    this.applyResolution();
  }

  private buildPark(): void {
    this.parkMeshes = new ParkMeshes(this.sim!.park, this.environment!.featureSnow, {
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
        this.effects?.onLanded(sim, e.result.impactSpeed);
        this.cameraCtl?.addShake(Math.min(0.6, e.result.impactSpeed / 20));
      }),
      sim.events.on('crash', () => {
        this.audio.playCrash();
        this.effects?.onCrash(sim);
        this.cameraCtl?.addShake(0.8);
      }),
      sim.events.on('railStart', (e) => {
        this.audio.playRailStart(e.kind);
        this.effects?.onRailStart(sim);
      }),
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
    this.effects?.clear();
    if (this.cameraCtl) this.cameraCtl.snap(this.cameraTarget());
    this.environment?.update(this.currPos, this.camera, 0, true);
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
    return buildCameraTarget(p, this.skier ? this.skier.root.position : p.body.position);
  }

  private renderFrame(alpha: number, frameDt: number): void {
    if (!this.renderer || !this.sim || !this.skier || !this.cameraCtl) return;
    const sim = this.sim;
    const dt = Math.min(frameDt, 0.1);
    this.renderTime += dt;

    // Interpolated skier transform.
    this.skier.root.position.lerpVectors(this.prevPos, this.currPos, alpha);
    this.skier.root.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
    if (!this.paused) {
      this.animator.update(this.skier, buildSkierPose(sim.player, this.renderTime), dt);
      this.cameraCtl.update(this.cameraTarget(), dt);
      this.effects?.update(sim, this.camera.position, dt);
      this.camera.getWorldDirection(_fwd);
      this.audio.update(
        buildAudioState(sim.player),
        this.camera.position,
        _fwd,
        sim.player.body.position,
        dt,
      );
    }

    this.environment?.update(this.skier.root.position, this.camera, dt);
    this.environment?.render(this.camera);

    this.hudTimer -= frameDt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.08;
      this.callbacks.onHud(this.buildHud());
    }
  }

  private buildHud(): HudSnapshot {
    const sim = this.sim!;
    const p = sim.player;
    const combo = sim.scoring.combo;
    const live = liveTrickLabel(p);
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
      this.environment?.setShadowMapSize(q.shadowMapSize);
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
    this.effects?.dispose();
    this.effects = null;
    this.environment?.dispose();
    this.environment = null;
    this.skier?.dispose();
    this.skier = null;
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
