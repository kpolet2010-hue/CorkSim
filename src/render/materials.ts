import { Color, MeshStandardMaterial, type Texture } from 'three';

export interface SnowMaterialOptions {
  /** Sun glints (view- and sun-dependent crystal sparkle). */
  sparkle: boolean;
  /** World-space repeat of the detail normal map (1/m). */
  repeat?: number;
  roughness?: number;
  color?: number;
  /** Half width of the groomed corridor (m). Grooming only shows inside it. */
  corridorHalfWidth?: number;
  /** Groomer lanes (4.8 m wide albedo/roughness bands with overlap seams) on the piste. */
  lanes?: boolean;
  /** Fine corduroy ridges as normal detail (anti-aliased; fades out where it would shimmer). */
  corduroy?: boolean;
}

/**
 * Snow material: PBR base with a procedural normal map, macro albedo/roughness variation, groomed corduroy
 * on the piste and sun-dependent crystal glints, all injected into the standard shader in world space so
 * terrain chunks and features tile seamlessly. Pure shading: no vertex displacement, so the visible surface
 * stays exactly where the physics samples it.
 */
export function createSnowMaterial(normalMap: Texture, opts: SnowMaterialOptions): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: new Color(opts.color ?? 0xf3f7ff),
    roughness: opts.roughness ?? 0.86,
    metalness: 0,
    normalMap,
    vertexColors: true,
  });
  mat.normalScale.set(0.55, 0.55);
  const repeat = opts.repeat ?? 0.22;
  const halfWidth = opts.corridorHalfWidth ?? 1e6;
  const lanes = opts.lanes ?? false;
  const corduroy = opts.corduroy ?? false;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowRepeat = { value: repeat };
    shader.uniforms.uHalfWidth = { value: halfWidth };
    const defines = [
      opts.sparkle ? '#define SNOW_SPARKLE' : '',
      lanes ? '#define SNOW_LANES' : '',
      corduroy ? '#define SNOW_CORDUROY' : '',
    ].join('\n');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSnowWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvSnowWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${defines}
