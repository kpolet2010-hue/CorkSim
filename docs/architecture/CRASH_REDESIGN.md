# Crash System Redesign (WP-2C)

_2026-11-25 · Owner: lead (main session) · Status: in progress, NOT accepted. The user reviews the recordings._

## 1. Audit: why the crash looks wrong

| Symptom (user) | Root cause in code |
| --- | --- |
| "Rigid cheese block with legs" | The whole crash is **one Rapier capsule** (`PhysicsWorld.startTumble`, capsule half-height 0.45, radius 0.3). The skier root is glued to that capsule (`stepTumble` derives the foot point from it), so the whole character rotates as one rigid object. |
| Legs stay in the skiing pose | The animator crash layer (`SkierAnimator.buildCrash`) starts from `neutral()` (a standing ski stance) plus `wobble()` noise. The ski targets stay 0.18–0.43 m under the hips, and the legs are IK-solved to them, so the legs are always in a ski stance. No physics touches the limbs. |
| Doesn't fall onto back or side | There is no articulation and no loss-of-balance input. The capsule is round in cross-section, so it never comes to rest on a "back", and no crash cause has a fall direction. Ground crashes only happen on obstacle hits; landing crashes keep whatever orientation the body had. |
| Spins like a top | Air spin is copied into the capsule (`angvel × 0.6`). A capsule has no flat faces and no limbs to spread inertia, so it rolls freely on the snow. Angular damping (1.2) and friction (0.55 vs 0.35 snow) are too weak to stop it, and the round shape has no rolling resistance. |
| Weak snow interaction | Only the capsule collides; skis and limbs never touch the snow. The spawn clamp (`centre.y ≥ snow + 0.85`, +0.05) also pops head-first crashes up into the air. That is the 2 m bounce seen in the earlier review. |
| Animation fights physics | The crash pose is procedural noise on top of the capsule transform. Recovery (`recover()`) hard-resets the root to upright, facing downhill, and only the limb pose is eased. The root snaps from lying to standing in one frame. |

The obstacle-check capsule (`checkObstacleHit`) is a separate collision probe while riding. It is unaffected.

## 2. Design

**Articulated ragdoll in the simulation** (Rapier, headless, deterministic, fixed 1/60 s step), replacing
the single tumble capsule. Crash physics owns the body; the animator only displays it.

### 2.1 Segments (11 rigid bodies)

Each segment's local frame equals the rest frame of its bone(s) in `SkierModel`. All bone rest rotations
are identity: body +Y up, +Z forward, +X left. The joint anchors use the same lengths as `RIG`, so the
displayed chain never stretches.

| Segment | Bones it drives | Approx. mass (75 kg skier) | Collider |
| --- | --- | --- | --- |
| `pelvis` | pelvis | 11 | flat cuboid (so the body slides on the hips instead of rolling) |
| `chest` | spine + chest (relative rotation split between them) | 22 | flat cuboid (a back to slide on) |
| `head` | neck + head (split) | 5.5 | ball (helmet) |
| `upperArmL/R` | upperArm | 2.2 | capsule |
| `forearmL/R` | forearm + hand + pole (rigid) | 1.8 | capsule (no pole collider) |
| `thighL/R` | thigh | 9 | capsule |
| `shinL/R` | shin + foot + ski (rigid ski boot) | 6.5 | capsule plus a thin ski cuboid (1.78 × 0.1 × 0.03 m) at the foot offset |

### 2.2 Joints

- **Knees and elbows:** revolute joints with Rapier limits (knee 0–150°, elbow 0–145°).
- **Hips, shoulders, waist and neck:** Rapier 0.19 spherical joints have no limits. Limits are therefore
  enforced in our own code, as swing-cone + twist spring-damper torques applied before each step.
  - The same mechanism also provides weak **muscle tone** towards a protective pose (arms out, chin tucked,
    knees bending). It decays as the skier goes limp after the impact.
  - All plain arithmetic, so it stays deterministic.
