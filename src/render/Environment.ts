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
import type { QualityProfile } from './quality';
import { buildBackdropMountains, buildTerrainMesh } from './TerrainMesh';
import { createSnowNormalTexture } from './textures';
import { Forest } from './Trees';

export const SUN_DIRECTION = new Vector3(-0.45, 0.62, -0.64).normalize();

/**
 * The static world and its lighting: sky, image-based lighting, fog, sun with a skier-following shadow
 * frustum, terrain, backdrop mountains and forest. Also owns the final scene render so the graphics side can
 * add post-processing without touching Game. Owned by graphics; Game only constructs, updates and renders it.
 */
export class Environment {
  /** Snow material for park features (kickers, landings), shared with ParkMeshes. */
  readonly featureSnow: MeshStandardMaterial;
  private readonly sun: DirectionalLight;
  private readonly forest: Forest;
  private envTexture: Texture | null = null;
  private readonly disposables: { dispose(): void }[] = [];

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly scene: Scene,
    park: Park,
    quality: QualityProfile,
    treeGeometry: BufferGeometry | null,
  ) {
    const q = quality;
    // Sky + image based lighting generated from it.
    const sky = new Sky();
    sky.scale.setScalar(10000);
    const u = sky.material.uniforms;
    u.turbidity.value = 4;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(SUN_DIRECTION).multiplyScalar(1000);
    const pmrem = new PMREMGenerator(renderer);
    const envScene = new Scene();
    envScene.add(sky);
    this.envTexture = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();
    envScene.remove(sky);
    scene.add(sky);
    this.disposables.push(sky.geometry, sky.material);
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.55;
    scene.fog = new FogExp2(new Color(0xc9d9ec), 0.0011);
    scene.background = null;

    const hemi = new HemisphereLight(0xdbe9ff, 0xf4f6fa, 0.55);
    scene.add(hemi);
    const sun = new DirectionalLight(0xfff3e0, 2.6);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(120);
    sun.castShadow = q.shadows;
    sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const sc = sun.shadow.camera;
    sc.left = -45;
    sc.right = 45;
    sc.top = 45;
    sc.bottom = -45;
    sc.near = 1;
    sc.far = 400;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);
    this.sun = sun;

    const normal = createSnowNormalTexture(256);
    this.disposables.push(normal);
    const snow = createSnowMaterial(normal, { sparkle: q.sparkle });
    const featureSnow = createSnowMaterial(normal, {
      sparkle: q.sparkle,
      roughness: 0.7,
      color: 0xffffff,
      repeat: 0.35,
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
    const backdrop = buildBackdropMountains(park, backdropMat);
    this.disposables.push(backdrop.geometry);
    scene.add(backdrop);

    const trees = park.trees.filter((_, i) => i % 100 < q.treeFraction * 100);
    this.forest = new Forest(trees, q.shadows, 150, treeGeometry);
    scene.add(this.forest.group);
  }

  /** Per frame: the shadow frustum follows the focus point (the skier), the forest re-buckets its LOD. */
  update(focus: Vector3, camera: PerspectiveCamera, dt: number, force = false): void {
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(SUN_DIRECTION, 150);
    this.sun.target.updateMatrixWorld();
    this.forest.update(camera.position, dt, force);
  }

  /** Draws the frame. The single place to add post-processing. */
  render(camera: PerspectiveCamera): void {
    this.renderer.render(this.scene, camera);
  }

  /** Called whenever the drawing buffer size changes (CSS size in px and the device pixel ratio). */
  resize(_width: number, _height: number, _pixelRatio: number): void {}

  /** Live quality change (shadow map size). Geometry density applies on the next run. */
  setShadowMapSize(size: number): void {
    if (!this.renderer.shadowMap.enabled) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  dispose(): void {
    this.forest.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.envTexture?.dispose();
    this.envTexture = null;
    this.sun.shadow.map?.dispose();
  }
}
