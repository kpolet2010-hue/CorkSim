import type { PlayerController } from '../player/PlayerController';
import type { SkierPoseInput } from './SkierAnimator';

/**
 * Builds the animation input from the (read-only) simulation state. This is the single sim -> animation
 * mapping; extend `SkierPoseInput` and this function together. Owned by character/animation.
 */
export function buildSkierPose(player: PlayerController, time: number): SkierPoseInput {
  const body = player.body;
  const grab = player.grabs.poseDefinition;
  const g = player.rails.grind;
  return {
    state: player.state,
    edgeAngle: body.edgeAngle,
    brake: body.brakeAmount,
    speed: body.speed,
    tucking: body.tucking,
    charge: player.charge,
    landingCompression: player.landingCompression,
    groundGap: body.groundGap,
    grab: player.grabs.current ?? (player.grabs.blend > 0 ? grab : null),
    grabBlend: player.grabs.blend,
    railStance: g?.stance ?? null,
    railBalance: g?.balance ?? 0,
    railPress: g?.press ?? 'none',
    spinRate: body.angularVelocity.length(),
    time,
  };
}
