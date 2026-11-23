import { useEffect, useState } from 'react';
import { GAME_ACTIONS, type GameAction } from '../../input/actions';
import {
  ACTION_LABELS,
  DEFAULT_SETTINGS,
  keyLabel,
  type GameSettings,
  type GraphicsQuality,
} from '../../config/settings';
import { useGameStore } from '../store';

type Tab = 'graphics' | 'camera' | 'audio' | 'keys' | 'gameplay';

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="setting-row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <span className="value">{props.format ? props.format(props.value) : props.value.toFixed(1)}</span>
    </label>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting-row toggle">
      <span>{props.label}</span>
      <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  );
}

function KeyBindings() {
  const bindings = useGameStore((s) => s.settings.bindings);
  const update = useGameStore((s) => s.updateSettings);
  const [listening, setListening] = useState<GameAction | null>(null);

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code !== 'Escape') {
        update((s) => {
          const b = structuredClone(s.bindings);
          // Remove the key from any other action to avoid conflicts.
          for (const a of GAME_ACTIONS) b[a] = b[a].filter((c) => c !== e.code);
          b[listening] = [e.code];
          return { ...s, bindings: b };
        });
      }
      setListening(null);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [listening, update]);

  return (
    <div className="bindings">
      {GAME_ACTIONS.map((a) => (
        <div className="setting-row binding" key={a}>
          <span>{ACTION_LABELS[a]}</span>
          <button
            className={`btn small key-btn ${listening === a ? 'listening' : ''}`}
            onClick={() => setListening(a)}
            data-testid={`bind-${a}`}
          >
            {listening === a ? 'Press a key…' : bindings[a].map(keyLabel).join(' / ') || 'Unbound'}
          </button>
        </div>
      ))}
      <button
        className="btn small"
        onClick={() => update((s) => ({ ...s, bindings: structuredClone(DEFAULT_SETTINGS.bindings) }))}
      >
        Reset key bindings
      </button>
    </div>
  );
}

export function SettingsPanel() {
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  const [tab, setTab] = useState<Tab>('graphics');
  const set = (fn: (s: GameSettings) => GameSettings) => update(fn);
  const fullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;

  return (
    <div className="panel-body settings">
      <div className="tabs" role="tablist">
        {(['graphics', 'camera', 'audio', 'keys', 'gameplay'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={`tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'keys' ? 'Key bindings' : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'graphics' && (
        <div className="setting-group">
          <div className="setting-row">
            <span>Quality</span>
            <div className="segmented">
              {(['low', 'medium', 'high'] as GraphicsQuality[]).map((q) => (
                <button
                  key={q}
                  className={settings.graphics === q ? 'active' : ''}
                  onClick={() => set((s) => ({ ...s, graphics: q }))}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            Terrain and tree density changes apply when a run is (re)started from the menu.
          </p>
          <Slider
            label="Resolution scale"
            value={settings.resolutionScale}
            min={0.5}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set((s) => ({ ...s, resolutionScale: v }))}
          />
          <Toggle
            label="Show FPS"
            value={settings.showFps}
            onChange={(v) => set((s) => ({ ...s, showFps: v }))}
          />
          <div className="setting-row">
            <span>Fullscreen</span>
            <button
              className="btn small"
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
                else void document.documentElement.requestFullscreen().catch(() => undefined);
              }}
            >
              {fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            </button>
          </div>
        </div>
      )}
      {tab === 'camera' && (
        <div className="setting-group">
          <Slider
            label="Distance"
            value={settings.camera.distance}
            min={3}
            max={10}
            step={0.1}
            format={(v) => `${v.toFixed(1)} m`}
            onChange={(v) => set((s) => ({ ...s, camera: { ...s.camera, distance: v } }))}
          />
          <Slider
            label="Height"
            value={settings.camera.height}
            min={0.8}
            max={4}
            step={0.1}
            format={(v) => `${v.toFixed(1)} m`}
            onChange={(v) => set((s) => ({ ...s, camera: { ...s.camera, height: v } }))}
          />
          <Slider
            label="Sensitivity"
            value={settings.camera.sensitivity}
            min={0.2}
            max={3}
            step={0.1}
            onChange={(v) => set((s) => ({ ...s, camera: { ...s.camera, sensitivity: v } }))}
          />
          <Slider
            label="Follow smoothing"
            value={settings.camera.smoothing}
            min={2}
            max={20}
            step={0.5}
            onChange={(v) => set((s) => ({ ...s, camera: { ...s.camera, smoothing: v } }))}
          />
          <Slider
            label="Field of view"
            value={settings.camera.fov}
            min={45}
            max={90}
            step={1}
            format={(v) => `${v}°`}
            onChange={(v) => set((s) => ({ ...s, camera: { ...s.camera, fov: v } }))}
          />
        </div>
      )}
      {tab === 'audio' && (
        <div className="setting-group">
          <Slider
            label="Master volume"
            value={settings.audio.master}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set((s) => ({ ...s, audio: { ...s.audio, master: v } }))}
          />
          <Slider
            label="Effects"
            value={settings.audio.effects}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set((s) => ({ ...s, audio: { ...s.audio, effects: v } }))}
          />
          <Slider
            label="Ambience"
            value={settings.audio.ambience}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => set((s) => ({ ...s, audio: { ...s.audio, ambience: v } }))}
          />
          <Toggle
            label="Mute"
            value={settings.audio.muted}
            onChange={(v) => set((s) => ({ ...s, audio: { ...s.audio, muted: v } }))}
          />
        </div>
      )}
      {tab === 'keys' && <KeyBindings />}
      {tab === 'gameplay' && (
        <div className="setting-group">
          <Toggle
            label="Landing assist (spot the landing when not rotating)"
            value={settings.landingAssist}
            onChange={(v) => set((s) => ({ ...s, landingAssist: v }))}
          />
          <button className="btn small" onClick={() => set(() => structuredClone(DEFAULT_SETTINGS))}>
            Restore all defaults
          </button>
        </div>
      )}
    </div>
  );
}
