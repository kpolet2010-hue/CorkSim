# Freeski – Development Notes

Status document for the project. Updated at the end of every milestone.

_Last updated: 2026-11-23_

## Current status

The first complete playable version is implemented. All items of the definition of done are covered,
with the limitations listed at the end of this file.

| Check                           | Result                                                      |
| ------------------------------- | ----------------------------------------------------------- |
| `npm run typecheck` (strict)    | passes                                                      |
| `npm run lint`                  | passes, no warnings                                         |
| `npm test` (Vitest)             | 111 tests in 16 files pass                                  |
| `npm run build`                 | passes                                                      |
| `npm run test:e2e` (Playwright) | 6 browser tests pass (headless Chromium, SwiftShader WebGL) |

## Milestones

- [x] **M1 Foundation** – Vite + React + TS strict, ESLint/Prettier, Vitest/Playwright, fixed-timestep
      loop, Three.js renderer, sky, fog, lights, chunked terrain, chase camera.
- [x] **M2 Ski physics** – skier body, two independently resolved skis, Rapier world, analytic snow
      contact, gravity/slope acceleration, glide friction, snow resistance, quadratic drag, gradual
      braking, sidecut carving with edge grip, push/tuck, reset/recover.
- [x] **M3 Jumping and tricks** – jump charge, pop, auto-pop at the lip, late-pop window, pre-wind,
      airborne rotation physics (spin/flip/roll + tilted off-axis axis), grabs, trick recognition from
      measured rotation, landing evaluation against the landing surface, crash tumble.
- [x] **M4 Snowpark** – data-driven JSON parks, kickers (takeoff + table + knuckle + landing), ramps,
      rollers, rails and boxes as geometric paths (straight, down, up, kinked, curved, rainbow), locking,
      grinding with balance, presses, pop-off, rail-to-rail transfers, two complete parks.
- [x] **M5 Gameplay** – scoring with combos, variety and repetition penalties, HUD, trick feed, banners,
      pause menu, restart, results screen, settings (graphics, resolution, camera, audio, key bindings,
      fullscreen, landing assist), persisted settings.
- [x] **M6 Polish** – procedural rigged skier with IK, snow sparkle shader, spray particles, snowfall,
      ski tracks, instanced forest with LOD, park decoration (fences, gates, lift, signs, dye lines),
      procedural Web Audio, optional GLB asset loading, error handling, browser tests.

## Architecture

```
src/
  core/        GameLoop (fixed step + interpolation), math, deterministic Random/noise, EventBus
  config/      physicsConfig (all tunables), scoringConfig, settings (+ persistence, sanitising)
  input/       actions (ControlInput), InputManager (the only keyboard listener in the game)
  terrain/     Terrain: analytic C1 height function integrated from a slope profile
  park/        types (JSON schema), ParkLoader (validation), Park (construction), SurfaceFeatures
               (kicker takeoff, landing, ramp, roller), SurfaceField (terrain ∪ features query)
  physics/     SkiPhysics (ground), AirPhysics (air, landing assist, posture), PhysicsWorld (Rapier)
  player/      SkierBody (physical state), PlayerState (FSM + transition table), PlayerController
  tricks/      RotationTracker, TrickRecognition, GrabSystem, grabs (data-driven catalogue)
  landing/     LandingEvaluator
  rails/       RailPath (geometric path), RailSystem (locking, grinding, balance, exits)
  scoring/     ScoringSystem (+ pure scoreAirTrick / scoreRailTrick)
  sim/         Simulation (headless orchestrator), events
  render/      terrain/park/forest meshes, materials, SkierModel, SkierAnimator, IK, camera,
               particles, ski tracks, AssetLoader
  audio/       AudioSystem (procedural Web Audio)
  game/        Game: browser orchestrator (renderer, loop, input, audio, HUD bridge)
  ui/          React + Zustand: menus, settings, HUD, pause, results, loading
```

**Separation of simulation and presentation.** `Simulation` contains everything that affects gameplay and
has no DOM, WebGL or audio dependencies. It is advanced with a fixed 1/60 s step from `ControlInput`
snapshots, so it runs identically in the browser and in tests (the integration tests ski complete runs,
land tricks and grind rails headlessly). `Game` owns rendering and interpolates the skier between the last
two physics states. React only renders menus and the HUD; the HUD receives throttled snapshots
(~12 Hz) through a Zustand store and every HUD block subscribes only to the fields it shows.

