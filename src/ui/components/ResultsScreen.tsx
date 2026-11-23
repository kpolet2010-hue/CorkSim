import { useGameStore } from '../store';

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function ResultsScreen(props: { onRestart: () => void; onMenu: () => void }) {
  const results = useGameStore((s) => s.results);
  if (!results) return null;
  const landed = results.tricks.filter((t) => t.landing !== 'crash');
  return (
    <div className="overlay results" data-testid="results">
      <section className="menu-panel compact wide">
        <h2>Run complete</h2>
        <div className="result-score">{results.total.toLocaleString()}</div>
        <div className="result-stats">
          <div>
            <span>Time</span>
            <strong>{formatTime(results.time)}</strong>
          </div>
          <div>
            <span>Tricks landed</span>
            <strong>{landed.length}</strong>
          </div>
          <div>
            <span>Best trick</span>
            <strong>
              {results.bestTrick ? `${results.bestTrick.name} (${results.bestTrick.points})` : '-'}
            </strong>
          </div>
          <div>
            <span>Best combo</span>
            <strong>{results.bestCombo.toLocaleString()}</strong>
          </div>
        </div>
        <ol className="result-list">
          {results.tricks.map((t) => (
            <li key={t.id} className={t.landing}>
              <span>{t.name}</span>
              <span>{t.landing === 'crash' ? 'crash' : `+${t.points}`}</span>
            </li>
          ))}
        </ol>
        <div className="menu-buttons row">
          <button className="btn primary" onClick={props.onRestart} data-testid="results-restart">
            Ride again
          </button>
          <button className="btn" onClick={props.onMenu}>
            Main Menu
          </button>
        </div>
      </section>
    </div>
  );
}
