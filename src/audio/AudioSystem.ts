import type { Vector3 } from 'three';
import type { AudioSettings } from '../config/settings';

/** Per-frame audio drivers derived from the simulation. */
export interface AudioState {
  speed: number;
  grounded: boolean;
  airborne: boolean;
  grinding: boolean;
  railKind: 'rail' | 'box' | null;
  carve: number;
  skid: number;
  brake: number;
  crashed: boolean;
}

interface Loop {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

/**
 * Procedural audio built on the Web Audio API. All sounds are synthesised from filtered noise and simple
 * oscillators, so the game ships without audio assets and works offline. The AudioContext is only
 * created after a user gesture (`unlock`) to respect browser autoplay policies.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private panner: PannerNode | null = null;
  private noise: AudioBuffer | null = null;
  private glide: Loop | null = null;
  private carve: Loop | null = null;
  private skid: Loop | null = null;
  private wind: Loop | null = null;
  private rail: Loop | null = null;
  private railTone: OscillatorNode | null = null;
  private railToneGain: GainNode | null = null;
  private ambient: Loop | null = null;
  private settings: AudioSettings;
  private gustPhase = 0;

  constructor(settings: AudioSettings) {
    this.settings = settings;
  }

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Creates the audio graph. Must be called from a user gesture handler. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.ambience = ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience.connect(this.master);
    this.master.connect(ctx.destination);
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'equalpower';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 4;
    this.panner.rolloffFactor = 0.6;
    this.panner.connect(this.sfx);

    // Two seconds of pink-ish noise as the base for every texture.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.18;
    }
    this.glide = this.makeLoop('bandpass', 900, 0.8, this.panner);
    this.carve = this.makeLoop('highpass', 2600, 0.7, this.panner);
    this.skid = this.makeLoop('lowpass', 1400, 1.2, this.panner);
    this.wind = this.makeLoop('lowpass', 400, 0.5, this.ambience);
    this.rail = this.makeLoop('bandpass', 3600, 9, this.panner);
    this.ambient = this.makeLoop('lowpass', 260, 0.4, this.ambience);
    this.ambient.gain.gain.value = 0.22;
    this.railTone = ctx.createOscillator();
    this.railTone.type = 'sawtooth';
    this.railTone.frequency.value = 96;
    this.railToneGain = ctx.createGain();
    this.railToneGain.gain.value = 0;
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = 'bandpass';
    toneFilter.frequency.value = 900;
    toneFilter.Q.value = 3;
    this.railTone.connect(toneFilter).connect(this.railToneGain).connect(this.panner);
    this.railTone.start();
    this.applyVolumes();
  }

  private makeLoop(type: BiquadFilterType, freq: number, q: number, out: AudioNode): Loop {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.loopStart = Math.random();
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(out);
    source.start(0, Math.random() * 1.5);
    return { source, filter, gain };
  }

  setSettings(s: AudioSettings): void {
    this.settings = s;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.sfx || !this.ambience) return;
    const t = this.ctx.currentTime;
    const s = this.settings;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.effects, t, 0.05);
    this.ambience.gain.setTargetAtTime(s.ambience, t, 0.05);
  }

  /** Updates continuous sounds. Listener follows the camera; the skier is a positional source. */
  update(state: AudioState, listener: Vector3, forward: Vector3, source: Vector3, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const tc = 0.06;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.setTargetAtTime(listener.x, t, 0.02);
      l.positionY.setTargetAtTime(listener.y, t, 0.02);
      l.positionZ.setTargetAtTime(listener.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    } else {
      l.setPosition(listener.x, listener.y, listener.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
    if (this.panner) {
      if (this.panner.positionX) {
        this.panner.positionX.setTargetAtTime(source.x, t, 0.02);
        this.panner.positionY.setTargetAtTime(source.y, t, 0.02);
        this.panner.positionZ.setTargetAtTime(source.z, t, 0.02);
      } else {
        this.panner.setPosition(source.x, source.y, source.z);
      }
    }
    const v = Math.min(1, state.speed / 25);
    const onSnow = state.grounded && !state.crashed ? 1 : 0;
    this.glide!.gain.gain.setTargetAtTime(onSnow * (0.08 + v * 0.55), t, tc);
    this.glide!.filter.frequency.setTargetAtTime(500 + v * 1700, t, tc);
    this.carve!.gain.gain.setTargetAtTime(onSnow * Math.min(1, state.carve) * v * 0.5, t, tc);
    this.carve!.filter.frequency.setTargetAtTime(2200 + state.carve * 1600, t, tc);
    const skid = onSnow * Math.min(1, state.skid / 6 + state.brake * 0.8) * (0.2 + v);
    this.skid!.gain.gain.setTargetAtTime(Math.min(0.9, skid * 0.7), t, tc);
    this.skid!.filter.frequency.setTargetAtTime(700 + state.skid * 120, t, tc);
    // Wind: stronger with speed and in the air.
    this.gustPhase += dt * 0.37;
    const gust = 0.85 + Math.sin(this.gustPhase) * 0.15;
    this.wind!.gain.gain.setTargetAtTime((v * v * 0.6 + (state.airborne ? 0.18 : 0)) * gust, t, 0.15);
    this.wind!.filter.frequency.setTargetAtTime(300 + v * 900 + (state.airborne ? 300 : 0), t, 0.15);
    // Rail grind.
    const g = state.grinding ? 1 : 0;
    const isBox = state.railKind === 'box';
    this.rail!.gain.gain.setTargetAtTime(g * (isBox ? 0.5 : 0.9) * (0.4 + v), t, 0.03);
    this.rail!.filter.frequency.setTargetAtTime(isBox ? 1400 : 3600, t, 0.03);
    this.rail!.filter.Q.setTargetAtTime(isBox ? 2 : 9, t, 0.03);
    this.railToneGain!.gain.setTargetAtTime(g * (isBox ? 0.02 : 0.06), t, 0.03);
    this.railTone!.frequency.setTargetAtTime(isBox ? 70 : 96 + v * 40, t, 0.05);
    this.ambient!.gain.gain.setTargetAtTime(0.2 * gust, t, 0.5);
  }

  private burst(
    duration: number,
    freq: number,
    gain: number,
    type: BiquadFilterType = 'lowpass',
    out?: AudioNode,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src
      .connect(f)
      .connect(g)
      .connect(out ?? this.panner ?? this.sfx!);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  private thump(freqStart: number, freqEnd: number, duration: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freqStart, t);
    o.frequency.exponentialRampToValueAtTime(freqEnd, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(this.sfx!);
    o.start(t);
    o.stop(t + duration + 0.05);
  }

  playJump(pop: number): void {
    this.burst(0.18, 1800, 0.25 + pop * 0.05, 'bandpass');
    this.thump(140, 70, 0.12, 0.18);
  }

  playLanding(impact: number, quality: 'clean' | 'sketchy' | 'crash'): void {
    const i = Math.min(1, impact / 12);
    this.burst(0.35 + i * 0.3, 900 + i * 600, 0.35 + i * 0.5);
    this.thump(110, 45, 0.25 + i * 0.2, 0.3 + i * 0.4);
    if (quality === 'sketchy') this.burst(0.5, 1500, 0.25, 'bandpass');
  }

  playCrash(): void {
    this.burst(0.9, 700, 0.9);
    this.thump(90, 35, 0.4, 0.6);
    setTimeout(() => this.thump(80, 40, 0.3, 0.35), 180);
  }

  playRailStart(kind: 'rail' | 'box'): void {
    this.burst(0.12, kind === 'rail' ? 4200 : 1600, 0.4, 'bandpass');
    this.thump(kind === 'rail' ? 320 : 160, 120, 0.1, 0.2);
  }

  /** Pleasant two-note chime for landed tricks; pitch rises with score. */
  playTrickLanded(points: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx) return;
    const base = 520 + Math.min(600, points / 8);
    [0, 0.09].forEach((delay, k) => {
      const t = ctx.currentTime + delay;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = base * (k === 0 ? 1 : 1.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(this.sfx!);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  playUiClick(): void {
    this.thump(900, 600, 0.05, 0.08);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  dispose(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.ctx = null;
    void ctx.close().catch(() => undefined);
  }
}
