import { useGameStore } from '../store';

export function LoadingScreen() {
  const { progress, label } = useGameStore((s) => s.loading);
  return (
    <div className="loading-screen" data-testid="loading">
      <div className="logo small">
        <span className="logo-free">FREE</span>
        <span className="logo-ski">SKI</span>
      </div>
      <div className="loading-bar">
        <div className="loading-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <div className="loading-label">
        {label} · {Math.round(progress * 100)}%
      </div>
      <div className="loading-tip">
        Tip: hold a spin key while charging the jump to pre-wind your rotation.
      </div>
    </div>
  );
}
