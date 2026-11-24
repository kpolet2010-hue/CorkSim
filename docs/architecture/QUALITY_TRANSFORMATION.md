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