**Player state machine.** `IDLE, RIDING, CARVING, BRAKING, JUMP_CHARGING, AIRBORNE, RAIL_GRINDING,
LANDING, CRASHED` with an explicit transition table (`player/PlayerState.ts`). Illegal transitions are
rejected and counted; only explicit resets may force a state. Each fixed step dispatches to exactly one
subsystem (ground, air, rail, crash), so e.g. ground carving can never run while airborne. Input is
contextual: A/D carve on the ground, spin in the air, balance on rails.

## Physics model

### Ground (physics/SkiPhysics.ts)

Per step:

1. Each ski samples the snow under its tip and tail → contact point, averaged normal, gap. Skis are in
   contact if the gap is below `contactTolerance` (12 cm, absorbs small bumps without jitter).
2. Edge angle follows the steering input at `edgeRate`. Carving yaw rate is `v · sin(edge) / R_sidecut`
   (sidecut 15 m), so carving is more effective at speed; at low speed a rotary "pivot" rate dominates.
3. Forces in the snow tangent plane (m = 75 kg):
   - gravity (full vector; the normal part is cancelled by the contact constraint),
   - longitudinal glide friction `μ_k N` (μ_k = 0.045) plus braking friction that ramps in over 0.35 s,
   - lateral edge grip that cancels sideways velocity within `lateralGripTime`, limited by
     `μ_lat(edge) · N`; turning the skis therefore _redirects the velocity_, and excess demands skid,
   - quadratic drag `½ ρ C_dA |v| v` (CdA 0.55 upright / 0.30 tucked) and a small linear snow resistance,
   - a skating/poling push below 7 m/s.
4. Semi-implicit Euler, then a non-penetration constraint: penetration is resolved vertically and the
   inward normal velocity removed (inelastic → no bouncing). The normal force is reconstructed from that
   impulse, `N = m Δv / dt`, so friction naturally fades when the skier is unweighted over a crest.
5. The skier leaves the ground only when geometry and velocity separate them from the snow (gap above
   `airborneGap`, or a small gap with separating normal velocity). This is how kicker lips launch the
   skier; plain terrain never launches randomly.

Load is shifted to the outside ski in a turn; each ski reports its own load, edge angle and skid speed.

### Air (physics/AirPhysics.ts)

The body is a free rigid body under gravity and drag. Input applies angular acceleration:

- Spin about the world vertical while upright (flat spins), blending to the body axis when tilted.
- Flip about the body's left axis, roll about its forward axis.
- **Off-axis:** spin + flip/roll accelerates rotation about an axis tilted 55° from the horizon-referenced
  spin axis towards the flip/roll direction. That genuinely tilted axis produces corks (roll), bios
  (back) and mistys (front) that invert the skier, instead of canned animations.
- Without input each axis coasts down (the skier "opens up"). Grabbing lowers inertia, and angular
  momentum is conserved (ω scales by the inertia ratio).
- Pre-wind: rotation keys held while charging give initial angular velocity at takeoff.
- Assistance (configurable): a natural posture term levels pitch/roll towards the predicted landing slope
  when no flip/roll input is given (spin untouched), and a landing "spotting" assist within 38° of a
  landable orientation in the last 0.38 s before impact. Both can be disabled.

### Trick recognition (tricks/)

`RotationTracker` integrates the world angular velocity `W = ∫ω dt` (exactly θ·â for a fixed axis) in
the takeoff frame and counts inversions with hysteresis on the body up vector. Classification:
no inversion → spin (rounded to 180°); inverted with little spin → flips (count = inversions, direction
from the pitch sign); otherwise off-axis with type from the horizontal axis component. Names follow
freestyle shorthand ("Right Double Cork 10", "Left Bio 5", "Switch Left 720 Mute"). Recognition runs once
per landing on the accumulated data, so double recognition is impossible; crashes discard the trick.

### Landing (landing/LandingEvaluator.ts)