- Joints between connected segments have contacts disabled. Skier parts do not collide with each other;
  only with the snow and obstacles.

### 2.3 Crash entry

- **Momentum is preserved exactly.** Each segment gets `v + ω × r` from the skier's rigid motion at the
  crash. No extra spin is added and none is scaled away.
- **Loss of balance comes from the cause**, as a momentum-conserving "trip" impulse pair applied to the legs
  and the torso. There is no animation:
  - **backward:** the skis shoot forward relative to the hips (bad landing, back-seated).
  - **side:** the skis slip out to one side (yaw or roll landing errors, rail bails towards the balance side,
    edge catch).
  - **forward:** the skis catch while the torso continues (head-first, nose-down, obstacles).
- **Initial pose:** the athletic stance built from the RIG lengths. There is no spawn pop: the ragdoll is
  lifted only by actual penetration plus 1 cm.
- **Test hook:** `PlayerController.debugFall(kind)` triggers ground falls in scripts and tests, since ground
  falls have no gameplay trigger yet. It is exposed as `game.debugFall(kind)`.

### 2.4 Snow interaction, rest and recovery

- Friction: clothing ≈ 0.45, skis ≈ 0.2, helmet 0.5 (snow trimesh 0.35). Moderate per-segment angular damping
  stands in for air drag and flailing.
- **Settled** means the pelvis speed is below about 0.8 m/s and every segment's angular speed is below about
  1.5 rad/s, for 0.4 s, after at least 1.2 s.
  - After settling the skier lies still for about 0.6 s, then recovers. The hard cap is about 5 s.
- `recover()` stands the skier up at the pelvis location. The animator plays a **get-up blend** from the
  frozen last ragdoll pose, in world space, over about 0.7 s. No root snap.

### 2.5 Sim → render contract

- `player.ragdoll: RagdollView | null` (read-only). `segments[i]` holds `{ name, position, quaternion,
  prevPosition, prevQuaternion }` in world space, updated each fixed step.
- While CRASHED, `body.position` / `body.orientation` are set so that the model root equals the pelvis
  world transform × inverse(pelvis rest offset). Game's existing root interpolation keeps working.
- `SkierPoseInput.ragdoll` carries the interpolated segment transforms. `buildSkierPose(player, time, out,
  alpha)` gets the fixed-step alpha from `Game.ts` (architect).
- `SkierAnimator`: while a ragdoll pose is present, the bone local rotations come only from the segments,
  via `inverse(parentSegment) × segment`. There is no IK, no procedural noise and no grab layer. Blend in
  from the last animated pose over about 0.1 s (no snap). Blend out through the get-up transition.
- The old `buildCrash` noise layer and the tumble capsule are removed.

## 2.6 Session 4 revisions (2026-11-26, from the recordings)

Found by recording the committed ragdoll (`b237d7e`) and measuring it headlessly (pelvis height, knee
angles, settle criteria per step) before changing anything:

