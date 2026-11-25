import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { RAGDOLL_SEGMENT_INFO } from '../physics/Ragdoll';
import { RIG, SkierModel } from '../render/SkierModel';
import { BODY } from './bodyDimensions';

describe('body dimensions shared by the ragdoll and the rig', () => {
  it('match the RIG segment lengths', () => {
    expect(BODY.thigh).toBe(RIG.thigh);
    expect(BODY.shin).toBe(RIG.shin);
    expect(BODY.upperArmLength).toBe(RIG.upperArm);
    expect(BODY.forearm).toBe(RIG.forearm);
    expect(BODY.hip.x).toBe(RIG.hipHalfWidth);
    expect(BODY.clavicle.x + BODY.upperArm.x).toBeCloseTo(RIG.shoulderHalfWidth, 12);
    expect(BODY.skiOffsetY).toBe(RIG.skiOffsetY);
    expect(BODY.skiOffsetZ).toBe(RIG.skiOffsetZ);
    expect(BODY.skiLength).toBe(RIG.skiLength);
    expect(-BODY.skiOffsetY).toBe(RIG.ankle);
  });

  it('match the bone offsets built by SkierModel', () => {
    const m = new SkierModel();
    const local = (b: { position: Vector3 }) => b.position;
    expect(local(m.pelvis).toArray()).toEqual([0, BODY.pelvisHeight, 0]);
    expect(local(m.spine).toArray()).toEqual([BODY.spine.x, BODY.spine.y, BODY.spine.z]);
    expect(local(m.chest).toArray()).toEqual([BODY.chest.x, BODY.chest.y, BODY.chest.z]);
    expect(local(m.neck).toArray()).toEqual([BODY.neck.x, BODY.neck.y, BODY.neck.z]);
    expect(local(m.head).toArray()).toEqual([BODY.head.x, BODY.head.y, BODY.head.z]);
    expect(local(m.shoulders[0]).toArray()).toEqual([BODY.clavicle.x, BODY.clavicle.y, BODY.clavicle.z]);
    expect(local(m.hips[0]).toArray()).toEqual([BODY.hip.x, BODY.hip.y, BODY.hip.z]);
    expect(local(m.upperArms[0]).x).toBeCloseTo(BODY.upperArm.x, 12);
    expect(local(m.upperArms[0]).y).toBe(BODY.upperArm.y);
    expect(local(m.upperArms[0]).z).toBe(BODY.upperArm.z);
    m.dispose();
  });

  it('place every ragdoll segment origin on its bone joint in the rest pose', () => {
    const m = new SkierModel();
    m.root.updateMatrixWorld(true);
    const bone: Record<string, Vector3> = {};
    m.root.traverse((o) => {
      if (o.name) bone[o.name] = o.getWorldPosition(new Vector3());
    });
    const world: Vector3[] = [];
    for (let i = 0; i < RAGDOLL_SEGMENT_INFO.length; i++) {
      const info = RAGDOLL_SEGMENT_INFO[i];
      const o = new Vector3(info.origin.x, info.origin.y, info.origin.z);
      world.push(info.parent < 0 ? o : o.add(world[info.parent]));
      // The first bone a segment drives starts at the segment origin.
      const first = info.bones[0];
      expect(world[i].distanceTo(bone[first]), `${info.name} vs ${first}`).toBeLessThan(1e-9);
    }
    m.dispose();
  });
});
