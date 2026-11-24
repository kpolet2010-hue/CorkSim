# Freeski — Art Direction

_Owner: graphics-environment-engineer · Source of truth for values: `src/render/parkTheme.ts`, `src/render/quality.ts`_

## Target look

**A crisp, sunny alpine day.** Hard sunlight, deep blue sky, snow that is bright but never clipped, and cool
blue shadows that carry the shape of every slope and feature. The reference feeling is a clear-morning
slopestyle broadcast: the course is immaculate and readable, the mountains behind are big and calm.

1. **Readable snow first.** Snow is high-albedo but must show form. Form comes from a low sun angle from the
   side (never from behind the camera), a strong sun-to-sky ratio, and curvature shading on features.
   Shadows are blue (sky fill), not grey.
2. **Saturated but natural sky.** Deep blue at the zenith, paler toward the horizon, a soft sun halo. No
   white-out haze. Aerial perspective only on the far mountains.
3. **Groomed, man-made park vs. wild mountain.** Inside the corridor: corduroy, groomer lanes, dye lines,
   painted metal and plastic. Outside: wind-blown snow, rock outcrops, snow mounds, forest. The contrast
   tells the player where the play area is.
4. **One palette.** Neutral snow, cool shadow blue, dark forest green, grey-brown rock, and a small set of
   saturated park accents (safety orange nets, the park's accent colour, rail paints). Accents only on
   man-made objects.
5. **Gameplay reads beat decoration.** Kicker lips, knuckles and landing edges must be visible from the
   in-run at speed. Effects (spray, sparks) never cover the landing.

## Lighting and grade (per park)

| Element      | Rule                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Sun          | Directional, 4.2–4.3, warm white. Elevation 25–40 deg, side-lit relative to the fall line.                                                  |
| Sky fill     | Hemisphere light 0.5–0.55, blue sky / light ground. IBL from the sky at 0.3 (keeps contrast).                                               |
| Exposure     | 1.3 ACES Filmic, set by the theme (applied once: renderer or OutputPass). Sunlit snow lands near white without clipping; shadows stay blue. |
| Sky          | Preetham sky, low turbidity/mie, gain ~0.25 and saturation 1.4–1.5 plus a blue horizon tint, injected before tone mapping.                  |
| Fog          | FogExp2 ~0.0008, blue matching the tinted horizon; separates the far landing and run-out from the table.                                    |
| Shadows      | Skier-following frustum ±38 m, texel-snapped (no crawling), PCF soft, small bias.                                                           |
| Grade (post) | Folded into the OutputPass draw: contrast ~1.05, saturation ~1.1, slight shadow tint, soft vignette, 1/255 dither.                          |

## Park identities

- **Glacier Park** — high cold valley at midday. Sun from the skier's left, cool blue fog, glacier ice on the
  high slopes of the backdrop, navy accents (gates, signs), classic blue/orange/yellow rail paints.
- **Big Air Ridge** — afternoon light on a dark rocky ridge. Lower, warmer sun from the right with long
  shadows, warmer haze, darker rock and little ice, red accents and red/yellow/white rail paints.

## Materials

- **Snow** (`materials.ts`): PBR, roughness ~0.86 (piste a bit smoother), world-space detail normals,
  macro albedo/roughness noise, 4.8 m groomer lanes with overlap seams on the piste, anti-aliased corduroy
  normals (medium/high), sun-dependent crystal glints that only appear in direct sun and fade with
  distance. All shading: no displacement, so the visible surface is exactly the physics surface.
- **Features**: same snow plus vertex curvature shading (convex edges bright, concave transitions cool),
  a darker lip wall, and dye lines at the lip (double), knuckle and takeoff edges.
- **Metal**: rails and coping at metalness 1 / roughness ~0.24 so they pick up the sky. Painted parts
  roughness ~0.4. Box tops are dark UHMW; sides carry a stripe and wordmark texture.
- **Props**: faceted rocks with snow caps, soft snow mounds, orange mesh nets, merged lift (towers, sheaves,
  sagging ropes, chairs).

## Effects

Every effect maps to a physical cause (`effectsModel.ts`): carve spray from edge angle × speed, scrape fans
from skid and brake, landing bursts from vertical impact, sparks only while grinding metal, snow flecks
only while sliding a box. Tracks are compressed-snow ribbons whose width follows the skid.

## Quality presets

| Preset | Post chain                                         | Shadows | Snow extras            | Props (rocks/mounds) |
| ------ | -------------------------------------------------- | ------- | ---------------------- | -------------------- |
| Low    | None (direct render, ACES in shader)               | Off     | Lanes, macro variation | 70 / 40              |
| Medium | Render (2x MSAA) -> graded Output                  | 2048    | + corduroy, glints     | 160 / 90             |
| High   | Render (2x MSAA) -> low-res bloom -> graded Output | 4096    | + corduroy, glints     | 260 / 140            |

Bloom runs at half its usual resolution with a high threshold (2.4) so only HDR highlights (glints, sparks, sun on metal) bloom, never snow.

Corduroy is normal detail only: 5.5 cm ridges, filtered out by `fwidth` before they can alias, faded at grazing angles and broken into patches. Spray is shaded (sun-lit top, sky-blue underside) with a clumpy puff sprite so it separates from the snow.

## Not allowed

Placeholder colours on final surfaces, flat-lit frames (sun behind the camera), white-out haze, glow used to
hide missing geometry, assets without a recorded licence, geometry changes that move the snow surface.
