import { useGameStore } from '../store';
import { SettingsPanel } from './SettingsPanel';
import { ControlsPanel } from './ControlsPanel';

export function PauseMenu(props: { onResume: () => void; onRestart: () => void; onMenu: () => void }) {
  const panel = useGameStore((s) => s.pausePanel);
  const setPanel = useGameStore((s) => s.setPausePanel);
  return (
    <div className="overlay pause" data-testid="pause-menu">
      <section className="menu-panel compact">
        {panel === 'main' ? (
          <>
            <h2>Paused</h2>
            <div className="menu-buttons">
              <button className="btn primary" onClick={props.onResume} data-testid="resume">
                Resume
              </button>
              <button className="btn" onClick={props.onRestart} data-testid="restart">
                Restart Run
              </button>
              <button className="btn" onClick={() => setPanel('settings')}>
                Settings
              </button>
              <button className="btn" onClick={() => setPanel('controls')}>
                Controls
              </button>
              <button className="btn" onClick={props.onMenu} data-testid="main-menu">
                Main Menu
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="panel-header">
              <h2>{panel === 'settings' ? 'Settings' : 'Controls'}</h2>
              <button className="btn small" onClick={() => setPanel('main')}>
                Back
              </button>
            </div>
            {panel === 'settings' ? <SettingsPanel /> : <ControlsPanel />}
          </>
        )}
      </section>
    </div>
  );
}