| Problem seen | Cause | Change |
| --- | --- | --- |
| Forward fall stands stiff-legged for ~0.5 s with the torso hanging down (a pike), then topples sideways | The ski is flat and rigid with the shin, so the shin angle is fixed. Anything that moves the feet back relative to the hips (the forward trip pushed the legs back) swings the thigh to vertical and locks the knee at its 0° stop. On a straight knee gravity acts along the leg and can never buckle it, and the long skis make the pose statically stable. | Forward trip 0 with the skis on the snow (`groundTripScale.forward`): the athletic stance already leans forward, so gravity tips the body over the skis, the knees buckle, the hands catch and the chest goes down. Knee hinge minimum `kneeMin` = 12° (a falling skier's knees never lock out). Tested: a trip at the ski tip or on the shins only still locked the knees. |
| Big Air crashes (and g4) recover at the 5.5 s cap while still sliding | On steep landings plough drag alone gives a terminal slide of ~1.5 m/s, above the 0.8 m/s settle speed | **Self-arrest**: a bounded Coulomb-like deceleration (3.5 m/s²) of the tangential velocity of touching segments, ramped in after 0.5 s **on the snow** (air time after a jump crash does not count). Never reverses a velocity; holds a stopped body on a slope. |
| Pelvis hitch of ~v·dt at crash entry | Spawn set `prev = current`, so the first interpolated step stalls | The spawn is treated as the end of a step: `prev = position − v·dt`, rotation − ω·dt (`RagdollSpawn.dt`). |
| Get-up snaps from lying to standing in ~0.25 s, arms flung wide | 0.5–0.8 s smoothstep blends turning bones by up to a half turn | `GETUP_TIME` 0.8 → 1.5 s, staggered: arms 0–0.95 s, legs 0.1–1.15 s, torso and pelvis 0.35–1.5 s. Recovery crouch hold `GETUP_TIME × 0.8`. |
| g6: after a tree crash off-piste the skier is teleported back through the net on recovery; the camera loses them | Nets and rail pipes had no colliders; `recover()` clamped x to `halfWidth − 3` | Nets (`FENCE_*` in `Park.ts`, shared with the renderer) and rail pipes are colliders in `GROUP_RAGDOLL_SOLID`, solid for the ragdoll only (riding, grinding and the obstacle query are unchanged). `recover()` keeps the skier on the side of the net they lie on. |
| g5: body lies through the rail after a bail | Same: rail pipes were not solid | Rail pipe capsules (radius 0.035, one radius below the path's top line, as rendered). |
| Head-first landing sinks 0.19 m into the snow (Simulation test) | Forward trip 0 also applied to landing crashes | `tripSpeed` back to 2.8 for every kind (landing crashes × `landingTripScale`); `groundTripScale` {1, 1, 0} applies only with the skis on the snow, so ground forward falls have no trip. |
| Backward fall unreadable: from straight behind, a body lying along the slide shows only two boots | Crash camera yaw = slide direction | **Three-quarter orbit**: the crash yaw target is the slide direction ± 38° (on the side the camera already is), faded in as the slide slows below 9 → 4 m/s (at speed it stays behind to track). Look-down 20° → 24°. |

Regression tests: forward fall buckles the knees and goes down (no pike); knees never lock; self-arrest on a
24° slope settles before the cap; a body sliding into the edge is caught by the net and gets up where it lies;
a body falling onto a rail does not pass through the pipe; spawn `prev` is one rigid-motion step back; camera
reaches the 3/4 view as the slide slows with the body framed. Each new physics test fails on the previous
implementation.

Still open (session 4): b4 (XL backflip, ~70 km/h) ends at the 5.5 s cap with the body nearly stopped; the arms
trail at the shoulder limit while sliding on the back (symmetric, still); no binding release.

## 3. Work split

1. **Physics** (`physics-simulation-engineer`): `src/physics/Ragdoll.ts` (new), `PhysicsWorld.ts`,
   `PlayerController.ts` (crash, stepCrashed, recover, debugFall), `physicsConfig.ts` (crash section), and
   Vitest tests:
   - determinism
   - comes to rest
   - angular velocity dissipates (no continuous spinning)
   - a backward fall ends with back or side contact
   - joint limits respected
   - segment chain stays connected
2. **Character** (`character-animation-engineer`): `poseFromSim.ts`, `SkierAnimator.ts` (ragdoll drive,
   blend in, get-up), with tests.
3. **Architect:** `Game.ts` (alpha, `debugFall`), and `Effects` contact from the segments if needed (graphics).
4. **QA:** six scenarios in both parks, recorded as video plus frame sequences from the gameplay camera:
   1. backward fall while skiing
   2. sideways fall while carving
   3. forward fall
   4. crash after a large jump
   5. crash after a rail trick
   6. high-speed impact
