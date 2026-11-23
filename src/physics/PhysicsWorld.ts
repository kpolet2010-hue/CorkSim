import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import type { Park } from '../park/Park';

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

function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export type ObstacleKind = 'tree' | 'support' | 'box';

/**
 * Rapier integration. Rapier owns the *solid* world: trees, rail/box supports and box bodies (crash
 * obstacles), plus a triangle-mesh copy of the snow surface used for the physically simulated crash tumble.
 * Normal skiing contact uses the analytic SurfaceField (smooth normals, no triangle faceting) - see
 * DEVELOPMENT.md for the trade-off.
 */
export class PhysicsWorld {
  readonly world: RAPIER.World;
  private readonly obstacleKinds = new Map<number, ObstacleKind>();
  private readonly skierShape: RAPIER.Capsule;
  private tumbleBody: RAPIER.RigidBody | null = null;
  private readonly _pos = { x: 0, y: 0, z: 0 };
  private readonly _rot = { x: 0, y: 0, z: 0, w: 1 };

  private constructor(park: Park) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.skierShape = new RAPIER.Capsule(0.5, 0.26);
    this.buildSnowCollider(park);
    this.buildObstacles(park);
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
    const desc = RAPIER.ColliderDesc.trimesh(verts, idx)
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

  /** Starts a physically simulated tumble (crash) from the skier's current state. */
  startTumble(
    footPosition: Vector3,
    orientation: Quaternion,
    velocity: Vector3,
    angularVelocity: Vector3,
    snowHeight: number,
  ): void {
    this.endTumble();
    const up = new Vector3(0, 1, 0).applyQuaternion(orientation);
    const center = footPosition.clone().addScaledVector(up, 0.75);
    // Never spawn the body inside the snow (e.g. when landing upside down).
    center.y = Math.max(center.y, snowHeight + 0.85);
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(center.x, center.y + 0.05, center.z)
      .setRotation({ x: orientation.x, y: orientation.y, z: orientation.z, w: orientation.w })
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setAngvel({ x: angularVelocity.x * 0.6, y: angularVelocity.y * 0.6, z: angularVelocity.z * 0.6 })
      .setLinearDamping(0.25)
      .setAngularDamping(1.2)
      .setCcdEnabled(true);
    this.tumbleBody = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.capsule(0.45, 0.3)
      .setFriction(0.55)
      .setRestitution(0.15)
      .setDensity(160)
      .setCollisionGroups(groups(GROUP_SKIER, GROUP_SNOW | GROUP_OBSTACLE));
    this.world.createCollider(colDesc, this.tumbleBody);
  }

  get tumbling(): boolean {
    return this.tumbleBody !== null;
  }

  /** Steps the tumble simulation and writes the result back (foot point derived from capsule centre). */
  stepTumble(outFoot: Vector3, outOrientation: Quaternion, outVelocity: Vector3, outAngular: Vector3): void {
    const b = this.tumbleBody;
    if (!b) return;
    this.world.step();
    const t = b.translation();
    const r = b.rotation();
    const lv = b.linvel();
    const av = b.angvel();
    outOrientation.set(r.x, r.y, r.z, r.w).normalize();
    const up = new Vector3(0, 1, 0).applyQuaternion(outOrientation);
    outFoot.set(t.x, t.y, t.z).addScaledVector(up, -0.75);
    outVelocity.set(lv.x, lv.y, lv.z);
    outAngular.set(av.x, av.y, av.z);
  }

  endTumble(): void {
    if (this.tumbleBody) {
      this.world.removeRigidBody(this.tumbleBody);
      this.tumbleBody = null;
    }
  }

  dispose(): void {
    this.endTumble();
    this.world.free();
  }
}
