# Session Progress — Freeski Quality Transformation

## Resumed 2026-11-24 (session 2)

- State verified: tree clean, `main` = `origin/main` = `5d74a98`, no project servers or agents running.
- Baseline re-run: typecheck, lint and 111/111 Vitest pass; `FREESKI_GPU=1 npx playwright test` passes
  10/10 (51 s).
- The user chose **sequential** execution. Order: WP-1 → WP-2 → WP-5 → WP-3 → WP-4 → WP-6 → WP-7.
- **WP-1 (graphics) dispatched** to `graphics-environment-engineer`. The other packages are waiting.
- **WP-1 acceptance (the user's requirement):** tests passing is not enough. WP-1 counts as done only when
  it looks clearly better than the baseline:
  - **Screenshots:** compare against the baseline with identical fixed views in both parks, using
    `scripts/compare-views.mjs` (13 views: spawn, rail garden, jump line, knuckle/landing, side hits, carve
    spray, air, landing burst, grind; Big Air: spawn, XL jump, warm-up rails, riding).
  - **Performance:** measure on the real GPU (`perf` flag), baseline and new back to back under the same
    load. Note that Edge renders on the **AMD Radeon RX 9070** (D3D11), not the Intel iGPU mentioned earlier.
  - **Regressions:** document all regressions and unresolved problems.
  - **If it isn't convincing:** keep improving WP-1 before starting WP-2.
- **Baseline setup:**
  - Git worktree of `5d74a98` in the session scratchpad (`baseline-wt`, `node_modules` as a junction).
  - Build served with `npx vite preview --port 5199`.
  - Baseline screenshots in `scratchpad/cmp-baseline/`. Baseline perf is not yet measured (it must run back
    to back with the new build).
  - Remove the worktree afterwards with `git worktree remove`.
- **WP-1 iteration 1 reviewed: not accepted.** All 121 tests passed and so did the e2e run, but the
  side-by-side comparison (`scripts/side-by-side.mjs`, composites in `scratchpad/sbs/`) showed:
  - Gains: mountains, sidelight and shadows, fences, lift, sky, Big Air theme.
  - Particles are weaker than the baseline (carve spray and landing burst are barely visible).
  - The corduroy looks synthetic and shows moiré.
  - The snow reads grey or beige.
  - The knuckle and landing are unreadable from the table, and the lip dye line is a full-width blue band.
  - The horizon sky is pale.
- **Perf, real GPU (RX 9070, High preset, vsync off):**
  - Mean 911 → 699 fps (about +23% frame cost); p95 ≤ 2.2 ms.
  - Draw calls −30 to −40%; triangles +35%; shader programs 15 → 41.
  - 37 ms hitch on the first frame. The fix is `Environment.warmUp` plus a call in `Game.init` (WP-6).
- **Iteration 2:** sent back to the same agent with concrete targets.
- **WP-1 iteration 2 reviewed: a clear improvement** (composites in `scratchpad/sbs2/`).
  - Accepted: bright snow with blue shadows, subtle corduroy without aliasing, deep blue sky, rock structure on
    the mountains, Big Air no longer beige, visible spray, sparks and snow flecks.
  - Perf back to back (RX 9070, High, uncapped): mean 804 → 759 fps. Run-to-run noise is about ±15%, so the
    real extra cost is about 5–15%. p95 < 2 ms. Draw calls −10 to −25%.
  - The first-frame hitch dropped from 37.7 to 19.8 ms.
  - Integrated in `Game.ts` (architect): `environment.warmUp(camera)` after `renderer.compile`, and the
    redundant `toneMappingExposure = 0.74` line removed.
- **Iteration 3 (narrow):** the landing burst hides the skier (`g8`) and the carve spray looks like ground fog
  in `g6`. Scope: Effects / effectsModel / SnowParticles only.
- **WP-1 ACCEPTED** after iteration 3 (composites in `scratchpad/sbs3/`). The full report is in
  `docs/qa/WP-1-acceptance.md`. Checks: Vitest 121/121, `FREESKI_GPU=1` e2e 10/10. Not committed.
- **WP-2 (skier and animation) dispatched** to `character-animation-engineer`.
- **WP-2 acceptance tooling:** `scripts/skier-views.mjs` produces 15 close-up poses. The baseline is in
  `scratchpad/skier-baseline/`.
- **WP-2 iteration 1 reviewed: a strong improvement, not yet accepted.**
  - Model: the skier is 5 SkinnedMeshes, 25 bones and 20.8k triangles (it used to be 37 rigid meshes). It has a
    real jacket, baggy pants, helmet, goggles, boots, bindings, twin-tips with a top sheet, and poles. All 8
    grabs are distinct. Tests: Vitest 139/139, e2e 10/10.
  - Integrated in `Game.ts`: the reused `poseInput`, and a lighter skier on the low preset (detail 0.6).
  - Must-fix (iteration 2, character agent): the tucked thigh in grabs reads as a flat olive slab (`s09`, `s10`).
  - Then, for the graphics agent: the WP-1 crash cloud hides the crash pose (`s15`).
- **WP-2 iteration 2 reviewed:** the tucked-thigh slab is fixed. Mute and Japan read as bent legs from behind,
  and the crossed skis show in Japan. The skier part of WP-2 is OK; WP-2 is formally accepted only after the
  crash fix.
- **Checkpoint commit at the user's request.**
  - All agents and servers were stopped before committing.
  - The graphics agent's crash-cloud fix was **interrupted mid-work**. Its last note: the crash burst spawns at
    body height with 3.5 m/s upward speed and a 1.4 s life, and while CRASHED the ski-spray path keeps emitting.
  - `Effects.ts` / `effectsModel*` may therefore contain a **partial, unreviewed** crash-cloud change.
    Typecheck, lint, build, Vitest (141/141) and `FREESKI_GPU=1` e2e (10/10) pass on this checkpoint.
  - **Next step:** resume the crash-cloud fix (graphics agent, narrow scope), review `s15`/`s13`/`g8`, accept
    WP-2, then WP-5.

## Resumed 2026-11-25 (session 3)

- State verified: tree clean at `2acd27e`, no project servers or agents running. The baseline worktree
  `baseline-wt` (`5d74a98`) is still registered in the session-2 scratchpad. **Keep it until the user says
  all comparisons are done.**
- Baseline before changes: typecheck, lint and build pass; Vitest 141/141; `FREESKI_GPU=1` e2e 10/10.
- Checkpoint (`2acd27e`) shots of `s13`, `s15` and `g8` were captured before any change, giving a three-way
  comparison.
- **Crash-cloud fix finished** (graphics agent). Uncommitted, in `Effects.ts`, `effectsModel.ts`,
  `effectsModel.test.ts` and `SnowParticles.ts`.
  - The impact now spawns at the actual contact point (the lowest of feet, hips or head), not under the
    airborne skis.
  - Snow is thrown along the slope, so it no longer hovers over the body or flies out of frame.
  - No double landing+crash burst, dense chunks, and a slide trail only while the body is on the snow.
  - Checks: Vitest 151/151 (+10), e2e 10/10. `s13` and `g8` are unchanged. In `s15` the pose is fully
    readable, with a low impact skirt.
  - Review composites are in the session-3 scratchpad, in `wp2-review/` and `crashfix/v4/*-sheet.png`.
- **WP-2 is NOT formally accepted.** It waits for the user's review of the three-way comparison. **WP-5 must
  not start before that.**
- Open observations for later packages:
  - Head-first crashes bounce the body about 2 m up (`PhysicsWorld.startTumble` lifts the capsule to at least
    0.85 m). This belongs to physics.
  - The chase camera puts the crash contact low in the frame. This belongs to WP-3.
- New requirement for **WP-3**: hold the right mouse button to orbit the camera (look-around).
  - Releasing the button stops the rotation.
  - Suppress `contextmenu` on the game canvas only; normal browser behaviour stays unchanged elsewhere.
  - Camera-only: it must not affect the simulation.
- Skier asset: the user prefers "Skieur" (Sketchfab), but it has no license and can't be downloaded. The user
  will ask the author for permission. Alternatives and a draft request are in `SKIER_ASSET_SEARCH.md`.
  Nothing has been downloaded, and the procedural skier stays in use.

### Crash redesign WP-2C (session 3, checkpoint commit at the user's request)

- The user rejected the old crash: a rigid capsule, the legs stayed in the ski pose, it spun like a top, and
  the root snapped on recovery. See `CRASH_REDESIGN.md` for the audit and design.
- Done and green (typecheck, lint, Vitest 196/196):
  - Physics: an 11-segment Rapier ragdoll (`Ragdoll.ts`) with fall directions from the crash cause, settle
    detection and `debugFall`.
  - Character: the bones are driven only from the ragdoll (`RagdollDriver.ts`), with a blend in and a get-up
    blend.
  - Camera: crash framing from the ragdoll body bounds.
  - Game.ts: the fixed-step alpha is passed to `buildSkierPose`.
- Recordings:
  - Old implementation: `scratchpad/crash-old`, plus `crash-old-close`. They are built from a scratch worktree
    `old-crash-wt` with a test-only `debugFall` shim.
  - New implementation: the agents' runs are in `wp2c-char` and `wp2c-cam`. A final like-for-like recording
    of the new build with `scripts/crash-scenarios.mjs` is still to do.
- **Open before showing the user:**
  1. Backward fall `g1`: the end pose looks wrong from behind (stiff "T" arms; the shins and skis are not
     visible). Check from the side by freezing the game with `game.pause()` and moving the camera.
  2. Physics follow-ups:
     - At spawn, set `prev = position − v·dt`; the pelvis currently hitches about 0.2 m at crash entry.
     - Recover only once the body is slow, not by the 5.5 s cap while still sliding.
     - Show the last ragdoll step at the recover step.
  3. Render: an arm sweeps overhead in the forward-fall get-up.
  4. Done (23:45): `Game.cameraTarget(alpha)` passes the alpha.
  5. Record the final set (12 scenarios plus close-ups).
- Point 1 resolved (23:47, side views from the frozen game, `scratchpad/inspect/backward-2s-*.png`). The
  backward-fall end pose is plausible: on the back, knees bent, skis flat on the snow. The "legs straight up"
  look from behind was foreshortening. Remaining nit: the arms lie stretched out to the sides, a bit stiff.
- Point 5 done (23:46): the final like-for-like recordings of the new build, with no page errors, are in
  `scratchpad/crash-new` (12 scenarios) and `scratchpad/crash-new-close` (g1, g2, b1, b2). Compare them with
  `crash-old` / `crash-old-close`.
  - Every Big Air crash ends at the 5.5 s cap, with the body still sliding. This confirms physics follow-up
    point 2: recover only once the body is slow.
- **Session ended at the user's request at 00:00.** No agents or servers running. Next session: points 2, 3
  and 5, then show the user the old/new comparison.
- **WP-2 is still open** until the user reviews the recordings. Do not start WP-5.
- Kept for later comparisons: the worktrees `baseline-wt` (`5d74a98`) and `old-crash-wt` in the scratchpad.
- Documented for WP-3: the XL kicker air camera falls far behind. Trees can block the crash camera (it has
  no obstacle query).

## Resumed 2026-11-26 (session 4): WP-2C continued

- State at start: tree clean at `b237d7e` (approved stance and switch look-back, untouched this session). No
  agents running. The session-3 scratchpad (old recordings, `baseline-wt`, `old-crash-wt`) had been cleared;
  the old-build recordings were regenerated from a new `old-crash-wt` worktree of `2acd27e` with the same
  test-only `debugFall` shim, using the same script and settings.
- Fixes (details and causes in `CRASH_REDESIGN.md` §2.6): forward ground falls without the knee-locking trip, plus
  a knee minimum; self-arrest; spawn `prev` continuity; 1.5 s staged get-up; 3/4 crash camera; solid nets and
  rail pipes for the ragdoll; recovery stays on its side of the net.
- New recordings (`scratchpad/crash-new`, one browser session per scenario because of machine load) and old |
  new side-by-sides (`scratchpad/compare`) are published for review as the artifact "Freeski Crash Review".
- **WP-2 is still open** until the user approves the recordings. WP-5 not started. Nothing committed.
- Test notes: `Ragdoll.test.ts` "pelvis rotation dies out" and the Vitest worker RPC can exceed their 5 s timeouts
  when the laptop is under background load (also on the untouched baseline). The assertions pass.

---

_The original pause record follows._

_Paused: 2026-11-24 · Reason: laptop under heavy load (user request) · Last commit: `c436677` (on `origin/main`)_

The detailed plan for the remaining work is in
[QUALITY_TRANSFORMATION.md](QUALITY_TRANSFORMATION.md) → "RESUME HERE". This file records the session
state at the moment of pausing.

## Completed phases

| Phase                       | Result                                                                                              | Commit    |
| --------------------------- | --------------------------------------------------------------------------------------------------- | --------- |
| Setup: agent team           | 6 agents in `.claude/agents/`, `CLAUDE.md`                                                          | `4bf5c3b` |
| Setup: skills               | 20 reviewed MIT skills in `.claude/skills/`, `docs/architecture/SKILL_AUDIT.md`                     | `4bf5c3b` |
| Phase 0: Git backup         | Committed and pushed, verified on the remote                                                        | `4bf5c3b` |
| Phase 1: analysis + roadmap | Baseline screenshots on the real GPU, quality assessment and roadmap in `QUALITY_TRANSFORMATION.md` | `6a48ca5` |
| Phase 1: integration seams  | `Game.ts` split into owned modules (see below); behaviour unchanged                                 | `6a48ca5` |
| Handoff plan                | "RESUME HERE" section with work packages WP-1…WP-7; pointer in `CLAUDE.md`                          | `c436677` |

## Running or incomplete tasks

- **None running.** No background processes, dev or preview servers, test runs or agents are active. No
  files are being written.
- **Not started:** phases 2–8 of the brief (graphics, skier, camera/replay, tricks/scoring, UI/audio,
  QA, performance). **No visible improvement to the game has been made yet.**

## Agents

**No agent is working.** The specialists were not dispatched before the pause. The work packages are
prepared but unassigned:

| Package | Agent                            | Topic                                            |
| ------- | -------------------------------- | ------------------------------------------------ |
| WP-1    | `graphics-environment-engineer`  | Lighting, snow, post-fx, park, effects           |
| WP-2    | `character-animation-engineer`   | Skier model and animation                        |
| WP-3    | `camera-gameplay-engineer`       | Camera and replay system                         |
| WP-4    | `camera-gameplay-engineer` (2nd) | Menu, HUD, results, audio                        |
| WP-5    | `physics-simulation-engineer`    | Live trick label, recognition and scoring review |
| WP-6    | lead (main session)              | Integration into `Game.ts` / `GameView.tsx`      |
| WP-7    | `qa-performance-engineer`        | Tests, screenshots, perf report                  |

## Files changed in this session (all committed)

- New: `.claude/agents/*` (6), `.claude/skills/*` (20 skills), `CLAUDE.md`,
  `docs/architecture/SKILL_AUDIT.md`, `docs/architecture/QUALITY_TRANSFORMATION.md`.
- New modules: `src/render/Environment.ts`, `src/render/Effects.ts`, `src/render/quality.ts`,
  `src/render/poseFromSim.ts`, `src/render/cameraTarget.ts`, `src/audio/audioInput.ts`,
  `src/tricks/liveTrick.ts`.
- Modified:
  - `src/game/Game.ts` (799 → ~500 lines, orchestration only)
  - `playwright.config.ts` and `scripts/showcase.mjs` (opt-in `FREESKI_GPU=1`)
  - `.prettierignore` (excludes `.claude/skills`)
- Uncommitted: only this file (`SESSION_PROGRESS.md`), by request.

## Test results (after the refactor)

| Check                               | Result                                                   |
| ----------------------------------- | -------------------------------------------------------- |
| `npm run typecheck`                 | pass                                                     |
| `npm run lint`                      | pass                                                     |
| `npm test` (Vitest)                 | 111 / 111 pass                                           |
| `npm run build`                     | pass                                                     |
| `FREESKI_GPU=1 npx playwright test` | 10 / 10 pass (Edge, Intel iGPU via ANGLE D3D11, 1.5 min) |
| `npx playwright test` (SwiftShader) | 3 / 10 pass. Environmental, see below                    |

## Open issues

1. **SwiftShader e2e is too slow on this laptop.** The default (SwiftShader) e2e run fails 7 of 10
   timing-based checks, with the same result on the pre-refactor commit, so it is not a regression. Use
   `FREESKI_GPU=1`. CI machines with faster software WebGL are unaffected.
2. **Prettier vs CRLF.** `npm run format:check` reports ~95 pre-existing project files because
   `core.autocrlf=true` checks out CRLF. This predates the session and is unrelated to the changes. A fix
   is either `.gitattributes` with `* text=auto eol=lf` or `endOfLine: "auto"` in `.prettierrc.json`.
   That is the user's decision.
3. **npm install scripts.** npm blocked the esbuild `postinstall` (install-scripts policy). Build, dev
   server and tests work anyway. Approve it with `npm install-scripts approve esbuild` if problems appear.
4. **Known game-quality gaps** (the reason for phases 2–8): a flat, washed-out look; uniform snow; a
   primitive capsule skier; a live HUD label showing "Flip" for corks; generic menu UI; no replay.

## Exact next step

1. In a new session, read `CLAUDE.md` → `docs/architecture/QUALITY_TRANSFORMATION.md` ("RESUME HERE")
   → this file.
2. Run the baseline: `npm run typecheck && npm run lint && npm test`, then `FREESKI_GPU=1 npx playwright test`.
   Expect 10/10.
3. Ask the user whether to run WP-1…WP-5 **in parallel** (faster, heavy load) or **sequentially** (light
   load). If sequential, start with **WP-1 (graphics)**, which has the largest visible impact. Then do
   WP-2 (skier), WP-5 (tricks), WP-3 (camera + replay), WP-4 (UI + audio), integrate (WP-6) and run QA (WP-7).
4. Do not commit or push without the user's explicit approval.