Compares the body up vector with the _landing surface normal_, the skis' direction with the velocity
projected on the slope (forward or switch), the impact speed into the slope (a steep landing is soft, a
flat landing hard), residual angular velocity and a still-held grab. Thresholds live in `LandingConfig`
and are generous enough that floating point noise never causes a crash. Head/torso contact before the
skis is detected separately ("Head first").

### Rails (rails/)

Rails and boxes are polylines (curves pre-sampled from Catmull-Rom splines). Locking requires the skis to
be within the lock radius of the path, arriving from above, roughly aligned (≤ 55°) and fast enough.
While grinding the position is the arc-length parameter `s`; gravity along the tangent and kinetic
friction change the speed, the tangent defines orientation, and stance (50-50, switch, boardslide) is
snapped from the approach angle. Balance drifts (deterministically seeded per attempt, harder on slides,
kinks and at speed) and is countered with A/D; losing it bails. Exits fly off the end with momentum or pop
with Space; air rotation before locking scores "N On", after leaving "N Out". Rail-to-rail transfers bank
the first grind when the next one locks.

### Crash ragdoll (physics/Ragdoll.ts)

A crash turns the skier into an articulated ragdoll of 11 Rapier bodies (spec and audit:
`docs/architecture/CRASH_REDESIGN.md`). There is no animation layer: the body movement comes from physics.

- **Segments:** pelvis and chest (flat round cuboids, a back and hips to slide on), head (ball), upper arms,
  forearms (hand + pole rigid), thighs (capsules) and shins (capsule plus a rigid boot + ski cuboid
  1.78 × 0.1 × 0.03 m). Masses for 75 kg (scaled to `physics.mass`): 11 / 22 / 5.5 / 2.2 / 1.8 / 9 / 6.5 kg.
  Each segment's frame is the rest frame of the bone(s) it drives (identity in the rest pose, +Y up, +Z
  forward, +X left) with its origin at the bone joint; the offsets come from `player/bodyDimensions.ts`,
  which a test checks against `RIG` and `SkierModel.buildRig`. The foot/ski frame is Rx(−bootLean) in the
  shin (fixed boot forward lean, 0.3 rad), so the ski is flat when the shin leans forward by that angle.
- **Joints:** knees (0–150°) and elbows (0–145°) are revolute with Rapier limits (rapier3d-compat 0.19
  ignores `JointData.limits` for revolute joints: they are set with `setLimits` after creation).
  Hips, shoulders, waist and neck are spherical joints whose per-axis angular limits are set through the
  joint set (`ImpulseJointSet.raw.jointSetLimits`, the JS wrapper has no `setLimits` for spherical
  joints). Rapier limits each imaginary component of the relative quaternion (a box); a box whose corner
  reaches |imag| = 1 lets the rotation reach w = 0, where the double cover flips the sign and the limit
  explodes, so every solver-limited range keeps Σ sin²(limit/2) < 0.85 (tested). That rules out an
  overhead arm reach. Our own soft limit (swing ellipse + twist, velocity level) remains as a
  configurable fallback (`crash.solverLimits`): explicit limit torques were measured to be too weak under
  gravity, unstable when stiffened, and fidgety against contacts. Skier parts never collide with each
  other. Hard and soft CCD are off on the ragdoll (both destabilise the jointed chain); the snow trimesh
  uses `FIX_INTERNAL_EDGES` so skis and limbs do not catch on interior triangle edges.
- **Muscle tone and damping:** a weak spring-damper towards a protective pose (arms forward/out, chin
  tucked, slight hip and knee bend) decays from 1 to 0.08 with τ = 0.6 s; joint damping 2.5 /s. Ball joints
  get explicit torque impulse pairs before each `world.step()`, hinges an acceleration-based motor.
