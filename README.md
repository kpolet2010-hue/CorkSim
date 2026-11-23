# Freeski

An original 3D freestyle skiing game that runs in a desktop browser. Ski a snowpark with physically
simulated skis, launch off kickers, throw spins, flips and corks, grab your skis, grind rails and boxes,
and stomp your landings for points.

No account, no server, no downloaded assets: terrain, park, skier, trees and all audio are procedural.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Production build:

```bash
npm run build
npm run preview    # http://localhost:4173
```

## Controls (default, rebindable in Settings)

| Key                 | On the snow                     | In the air               | On a rail  |
| ------------------- | ------------------------------- | ------------------------ | ---------- |
| `A` / `D`           | Carve left / right              | Spin left / right        | Balance    |
| `W`                 | Push off / tuck                 | Frontflip                | Nose press |
| `S`                 | Brake                           | Backflip                 | Tail press |
| `Space`             | Hold to charge, release to jump | -                        | Pop off    |
| `←` / `→`           | Pre-wind roll                   | Off-axis roll (corks)    | -          |
| `Q` `E` `Shift` `F` | -                               | Grabs (combine for more) | -          |
| `Esc` / `P`         | Pause                           |                          |            |
| `R`                 | Restart run                     |                          |            |
| `Backspace`         | Reset skier in place            |                          |            |
| `C`                 | Cycle camera                    |                          |            |

Spin + roll = **cork**, spin + backflip = **bio**, spin + frontflip = **misty**. Rotations coast after you
release the key, so let go early and land with your skis pointing along your direction of travel
(forward or switch).

Grabs: `Q` Mute, `E` Safety, `Shift` Tail, `F` Method, `Q+E` Japan, `Q+Shift` Nose, `E+Shift` Truck Driver,
`Q+E+Shift` Lui Kang. Let go before you land.

## Scripts

| Script              | What it does                                 |
| ------------------- | -------------------------------------------- |
| `npm run dev`       | Vite dev server                              |
| `npm run build`     | Type-check (`tsc -b`) and production build   |
| `npm run typecheck` | TypeScript only                              |
| `npm run lint`      | ESLint                                       |
| `npm test`          | Vitest unit + headless simulation tests      |
| `npm run test:e2e`  | Playwright browser tests (builds and serves) |
| `npm run check`     | typecheck + lint + unit tests + build        |

`npx playwright install chromium` is needed once before the first e2e run.

See [DEVELOPMENT.md](DEVELOPMENT.md) for the architecture, physics model, status and known limitations.
