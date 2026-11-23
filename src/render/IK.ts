import { Matrix4, Object3D, Quaternion, Vector3 } from 'three';

const _a = new Vector3();
const _t = new Vector3();
const _dir = new Vector3();
const _pole = new Vector3();
const _bend = new Vector3();
const _joint = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _parentQ = new Quaternion();
const _inv = new Matrix4();

/**
 * Builds a world rotation whose local -Y axis (bones point down -Y in rest pose) points along `boneDir`
 * and whose local +Z axis points towards `hint` (knee/elbow bend direction).
 */
function boneRotation(boneDir: Vector3, hint: Vector3, out: Quaternion): Quaternion {
  _y.copy(boneDir).negate().normalize();
  _z.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _z.normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

function setWorldQuaternion(obj: Object3D, worldQ: Quaternion): void {
  if (obj.parent) {
    obj.parent.getWorldQuaternion(_parentQ);
    obj.quaternion.copy(_parentQ.invert().multiply(worldQ));
  } else {
    obj.quaternion.copy(worldQ);
  }
  obj.updateMatrixWorld(true);
}

/**
 * Analytic two-bone IK (law of cosines). Bones must be modelled pointing down -Y in their rest pose,
 * with `lower` a child of `upper` offset by `upperLength`, and the end effector `lowerLength` below lower.
 * `target` and `poleDirection` are in world space. Handles unreachable targets by fully extending.
 */
export function solveTwoBoneIK(
  upper: Object3D,
  lower: Object3D,
  upperLength: number,
  lowerLength: number,
  target: Vector3,
  poleDirection: Vector3,
): void {
  upper.updateMatrixWorld(true);
  upper.getWorldPosition(_a);
  _t.copy(target);
  _dir.subVectors(_t, _a);
  let dist = _dir.length();
  const maxReach = (upperLength + lowerLength) * 0.999;
  const minReach = Math.abs(upperLength - lowerLength) + 1e-3;
  if (dist < 1e-6) {
    _dir.set(0, -1, 0);
    dist = minReach;
  }
  _dir.normalize();
  dist = Math.min(Math.max(dist, minReach), maxReach);
  // Angle at the root between the target direction and the upper bone.
  const cosA =
    (upperLength * upperLength + dist * dist - lowerLength * lowerLength) / (2 * upperLength * dist);
  const angleA = Math.acos(Math.min(1, Math.max(-1, cosA)));
  // Bend direction: pole projected perpendicular to the target direction.
  _pole.copy(poleDirection).addScaledVector(_dir, -poleDirection.dot(_dir));
  if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).addScaledVector(_dir, -_dir.z);
  _pole.normalize();
  _bend.copy(_dir).multiplyScalar(Math.cos(angleA)).addScaledVector(_pole, Math.sin(angleA)).normalize();
  _joint.copy(_a).addScaledVector(_bend, upperLength);
  boneRotation(_bend, _pole, _q);
  setWorldQuaternion(upper, _q);
  const lowerDir = _dir.copy(target).sub(_joint);
  if (lowerDir.lengthSq() < 1e-10) lowerDir.copy(_bend);
  boneRotation(lowerDir.normalize(), _pole, _q);
  setWorldQuaternion(lower, _q);
}

/** Converts a point from an object's local space to world space (helper for IK targets). */
export function localToWorld(obj: Object3D, local: Vector3, out: Vector3): Vector3 {
  obj.updateMatrixWorld(true);
  return out.copy(local).applyMatrix4(obj.matrixWorld);
}

/** Converts a world-space point into an object's local space. */
export function worldToLocal(obj: Object3D, world: Vector3, out: Vector3): Vector3 {
  obj.updateMatrixWorld(true);
  _inv.copy(obj.matrixWorld).invert();
  return out.copy(world).applyMatrix4(_inv);
}

export { setWorldQuaternion };