- **Crash entry:** every segment gets the skier's rigid motion `v + ω × r` (r from the foot point, the
  pivot of the air rotation), so momentum is preserved exactly (no damping, no extra spin). The loss of
  balance is a momentum-conserving trip impulse pair (legs vs chest, head and arms; pelvis = pivot) of
  2.8 m/s relative, spread over 0.12 s: backward = skis shoot forward (relative to the travel), forward =
  skis catch, side = skis slip out opposite to the fall side. Landing crashes derive the kind from the
  touchdown (`fallFromTouchdown`: tilt in the slope plane against the travel, skis sideways, hard upright
  impact = backward) with the trip scaled by 0.6; obstacles fall forward (spawned from the pre-step position
  so the ragdoll does not start inside the obstacle); rail bails fall to the side the balance tipped to.
  The athletic stance is built from the RIG lengths and lifted only by its actual snow penetration (+1 cm).
- **Snow:** clothing friction 0.45, skis 0.2, helmet 0.5 (snow 0.35, averaged), restitution 0.05, linear /
  angular damping 0.05 / 0.8. Segments within 5 cm of the analytic snow get a ploughing drag on their
  tangential velocity (0.6 /s) and extra angular damping (5 /s, rolling resistance).
- **Rest and recovery:** settled = pelvis slower than 0.8 m/s and the low-passed (0.15 s) largest segment
  angular speed below 1.5 rad/s for 0.4 s, after at least 1.2 s; the skier lies for 0.6 s and recovers at
  the pelvis (stepping off features as before). Hard cap 5.5 s, fall-through guard (pelvis 1.2 m under the
  snow), NaN guard.
- **Contract:** `player.ragdoll: RagdollView | null` (segments with world position/quaternion, the state
  before the last step, velocities, snow contact; static layout `info`; `bootLean`; `time`). While CRASHED
  `body.position/orientation` = pelvis × inverse(pelvis rest offset) and `body.velocity/angularVelocity` are
  the pelvis's. `player.debugFall(kind, side)` starts a ground fall (scripts, tests);
  `player.crashSettled` and `player.lastFall` describe the crash.

### Rapier

Rapier (`@dimforge/rapier3d-compat`, the WASM-embedded build of `@dimforge/rapier3d`) owns the solid
world: tree trunks, rail/box supports and box bodies (crash obstacles, queried with the skier's body
capsule each step), plus a triangle mesh of the snow used for the crash ragdoll. Rapier 0.19 scene
queries use the broad-phase BVH, which only a world step builds, so `PhysicsWorld` steps the (still
body-less) world once after loading; before that fix, obstacles were invisible until the first crash.

**Trade-off:** normal ski contact uses the analytic `SurfaceField` instead of Rapier ray casts against a
triangle mesh. The analytic surface gives exact, smooth normals (no facet jitter at speed), is allocation
free, deterministic and lets tests run without WebGL. The render mesh samples the same function.

## Scoring (scoring/, config/scoringConfig.ts)

Progressive spin points (`100 · (deg/180)^1.35`), flip and inversion points, off-axis multipliers by type,
grab base + hold time, grab-with-rotation and switch multipliers, airtime bonus; rails by stance, press,
distance, spins and feature difficulty. Landing factor 1 / 0.5 / 0 for clean / sketchy / crash.
Repeating a trick scales it by 0.7^n (min 0.2). Tricks within a line (≤ 4 s on the ground between them)
form a combo; its multiplier grows with length and variety and the bonus is banked when the line ends,
or lost on a crash. Everything is deterministic (tested).

## Parks

Parks are JSON (`src/park/parks/*.json`) validated by `ParkLoader`. Jumps sit on terrain steps (mellow
approach, steep landing) exactly as real parks are built; kicker geometry is derived from lip height and
takeoff angle (circular transition), followed by a table, a rounded knuckle and the landing.
Headless probes were used to tune gaps so the natural line lands in the sweet spot.

- **Glacier Park** – rail garden (flat box, down rail, flat-down rail, curved box, rainbow box, up rail,
  straight rail), S/M/L jump line, XL and M side hits, transfer rails, down box, down-flat box, rollers.
- **Big Air Ridge** – steep in-run, L/XL/XXL tables (≈2.4 s airtime), warm-up box and rail.

## Rendering

ACES tone mapping, physically based materials, analytic sky with PMREM environment lighting, exponential
fog, a directional sun whose shadow frustum follows the skier (PCF soft shadows), chunked terrain meshes
for frustum culling (coarser away from the corridor), distant mountain backdrop, instanced forest with
near/far LOD rebucketed a few times per second, snow normal map + view-dependent glitter injected into
the standard shader, pooled snow spray, camera-following snowfall, ring-buffered ski tracks.
Quality presets (low/medium/high) control shadow map size, pixel ratio cap, terrain density, tree count,
particle counts, sparkle and antialiasing; resolution scale is live.

