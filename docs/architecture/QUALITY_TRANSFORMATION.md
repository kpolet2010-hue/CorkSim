# Freeski — Quality Transformation Roadmap

_Started 2026-11-24 · Owner: lead-game-architect_

## 1. Baseline assessment (real-GPU screenshots, Edge/ANGLE D3D11, Intel iGPU)

| Area             | Finding                                                                                                                                             | Impact  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Lighting / grade | Flat and low-contrast; exposure 0.74 plus hazy fog washes the scene out. Shadows are weak and the sun reads as overcast.                            | High    |
| Snow surface     | Uniform pale grey-blue with no visible structure (no grooming, no macro variation, no shading cues for slope shape). Terrain shape is hard to read. | High    |
| Skier            | Capsule and box primitives, a teal box as a backpack, small helmet, no garment volume. Reads as a placeholder.                                      | High    |
| Park features    | Clean geometry, but the kicker/landing silhouettes merge into the snow with no edge definition. Rails and boxes are plain.                          | Medium  |
| Effects          | Spray exists but is subtle. No landing burst read, and rail sparks/snow are absent.                                                                 | Medium  |
| Camera           | Solid damped follow. Air framing can sit low behind the kicker, and shake is a random jitter rather than impact-shaped.                             | Medium  |
| HUD trick label  | A live cork is shown as "Flip" (heuristic in `Game.buildHud` diverges from landing recognition).                                                    | Medium  |
| UI               | Menu uses CSS triangles as mountains and generic slate buttons. It is functional but not "finished game".                                           | Medium  |
| Replay           | Not implemented (showcase script already anticipates `startReplay`).                                                                                | Medium  |
| Audio            | Fully synthesised, functional. No ambience bed and no menu sounds.                                                                                  | Low     |
| Architecture     | `Game.ts` (799 lines) mixed environment, effects, pose, camera and HUD logic, blocking parallel work.                                               | Enabler |

## 2. Step 0 — integration seams (done by the architect)

`Game.ts` now only orchestrates. Each presentation concern lives in a module with a single owner:

| Module                   | Owner     | Contract                                                                                                                                                                                   |
| ------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `render/quality.ts`      | graphics  | `QualityProfile`, `QUALITY` presets                                                                                                                                                        |
| `render/Environment.ts`  | graphics  | `new Environment(renderer, scene, park, quality, treeGeo)`, `update(focus, camera, dt, force?)`, `render(camera)`, `resize(w, h, ratio)`, `setShadowMapSize()`, `featureSnow`, `dispose()` |
| `render/Effects.ts`      | graphics  | `update(sim, camPos, dt)`, `onLanded/onCrash/onRailStart(sim, …)`, `clear()`, `setPixelScale()`, `dispose()`                                                                               |
| `render/poseFromSim.ts`  | character | `buildSkierPose(player, time): SkierPoseInput`                                                                                                                                             |
| `render/cameraTarget.ts` | camera    | `buildCameraTarget(player, skierPos): CameraTarget`                                                                                                                                        |
| `audio/audioInput.ts`    | camera    | `buildAudioState(player): AudioState`                                                                                                                                                      |
| `tricks/liveTrick.ts`    | physics   | `liveTrickLabel(player): string`                                                                                                                                                           |

All builders are read-only views of the simulation. Nothing in presentation writes simulation state.

## 3. Prioritised roadmap

1. **Look (graphics):** art direction, a stronger sun/sky/fog balance, colour grading and post-processing
   (WebGL `EffectComposer`, r181-verified), a snow material with grooming and macro variation, readable
   feature edges, better rails, boxes and props, and stronger spray, landing and rail effects.
2. **Skier (character):** a procedural but sculpted-looking character (lathe/tube garments, real helmet
   and goggles, gloves, boots, twin-tips with graphics), better proportions, layered procedural animation
   with damped secondary motion, readable grabs, and landing and crash poses.
3. **Feel (camera):** impact-shaped camera shake, speed FOV, air framing that keeps skier and landing in
   view, rail framing, and the replay system (recorder + player + replay cameras + slow motion).
4. **Presentation (UI/audio):** a finished-game menu and park select, HUD trick/combo/score presentation,
   results screen, pause, audio ambience and menu sounds.
5. **Tricks (physics):** live trick naming consistent with recognition, plus a review of recognition and
   scoring edge cases with tests.
6. **QA:** real-GPU screenshot set (`FREESKI_GPU=1 node scripts/showcase.mjs`), full test suite, perf
   numbers on the real GPU, and a regression report.

