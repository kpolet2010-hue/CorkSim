/**
 * Tunable physical constants for the skier simulation.
 * Units are SI (metres, seconds, kilograms, radians) unless stated otherwise.
 * All gameplay systems read from a config object so values can be tuned or overridden in tests.
 */
export interface SkiPhysicsConfig {
  gravity: number;
  mass: number;
  /** Air density (kg/m^3). */
  airDensity: number;
  /** Drag area Cd*A (m^2) in a normal stance. */
  dragAreaUpright: number;
  /** Drag area when tucking (accelerate input). */
  dragAreaTuck: number;
  /** Kinetic friction coefficient of waxed skis gliding on snow. */
  glideFriction: number;
  /** Velocity proportional snow resistance (1/s) - ploughing/compaction losses. */
  snowResistance: number;
  /** Additional longitudinal friction coefficient at full brake. */
  brakeFriction: number;
  /** Seconds to reach full braking (braking ramps in gradually). */
  brakeRampTime: number;
  /** Lateral friction coefficient with flat skis (skidding). */
  lateralFrictionFlat: number;
  /** Lateral friction coefficient with fully edged skis (carving grip). */
  lateralFrictionEdged: number;
  /** Time constant for the edge to cancel lateral velocity (s). */
  lateralGripTime: number;
  /** Ski sidecut radius (m). Carve radius = sidecut / sin(edge). */
  sidecutRadius: number;
  /** Maximum edge angle (rad). */
  maxEdgeAngle: number;
  /** Edge angle change rate (rad/s). */
  edgeRate: number;
  /** Rotary (pivot) steering rate at low speed (rad/s). */
  pivotRateLow: number;
  /** Rotary steering rate retained at high speed (rad/s). */
  pivotRateHigh: number;
  /** Maximum yaw rate on the ground (rad/s). */
  maxGroundYawRate: number;
  /** Skating/poling acceleration at standstill (m/s^2). */
  pushAcceleration: number;
  /** Speed above which pushing no longer helps (m/s). */
  pushMaxSpeed: number;
  /** Distance below which skis count as touching the snow (m). */
  contactTolerance: number;
  /** Gap at which the skier is considered airborne regardless of velocity (m). */
  airborneGap: number;
  /** Separation velocity along the normal that, combined with a small gap, means takeoff (m/s). */
  takeoffSeparationSpeed: number;
  /** Lateral distance of each ski from the body centreline (m). */
  skiHalfSpacing: number;
  /** Half the length of a ski (m). */
  skiHalfLength: number;
  /** Hard speed limit as a numerical safeguard (m/s). */
  maxSpeed: number;
}

export interface JumpConfig {
  /** Seconds to fully charge a jump. */
  chargeTime: number;
  /** Pop velocity at zero charge (m/s). */
  popMin: number;
  /** Pop velocity at full charge (m/s). */
  popMax: number;
  /** Grace period after leaving the ground in which releasing jump still pops (s). */
  lateWindow: number;
  /** Steering effectiveness while charging (0-1). */
  chargeSteerFactor: number;
  /** Initial spin rate from pre-winding at full charge (rad/s). */
  windupSpin: number;
  /** Initial flip rate from pre-winding at full charge (rad/s). */
  windupFlip: number;
  /** Initial roll rate from pre-winding (rad/s). */
  windupRoll: number;
}

export interface AirConfig {
  /** Angular acceleration from spin input (rad/s^2). */
  spinAcceleration: number;
  flipAcceleration: number;
  rollAcceleration: number;
  maxSpinRate: number;
  maxFlipRate: number;
  maxRollRate: number;
  /** Tilt of the rotation axis from the body's up axis for off-axis tricks (rad). */
  offAxisTilt: number;
  /** Absolute cap on angular speed (rad/s). */
  maxAngularSpeed: number;
  /**
   * Angular damping per axis when no input is applied (1/s). Models the skier opening up their body
   * (raising inertia) to slow a rotation, so releasing a key lets the trick coast to a stop.
   */
  spinDamping: number;
  flipDamping: number;
  rollDamping: number;
  /** Ratio by which grabbing reduces moment of inertia (angular momentum is conserved). */
  grabInertiaRatio: number;
  /** Strength of the landing "spotting" assist (0 disables). */
  landingAssist: number;
  /** Time before predicted impact during which assist works (s). */
  landingAssistWindow: number;
  /** Maximum orientation error the assist will correct (rad). */
  landingAssistMaxError: number;
  /** Strength of the automatic pitch/roll posture levelling without flip input (0 disables). */
  postureStrength: number;
}

export interface LandingConfig {
  cleanUprightDeg: number;
  cleanYawDeg: number;
  cleanImpactSpeed: number;
  cleanAngularSpeed: number;
  crashUprightDeg: number;
  crashYawDeg: number;
  crashImpactSpeed: number;
  /** Below this horizontal speed yaw misalignment is ignored (m/s). */
  yawCheckMinSpeed: number;
  /** Duration of the landing absorption state (s). */
  absorbTime: number;
  /** Fraction of speed lost on a sketchy landing. */
  sketchySpeedLoss: number;
}

