import {
  HalfFloatType,
  type PerspectiveCamera,
  type Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface PostFXOptions {
  /** MSAA samples on the HDR scene target (0 = none). */
  samples: number;
  bloom: boolean;
  grade: { contrast: number; saturation: number; vignette: number; lift: [number, number, number] };
}

const GRADE_PARS = /* glsl */ `
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform vec3 uLift;
uniform float uAspect;
float gradeHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
`;

// Display-space grade, appended after OutputPass's tone mapping + sRGB encode: contrast around mid grey,
// saturation, a shadow tint, a soft vignette and 1/255 dither against sky banding.
const GRADE_MAIN = /* glsl */ `
{
  vec3 col = clamp(gl_FragColor.rgb, 0.0, 1.0);
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(luma), col, uSaturation);
  col = (col - 0.5) * uContrast + 0.5;
  col += uLift * (1.0 - smoothstep(0.0, 0.7, luma));
  vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(d));
  col += (gradeHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor.rgb = clamp(col, 0.0, 1.0);
}
`;

/**
 * OutputPass (tone mapping + output colour space, from the renderer's settings) with the grade folded into
 * the same full-screen draw, so grading costs no extra pass.
 */
class GradedOutputPass extends OutputPass {
  constructor(grade: PostFXOptions['grade']) {
    super();
    const u = this.uniforms as Record<string, { value: unknown }>;
    u.uContrast = { value: grade.contrast };
    u.uSaturation = { value: grade.saturation };
    u.uVignette = { value: grade.vignette };
    u.uLift = { value: new Vector3(...grade.lift) };
    u.uAspect = { value: 16 / 9 };
    const src = this.material.fragmentShader;
    const patched = src
      .replace('varying vec2 vUv;', `varying vec2 vUv;\n${GRADE_PARS}`)
      .replace(/(gl_FragColor = sRGBTransferOETF\( gl_FragColor \);\s*#endif)/, `$1\n${GRADE_MAIN}`);
    if (patched === src || !patched.includes('uContrast;') || !patched.includes('gradeHash(gl_FragCoord')) {
      // The OutputShader layout changed: leave the plain output (still correct, just ungraded).
      return;
    }
    this.material.fragmentShader = patched;
    this.material.needsUpdate = true;
  }

  setAspect(aspect: number): void {
    (this.uniforms as Record<string, { value: unknown }>).uAspect.value = aspect;
  }
}

/**
 * Bloom at half the usual resolution (its bright pass at 1/4 of the frame and the blur pyramid below that).
 * Highlights here are small glints and sparks, so the softer source loses nothing visible and the pass costs
 * about a quarter as much fill.
 */
class LowResBloomPass extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width / 2)), Math.max(2, Math.round(height / 2)));
  }
}

/**
 * Post-processing chain: RenderPass (HDR, optional MSAA) -> optional low-res bloom -> graded OutputPass (tone
 * mapping and sRGB applied exactly once: the renderer skips tone mapping while drawing into a render target).
 * Owned by graphics; driven through Environment.render()/resize().
 */
export class PostFX {
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: LowResBloomPass | null = null;
  private readonly outputPass: GradedOutputPass;
  private readonly size = new Vector2();

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, opts: PostFXOptions) {
    renderer.getSize(this.size);
    const ratio = renderer.getPixelRatio();
    const target = new WebGLRenderTarget(
      Math.max(1, Math.floor(this.size.x * ratio)),
      Math.max(1, Math.floor(this.size.y * ratio)),
      { type: HalfFloatType, samples: opts.samples },
    );
    target.texture.name = 'Freeski.post.rt';
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(this.size.x, this.size.y);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (opts.bloom) {
      // High threshold: only HDR highlights (snow glints, sparks, sun-facing metal) bloom, never the snow.
      this.bloomPass = new LowResBloomPass(new Vector2(this.size.x, this.size.y), 0.3, 0.4, 2.4);
      this.composer.addPass(this.bloomPass);
    }
    this.outputPass = new GradedOutputPass(opts.grade);
    this.outputPass.setAspect(this.size.x / Math.max(1, this.size.y));
    this.composer.addPass(this.outputPass);
  }

  render(camera: PerspectiveCamera): void {
    this.renderPass.camera = camera;
    this.composer.render();
  }

  resize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
    this.outputPass.setAspect(width / Math.max(1, height));
  }

  dispose(): void {
    this.bloomPass?.dispose();
    this.outputPass.dispose();
    this.renderPass.dispose();
    this.composer.dispose();
  }
}
