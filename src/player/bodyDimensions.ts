/**
 * Skier body dimensions shared by the simulation (ragdoll) and the renderer's rig. The simulation must not
 * import from `src/render`, so the numbers live here; `bodyDimensions.test.ts` checks that they match
 * `RIG` and the bone offsets built by `SkierModel.buildRig`. All bone rest rotations are identity: body
 * +Y up, +Z forward, +X left. Offsets are a bone's position in its parent bone's frame (metres).
 */
export const BODY = {
  /** Pelvis bone above the model root (the foot point) in the rest pose. */
  pelvisHeight: 0.92,
  /** Spine bone in the pelvis frame. */
  spine: { x: 0, y: 0.04, z: 0 },
  /** Chest bone in the spine frame. */
  chest: { x: 0, y: 0.24, z: 0 },
  /** Neck bone in the chest frame. */
  neck: { x: 0, y: 0.2, z: 0.01 },
  /** Head bone in the neck frame. */
  head: { x: 0, y: 0.12, z: 0 },
  /** Left clavicle (shoulder bone) in the chest frame; the right one mirrors x. */
  clavicle: { x: 0.045, y: 0.13, z: -0.005 },
  /** Left upper-arm bone in the clavicle frame (x = shoulderHalfWidth - clavicle.x). */
  upperArm: { x: 0.145, y: 0.01, z: 0.005 },
  /** Left hip bone in the pelvis frame; the thigh bone sits at the hip. */
  hip: { x: 0.1, y: -0.05, z: 0 },
  thigh: 0.44,
  shin: 0.45,
  upperArmLength: 0.29,
  forearm: 0.27,
  /** Ski bone in the foot frame (the ski base, below the ankle). */
  skiOffsetY: -0.12,
  skiOffsetZ: 0.02,
  skiLength: 1.78,
} as const;