export interface RailConfig {
  /** Horizontal lock radius around a rail centreline (m). */
  lockRadius: number;
  /** Vertical window below the rail top in which the skier can still lock (m). */
  lockBelow: number;
  /** Vertical window above the rail top (m). */
  lockAbove: number;
  /** Minimum speed along the rail to lock (m/s). */
  minLockSpeed: number;
  /** Max angle between travel and rail to lock (rad). */
  maxEntryAngle: number;
  railFriction: number;
  boxFriction: number;
  slideFrictionMultiplier: number;
  /** Balance drift strength (1/s). */
  balanceDrift: number;
  /** Self-amplification of an existing lean (1/s): the further off balance, the faster it tips. */
  balanceInstability: number;
  /** Balance correction per second of input. */
  balanceCorrection: number;
  /** Speed at which balance becomes noticeably harder (m/s). */
  balanceSpeedReference: number;
  popVelocity: number;
  /** Seconds before the same rail can be locked again. */
  relockCooldown: number;
}

export interface CrashConfig {
  /** Seconds before the skier recovers after a crash. */
  recoverTime: number;
  /** Max seconds to wait for the tumbling body to settle. */
  maxTumbleTime: number;
}

export interface GameplayConfig {
  physics: SkiPhysicsConfig;
  jump: JumpConfig;
  air: AirConfig;
  landing: LandingConfig;
  rail: RailConfig;
  crash: CrashConfig;
  fixedTimestep: number;
}

export const DEFAULT_GAMEPLAY_CONFIG: GameplayConfig = {
  fixedTimestep: 1 / 60,
  physics: {
    gravity: 9.81,
    mass: 75,
    airDensity: 1.1,
    dragAreaUpright: 0.55,
    dragAreaTuck: 0.3,
    glideFriction: 0.045,
    snowResistance: 0.012,
    brakeFriction: 0.55,
    brakeRampTime: 0.35,
    lateralFrictionFlat: 0.45,
    lateralFrictionEdged: 1.25,
    lateralGripTime: 0.06,
    sidecutRadius: 15,
    maxEdgeAngle: 62 * (Math.PI / 180),
    edgeRate: 4.2,
    pivotRateLow: 1.9,
    pivotRateHigh: 0.45,
    maxGroundYawRate: 2.6,
    pushAcceleration: 2.6,
    pushMaxSpeed: 7,
    contactTolerance: 0.12,
    airborneGap: 0.35,
    takeoffSeparationSpeed: 0.9,
    skiHalfSpacing: 0.13,
    skiHalfLength: 0.88,
    maxSpeed: 45,
  },
  jump: {
    chargeTime: 0.55,
    popMin: 1.8,
    popMax: 4.4,
    lateWindow: 0.14,
    chargeSteerFactor: 0.2,
    windupSpin: 4,
    windupFlip: 3,
    windupRoll: 3,
  },
  air: {
    spinAcceleration: 20,
    flipAcceleration: 16,
    rollAcceleration: 18,
    maxSpinRate: 11,
    maxFlipRate: 7,
    maxRollRate: 7.5,
    offAxisTilt: 55 * (Math.PI / 180),
    maxAngularSpeed: 15,
    spinDamping: 3,
    flipDamping: 2.4,
    rollDamping: 2.4,
    grabInertiaRatio: 0.88,
    landingAssist: 9,
    landingAssistWindow: 0.38,
    landingAssistMaxError: 38 * (Math.PI / 180),
    postureStrength: 3.5,
  },
  landing: {
    cleanUprightDeg: 24,
    cleanYawDeg: 20,
    cleanImpactSpeed: 8,
    cleanAngularSpeed: 4,
    crashUprightDeg: 58,
    crashYawDeg: 62,
    crashImpactSpeed: 14,
    yawCheckMinSpeed: 2.5,
    absorbTime: 0.28,
    sketchySpeedLoss: 0.2,
  },
  rail: {
    lockRadius: 0.38,
    lockBelow: 0.32,
    lockAbove: 0.55,
    minLockSpeed: 1.2,
    maxEntryAngle: 55 * (Math.PI / 180),
    railFriction: 0.05,
    boxFriction: 0.075,
    slideFrictionMultiplier: 1.8,
    balanceDrift: 0.7,
    balanceInstability: 0.8,
    balanceCorrection: 2.6,
    balanceSpeedReference: 12,
    popVelocity: 3.4,
    relockCooldown: 0.45,
  },
  crash: {
    recoverTime: 2.2,
    maxTumbleTime: 4,
  },
};

/** Deep-ish clone so tests can tweak values without leaking into other tests. */
export function cloneGameplayConfig(base: GameplayConfig = DEFAULT_GAMEPLAY_CONFIG): GameplayConfig {
  return {
    fixedTimestep: base.fixedTimestep,
    physics: { ...base.physics },
    jump: { ...base.jump },
    air: { ...base.air },
    landing: { ...base.landing },
    rail: { ...base.rail },
    crash: { ...base.crash },
  };
}
