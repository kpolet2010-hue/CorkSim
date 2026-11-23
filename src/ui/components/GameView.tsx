import { useEffect, useRef } from 'react';
import { Game } from '../../game/Game';
import { getParkById } from '../../park/ParkLoader';
import { useGameStore } from '../store';
import { Hud } from './Hud';
import { LoadingScreen } from './LoadingScreen';
import { PauseMenu } from './PauseMenu';
import { ResultsScreen } from './ResultsScreen';
import type { SimEvents } from '../../sim/events';

let feedId = 1;

function handleEvent<K extends keyof SimEvents>(type: K, payload: SimEvents[K]): void {
  const st = useGameStore.getState();
  switch (type) {
    case 'trickLanded': {
      const e = payload as SimEvents['trickLanded'];
      st.pushFeed({
        id: feedId++,
        name: e.scored.name,
        points: e.scored.points,
        landing: e.scored.landing,
        kind: e.scored.kind,
        repetition: e.scored.repetitionFactor,
      });
      st.showBanner({
        title: e.scored.name,
        subtitle: `+${e.scored.points.toLocaleString()}${e.scored.landing === 'sketchy' ? '  ·  sketchy' : ''}${e.scored.repetitionFactor < 1 ? '  ·  repeat' : ''}`,
        tone: e.scored.landing === 'sketchy' ? 'sketchy' : 'clean',
      });
      break;
    }
    case 'landed': {
      const e = payload as SimEvents['landed'];
      if (e.result.quality === 'sketchy' && e.airTime > 0.5) {
        // Shown only if no trick banner follows immediately; trick banners overwrite it.
        st.showBanner({ title: 'Sketchy landing', subtitle: e.result.reason, tone: 'sketchy' });
      }
      break;
    }
    case 'crash': {
      const e = payload as SimEvents['crash'];
      st.showBanner({ title: 'CRASH', subtitle: e.reason, tone: 'crash' });
      break;
    }
    case 'comboEnded': {
      const e = payload as SimEvents['comboEnded'];
      if (e.bonus > 0) {
        st.pushFeed({
          id: feedId++,
          name: `Combo x${e.multiplier.toFixed(2)}`,
          points: e.bonus,
          landing: 'clean',
          kind: 'combo',
          repetition: 1,
        });
        st.showBanner({
          title: `${e.tricks} trick combo`,
          subtitle: `x${e.multiplier.toFixed(2)}  ·  +${e.bonus.toLocaleString()} bonus`,
          tone: 'combo',
        });
      }
      break;
    }
    case 'runFinished': {
      const e = payload as SimEvents['runFinished'];
      st.setResults({ ...e.score, time: e.time });
      setTimeout(() => {
        if (useGameStore.getState().screen === 'playing') useGameStore.getState().setScreen('results');
      }, 1200);
      break;
    }
    case 'reset': {
      const e = payload as SimEvents['reset'];
      if (e.restart) st.clearFeed();
      break;
    }
    default:
      break;
  }
}

/** Hosts the WebGL canvas and the Game instance for the lifetime of a session. */
export function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const screen = useGameStore((s) => s.screen);
  const settings = useGameStore((s) => s.settings);
  const parkId = useGameStore((s) => s.parkId);

  // Create / dispose the game.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const store = useGameStore.getState();
    const game = new Game(container, store.settings, getParkById(parkId), {
      onProgress: (p, label) => useGameStore.getState().setLoading(p, label),
      onHud: (hud) => useGameStore.getState().setHud(hud),
      onEvent: handleEvent,
      onPauseRequest: () => {
        const s = useGameStore.getState();
        if (s.screen === 'playing') s.setScreen('paused');
        else if (s.screen === 'paused') s.setScreen('playing');
      },
      onError: (msg) => useGameStore.getState().setError(msg),
    });
    gameRef.current = game;
    let cancelled = false;
    game
      .init()
      .then((ready) => {
        if (cancelled || !ready) return;
        game.unlockAudio();
        game.start();
        useGameStore.getState().setScreen('playing');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        console.error(err);
        useGameStore.getState().setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      game.dispose();
      gameRef.current = null;
    };
  }, [parkId]);

  // Pause / resume with the screen state.
  useEffect(() => {
    const game = gameRef.current;
    if (!game) return;
    if (screen === 'paused' || screen === 'results') game.pause();
    else if (screen === 'playing') game.resume();
  }, [screen]);

  // Live settings.
  useEffect(() => {
    gameRef.current?.applySettings(settings);
  }, [settings]);

  return (
    <div className="game-view">
      <div ref={containerRef} className="canvas-host" data-testid="canvas-host" />
      {screen === 'loading' && <LoadingScreen />}
      {(screen === 'playing' || screen === 'paused') && <Hud />}
      {screen === 'paused' && (
        <PauseMenu
          onResume={() => useGameStore.getState().setScreen('playing')}
          onRestart={() => {
            gameRef.current?.restartRun();
            useGameStore.getState().clearFeed();
            useGameStore.getState().setScreen('playing');
          }}
          onMenu={() => useGameStore.getState().setScreen('menu')}
        />
      )}
      {screen === 'results' && (
        <ResultsScreen
          onRestart={() => {
            gameRef.current?.restartRun();
            useGameStore.getState().clearFeed();
            useGameStore.getState().setResults(null);
            useGameStore.getState().setScreen('playing');
          }}
          onMenu={() => useGameStore.getState().setScreen('menu')}
        />
      )}
    </div>
  );
}
