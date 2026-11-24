# Skill Audit — Freeski

_Date: 2026-11-24 · Scope: public Claude Code skills for the Freeski agent team_

## 1. Project baseline used for evaluation

| Item               | Finding                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| Three.js           | `0.181.0` (r181), `WebGLRenderer`. No WebGPU or TSL anywhere in `src/`.                                |
| Stack              | TypeScript strict, React 19 (UI only), Vite 7, Rapier 0.19 (obstacles/crash only), Zustand 5           |
| Rendering          | ACES, `Sky` + PMREM, `FogExp2`, PCF soft shadows, `onBeforeCompile` snow sparkle, instanced LOD forest |
| Physics            | Custom deterministic fixed-step sim with analytic `SurfaceField` contact (see `DEVELOPMENT.md`)        |
| Tests              | Vitest (headless sim), Playwright `e2e/rendering.spec.ts` (dev + preview, both parks, pixel checks)    |
| Screenshots        | `scripts/showcase.mjs`, `screenshots.mjs`, `landed-shot.mjs`, `diagnose-blank.mjs`                     |
| Platform           | Desktop browsers only. No mobile or touch.                                                             |
| Blender            | **Not installed** on the dev machine. `BLENDER_EXE` is unset.                                          |
| Existing `.claude` | 6 agents, no skills, no settings                                                                       |

## 2. Repositories investigated