The skier is a procedural rig (pelvis, spine, chest, neck, head, shoulders, arms, hands with poles,
legs, boots, twin-tip skis). `SkierAnimator` drives it with analytic two-bone IK: feet stay planted on the
skis, knees bend with crouch/compression, hands reach real points on the skis for grabs, arms balance on
rails and flail in crashes. Visual transforms are interpolated between physics states.

## Assets

No external assets are required. `render/AssetLoader.ts` optionally loads Blender-exported `.glb` files
(currently `public/models/pine.glb` replaces the near-LOD tree). Missing, invalid or slow files fall back to
the procedural version (tested).

## Robustness

NaN/Infinity guards on every step (reset if ever detected), angular velocity clamps, quaternion
re-normalisation, speed limit, out-of-bounds respawn, head-first detection, crash ragdoll fall-through
guard, ragdoll NaN guard and hard cap, automatic recovery after crashes, Backspace reset, stuck hint. The loop clamps long frames,
resynchronises after tab switches and auto-pauses on visibility loss. Keyboard listeners are registered
once (centrally), bound keys only suppress browser shortcuts while the game is active and focus is not in a
form field, and held keys are released on blur. All geometries, materials, textures, listeners, the
AudioContext, the Rapier world and the WebGL context are disposed when leaving a run.

## Known limitations and next steps

- **Performance has not been measured on real GPU hardware.** The only measurements available in this
  environment are headless Chromium with SwiftShader (software WebGL), which ran at 10–17 fps; that says
  nothing about desktop GPUs. The simulation itself measured ≈9 µs per fixed step on this machine
  (Node, 6000 steps riding Glacier Park), so CPU-side physics is not a bottleneck.
  Measure with the in-game FPS counter (Settings → Graphics → Show FPS) and adjust the presets.
- The skier is procedural primitive geometry, not a sculpted, skinned character. The rig and animator are
  structured so a skinned GLB could be retargeted later.
- Arm IK is a two-bone solver without joint limits; extreme grabs can show elbow flips.
- Audio is fully synthesised (filtered noise + oscillators); recorded samples would sound more natural.
- Rail stance is fixed at lock time (no in-grind 90° swaps); "180/270 On" depends on the measured air
  rotation before locking.
- No mouse camera orbit (camera sensitivity setting controls follow responsiveness instead).
- Only two parks; a park editor UI would be a natural next step since parks are plain JSON.
- Mobile/touch is intentionally not supported.

## Fixed: blank gameplay viewport (dev server)

**Symptom:** after clicking Play the HUD ran but the 3D viewport stayed dark navy (`npm run dev` only).

**Root cause:** React StrictMode mounts → unmounts → re-mounts `GameView` in development. The first
`Game` was disposed while its async `init()` was suspended at an `await`; `init()` resumed and created a
WebGL renderer anyway, appending a canvas that never renders. Both canvases were `height: 100%` blocks,
so the dead canvas filled the viewport and pushed the live one below the fold. Production builds have no
double mount, so preview-based tests passed.

**Fix (`src/game/Game.ts`, `src/ui/components/GameView.tsx`):** `init()` checks `disposed` after every
`await`, releases anything created meanwhile and returns `false`; resource release is a shared,
idempotent `releaseResources()`. `GameView` only starts the game when `init()` returns `true`.

**Regression tests:** `e2e/rendering.spec.ts` runs against both the production preview and the Vite dev
server (StrictMode) for both parks. It asserts exactly one gameplay canvas at the top of the viewport,
decodes a screenshot and checks luminance variance, colour count and brightness (not the page
background), and verifies the skier moves and the camera follows. With the fix disabled, the dev-server
test fails.

## Not yet done from the visual-upgrade request

The character/animation upgrade, environment and VFX polish, camera modes, replay system, audio polish and
GPU performance measurements were not started. `scripts/showcase.mjs` captures the screenshot set for
those visual checks.