## 4. Rules

r181 APIs only (check against `node_modules/three`), WebGL only, no new dependencies, no paid generators,
no weakening of tests, the simulation stays headless and deterministic, and only the architect edits
`Game.ts`.

## 5. Progress log

- Step 0 seams: done. Typecheck, lint and 111 unit tests pass. All 10 Playwright tests pass on the real GPU
  (`FREESKI_GPU=1 npx playwright test`, 1.5 min).
- Found while testing: under SwiftShader this machine is too slow for the timing-based e2e checks. 7 of 10
  fail identically on the pre-refactor commit, so this is environmental, not a regression. Added the opt-in
  `FREESKI_GPU=1` mode to `playwright.config.ts` and `scripts/showcase.mjs` (Edge on the real GPU).
  Assertions are unchanged.
- **Paused 2026-11-24 at the user's request** (laptop under load). Next: roadmap items 1–6 as parallel
  work packages (graphics, character, camera + replay, UI + audio, tricks), then QA.

## 6. RESUME HERE — handoff for the next session

**State:** Phase 0 (backup) and Phase 1 (analysis + seams) are done and pushed (last commit `6a48ca5`).
**No visible game improvement has been made yet.** The original brief is phases 2–8 (visuals, skier,
camera/feel, tricks, UI/audio, QA, performance). This section is the complete plan to continue it.

### How to resume

1. Read `CLAUDE.md`, this file, `DEVELOPMENT.md` and the agent files in `.claude/agents/`.
2. `npm ci` if `node_modules` is missing. Run `npx playwright install chromium` once.
3. Baseline check: `npm run typecheck && npm run lint && npm test`, then `FREESKI_GPU=1 npx playwright test`
   (expect 10/10). Do not use the SwiftShader default on this laptop: 7/10 time out there. That is a
   pre-existing environment issue.
4. Reference screenshots: build, run `npx vite preview --port 4173`, then
   `FREESKI_GPU=1 node scripts/showcase.mjs <outDir>`.
5. Dispatch WP-1…WP-5 below as background agents. They can run in parallel because their files do not
   overlap. Sequential is fine if the laptop is under load. Then integrate (WP-6) and verify (WP-7).

### Rules for every package

- r181 + `WebGLRenderer` only. Verify every API in `node_modules/three` and `@types/three`. No WebGPU/TSL.
- No new dependencies, no paid generators, no external assets without a clear license.
- Do not weaken or remove tests, especially `e2e/rendering.spec.ts`.
- Presentation reads simulation state only. The simulation stays headless and deterministic.
- **Only the architect edits `src/game/Game.ts`, `src/ui/components/GameView.tsx`, `src/ui/store.ts` and
  `src/config/settings.ts`.** Specialists list the changes they need there in their report.
- Each agent may use its own dev server port: WP-1 5191, WP-2 5192, WP-3 5193, WP-4 5194. Start it with
  `npx vite --port <p> --strictPort`, then run
  `FREESKI_GPU=1 node scripts/showcase.mjs <dir> http://localhost:<p> [only=a,b]`.
  Never use 4173 or 5173, which are reserved for Playwright.
- While others work in parallel, `tsc` errors in files you do not own can be transient. Fix only your own.
- No commit or push without the user's explicit approval (a standing rule from the brief).

### Work packages

**WP-1 Graphics & environment** (`graphics-environment-engineer`; skills `threejs-aaa-graphics-builder`,
`threejs-lighting`, `threejs-shaders`, `threejs-postprocessing`, `threejs-performance`)

- Files: `render/Environment.ts`, `Effects.ts`, `quality.ts`, `materials.ts`, `textures.ts`, `TerrainMesh.ts`,
  `ParkMeshes.ts`, `Trees.ts`, `SnowParticles.ts`, `SkiTracks.ts`, plus new `render/*` files (e.g. `PostFX.ts`).
- Goals:
  - Write the art direction.
  - Fix the flat, washed-out look: exposure, sun/hemisphere balance, fog and colour grading.
  - Add post-processing via `EffectComposer` and `OutputPass` from `three/examples/jsm`, wired through
    `Environment.render()` and `resize()`, with per-preset quality toggles.
  - Snow with groomed corduroy on the piste, macro albedo/roughness variation and better sparkle.
  - Readable kicker lips and landing edges.
  - Better rails, boxes, fences, signs and lift.
  - Rocks and snow mounds.
  - Stronger physics-coupled spray: carve, brake, landing burst and rail particles via `Effects.onRailStart`
    and `update`.
