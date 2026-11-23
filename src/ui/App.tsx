import { useGameStore } from './store';
import { MainMenu } from './components/MainMenu';
import { GameView } from './components/GameView';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  const screen = useGameStore((s) => s.screen);
  const error = useGameStore((s) => s.error);
  const inGame = screen === 'loading' || screen === 'playing' || screen === 'paused' || screen === 'results';
  return (
    <ErrorBoundary>
      <div className="app">
        {inGame ? <GameView /> : <MainMenu />}
        {error && (
          <div className="error-toast" role="alert">
            <strong>Something went wrong</strong>
            <span>{error}</span>
            <button
              className="btn small"
              onClick={() => {
                useGameStore.getState().setError(null);
                useGameStore.getState().setScreen('menu');
              }}
            >
              Back to menu
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
