import {
  type BufferGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  MeshStandardMaterial,
  type PerspectiveCamera,
  PMREMGenerator,
  Scene,
  type Texture,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import type { Park } from '../park/Park';
import { createSnowMaterial } from './materials';
import { getParkTheme, type ParkTheme } from './parkTheme';
import { PostFX, type PostFXOptions } from './PostFX';
import { Props } from './Props';
import type { QualityProfile } from './quality';
import { buildBackdropMountains, buildTerrainMesh } from './TerrainMesh';
import { createSnowNormalTexture } from './textures';
import { Forest } from './Trees';

/** Default sun direction (Glacier Park). Each park's actual sun comes from its theme. */
export const SUN_DIRECTION = getParkTheme('glacier-park').sunDirection.clone();

/** Half extent of the skier-following shadow frustum (m). */
const SHADOW_HALF_EXTENT = 38;
const SHADOW_DISTANCE = 150;

const _snap = new Vector3();
const _right = new Vector3();
const _upL = new Vector3();

/**
 * The static world and its lighting: sky, image-based lighting, fog, sun with a skier-following shadow
 * frustum, terrain, backdrop mountains, forest, rocks/mounds, and the final frame render (direct or through
 * the post chain). Owned by graphics; Game only constructs, updates and renders it.
 */
export class Environment {
  /** Snow material for park features (kickers, landings), shared with ParkMeshes. */
  readonly featureSnow: MeshStandardMaterial;
  readonly theme: ParkTheme;
  private readonly sun: DirectionalLight;
  private readonly sunDir: Vector3;
  private readonly forest: Forest;
  private readonly props: Props;
  private envTexture: Texture | null = null;
  /** Post chain, created on the first render (it needs the camera; it sizes itself from the renderer). */
  private post: PostFX | null = null;
  private readonly postEnabled: boolean;
  private readonly postOptions: PostFXOptions;
  private disposed = false;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    park: Park,
    quality: QualityProfile,
    treeGeometry: BufferGeometry | null,
  ) {
    const q = quality;
    const theme = getParkTheme(park.config.id);
    this.theme = theme;
    this.sunDir = theme.sunDirection.clone();
    // Exposure is part of the park's grade. OutputPass reads it from the renderer, so it applies exactly once
    // whether or not post-processing is on.
    renderer.toneMappingExposure = theme.exposure;

    // Sky + image based lighting generated from it.
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = theme.turbidity;
    u.rayleigh.value = theme.rayleigh;
    u.mieCoefficient.value = theme.mieCoefficient;
    u.mieDirectionalG.value = theme.mieDirectionalG;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(1000);
    // The Preetham model is calibrated for an exposure around 0.5; scale and saturate it so the sky stays a
    // deep alpine blue at the exposure the snow needs. Also lowers the IBL it bakes into the snow shadows.
    const hz = new Color(theme.horizonTint);
    const hzStr = [hz.r, hz.g, hz.b].map((v) => v.toFixed(3)).join(', ');
    sky.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <tonemapping_fragment>',
        `gl_FragColor.rgb *= ${theme.skyGain.toFixed(3)};
gl_FragColor.rgb = max(mix(vec3(dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722))), gl_FragColor.rgb, ${theme.skySaturation.toFixed(3)}), 0.0);
{
  // Keep the band above the horizon blue instead of the model's near-white haze.
  float skyH = clamp(normalize(vWorldPosition - cameraPosition).y, 0.0, 1.0);
  gl_FragColor.rgb *= mix(vec3(${hzStr}), vec3(1.0), smoothstep(0.0, 0.45, skyH));
}
#include <tonemapping_fragment>`,
      );
    };
    sky.material.customProgramCacheKey = () =>
      `freeski-sky-${theme.skyGain}-${theme.skySaturation}-${theme.horizonTint}`;
    const pmrem = new PMREMGenerator(renderer);
    const envScene = new Scene();
    envScene.add(sky);
    this.envTexture = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    envScene.remove(sky);
    scene.add(sky);
    this.disposables.push(sky.geometry, sky.material);
    scene.environment = this.envTexture;
    // Low IBL + a blue hemisphere sky term: shadows on snow go cool blue instead of flat grey, and the sun
    // side keeps its contrast.
    scene.environmentIntensity = theme.environmentIntensity;
    scene.fog = new FogExp2(new Color(theme.fogColor), theme.fogDensity);
    scene.background = null;

    const hemi = new HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
    scene.add(hemi);
    const sun = new DirectionalLight(theme.sunColor, theme.sunIntensity);
    sun.position.copy(this.sunDir).multiplyScalar(SHADOW_DISTANCE);
    sun.castShadow = q.shadows;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF_EXTENT;
    sc.right = SHADOW_HALF_EXTENT;
    sc.top = SHADOW_HALF_EXTENT;
    sc.bottom = -SHADOW_HALF_EXTENT;
    sc.near = 20;
    sc.far = SHADOW_DISTANCE + 120;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2;
    scene.add(sun, sun.target);
    this.sun = sun;

    const normal = createSnowNormalTexture(256);
    this.disposables.push(normal);
    const halfWidth = park.config.terrain.halfWidth;
    const snow = createSnowMaterial(normal, {
      sparkle: q.sparkle,
      color: theme.pisteColor,
      corridorHalfWidth: halfWidth,
      lanes: true,
      corduroy: q.corduroy,
    });
    const featureSnow = createSnowMaterial(normal, {
      sparkle: q.sparkle,
      roughness: 0.74,
      color: 0xffffff,
      repeat: 0.35,
      corridorHalfWidth: halfWidth,
      lanes: false,
      corduroy: q.corduroy,
    });
    const backdropMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    this.disposables.push(snow, featureSnow, backdropMat);
    this.featureSnow = featureSnow;
    const terrain = buildTerrainMesh(park, snow, {
      spacing: q.terrainSpacing,
      chunkSize: 48,
      receiveShadow: q.shadows,
    });
    terrain.traverse((o) => {
      const g = (o as { geometry?: { dispose(): void } }).geometry;
      if (g) this.disposables.push(g);
    });
    scene.add(terrain);
    const backdrop = buildBackdropMountains(park, backdropMat, theme);
    this.disposables.push(backdrop.geometry);
    scene.add(backdrop);

    const trees = park.trees.filter((_, i) => i % 100 < q.treeFraction * 100);
    this.forest = new Forest(trees, q.shadows, 150, treeGeometry);
    scene.add(this.forest.group);

    this.props = new Props(park, snow, {
      rocks: q.rocks,
      mounds: q.mounds,
      shadows: q.shadows,
      rockColor: theme.rockColor,
    });
    scene.add(this.props.group);

    this.postEnabled = q.post;
    this.postOptions = { samples: q.postSamples, bloom: q.bloom, grade: theme.grade };
  }

  /**
   * Per frame: the shadow frustum follows the focus point (the skier), snapped to whole shadow-map texels in
   * light space so shadow edges do not crawl as the skier moves. The forest re-buckets its LOD.
   */
  update(focus: Vector3, camera: PerspectiveCamera, dt: number, force = false): void {
    const texel = (2 * SHADOW_HALF_EXTENT) / this.sun.shadow.mapSize.x;
    _right.set(0, 1, 0).cross(this.sunDir).normalize();
    _upL.copy(this.sunDir).cross(_right);
    const a = focus.dot(_right);
    const b = focus.dot(_upL);
    _snap
      .copy(focus)
      .addScaledVector(_right, Math.round(a / texel) * texel - a)
      .addScaledVector(_upL, Math.round(b / texel) * texel - b);
    this.sun.target.position.copy(_snap);
    this.sun.position.copy(_snap).addScaledVector(this.sunDir, SHADOW_DISTANCE);
    this.sun.target.updateMatrixWorld();
    this.forest.update(camera.position, dt, force);
  }

  /**
   * Builds the post chain and draws one frame through the full path, so every shader program (scene
   * materials as used inside the HDR target, bloom, output and grade passes) is compiled before the first
   * visible frame. Call after renderer.compile() during loading; the frame is overwritten by the first render.
   */
  warmUp(camera: PerspectiveCamera): void {
    this.render(camera);
  }

  /** Draws the frame: through the post chain when the preset enables it, otherwise directly. */
  render(camera: PerspectiveCamera): void {
    if (this.postEnabled && !this.post && !this.disposed)
      this.post = new PostFX(this.renderer, this.scene, camera, this.postOptions);
    if (this.post) this.post.render(camera);
    else this.renderer.render(this.scene, camera);
  }

  /** Called whenever the drawing buffer size changes (CSS size in px and the device pixel ratio). */
  resize(width: number, height: number, pixelRatio: number): void {
    this.post?.resize(width, height, pixelRatio);
  }

  /** Live quality change (shadow map size). Geometry density applies on the next run. */
  setShadowMapSize(size: number): void {
    if (!this.renderer.shadowMap.enabled) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  dispose(): void {
    this.disposed = true;
    this.post?.dispose();
    this.post = null;
    this.forest.dispose();
    this.props.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.sun.shadow.map?.dispose();
  }
}
