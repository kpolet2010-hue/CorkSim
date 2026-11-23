import { useMemo } from 'react';
import { PARKS } from '../../park/ParkLoader';
import { useGameStore } from '../store';
import { SettingsPanel } from './SettingsPanel';
import { ControlsPanel } from './ControlsPanel';

function ParkCards() {
  const parkId = useGameStore((s) => s.parkId);
  const setParkId = useGameStore((s) => s.setParkId);
  const stats = useMemo(
    () =>
      PARKS.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        jumps: p.features.filter((f) => f.type === 'kicker').length,
        rails: p.rails.length,
        length: p.terrain.length,
      })),
    [],
  );
  return (
    <div className="park-cards">
      {stats.map((p) => (
        <button
          key={p.id}
          className={`park-card ${p.id === parkId ? 'selected' : ''}`}
          onClick={() => setParkId(p.id)}
          data-testid={`park-${p.id}`}
        >
          <span className="park-name">{p.name}</span>
          <span className="park-desc">{p.description}</span>
          <span className="park-stats">
            <span>{p.jumps} jumps</span>
            <span>{p.rails} rails &amp; boxes</span>
            <span>{p.length} m</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Credits() {
  return (
    <div className="panel-body credits">
      <p>
        <strong>Freeski</strong> - an original freestyle skiing game for the browser.
      </p>
      <p>
        Design, code, procedural art and synthesized audio were created for this project. No third-party game
        assets are used.
      </p>
      <p>Built with TypeScript, React, Three.js, Rapier physics and Zustand.</p>
      <p className="muted">
        Inspired by the spirit of freestyle skiing games - all mechanics are original implementations.
      </p>
    </div>
  );
}

export function MainMenu() {
  const panel = useGameStore((s) => s.menuPanel);
  const setPanel = useGameStore((s) => s.setMenuPanel);
  const setScreen = useGameStore((s) => s.setScreen);
  const parkId = useGameStore((s) => s.parkId);
  const parkName = PARKS.find((p) => p.id === parkId)?.name ?? '';

  const play = () => {
    useGameStore.getState().clearFeed();
    useGameStore.getState().setResults(null);
    setScreen('loading');
  };

  return (
    <div className="menu-screen">
      <div className="menu-backdrop" aria-hidden>
        <div className="mtn mtn-back" />
        <div className="mtn mtn-front" />
        <div className="menu-snow" />
      </div>
      <div className="menu-layout">
        <header className="logo">
          <span className="logo-free">FREE</span>
          <span className="logo-ski">SKI</span>
          <span className="logo-tag">freestyle skiing</span>
        </header>
        {panel === 'main' && (
          <nav className="menu-buttons">
            <button className="btn primary big" onClick={play} data-testid="play">
              Play <span className="btn-sub">{parkName}</span>
            </button>
            <button className="btn" onClick={() => setPanel('parks')} data-testid="menu-parks">
              Snowpark Selection
            </button>
            <button className="btn" onClick={() => setPanel('settings')} data-testid="menu-settings">
              Settings
            </button>
            <button className="btn" onClick={() => setPanel('controls')}>
              Controls
            </button>
            <button className="btn" onClick={() => setPanel('credits')}>
              Credits
            </button>
          </nav>
        )}
        {panel !== 'main' && (
          <section className="menu-panel">
            <div className="panel-header">
              <h2>
                {panel === 'parks'
                  ? 'Snowpark Selection'
                  : panel === 'settings'
                    ? 'Settings'
                    : panel === 'controls'
                      ? 'Controls'
                      : 'Credits'}
              </h2>
              <button className="btn small" onClick={() => setPanel('main')} data-testid="menu-back">
                Back
              </button>
            </div>
            {panel === 'parks' && <ParkCards />}
            {panel === 'settings' && <SettingsPanel />}
            {panel === 'controls' && <ControlsPanel />}
            {panel === 'credits' && <Credits />}
          </section>
        )}
      </div>
      <footer className="menu-footer">No account needed · Works offline · Best with a keyboard</footer>
    </div>
  );
}
