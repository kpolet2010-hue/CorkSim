# Freeski — Claude Code notes

Browser freestyle skiing game: Three.js + TypeScript (strict) + React + Vite + Rapier + Zustand.
Architecture, physics model, status and known limitations live in [DEVELOPMENT.md](DEVELOPMENT.md) —
read it before changing a system. `npm run check` must pass; `npm run test:e2e` for browser tests.

Key invariant: `src/sim/` is headless and deterministic (fixed 1/60 s step, no DOM/WebGL/audio/React);
`src/game/Game.ts` owns presentation. Never commit, push or merge unless asked.

## Agent team

Detailed definitions are in [.claude/agents/](.claude/agents/). Summary:

| Agent                           | Responsible for                                                        | Invoke when                                                      |
| ------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lead-game-architect`           | Architecture, shared contracts, ownership, `Game.ts`/`sim` integration | A task touches several domains, or interfaces/ownership change   |
| `graphics-environment-engineer` | Terrain/park meshes, materials, lighting, sky/fog, environment VFX     | Anything about how the world looks or renders                    |
| `character-animation-engineer`  | Skier model, equipment, rig, IK, animation and blending                | Anything about how the skier looks or moves                      |
| `physics-simulation-engineer`   | Ski/air/rail physics, tricks, landing, terrain and park geometry       | Anything about how the skier physically behaves                  |
| `camera-gameplay-engineer`      | Camera, replay, input feel, scoring, HUD, audio feedback               | Camera, replay, controls feel, scoring or HUD                    |
| `qa-performance-engineer`       | Tests, browser verification, screenshots, profiling, regressions       | After every significant change, and before calling anything done |

**Coordination.** For cross-domain work, start with `lead-game-architect`: it reads the code, splits
the task into work packages (owner, files, contracts, acceptance criteria, QA checks) and defines
interface changes first. The main session then dispatches the packages to the owning specialists,
returns their reports to the architect for integration review, and finishes with
`qa-performance-engineer` verifying in the browser. Specialists stay inside their ownership and route
out-of-domain changes through the architect. Run `claude --agent lead-game-architect` to make the
architect the main session so it can dispatch specialists directly.

## Skills

Vendored, reviewed third-party skills live in [.claude/skills/](.claude/skills/) (keep them unmodified;
audit, licenses and agent mapping: [docs/architecture/SKILL_AUDIT.md](docs/architecture/SKILL_AUDIT.md)).
Each agent file lists the skills it should load.

- `threejs-*` — rendering, shaders, lighting, post, performance, loaders/GLB pipeline, animation, debug, QA.
- `blender-*` — skier/prop asset pipeline in Blender (model → UV → rig → animate → QA → GLB export).

Rules when using them:

- Skills target three.js r184/r186; Freeski is on **r181**. Check an API in `node_modules/three` before
  using it.
- Freeski uses `WebGLRenderer`. Ignore the WebGPU/TSL sections.
- No paid asset generation (Tripo/Gemini/ElevenLabs) and no credential probes. Never run project
  scaffolds. Freeski is desktop-only, so skip mobile steps.
- `blender-*` scripts need Blender 5.2+ (not installed yet). Run them only through
  `blender-core/scripts/run_in_blender.py`.
