import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { bakeToSingleGeometry, loadOptionalGlb } from './AssetLoader';

afterEach(() => vi.unstubAllGlobals());

describe('AssetLoader', () => {
  it('returns null for a missing file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
    expect(await loadOptionalGlb('/models/missing.glb')).toBeNull();
  });

  it('returns null for an HTML fallback served with 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<!doctype html><html></html>', { status: 200 })),
    );
    expect(await loadOptionalGlb('/models/pine.glb')).toBeNull();
  });

  it('returns null when the request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    expect(await loadOptionalGlb('/models/pine.glb')).toBeNull();
  });

  it('bakes nested meshes into one geometry with transforms applied', () => {
    const g = new Group();
    const a = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const b = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    b.position.set(0, 5, 0);
    g.add(a, b);
    const merged = bakeToSingleGeometry(g)!;
    merged.computeBoundingBox();
    expect(merged.boundingBox!.max.y).toBeCloseTo(5.5);
    expect(merged.getAttribute('uv')).toBeUndefined();
  });
});