varying vec3 vSnowWorld;
uniform float uSnowRepeat;
uniform float uHalfWidth;
float snowHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float snowNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = snowHash(vec3(i, 1.0)); float b = snowHash(vec3(i + vec2(1.0, 0.0), 1.0));
  float c = snowHash(vec3(i + vec2(0.0, 1.0), 1.0)); float d = snowHash(vec3(i + vec2(1.0, 1.0), 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`,
      )
      // Macro albedo variation (wind crust, old/new snow) and grooming lanes on the piste.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float snowMacro = snowNoise(vSnowWorld.xz * 0.031) * 0.6 + snowNoise(vSnowWorld.xz * 0.17 + 9.1) * 0.4;
float snowPiste = 1.0 - smoothstep(uHalfWidth - 3.0, uHalfWidth + 0.5, abs(vSnowWorld.x));
float snowLaneSeam = 0.0;
float snowLaneShade = 0.5;
#ifdef SNOW_LANES
{
  float laneCoord = vSnowWorld.x / 4.8 + (snowNoise(vec2(vSnowWorld.z * 0.012, 3.0)) - 0.5) * 0.35;
  float laneF = fract(laneCoord);
  snowLaneShade = snowHash(vec3(floor(laneCoord), 3.1, 7.7));
  float aa = fwidth(laneCoord) * 1.5;
  snowLaneSeam = (1.0 - smoothstep(0.0, 0.03 + aa, laneF)) + smoothstep(0.97 - aa, 1.0, laneF);
}
#endif
diffuseColor.rgb *= 1.0 + (snowMacro - 0.5) * 0.1
  + snowPiste * ((snowLaneShade - 0.5) * 0.045 - snowLaneSeam * 0.05);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (snowMacro - 0.5) * 0.14 - snowPiste * (0.05 + (snowLaneShade - 0.5) * 0.06), 0.35, 1.0);`,
      )
      // World-space planar UVs for the detail normal map, plus corduroy ridges running downhill.
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec2 snowUv = vSnowWorld.xz * uSnowRepeat;
  vec3 mapN = texture2D( normalMap, snowUv ).xyz * 2.0 - 1.0;
  vec3 mapN2 = texture2D( normalMap, snowUv * 0.21 + 0.37 ).xyz * 2.0 - 1.0;
  mapN = normalize( mapN + mapN2 * 0.6 );
  mapN.xy *= normalScale * (1.0 - snowPiste * 0.35);
  normal = normalize( tbn * mapN );
#endif
#ifdef SNOW_CORDUROY
{
  // Groomer corduroy: 5.5 cm ridges running downhill, as pure normal detail (light/shadow ridges in sun).
  // It is filtered out wherever a ridge spans fewer than ~4 px (fwidth), at grazing angles, and broken
  // up into patches so it never reads as a uniform stripe texture.
  float cx = vSnowWorld.x * 18.0;
  float aa = 1.0 - smoothstep(0.1, 0.28, fwidth(cx));
  float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
  float graze = smoothstep(0.12, 0.45, facing);
  float patchy = 0.35 + 0.65 * smoothstep(0.3, 0.75, snowNoise(vSnowWorld.xz * 0.11 + 4.3));
  float cordFade = aa * graze * patchy * snowPiste;
  float ph = cx * 6.2831853 + snowNoise(vSnowWorld.xz * vec2(0.6, 0.05)) * 1.5;
  vec3 cordW = vec3(cos(ph) * 0.11 * cordFade, 0.0, 0.0);
  normal = normalize( normal + ( viewMatrix * vec4( cordW, 0.0 ) ).xyz );
}
#endif`,
      );
    if (opts.sparkle) {
      // Crystal glints: a sparse set of world cells gets a random facet normal; it flashes when that facet
      // mirrors the sun into the camera. Weighted by the actual direct sunlight (so no glints in shadow) and
      // faded with distance before the cells become sub-pixel and would shimmer.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
#if defined( SNOW_SPARKLE ) && NUM_DIR_LIGHTS > 0
{
  vec3 cellP = vSnowWorld * 22.0;
  vec3 cell = floor(cellP);
  float pick = snowHash(cell);
  float dist = length(vViewPosition);
  // A glint is a tiny point inside its cell (not the whole cell, which smears into streaks at grazing
  // angles), and disappears before the cells shrink below a pixel.
  vec2 inCell = fract(cellP.xz) - 0.5;
  float pointMask = 1.0 - smoothstep(0.1, 0.22, length(inCell));
  vec2 cw = fwidth(cellP.xz);
  float subPixel = 1.0 - smoothstep(0.35, 0.8, max(cw.x, cw.y));
  if (pick > 0.86 && dist < 45.0 && pointMask * subPixel > 0.0) {
    vec3 rnd = vec3(snowHash(cell + 1.37), snowHash(cell + 7.11), snowHash(cell + 3.73)) * 2.0 - 1.0;
    vec3 facet = normalize(normal + (viewMatrix * vec4(rnd, 0.0)).xyz * 0.75);
    vec3 L = directionalLights[ 0 ].direction;
    vec3 H = normalize(L + geometryViewDir);
    float glint = pow(max(dot(facet, H), 0.0), 900.0);
    float sunLum = max(1e-4, luminance(directionalLights[ 0 ].color));
    float lit = luminance(reflectedLight.directDiffuse) / max(1e-4, luminance(diffuseColor.rgb) * RECIPROCAL_PI * sunLum);
    glint *= smoothstep(0.08, 0.35, lit) * smoothstep(45.0, 6.0, dist) * pointMask * subPixel;
    totalEmissiveRadiance += directionalLights[ 0 ].color * glint * 2.2;
  }
}
#endif`,
      );
    }
  };
  mat.customProgramCacheKey = () => `snow-v2-${opts.sparkle ? 1 : 0}${lanes ? 1 : 0}${corduroy ? 1 : 0}`;
  return mat;
}
