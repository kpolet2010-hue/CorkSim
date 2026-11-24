import type { Vector3 } from 'three';
import type { PlayerController } from '../player/PlayerController';
import type { CameraTarget } from './CameraController';

/**
 * Builds the camera input from the (read-only) simulation state. `skierPosition` is the interpolated visual
 * position so the camera follows exactly what is drawn. Owned by camera/gameplay.
 */
export function buildCameraTarget(player: PlayerController, skierPosition: Vector3): CameraTarget {
  const b = player.body;
  return {
    position: skierPosition,
    velocity: b.velocity,
    heading: b.heading,
    airborne: player.state === 'AIRBORNE',
    grinding: player.state === 'RAIL_GRINDING',
    crashed: player.state === 'CRASHED',
    landingPoint: player.impact.valid ? player.impact.point : null,
  };
}
