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

/**
 * Range of a ball joint (hip, shoulder, waist, neck) for the LEFT side: per-axis angle limits of the
 * child's rotation relative to its parent, in the parent frame (rad), enforced by the Rapier solver on
 * each quaternion component (exact for single-axis rotations). About X: + bends a downward bone backwards /
 * an upward bone forwards. About Z: + moves a downward bone towards +X (left). Twist is about the bone
 * axis (Y). The right side mirrors Z and twist.
 */
export interface RagdollJointRange {
  swingXMin: number;
  swingXMax: number;
  swingZMin: number;
  swingZMax: number;
  twistMin: number;
  twistMax: number;
}

/** A relative rotation (rotation vector, parent frame, rad) for the LEFT side; right mirrors y and z. */
export interface RagdollRotation {
  x: number;
  y: number;
  z: number;
}

export type RagdollSegmentKind = 'pelvis' | 'chest' | 'head' | 'upperArm' | 'forearm' | 'thigh' | 'shin';

export type FallKind = 'backward' | 'side' | 'forward';

export interface CrashConfig {
  /** Minimum crash time before the body may count as settled (s). */
  minCrashTime: number;
  /** The body must stay below the settle thresholds this long (s). */
  settleTime: number;
  /** Time the skier lies still after settling before getting up (s). */
  lieTime: number;
  /** Hard cap on the crash duration (s). */
  maxTumbleTime: number;
  /** Pelvis speed below which the body counts as settling (m/s). */
  settleSpeed: number;
  /** Every segment's angular speed must be below this to settle (rad/s). */
  settleAngularSpeed: number;
  /** Time constant of the low-pass on the largest segment angular speed for settling (s). */
  settleFilterTime: number;
  /** Pelvis this far below the analytic snow = fell through the trimesh, recover at once (m). */
  fallThroughDepth: number;
  /** Relative leg-vs-torso speed of the loss-of-balance trip impulse pair (m/s). */
  tripSpeed: Record<FallKind, number>;
  /** Time over which the trip impulse pair is applied (s); 0 = instantly at the crash. */
  tripDuration: number;
  /**
   * Trip scale for falls with the skis on the snow (ground falls, rail bails, obstacle hits), per kind.
   * Landing crashes use `landingTripScale` instead.
   */
  groundTripScale: Record<FallKind, number>;
  /** Trip scale for landing crashes (the touchdown itself already unbalances the body). */
  landingTripScale: number;
  /** Segment masses for a 75 kg skier (kg); scaled to `physics.mass`. Shin includes boot and ski. */
  segmentMass: Record<RagdollSegmentKind, number>;
  /** Long-axis inertia of the limb capsules as a fraction of their transverse inertia (stability). */
  limbAxialInertia: number;
  /** Part of the shin mass carried by the boot+ski cuboid (0..1). */
  skiMassFraction: number;
  /** Friction coefficients (Rapier averages them with the snow's 0.35). */
  frictionClothing: number;
  frictionSki: number;
  frictionHelmet: number;
  restitution: number;
  /** Per-segment Rapier damping (1/s): air drag and flailing losses. */
  linearDamping: number;
  angularDamping: number;
  /** Snow ploughing: tangential velocity drag of segments touching the snow (1/s). */
  ploughDrag: number;
  /** Extra angular damping of segments touching the snow (rolling resistance, 1/s). */
  contactAngularDamping: number;
  /**
   * Self-arrest: once the first tumble is over, the limp body digs heels, elbows and hands in. A bounded
   * Coulomb-like deceleration (m/s²) of the tangential velocity of segments touching the snow, ramped in
   * from `selfArrestDelay` over `selfArrestRamp` (s) of time on the snow (time in the air after a jump crash
   * does not count). It never reverses a velocity, and it holds a body
   * that has stopped on a slope (without it a body on a steep landing slides at ~1.5 m/s forever).
   */
  selfArrestDecel: number;
  selfArrestDelay: number;
  selfArrestRamp: number;
  /** Probe gap below which a segment counts as touching the snow (m). */
  contactMargin: number;
  /**
   * Which ball joints use Rapier solver limits (per-axis, stiff, but only well-conditioned for moderate
   * ranges: the solver uses a small-angle Jacobian) instead of our own soft limit (swing ellipse + twist,
   * velocity-level, robust for wide ranges but softer under sustained load).
   */
  solverLimits: { waist: boolean; neck: boolean; shoulder: boolean; hip: boolean };
  /** Soft limits: fraction of the limit error corrected per step (0..1). */
  limitErp: number;
  /**
   * Soft limits: gain of the error-correction (bias) term. The joint pair's own pivot inertia underestimates
   * the coupled chain's, so a gain > 1 is needed to hold against gravity.
   */
  softLimitStrength: number;
  /** Soft limits: fraction of the outward relative velocity removed per step (above 1 overshoots: jitter). */
  softLimitVelocityGain: number;
  /**
   * Soft limits: cap of the error-correction speed (rad/s). A limit held open by a contact (e.g. a flat ski
   * twisting the leg) then only pushes gently instead of rocking the body while it lies still.
   */
  softLimitMaxBias: number;
  /** Passive joint damping on the relative angular velocity (1/s). */
  jointDamping: number;
  /** Per-step cap of the relative angular velocity change from our joint torques (rad/s). */
  maxJointDeltaOmega: number;
  /** Muscle tone: natural frequency at full tone (rad/s). */
  toneFrequency: number;
  toneDampingRatio: number;
  /** Tone level at the crash (1) decaying with `toneDecayTime` towards `toneLimp`. */
  toneStart: number;
  toneLimp: number;
  toneDecayTime: number;
  /** Knee and elbow ranges (rad, 0 = straight). */
  kneeMax: number;
  /**
   * Smallest knee bend (rad). A falling skier's knees never lock out: on a fully straight knee gravity acts
   * along the leg and can never buckle it, so with the long flat skis as a base the body would stand
   * stiff-legged (a pike) instead of collapsing.
   */
  kneeMin: number;
  elbowMax: number;
  waist: RagdollJointRange;
  neck: RagdollJointRange;
  shoulder: RagdollJointRange;
  hip: RagdollJointRange;
  /** Protective pose the tone pulls towards (arms out, chin tucked, knees bending). */
  tonePose: {
    waist: RagdollRotation;
    neck: RagdollRotation;
    shoulder: RagdollRotation;
    hip: RagdollRotation;
    knee: number;
    elbow: number;
  };
  /**
   * Fixed forward lean of the rigid boot (rad): the foot/ski frame is Rx(-bootLean) in the shin frame, so
   * the ski lies flat when the shin leans forward by this angle.
   */
  bootLean: number;
  /** Athletic stance at the crash entry, in the skier's frame (rotation vectors, left side). */
  stance: {
    pelvis: RagdollRotation;
    chest: RagdollRotation;
    head: RagdollRotation;
    upperArm: RagdollRotation;
    /** Elbow bend (rad). */
    elbow: number;
    /** Thigh; the knee bends so that the shin leans forward by `bootLean` (flat skis). */
    thigh: RagdollRotation;
  };
  /**
   * Soft-CCD (speculative contact) prediction distance of every segment (m). 0 = off: hard CCD launches the
   * jointed chain and soft CCD makes limbs pressed against obstacles jitter; impacts then penetrate the snow
   * by up to v·dt for one step before the contact resolves it.
   */
  softCcdDistance: number;
  /** Extra Rapier solver iterations for the ragdoll bodies (joint stiffness). */
  solverIterations: number;
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

const DEG = Math.PI / 180;

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
    minCrashTime: 1.2,
    settleTime: 0.4,
    lieTime: 0.6,
    maxTumbleTime: 5.5,
    settleSpeed: 0.8,
    settleAngularSpeed: 1.5,
    settleFilterTime: 0.15,
    fallThroughDepth: 1.2,
    tripSpeed: { backward: 2.8, side: 2.8, forward: 2.8 },
    // Forward with the skis on the snow: no trip. The athletic stance already leans forward, so gravity
    // pitches the body over the skis; the knees buckle, the hands catch and the chest goes down. Any
    // differential push that moves the feet back relative to the hips levers the knees straight against the
    // flat, rigid skis instead (a stiff-legged pike that stands on the skis for over a second).
    groundTripScale: { backward: 1, side: 1, forward: 0 },
    tripDuration: 0.12,
    landingTripScale: 0.6,
    segmentMass: {
      pelvis: 11,
      chest: 22,
      head: 5.5,
      upperArm: 2.2,
      forearm: 1.8,
      thigh: 9,
      shin: 6.5,
    },
    skiMassFraction: 0.45,
    limbAxialInertia: 0.3,
    frictionClothing: 0.45,
    frictionSki: 0.2,
    frictionHelmet: 0.5,
    restitution: 0.05,
    linearDamping: 0.05,
    angularDamping: 0.8,
    ploughDrag: 0.6,
    contactAngularDamping: 5,
    selfArrestDecel: 3.5,
    selfArrestDelay: 0.5,
    selfArrestRamp: 1,
    contactMargin: 0.05,
    solverLimits: { waist: true, neck: true, shoulder: true, hip: true },
    limitErp: 0.25,
    softLimitStrength: 2,
    softLimitVelocityGain: 1,
    softLimitMaxBias: 5,
    jointDamping: 2.5,
    maxJointDeltaOmega: 25,
    toneFrequency: 8,
    toneDampingRatio: 0.9,
    toneStart: 1,
    toneLimp: 0.08,
    toneDecayTime: 0.6,
    kneeMax: 150 * DEG,
    kneeMin: 12 * DEG,
    elbowMax: 145 * DEG,
    waist: {
      swingXMin: -25 * DEG,
      swingXMax: 70 * DEG,
      swingZMin: -35 * DEG,
      swingZMax: 35 * DEG,
      twistMin: -35 * DEG,
      twistMax: 35 * DEG,
    },
    neck: {
      swingXMin: -45 * DEG,
      swingXMax: 60 * DEG,
      swingZMin: -40 * DEG,
      swingZMax: 40 * DEG,
      twistMin: -70 * DEG,
      twistMax: 70 * DEG,
    },
    // Solver-limited: the box must keep |imag| of its corner below ~0.9, so no overhead reach.
    shoulder: {
      swingXMin: -85 * DEG,
      swingXMax: 35 * DEG,
      swingZMin: -25 * DEG,
      swingZMax: 65 * DEG,
      twistMin: -25 * DEG,
      twistMax: 25 * DEG,
    },
    // Solver-limited: keep the quaternion box corner below |imag| ~0.9 (see solverLimits).
    hip: {
      swingXMin: -100 * DEG,
      swingXMax: 25 * DEG,
      swingZMin: -20 * DEG,
      swingZMax: 45 * DEG,
      twistMin: -35 * DEG,
      twistMax: 35 * DEG,
    },
    tonePose: {
      waist: { x: 0.12, y: 0, z: 0 },
      neck: { x: 0.45, y: 0, z: 0 },
      shoulder: { x: -0.6, y: 0, z: 0.7 },
      hip: { x: -0.35, y: 0, z: 0.12 },
      knee: 1.0,
      elbow: 0.9,
    },
    bootLean: 0.3,
    stance: {
      pelvis: { x: 0.1, y: 0, z: 0 },
      chest: { x: 0.35, y: 0, z: 0 },
      head: { x: 0.05, y: 0, z: 0 },
      upperArm: { x: -0.45, y: 0, z: 0.3 },
      elbow: 0.8,
      thigh: { x: -0.55, y: 0, z: 0.03 },
    },
    solverIterations: 6,
    softCcdDistance: 0,
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
    crash: cloneCrashConfig(base.crash),
  };
}

function cloneCrashConfig(c: CrashConfig): CrashConfig {
  const tp = c.tonePose;
  const st = c.stance;
  return {
    ...c,
    tripSpeed: { ...c.tripSpeed },
    groundTripScale: { ...c.groundTripScale },
    solverLimits: { ...c.solverLimits },
    segmentMass: { ...c.segmentMass },
    waist: { ...c.waist },
    neck: { ...c.neck },
    shoulder: { ...c.shoulder },
    hip: { ...c.hip },
    tonePose: {
      ...tp,
      waist: { ...tp.waist },
      neck: { ...tp.neck },
      shoulder: { ...tp.shoulder },
      hip: { ...tp.hip },
    },
    stance: {
      pelvis: { ...st.pelvis },
      chest: { ...st.chest },
      head: { ...st.head },
      upperArm: { ...st.upperArm },
      elbow: st.elbow,
      thigh: { ...st.thigh },
    },
  };
}
