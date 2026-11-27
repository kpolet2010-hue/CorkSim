import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { CrashConfig } from '../config/physicsConfig';
import { FENCE_HEIGHT, FENCE_INSET, FENCE_SPACING, FENCE_START, type Park } from '../park/Park';
import { Ragdoll, type RagdollSpawn } from './Ragdoll';

let rapierReady: Promise<void> | null = null;

/** Initialises the Rapier WASM module once (safe to call repeatedly). */
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

/** Collision group bits. */
const GROUP_SNOW = 0x0001;
const GROUP_OBSTACLE = 0x0002;
const GROUP_SKIER = 0x0004;
/**
 * Solid for the crash ragdoll only: corridor safety nets and rail pipes. Riding, grinding and the riding
 * obstacle query are unaffected (grinding is analytic; the obstacle query filters on GROUP_OBSTACLE).
 */
const GROUP_RAGDOLL_SOLID = 0x0008;

/** Rail pipe radius (matches the rendered tube in ParkMeshes). */
const RAIL_PIPE_RADIUS = 0.035;

function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export type ObstacleKind = 'tree' | 'support' | 'box';

/**
 * Rapier integration. Rapier owns the *solid* world: trees, rail/box supports and box bodies (crash
 * obstacles), plus a triangle-mesh copy of the snow surface used for the articulated crash ragdoll.
 * Normal skiing contact uses the analytic SurfaceField (smooth normals, no triangle faceting) - see
 * DEVELOPMENT.md for the trade-off.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly obstacleKinds = new Map<number, ObstacleKind>();
  private readonly skierShape: RAPIER.Capsule;
  /** Articulated crash ragdoll (bodies exist only while crashed). */
  readonly ragdoll: Ragdoll;
  private readonly _pos = { x: 0, y: 0, z: 0 };
  private readonly _rot = { x: 0, y: 0, z: 0, w: 1 };

  private constructor(park: Park) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.skierShape = new RAPIER.Capsule(0.5, 0.26);
    this.buildSnowCollider(park);
    this.buildObstacles(park);
    this.buildFences(park);
    // Rapier 0.19 scene queries run on the broad-phase BVH, which is only built by a world step: without
    // this, `checkObstacleHit` sees no obstacle until the first crash has stepped the world. The world has
    // no dynamic bodies yet, so this step only builds the query structures.
    this.world.step();
    // Skier parts collide with the snow, obstacles and nets only, never with each other.
    this.ragdoll = new Ragdoll(
      this.world,
      park.surface,
      groups(GROUP_SKIER, GROUP_SNOW | GROUP_OBSTACLE | GROUP_RAGDOLL_SOLID),
    );
  }

  static async create(park: Park): Promise<PhysicsWorld> {
    await initRapier();
    return new PhysicsWorld(park);
  }

  private buildSnowCollider(park: Park): void {
    // Coarse trimesh of the full surface (terrain + features) around the corridor.
    const t = park.config.terrain;
    const half = t.halfWidth + 30;
    const zMin = -80;
    const zMax = t.length + 80;
    const step = 2;
    const nx = Math.ceil((2 * half) / step) + 1;
    const nz = Math.ceil((zMax - zMin) / step) + 1;
    this.addHeightGrid(park, -half, zMin, step, nx, nz);
    // Finer meshes over snow features so tumbles interact with kickers and landings properly.
    for (const f of park.surface.features) {
      const fx = Math.ceil((f.maxX - f.minX) / 0.5) + 1;
      const fz = Math.ceil((f.maxZ - f.minZ) / 0.5) + 1;
      this.addHeightGrid(park, f.minX, f.minZ, 0.5, fx, fz, 0.01);
    }
  }

  private addHeightGrid(
    park: Park,
    x0: number,
    z0: number,
    step: number,
    nx: number,
    nz: number,
    lift = 0,
  ): void {
    const verts = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + i * step;
        const z = z0 + j * step;
        const k = (j * nx + i) * 3;
        verts[k] = x;
        verts[k + 1] = park.surface.height(x, z) + lift;
        verts[k + 2] = z;
      }
    }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        idx[q++] = a;
        idx[q++] = c;
        idx[q++] = b;
        idx[q++] = b;
        idx[q++] = c;
        idx[q++] = d;
      }
    }
    // FIX_INTERNAL_EDGES: no ghost collisions on interior triangle edges (skis and limbs sliding fast over
    // the mesh would otherwise catch on them and pole-vault the ragdoll).
    const desc = RAPIER.ColliderDesc.trimesh(verts, idx, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
      .setFriction(0.35)
      .setRestitution(0.05)
      .setCollisionGroups(groups(GROUP_SNOW, GROUP_SKIER));
    this.world.createCollider(desc);
  }

  private buildObstacles(park: Park): void {
    for (const tree of park.trees) {
      const halfH = 2.2 * tree.scale;
      const desc = RAPIER.ColliderDesc.cylinder(halfH, 0.32 * tree.scale)
        .setTranslation(tree.x, tree.y + halfH, tree.z)
        .setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_SKIER));
      const c = this.world.createCollider(desc);
      this.obstacleKinds.set(c.handle, 'tree');
    }
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const dir = new Vector3();
    for (const rail of park.rails) {
      for (const s of rail.supports) {
        const h = Math.max(0.05, s.top.y - s.base.y);
        const desc = RAPIER.ColliderDesc.cylinder(h / 2, rail.kind === 'box' ? 0.06 : 0.05)
          .setTranslation(s.base.x, s.base.y + h / 2, s.base.z)
          .setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_SKIER));
        const c = this.world.createCollider(desc);
        this.obstacleKinds.set(c.handle, 'support');
      }
      if (rail.kind === 'rail') {
        // The pipe itself: a bailing body falls against / off it instead of lying through it.
        const pts = rail.path.points;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          dir.subVectors(b, a);
          const len = dir.length();
          if (len < 0.05) continue;
          dir.normalize();
          // Rapier capsules lie along +Y.
          q.setFromUnitVectors(up, dir);
          // The path is the pipe's top line; the rendered pipe (radius 0.035) sits one radius below it.
          const center = new Vector3().addVectors(a, b).multiplyScalar(0.5);
          center.y -= RAIL_PIPE_RADIUS;
          const desc = RAPIER.ColliderDesc.capsule(len / 2, RAIL_PIPE_RADIUS)
            .setTranslation(center.x, center.y, center.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setFriction(0.15)
            .setRestitution(0.05)
            .setCollisionGroups(groups(GROUP_RAGDOLL_SOLID, GROUP_SKIER));
          this.world.createCollider(desc);
        }
      }
      if (rail.kind === 'box') {
        // Box body below the sliding surface, one cuboid per path segment.
        const pts = rail.path.points;
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          dir.subVectors(b, a);
          const len = dir.length();
          if (len < 0.05) continue;
          dir.normalize();
          q.setFromUnitVectors(new Vector3(0, 0, 1), dir);
          const hy = 0.16;
          const center = new Vector3().addVectors(a, b).multiplyScalar(0.5);
          center.addScaledVector(up, -hy - 0.12);
          const desc = RAPIER.ColliderDesc.cuboid(rail.halfWidth * 0.9, hy, len / 2)
            .setTranslation(center.x, center.y, center.z)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setCollisionGroups(groups(GROUP_OBSTACLE, GROUP_SKIER));
          const c = this.world.createCollider(desc);
          this.obstacleKinds.set(c.handle, 'box');
        }
      }
    }
  }

  /**
   * Corridor safety nets (same layout as the rendered fences): one thin panel per post span, following the
   * snow. Only the crash ragdoll collides with them, so a body thrown sideways is caught by the net instead of
   * sliding through it and being pulled back inside on recovery.
   */
  private buildFences(park: Park): void {
    const half = park.config.terrain.halfWidth - FENCE_INSET;
    const len = park.config.terrain.length;
    const a = new Vector3();
    const b = new Vector3();
    const q = new Quaternion();
    const fwd = new Vector3(0, 0, 1);
    const d = new Vector3();
    for (const side of [-1, 1]) {
      const x = side * half;
      for (let z = FENCE_START; z + FENCE_SPACING < len; z += FENCE_SPACING) {
        a.set(x, park.terrain.height(x, z), z);
        b.set(x, park.terrain.height(x, z + FENCE_SPACING), z + FENCE_SPACING);
        d.subVectors(b, a);
        const spanLen = d.length();
        q.setFromUnitVectors(fwd, d.divideScalar(spanLen));
        const desc = RAPIER.ColliderDesc.cuboid(0.04, FENCE_HEIGHT / 2, spanLen / 2)
          .setTranslation((a.x + b.x) / 2, (a.y + b.y) / 2 + FENCE_HEIGHT / 2, (a.z + b.z) / 2)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.3)
          .setRestitution(0.05)
          .setCollisionGroups(groups(GROUP_RAGDOLL_SOLID, GROUP_SKIER));
        this.world.createCollider(desc);
      }
    }
  }

  /**
   * Tests the skier's body capsule against solid obstacles. The capsule is oriented along the body up axis
   * and starts above the feet so riding on top of a box does not register as a collision.
   */
  checkObstacleHit(footPosition: Vector3, orientation: Quaternion): ObstacleKind | null {
    const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
    this._pos.x = footPosition.x + up.x * 0.98;
    this._pos.y = footPosition.y + up.y * 0.98;
    this._pos.z = footPosition.z + up.z * 0.98;
    this._rot.x = orientation.x;
    this._rot.y = orientation.y;
    this._rot.z = orientation.z;
    this._rot.w = orientation.w;
    const hit = this.world.intersectionWithShape(
      this._pos,
      this._rot,
      this.skierShape,
      undefined,
      groups(GROUP_SKIER, GROUP_OBSTACLE),
    );
    if (!hit) return null;
    return this.obstacleKinds.get(hit.handle) ?? 'tree';
  }

  /** Spawns the articulated crash ragdoll from the skier's state (replaces any previous one). */
  startRagdoll(cfg: CrashConfig, skierMass: number, spawn: RagdollSpawn): void {
    this.ragdoll.spawn(cfg, skierMass, spawn);
  }

  get tumbling(): boolean {
    return this.ragdoll.active;
  }

  /**
   * Steps the ragdoll: our joint/snow torques, then the Rapier world step, then the read-back. Returns
   * false if the result is not finite.
   */
  stepRagdoll(dt: number): boolean {
    if (!this.ragdoll.active) return true;
    this.ragdoll.beforeStep(dt);
    this.world.step();
    return this.ragdoll.afterStep(dt);
  }

  endRagdoll(): void {
    this.ragdoll.despawn();
  }

  dispose(): void {
    this.endRagdoll();
    this.world.free();
  }
}
