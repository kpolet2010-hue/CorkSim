import { useEffect, useState } from 'react';
import { useGameStore } from '../store';

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const STATE_LABEL: Record<string, string> = {
  IDLE: 'Standing',
  RIDING: 'Riding',
  CARVING: 'Carving',
  BRAKING: 'Braking',
  JUMP_CHARGING: 'Charging',
  AIRBORNE: 'Airborne',
  RAIL_GRINDING: 'Grinding',
  LANDING: 'Landing',
  CRASHED: 'Crashed',
};

function ScoreBlock() {
  const score = useGameStore((s) => s.hud.score);
  const tricks = useGameStore((s) => s.hud.comboTricks);
  const mult = useGameStore((s) => s.hud.comboMultiplier);
  const points = useGameStore((s) => s.hud.comboPoints);
  const time = useGameStore((s) => s.hud.runTime);
  return (
    <div className="hud-score">
      <div className="score" data-testid="hud-score">
        {score.toLocaleString()}
      </div>
      <div className="run-time">{formatTime(time)}</div>
      {tricks > 0 && (
        <div className="combo" data-testid="hud-combo">
          <span className="mult">x{mult.toFixed(2)}</span>
          <span>
            {tricks} trick{tricks > 1 ? 's' : ''} · {points.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

function SpeedBlock() {
  const speed = useGameStore((s) => s.hud.speedKmh);
  const state = useGameStore((s) => s.hud.state);
  const fps = useGameStore((s) => s.hud.fps);
  const showFps = useGameStore((s) => s.settings.showFps);
  return (
    <div className="hud-speed">
      <div className="speed" data-testid="hud-speed">
        {Math.round(speed)}
        <span className="unit">km/h</span>
      </div>
      <div className={`state-chip state-${state.toLowerCase()}`} data-testid="hud-state">
        {STATE_LABEL[state] ?? state}
      </div>
      {showFps && <div className="fps">{fps} fps</div>}
    </div>
  );
}

function CenterInfo() {
  const live = useGameStore((s) => s.hud.liveTrick);
  const charge = useGameStore((s) => s.hud.charge);
  const state = useGameStore((s) => s.hud.state);
  const grinding = useGameStore((s) => s.hud.grinding);
  const balance = useGameStore((s) => s.hud.balance);
  const rail = useGameStore((s) => s.hud.railLabel);
  const airTime = useGameStore((s) => s.hud.airTime);
  return (
    <div className="hud-center">
      {live && (
        <div className="live-trick" data-testid="hud-live-trick">
          {live}
        </div>
      )}
      {state === 'AIRBORNE' && airTime > 0.4 && <div className="air-time">{airTime.toFixed(1)} s air</div>}
      {state === 'JUMP_CHARGING' && (
        <div className="charge" data-testid="hud-charge">
          <div className="charge-fill" style={{ width: `${Math.round(charge * 100)}%` }} />
          <span>JUMP</span>
        </div>
      )}
      {grinding && (
        <div className="balance" data-testid="hud-balance">
          <div className="balance-label">{rail}</div>
          <div className="balance-track">
            <div className="balance-safe" />
            <div
              className="balance-needle"
              style={{ left: `${50 + Math.max(-1, Math.min(1, balance)) * 50}%` }}
            />
          </div>
          <div className="balance-keys">
            <kbd>A</kbd> balance <kbd>D</kbd>
          </div>
        </div>
      )}
    </div>
  );
}

function Feed() {
  const feed = useGameStore((s) => s.feed);
  return (
    <ul className="hud-feed" data-testid="hud-feed">
      {feed.map((f) => (
        <li key={f.id} className={`feed-item ${f.landing} ${f.kind}`}>
          <span className="feed-name">{f.name}</span>
          <span className="feed-points">+{f.points.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}

function BannerView() {
  const banner = useGameStore((s) => s.banner);
  // The banner hides itself after a delay; a new banner (new id) shows again.
  const [hiddenId, setHiddenId] = useState(0);
  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setHiddenId(banner.id), banner.tone === 'crash' ? 2000 : 2300);
    return () => clearTimeout(t);
  }, [banner]);
  if (!banner) return null;
  const visible = banner.id !== hiddenId;
  return (
    <div
      key={banner.id}
      className={`hud-banner tone-${banner.tone} ${visible ? 'show' : 'hide'}`}
      data-testid="hud-banner"
    >
      <div className="banner-title">{banner.title}</div>
      {banner.subtitle && <div className="banner-sub">{banner.subtitle}</div>}
    </div>
  );
}

function Hint() {
  const hint = useGameStore((s) => s.hud.hint);
  if (!hint) return null;
  return <div className="hud-hint">{hint}</div>;
}

/** Minimal gameplay HUD. Each block subscribes only to the values it shows. */
export function Hud() {
  return (
    <div className="hud" data-testid="hud">
      <ScoreBlock />
      <SpeedBlock />
      <Feed />
      <CenterInfo />
      <BannerView />
      <Hint />
    </div>
  );
}