- Constraint: the render mesh must sample the same analytic surface as physics.

**WP-2 Skier & animation** (`character-animation-engineer`; skills `threejs-animation`)

- Files: `render/SkierModel.ts`, `SkierAnimator.ts`, `IK.ts`, `poseFromSim.ts`.
- Goals:
  - Replace the capsule look with a much higher-quality procedural character: lathe/tube garments with
    volume (baggy jacket and pants), a real helmet and goggles, gloves, detailed boots and bindings,
    twin-tips with a top-sheet graphic and poles. Remove the teal backpack box.
  - Keep the joint names and RIG proportions that physics and IK rely on (stance 0.13 m, ski length).
  - Animation: idle, ride, carve, brake, takeoff, air, spin, flip, all grabs, landing compression, crash,
    rail grind and nose/tail press. Use layered, damped secondary motion and no pops.
- `SkierPoseInput` may be extended. Extend `poseFromSim.ts` in the same change.
- Blender is not installed, so everything is procedural.

**WP-3 Camera & replay** (`camera-gameplay-engineer`; skills `threejs-animation`, `threejs-postprocessing`)

- Files: `render/CameraController.ts`, `render/cameraTarget.ts`, new `src/replay/`.
- Camera goals: impact-shaped shake (trauma model instead of random jitter), speed FOV, air framing that
  keeps skier and landing in view (the cork shot currently sits low behind the kicker), rail framing and
  terrain-clip avoidance.
- Replay goals:
  - `ReplayRecorder` (preallocated ring buffer, ~20 s at 60 Hz, records transform + `SkierPoseInput` +
    camera-target fields per fixed step).
  - `ReplayPlayer` (interpolated sampling, speed 1 / 0.5 / 0.25, loop, finished flag).
  - `ReplayCamera` (follow, orbit, tripod and cinematic modes).
  - Add Vitest tests.
- The architect wires it into Game: record in `fixedUpdate`; `startReplay()`, `stopReplay()`,
  `setReplaySpeed()` and `cycleReplayCamera()` freeze the sim and drive the skier and camera from the player.
  `scripts/showcase.mjs` already expects `game.startReplay` and the test ids `replay`, `replay-ui` and
  `replay-exit`.

**WP-4 UI & audio** (`camera-gameplay-engineer`, second instance)

- Files: `src/ui/components/*` except `GameView.tsx`, `src/ui/styles.css`, `src/audio/*`.
- UI goals: a main menu and park select that look like a finished game (replace the CSS-triangle
  mountains), a HUD with trick, combo, score and speed presentation, and results and pause screens.
- Replay controls:
  - Add a pause-menu "Replay" button (`data-testid=replay`) with an `onReplay` prop.
  - Add a `ReplayOverlay` component (`replay-ui`, `replay-exit`, speed and camera buttons) driven by props.
  - The architect wires both into `GameView`.
- Keep every existing `data-testid` that the e2e tests use.
- Audio goals: ambience bed (wind), menu sounds, better landing/rail/trick layers, and no repetitive spam.

**WP-5 Tricks & scoring** (`physics-simulation-engineer`; `src/scoring` is reassigned to this package for
this phase)

- Files: `src/tricks/*` (including `liveTrick.ts`), `src/scoring/*`, `src/config/scoringConfig.ts`.
- Goals:
  - Fix the live label so a cork does not show "Flip". It must match `recognizeAirTrick` naming.
  - Review recognition, rotation counting, grabs, combo, landing factor and repetition penalties.
  - Add Vitest tests for each fix. Scores must stay plausible and deterministic.

**WP-6 Integration** (architect): wire WP-1…WP-5 into `Game.ts` and `GameView.tsx`, add settings
toggles (post-fx and shake) if needed, and update `DEVELOPMENT.md`.

**WP-7 QA & performance** (`qa-performance-engineer`; skills `threejs-qa-release`, `threejs-debug-profiler`,
`threejs-performance`):

- Run the full checks plus `FREESKI_GPU=1 npx playwright test`.
- Take before/after screenshots of all reference views in both parks.
- Measure FPS, draw calls and memory on the real GPU per preset.
- Check console and WebGL errors.
- Write the report to `docs/qa/`, then fix or hand back regressions.

Baseline screenshots for comparison: regenerate with `git checkout 6a48ca5` (identical visuals to
`4bf5c3b`). Do not commit screenshots.