| Repository                                                                                                     | License | Last commit | Verdict                         |
| -------------------------------------------------------------------------------------------------------------- | ------- | ----------- | ------------------------------- |
| [majidmanzarpour/threejs-game-skills](https://github.com/majidmanzarpour/threejs-game-skills)                  | MIT     | 2026-09-27  | 3 of 9 skills installed         |
| [EL4CTEO/blender-skills](https://github.com/EL4CTEO/blender-skills)                                            | MIT     | 2026-11-21  | 10 of 28 skills installed       |
| [czlonkowski/blender-web-3d-skill](https://github.com/czlonkowski/blender-web-3d-skill)                        | MIT     | 2026-09-23  | Rejected                        |
| `wolffe/threejs-skills`                                                                                        | —       | —           | **Does not exist** (GitHub 404) |
| [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) (likely the intended "threejs-skills") | MIT     | 2026-10-19  | 7 of 13 skills installed        |
| [zebbern/claude-code-guide](https://github.com/zebbern/claude-code-guide) (`three-best-practices`)             | MIT     | 2026-11-24  | Rejected                        |

Method: shallow clones into an isolated scratch directory with git hooks disabled. Read the README,
every relevant `SKILL.md` and its references, and the directory tree. Grepped every script for network
calls, `os.environ` and `process.env`, `subprocess` and `exec`, `rm -rf`, credential tokens, and
prompt-injection phrasing. **No repository script or installer was executed.** Skills were copied
manually.

## 3. Scores

Scale 1–10. For Duplication, a higher score means the skill adds more beyond our agents and other skills.

### Installed

| Skill                          | Source  | Rel | Tech | Pract | Compat | Maint | Safety | Dup | Notes                                                                                                   |
| ------------------------------ | ------- | --- | ---- | ----- | ------ | ----- | ------ | --- | ------------------------------------------------------------------------------------------------------- |
| `threejs-aaa-graphics-builder` | majid   | 9   | 8    | 8     | 7      | 7     | 8      | 8   | Art-direction workflow, render budgets, 10-category visual scorecard, `onBeforeCompile` cookbook (r184) |
| `threejs-debug-profiler`       | majid   | 7   | 8    | 8     | 8      | 7     | 10     | 7   | Ordered blank-canvas and loop triage, profiling sequence                                                |
| `threejs-qa-release`           | majid   | 6   | 8    | 7     | 6      | 7     | 8      | 5   | Release, visual-harness and bot-playtest references. Inspector works in single-view mode only           |
| `blender-core`                 | EL4CTEO | 8   | 9    | 9     | 5      | 9     | 8      | 9   | Required base: headless runner, Blender 5.x API rules                                                   |
| `blender-character-rigging`    | EL4CTEO | 9   | 9    | 9     | 5      | 9     | 9      | 9   | Rigify → game skeleton, weight rules, stress poses                                                      |
| `blender-animation`            | EL4CTEO | 9   | 9    | 9     | 5      | 9     | 9      | 9   | 5.x actions/slots, mocap retarget, bake, per-clip glTF export                                           |
| `blender-clothing`             | EL4CTEO | 7   | 8    | 8     | 5      | 9     | 9      | 9   | Baggy freestyle outfit on a skinned body, poke-through checks                                           |
| `blender-retopology-uv`        | EL4CTEO | 7   | 8    | 8     | 5      | 9     | 9      | 9   | Sculpt, scan or AI mesh → deformable game mesh                                                          |
| `blender-pbr-materials`        | EL4CTEO | 7   | 9    | 8     | 5      | 9     | 9      | 8   | Measured albedo/F0, color spaces, ORM. Directly matters for glTF → three                                |
| `blender-game-optimization`    | EL4CTEO | 8   | 9    | 8     | 6      | 9     | 9      | 7   | Web budgets (10–30k tris hero), LODs, draw calls, vertex splits                                         |
| `blender-export-pipelines`     | EL4CTEO | 8   | 9    | 9     | 6      | 9     | 9      | 8   | Tested `web` GLB preset with post-export verification                                                   |
| `blender-asset-qa`             | EL4CTEO | 8   | 9    | 9     | 5      | 9     | 9      | 9   | Mandatory numeric and visual gate for every asset                                                       |
| `blender-workflow-recipes`     | EL4CTEO | 7   | 8    | 8     | 5      | 9     | 9      | 7   | End-to-end game-character recipe                                                                        |
| `threejs-shaders`              | CloudAI | 8   | 8    | 7     | 7      | 7     | 10     | 6   | GLSL, extending built-ins and shader chunks (snow, sparkle, tracks)                                     |
| `threejs-lighting`             | CloudAI | 7   | 8    | 7     | 7      | 7     | 10     | 6   | Physical units, shadow acne, IBL and probes                                                             |
| `threejs-performance`          | CloudAI | 8   | 8    | 8     | 8      | 7     | 10     | 6   | `renderer.info`, instancing/batching/LOD, fill rate, compile stalls                                     |
| `threejs-postprocessing`       | CloudAI | 6   | 8    | 7     | 7      | 7     | 10     | 6   | Composer chains, DOF/bloom/AO for cinematic replay                                                      |
| `threejs-animation`            | CloudAI | 8   | 8    | 7     | 8      | 7     | 10     | 7   | Mixer, crossfades, additive layers, skeletal blending (runtime side of the skier)                       |
| `threejs-loaders`              | CloudAI | 7   | 8    | 7     | 8      | 7     | 10     | 6   | GLB with meshopt/Draco/KTX2, cloning skinned models, disposal                                           |
| `threejs-asset-pipeline`       | CloudAI | 7   | 8    | 8     | 8      | 7     | 10     | 7   | `gltf-transform` inspect, validate and optimize                                                         |

Compatibility for the Blender skills is 5 because Blender is not installed. They become fully usable
once Blender 5.2+ is installed. For the CloudAI skills it is 7: they target r186 and add WebGPU/TSL
sections we must ignore. Their WebGL parts fit r181 with an API check.

### Rejected

| Skill / repo                                                                                    | Rel | Tech | Pract | Compat | Maint | Safety | Dup | Reason                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------- | --- | ---- | ----- | ------ | ----- | ------ | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `threejs-game-director`                                                                         | 5   | 7    | 7     | 5      | 7     | 5      | 2   | Duplicates `lead-game-architect`. Its "never end a turn" rules fight our approval-based workflow. Routes to paid generators. Its probe script sources the user's shell profiles.                                                                                                                                                                                                      |
| `threejs-gameplay-systems`                                                                      | 5   | 7    | 7     | 4      | 7     | 6      | 3   | Built around a scaffold script with `--force` overwrite, dangerous in an existing project. Generic genre and arena design. `references/game-feel.md` is good (see §8).                                                                                                                                                                                                                |
| `threejs-game-ui-designer`                                                                      | 4   | 7    | 6     | 6      | 7     | 10     | 4   | Mobile and touch focus; HUD and menus already exist                                                                                                                                                                                                                                                                                                                                   |
| `threejs-3d-generator`, `threejs-image-generator`, `threejs-audio-generator`                    | 5   | 7    | 8     | 6      | 7     | 5      | 6   | Paid cloud APIs (Tripo3D, Gemini, ElevenLabs) that need API keys and upload project files. Scripts are clean (secrets redacted from checkpoints) but out of scope.                                                                                                                                                                                                                    |
| `blender-web-3d` (whole repo)                                                                   | 6   | 8    | 7     | 4      | 6     | 7      | 4   | Viewer template is a space-station demo (three r186, Next.js) with a `vercel deploy` step. GLB traps are mostly covered by `blender-export-pipelines` and `threejs-asset-pipeline`.                                                                                                                                                                                                   |
| 18 other `blender-*` skills                                                                     | 2–5 | 8–9  | 8     | 5      | 9     | 9      | —   | Not needed now: hardsurface, sculpting, texturing, texture-baking, geometry-nodes, facial-shapekeys, hair-grooming, rendering, lighting-lookdev, stylized-npr, video-editing, simulation, time-of-day, weather-fx, addon-development, pipeline-automation, scene-setup, environment-kits. The last one bakes terrain in Blender, which conflicts with the analytic in-engine terrain. |
| CloudAI `fundamentals`, `geometry`, `interaction`, `materials`, `textures`, `react-three-fiber` | 3–5 | 8    | 6     | 6      | 7     | 10     | 3   | Basics the agents already know. R3F is not used: React renders UI only.                                                                                                                                                                                                                                                                                                               |
| zebbern `three-best-practices`                                                                  | 5   | 7    | 6     | 4      | 6     | 7      | 3   | Heavy on WebGPU/TSL, WebXR and import maps (conflicts with Vite). Overlaps `threejs-performance`. Ships inside a 385-file grab-bag repo that includes offensive-security skills.                                                                                                                                                                                                      |
| `wolffe/threejs-skills`                                                                         | —   | —    | —     | —      | —     | —      | —   | Repository does not exist                                                                                                                                                                                                                                                                                                                                                             |

## 4. Security and license review

- **Licenses:** all installed skills are MIT. Each installed skill directory contains the upstream
  `LICENSE` file (copied in where the skill folder had none). Upstream files are byte-identical.
- **No prompt injection found.** No skill told the agent to ignore earlier instructions, hide actions,
  exfiltrate data, or act outside its purpose.
- **Network:** only the rejected generator scripts make network calls, and only to their documented
  APIs. `blender-web-3d` mentions `npx vercel deploy`. None of the installed skills' scripts contact the
  network.
- **Credentials and environment:**
  - `probe_asset_credentials.sh` (rejected) sources `~/.bashrc`/`~/.zshrc` and prints only `KEY=SET|MISSING`.
  - `run_in_blender.py` (installed) reads `BLENDER_EXE` to locate Blender and runs it with `--factory-startup`.
  - `inspect-threejs-canvas.mjs` (installed) imports Playwright from the project and writes report and
    screenshot files to paths it is given.
- **Filesystem:**
  - Upstream installers (`install.sh`/`install.ps1`) `rm -rf` target skill folders and default to
    global `~/.claude/skills`. They were not used.
  - Blender scripts read and write `.blend`, `.glb` and `.png` files passed as arguments.
- **Residual risk:** installed scripts run only when an agent invokes them. Claude Code's permission
  prompts still apply to every shell command.

## 5. Agent-to-skill mapping

| Agent                           | Skills                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lead-game-architect`           | `threejs-aaa-graphics-builder` (visual scorecard as the shared review yardstick); assigns skills in work packages                                                                                                                                                                                                 |
| `graphics-environment-engineer` | `threejs-aaa-graphics-builder`, `threejs-shaders`, `threejs-lighting`, `threejs-postprocessing`, `threejs-performance`, `threejs-loaders`, `threejs-asset-pipeline`; for Blender props: `blender-pbr-materials`, `blender-game-optimization`, `blender-export-pipelines`, `blender-asset-qa`                      |
| `character-animation-engineer`  | `blender-core`, `blender-workflow-recipes`, `blender-retopology-uv`, `blender-clothing`, `blender-pbr-materials`, `blender-character-rigging`, `blender-animation`, `blender-game-optimization`, `blender-asset-qa`, `blender-export-pipelines`, `threejs-animation`, `threejs-loaders`, `threejs-asset-pipeline` |
| `physics-simulation-engineer`   | None fit the domain. `threejs-debug-profiler` playbook for loop and timestep triage                                                                                                                                                                                                                               |
| `camera-gameplay-engineer`      | `threejs-postprocessing`, `threejs-animation`, `threejs-debug-profiler`, `threejs-performance`                                                                                                                                                                                                                    |
| `qa-performance-engineer`       | `threejs-qa-release`, `threejs-debug-profiler`, `threejs-performance`, `threejs-asset-pipeline`, `blender-asset-qa`                                                                                                                                                                                               |

Each agent file has a `# Skills` section with these names and the usage constraints.

## 6. Compatibility findings

- **three.js version:** the skills target r184 (majid) and r186 (CloudAI); Freeski is on r181. Most WebGL
  APIs are unchanged, but agents must check each API against `node_modules/three` first. Example: the
  cookbook notes an r184 `RoomEnvironment()` signature change.
- **WebGPU/TSL:** the CloudAI skills keep WebGPU/TSL in separate sections, which Freeski ignores. Its
  WebGL and `onBeforeCompile` content matches our renderer.
- **Freeski has no test hooks.** `threejs-qa-release`'s inspector `--state`/`--manifest` mode needs
  `window.__THREE_GAME_TEST_HOOKS__`. Freeski does not expose it, so only single-view mode works.
  Adding hooks would be a game-code change and needs architect approval. `e2e/rendering.spec.ts` stays
  the primary regression guard.
- **Missing siblings:** several cross-references point to skills that are not installed:
  - `threejs-aaa-graphics-builder` and the debug playbook mention the director, its credential probe
    and the generators.
  - `blender-core`'s routing table and `blender-workflow-recipes` mention blender skills we did not
    install.

  Agents are told to skip these steps. Install the missing skill if a pipeline needs it (see §8).

- **Physics advice:** generic physics guidance ("Rapier by default") must not override the analytic
  `SurfaceField` contact model.
- **Tooling:** ESLint only lints `**/*.{ts,tsx}`, and the skills contain no TypeScript. `.claude/skills` was
  added to `.prettierignore` so `npm run format` never rewrites vendored files.
- **Pre-existing:** `prettier --check .` already reports ~95 project files. The cause is
  `core.autocrlf=true` producing CRLF checkouts, and `node_modules` not being installed, so `npx` pulls
  Prettier 3.10 instead of the pinned 3.6.2. Unrelated to the skills.

## 7. Discovery and activation

- Claude Code discovers project skills from `.claude/skills/<name>/SKILL.md` at session start and picks
  up changes live. All 20 appeared in the session's skill list immediately after installation.
- **Automatic:** Claude loads a skill when a task matches its `description`. Only the frontmatter is
  always in context; the body and references load on use.
- **Manual:** type `/<skill-name>` (for example `/threejs-performance`) or name the skill in a prompt.
- **Subagents:** the six agents inherit all tools (no `tools:` restriction), so they can invoke skills
  through the Skill tool. Their `# Skills` sections tell them which ones to use.
- **Validation:** all 20 frontmatters parse. `name` matches the folder and `[a-z0-9-]`, and every
  description is between 239 and 412 characters (limit 1024). There are no duplicate names.
  - `threejs-performance` and `threejs-debug-profiler` overlap on purpose. One is an API reference, the
    other a triage workflow.
  - `threejs-animation` and `blender-animation` cover the runtime and authoring sides.

## 8. Recommended future skills

1. **When the skier pipeline starts:** install Blender 5.3, then add `blender-texture-baking` and
   `blender-sculpting` (same repo, same review) if the skier is sculpted rather than sourced.
2. **`game-feel.md`** from `threejs-gameplay-systems`: worth vendoring as a camera reference (trauma
   screenshake, FOV punch, hitstop) without the scaffold. Keep the MIT attribution.
3. **CloudAI `threejs-textures`:** add when snow texture work begins (KTX2, color spaces, render targets).
4. **Project-specific skills:** nothing public covered snow rendering, freestyle-ski physics, cinematic
   ski cameras or WebGL visual regression for games. Write our own:
   - `freeski-visual-check`, wrapping `scripts/showcase.mjs` and both parks.
   - `freeski-park-authoring`, covering the JSON schema and headless gap probes.
   - `freeski-physics-tuning`, covering `physicsConfig` and probe tests.
5. **Optional:** a Blender MCP server for live Blender sessions, which `blender-core` supports.
