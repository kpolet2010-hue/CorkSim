# WP-1 Graphics & Environment — Acceptance Report

_2026-11-24 · Reviewer: lead-game-architect (main session) · Result: **accepted after 3 iterations**_

## Method

- **Baseline:** commit `5d74a98` (pre-WP-1), built from a separate git worktree and served on its own port.
- **Views:** 13 fixed views with `scripts/compare-views.mjs`. Each one places the skier at an identical spot and
  speed with the camera snapped, so baseline and new build compare frame-for-frame:
  - Glacier Park: spawn, rail garden, jump line, knuckle/landing from the table, side hits, plus motion shots of
    carve spray, air, landing burst and grind.
  - Big Air Ridge: spawn, XL jump, warm-up rails, riding.
- **Composites:** baseline left, new right, built with `scripts/side-by-side.mjs` and judged visually.
- **Environment:** real GPU via Edge (ANGLE D3D11) on an **AMD Radeon RX 9070**, 1280×720, High preset (default).
- **Performance:** perf mode, vsync and frame-rate limit off (`FREESKI_UNCAPPED=1`). Draw calls and triangles are
  summed over all render passes per frame. Baseline and new were measured back to back.

## Iterations

| Iteration | Verdict | Key findings |
| --------- | ------- | ------------ |
| 1 | Rejected | **Gains:** mountains, sidelight, shadows, fences, lift. **Problems:** particles weaker than baseline, synthetic corduroy with moiré, grey/beige snow, knuckle unreadable, saturated full-width dye band, pale horizon, +23% frame cost, 37.7 ms first-frame hitch |
| 2 | Clear improvement, 2 regressions | All six points fixed. **New:** the landing burst hid the skier, and the carve spray looked like ground fog |
| 3 | **Accepted** | Landing burst is a low skirt and the skier stays readable. Carve spray is a puff arc, as in Big Air |

## Visual result (final)

| Area | Baseline | WP-1 |
| ---- | -------- | ---- |
| Snow | Flat grey-blue, no structure | Bright near-white with blue shadows. Soft, anti-aliased corduroy with groomer lanes, macro variation and sun glints |
| Lighting | Sun behind camera, flat, washed-out | Side light, crisp blue shadows, kicker/landing shapes read in 3D, per-park theme |
| Sky / atmosphere | Pale haze | Deep blue sky, fog matched to the horizon, depth in the valley |
| Mountains | Uniform grey-blue | Rock banding, snow ledges, glacier ice, shadowed faces |
| Park | Plain features | Lip and knuckle dye lines, knuckle marker poles, curvature shading, rounded rails and posts, trimmed boxes, net fences, detailed lift |
| Props | None | Instanced rocks and snow mounds outside the corridor (tested placement) |
| Particles | Small carve puffs, landing burst spawned at the takeoff lip (pre-existing bug) | Shaded puff spray scaled by edge × speed, landing skirt at the skis scaled by impact, metal-rail sparks and box flecks only while grinding |

## Performance (RX 9070, High, uncapped, mean of 13 views)

| Metric | Baseline | WP-1 final |
| ------ | -------- | ---------- |
| Mean FPS | 804 (911 in an earlier run) | 759 |
| p95 frame time | ≤ 2.1 ms | ≤ 1.9 ms |
| Draw calls / frame | 207–625 | 234–485 (−10 to −25% in most views) |
| Triangles / frame | 328k–496k | 403k–604k (+20 to +25%) |
| Shader programs | 15 | ~42 |
| Worst first-frame hitch | 16–38 ms | 19.8 ms (`warmUp` added) |

- The baseline varied by about ±15% between runs on the same machine. The real extra cost of the High preset is
  about 5–15% of frame time, roughly 0.1–0.2 ms on this GPU.
- The agent's single-view probes showed Medium and Low faster than baseline (Medium 1030 vs 974 fps, Low 1534 vs
  1324 fps), because there are fewer draw calls and no post-processing on Low.
- Vsync-capped, every preset stays at the monitor's 144 Hz.

## Tests

- typecheck, lint and build pass.
- Vitest: 121/121 (111 existing + 10 new: `Props.test.ts`, `effectsModel.test.ts`).
- `FREESKI_GPU=1 npx playwright test`: 10/10, including the blank-viewport regression tests on dev and preview for both parks.
- No console or WebGL errors in any comparison run.

## Integration done by the architect (`src/game/Game.ts`)

- Calls `environment.warmUp(camera)` after `renderer.compile`, which pre-compiles the post-processing chain.
- Removed the redundant `renderer.toneMappingExposure = 0.74` (`Environment` sets exposure from the park theme).

## Open issues / limitations

1. **No integrated-GPU measurement.** The browser exposes only the RX 9070, and `--force_low_power_gpu` had no
   effect. Low and Medium presets exist for weaker hardware but are not measured there.
2. **One ~20 ms frame remains at the first view.** It is likely the forest LOD or first shadow update, not shader
   compilation. It is noted, not blocking.
3. **The landing cannot be seen from the table** (g4). This is physically inherent, because the landing drops out
   of sight. The knuckle is marked with a dye line and poles. When the camera sits right above the lip, the lip
   dye line shows as a pale band at the bottom edge.
4. **The landing skirt is small at the default camera distance.** This is a deliberate trade-off so the skier
   silhouette stays readable.
5. **Live quality changes apply only partly.** Switching the post chain or bloom takes effect on the next run, the
   same as geometry density. There is no settings toggle for post-processing yet (optional, WP-6).
6. **Triangles rose by about 20–25%.** This is acceptable on desktop GPUs and is a candidate for WP-7 profiling.
