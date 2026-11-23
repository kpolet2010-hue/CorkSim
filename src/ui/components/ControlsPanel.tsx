import { GAME_ACTIONS } from '../../input/actions';
import { ACTION_LABELS, keyLabel } from '../../config/settings';
import { useGameStore } from '../store';

export function ControlsPanel() {
  const bindings = useGameStore((s) => s.settings.bindings);
  return (
    <div className="panel-body controls">
      <div className="controls-grid">
        {GAME_ACTIONS.map((a) => (
          <div className="control-row" key={a}>
            <span className="keys">
              {bindings[a].map((k) => (
                <kbd key={k}>{keyLabel(k)}</kbd>
              ))}
            </span>
            <span>{ACTION_LABELS[a]}</span>
          </div>
        ))}
      </div>
      <div className="tips">
        <h3>How to ride</h3>
        <ul>
          <li>
            Hold <kbd>W</kbd> to push off and tuck; <kbd>S</kbd> brakes gradually.
          </li>
          <li>
            <kbd>A</kbd>/<kbd>D</kbd> tip the skis on edge - carving is most effective at speed.
          </li>
          <li>
            Hold <kbd>Space</kbd> to charge, release at the lip. Holding through the lip pops automatically.
          </li>
          <li>Hold spin/flip keys while charging to pre-wind the rotation for takeoff.</li>
          <li>
            In the air: <kbd>A</kbd>/<kbd>D</kbd> spin, <kbd>W</kbd>/<kbd>S</kbd> flip, arrows roll off-axis.
            Spin + arrow = cork, spin + <kbd>S</kbd> = bio, spin + <kbd>W</kbd> = misty.
          </li>
          <li>
            Release rotation early - it coasts. Land with skis aligned to your direction of travel (forward or
            switch).
          </li>
          <li>
            Grabs: <kbd>Q</kbd> Mute, <kbd>E</kbd> Safety, <kbd>Shift</kbd> Tail, <kbd>F</kbd> Method, combine
            for Japan (Q+E), Nose (Q+Shift), Truck Driver (E+Shift), Lui Kang (Q+E+Shift). Let go before
            landing!
          </li>
          <li>
            Rails: ride or jump onto them aligned; <kbd>A</kbd>/<kbd>D</kbd> keep balance, <kbd>W</kbd>/
            <kbd>S</kbd> press, <kbd>Space</kbd> to pop off with a spin.
          </li>
        </ul>
      </div>
    </div>
  );
}
