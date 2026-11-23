import { BufferGeometry, Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const GLB_MAGIC = 0x46546c67; // 'glTF'

/**
 * Loads an optional Blender-exported .glb. Returns null (never throws) when the file is missing, is not a
 * binary glTF (e.g. a dev server's HTML fallback), fails to parse or takes too long - callers then use their
 * procedural fallback. This keeps the game fully playable without any external assets.
 */
export async function loadOptionalGlb(url: string, timeoutMs = 4000): Promise<Object3D | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength < 12 || new DataView(buffer).getUint32(0, true) !== GLB_MAGIC) return null;
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    return gltf.scene;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bakes every mesh in a loaded scene into one geometry (world transforms applied) so it can be used for
 * instancing. Only position/normal/color attributes are kept.
 */
export function bakeToSingleGeometry(root: Object3D): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(
      mesh.matrixWorld,
    );
    for (const name of Object.keys(g.attributes))
      if (name !== 'position' && name !== 'normal' && name !== 'color') g.deleteAttribute(name);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    parts.push(g);
  });
  if (parts.length === 0) return null;
  const hasColor = parts.every((p) => p.getAttribute('color'));
  if (!hasColor) for (const p of parts) p.deleteAttribute('color');
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return merged;
}
