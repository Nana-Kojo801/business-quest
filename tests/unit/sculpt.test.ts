import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blend, blobWeights, bounds, surfaceNets, type Blob } from '../../src/render/characters/sculpt';

const bone = new THREE.Object3D();
const bone2 = new THREE.Object3D();

describe('sculpting', () => {
  it('turns a blob into a closed mesh on its surface, with triangles facing outward', () => {
    const blobs: Blob[] = [{ kind: 'ellipsoid', a: new THREE.Vector3(0, 0, 0), r: new THREE.Vector3(0.1, 0.1, 0.1), k: 0, bone }];
    const g = surfaceNets(blend(blobs), bounds(blobs, 0.03), 0.01);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    expect(g.index!.count).toBeGreaterThan(300);
    for (let i = 0; i < pos.count; i++) {
      const r = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
      expect(Math.abs(r - 0.1)).toBeLessThan(0.006);
    }
    // Triangle winding agrees with the outward normals.
    const idx = g.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    let agree = 0;
    for (let t = 0; t < idx.count; t += 3) {
      a.fromBufferAttribute(pos, idx.getX(t)); b.fromBufferAttribute(pos, idx.getX(t + 1)); c.fromBufferAttribute(pos, idx.getX(t + 2));
      const fn = b.clone().sub(a).cross(c.clone().sub(a));
      n.fromBufferAttribute(nor, idx.getX(t));
      if (fn.dot(n) > 0) agree++;
    }
    expect(agree / (idx.count / 3)).toBeGreaterThan(0.98);
  });

  it('skins vertices to the nearest blob, blending where two meet', () => {
    const blobs: Blob[] = [
      { kind: 'capsule', a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(0, 0.2, 0), r: 0.04, k: 0, bone },
      { kind: 'capsule', a: new THREE.Vector3(0, 0.2, 0), b: new THREE.Vector3(0, 0.4, 0), r: 0.04, k: 0.03, bone: bone2 },
    ];
    const g = surfaceNets(blend(blobs), bounds(blobs, 0.03), 0.01);
    const { skinBones, skinWeights } = blobWeights(g, blobs);
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const first = skinBones[i][0];
      if (y < 0.1) expect(first).toBe(bone);
      if (y > 0.3) expect(first).toBe(bone2);
      if (Math.abs(y - 0.2) < 0.01) expect(skinWeights[i * 4 + 1]).toBeGreaterThan(0.2); // blended at the joint
    }
  });
});
