'use strict';

class FaceAssembly {
  constructor(solids, type, saved) {
    this.solids = solids;
    // Geometry changes can invalidate both the selected face and its contact point.
    const geometry = JSON.stringify([type, solids.map(s => [s.pi, s.part.name, s.map, s.th, s.pts, s.holes])]);
    let hash = 2166136261;
    for (let i = 0; i < geometry.length; i++) hash = Math.imul(hash ^ geometry.charCodeAt(i), 16777619);
    this.key = geometry.length + '-' + (hash >>> 0).toString(16);
    this.joints = [];
    this.poses = new Map();
    this.groups = new Map();
    this.offsets = new Map();
    this.resetPoses();
    if (saved?.key === this.key && Array.isArray(saved.joints)) {
      for (const joint of saved.joints) {
        if (!this.join(joint?.moving, joint?.fixed, joint?.angle)) break;
      }
    }
    this.fit();
  }

  resetPoses() {
    this.poses.clear();
    this.groups.clear();
    for (const {pi} of this.solids) {
      this.poses.set(pi, new THREE.Matrix4());
      this.groups.set(pi, new Set([pi]));
    }
  }

  sameGroup(a, b) {
    return this.groups.get(a) === this.groups.get(b);
  }

  facePoint(face) {
    return new THREE.Vector3(...face.point).applyMatrix4(this.poses.get(face.pi));
  }

  faceNormal(face) {
    return new THREE.Vector3(...face.normal).transformDirection(this.poses.get(face.pi));
  }

  rotationPreview(face, angle) {
    const pivot = this.facePoint(face);
    const rotation = new THREE.Matrix4().makeRotationAxis(this.faceNormal(face), angle * Math.PI / 180);
    return rotation.setPosition(pivot.clone().sub(pivot.clone().applyMatrix4(rotation)));
  }

  join(moving, fixed, angle = 0) {
    const vector = a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite);
    const valid = face => face && this.poses.has(face.pi) && vector(face.point) && vector(face.normal)
      && Math.abs(Math.hypot(...face.normal) - 1) < 1e-5;
    if (!valid(moving) || !valid(fixed) || this.sameGroup(moving.pi, fixed.pi)) return false;

    if (!Number.isFinite(angle) || Math.abs(angle) > 180) return false;

    const rotation = new THREE.Quaternion().setFromUnitVectors(this.faceNormal(moving), this.faceNormal(fixed).negate());
    const offset = this.facePoint(fixed).sub(this.facePoint(moving).applyQuaternion(rotation));
    const transform = new THREE.Matrix4().makeRotationFromQuaternion(rotation).setPosition(offset);
    if (angle) transform.multiply(this.rotationPreview(moving, angle));
    const movingGroup = this.groups.get(moving.pi), fixedGroup = this.groups.get(fixed.pi);
    for (const pi of movingGroup) {
      this.poses.get(pi).premultiply(transform);
      this.groups.set(pi, fixedGroup);
      fixedGroup.add(pi);
    }
    this.joints.push({moving, fixed, angle});
    return true;
  }

  undo() {
    const remaining = this.joints.slice(0, -1);
    this.joints = [];
    this.resetPoses();
    for (const {moving, fixed, angle} of remaining) this.join(moving, fixed, angle);
    this.fit();
  }

  fit() {
    const bounds = new THREE.Box3();
    const groupBounds = new Map();
    const p = new THREE.Vector3();
    for (const solid of this.solids) {
      const group = this.groups.get(solid.pi);
      if (!groupBounds.has(group)) groupBounds.set(group, new THREE.Box3());
      const box = groupBounds.get(group);
      const pose = this.poses.get(solid.pi);
      for (const loop of [solid.bot[0], solid.top[0]]) {
        for (const q of loop) box.expandByPoint(p.fromArray(q).applyMatrix4(pose));
      }
    }
    for (const box of groupBounds.values()) bounds.union(box);
    const center = bounds.getCenter(new THREE.Vector3());
    this.center = center.toArray();
    this.radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length() / 2);
    this.offsets.clear();
    for (const [pi, group] of this.groups) {
      this.offsets.set(pi, groupBounds.get(group).getCenter(new THREE.Vector3()).sub(center));
    }
  }
}
