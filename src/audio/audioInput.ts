import type { PlayerController } from '../player/PlayerController';
import type { AudioState } from './AudioSystem';

/** Builds the continuous audio input from the (read-only) simulation state. Owned by camera/gameplay. */
export function buildAudioState(player: PlayerController): AudioState {
  const b = player.body;
  return {
    speed: b.speed,
    grounded: player.fsm.onGround,
    airborne: player.state === 'AIRBORNE',
    grinding: player.state === 'RAIL_GRINDING',
    railKind: player.rails.grind?.rail.kind ?? null,
    carve: Math.abs(b.edgeAngle) / 1.1,
    skid: b.skidSpeed,
    brake: b.brakeAmount,
    crashed: player.state === 'CRASHED',
  };
}
