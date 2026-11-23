import { Color, MeshStandardMaterial, type Texture } from 'three';

/**
 * Snow material: PBR base with a procedural normal map plus a view-dependent glitter term injected into
 * the standard shader (sun-lit ice crystals sparkle as the camera moves).
 */
export function createSnowMaterial(
  normalMap: Texture,
  opts: { sparkle: boolean; repeat?: number; roughness?: number; color?: number },
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    color: new Color(opts.color ?? 0xf3f7ff),
    roughness: opts.roughness ?? 0.86,
    metalness: 0,
    normalMap,
    vertexColors: true,
  });
  mat.normalScale.set(0.55, 0.55);
  const repeat = opts.repeat ?? 0.22;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnowRepeat = { value: repeat };
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
varying vec3 vSnowWorld;
uniform float uSnowRepeat;
float snowHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      // World-space planar UVs so terrain chunks and features tile seamlessly.
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef USE_NORMALMAP_TANGENTSPACE
  vec2 snowUv = vSnowWorld.xz * uSnowRepeat;
  vec3 mapN = texture2D( normalMap, snowUv ).xyz * 2.0 - 1.0;
  vec3 mapN2 = texture2D( normalMap, snowUv * 0.21 + 0.37 ).xyz * 2.0 - 1.0;
  mapN = normalize( mapN + mapN2 * 0.6 );
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#endif`,
      );
    if (opts.sparkle) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 cell = floor(vSnowWorld * 24.0);
  float h = snowHash(cell);
  vec3 viewDir = normalize(cameraPosition - vSnowWorld);
  float facing = snowHash(cell + floor(viewDir * 6.0));
  float sparkle = step(0.9965, h * 0.5 + facing * 0.5);
  float dist = length(cameraPosition - vSnowWorld);
  totalEmissiveRadiance += vec3(sparkle) * 1.6 * smoothstep(60.0, 4.0, dist);
}`,
      );
    }
  };
  mat.customProgramCacheKey = () => `snow-${opts.sparkle ? 1 : 0}`;
  return mat;
}
