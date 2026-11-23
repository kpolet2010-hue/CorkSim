import { create } from 'zustand';
import { loadSettings, saveSettings, type GameSettings } from '../config/settings';
import type { LandingQuality } from '../landing/LandingEvaluator';
import type { PlayerState } from '../player/PlayerState';
import type { RunScore } from '../scoring/ScoringSystem';

export type Screen = 'menu' | 'loading' | 'playing' | 'paused' | 'results';
export type MenuPanel = 'main' | 'parks' | 'settings' | 'controls' | 'credits';

export interface HudState {
  speedKmh: number;
  state: PlayerState;
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

export interface FeedItem {
  id: number;
  name: string;
  points: number;
  landing: LandingQuality;
  kind: 'air' | 'rail' | 'combo';
  repetition: number;
}

export interface Banner {
  id: number;
  title: string;
  subtitle: string;
  tone: 'clean' | 'sketchy' | 'crash' | 'combo' | 'info';
}

export interface StoreState {
  screen: Screen;
  menuPanel: MenuPanel;
  /** Panel shown from the pause menu. */
  pausePanel: 'main' | 'settings' | 'controls';
  parkId: string;
  settings: GameSettings;
  loading: { progress: number; label: string };
  hud: HudState;
  feed: FeedItem[];
  banner: Banner | null;
  results: (RunScore & { time: number }) | null;
  error: string | null;
  setScreen: (s: Screen) => void;
  setMenuPanel: (p: MenuPanel) => void;
  setPausePanel: (p: 'main' | 'settings' | 'controls') => void;
  setParkId: (id: string) => void;
  updateSettings: (fn: (s: GameSettings) => GameSettings) => void;
  setLoading: (progress: number, label: string) => void;
  setHud: (h: Partial<HudState>) => void;
  pushFeed: (item: FeedItem) => void;
  clearFeed: () => void;
  showBanner: (b: Omit<Banner, 'id'>) => void;
  setResults: (r: (RunScore & { time: number }) | null) => void;
  setError: (e: string | null) => void;
}

export const INITIAL_HUD: HudState = {
  speedKmh: 0,
  state: 'IDLE',
  score: 0,
  comboTricks: 0,
  comboMultiplier: 1,
  comboPoints: 0,
  charge: 0,
  airTime: 0,
  liveTrick: '',
  grinding: false,
  railLabel: '',
  balance: 0,
  fps: 0,
  runTime: 0,
  hint: '',
};

let bannerId = 1;

export const useGameStore = create<StoreState>((set) => ({
  screen: 'menu',
  menuPanel: 'main',
  pausePanel: 'main',
  parkId: 'glacier-park',
  settings: loadSettings(),
  loading: { progress: 0, label: '' },
  hud: INITIAL_HUD,
  feed: [],
  banner: null,
  results: null,
  error: null,
  setScreen: (screen) => set({ screen, pausePanel: 'main' }),
  setMenuPanel: (menuPanel) => set({ menuPanel }),
  setPausePanel: (pausePanel) => set({ pausePanel }),
  setParkId: (parkId) => set({ parkId }),
  updateSettings: (fn) =>
    set((st) => {
      const settings = fn(st.settings);
      saveSettings(settings);
      return { settings };
    }),
  setLoading: (progress, label) => set({ loading: { progress, label } }),
  setHud: (h) => set((st) => ({ hud: { ...st.hud, ...h } })),
  pushFeed: (item) => set((st) => ({ feed: [item, ...st.feed].slice(0, 6) })),
  clearFeed: () => set({ feed: [], banner: null }),
  showBanner: (b) => set({ banner: { ...b, id: bannerId++ } }),
  setResults: (results) => set({ results }),
  setError: (error) => set({ error }),
}));
