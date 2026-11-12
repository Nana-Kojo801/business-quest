import * as THREE from 'three';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * A small flock wheeling far off over the valley. Wings flap in the vertex
 * shader; the few birds' paths are updated on the CPU (a handful of matrices).
 */
function birdGeometry() {
  // A body sliver and two swept wings; wing vertices have |x| > 0.1.
  const p = [
    // left wing
    0, 0, 0.15, -0.9, 0.05, -0.15, 0, 0, -0.2,
    // right wing
    0, 0, 0.15, 0, 0, -0.2, 0.9, 0.05, -0.15,
    // body
    0, 0.02, 0.4, -0.06, 0, -0.3, 0.06, 0, -0.3,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

export function createBirds(atmosphere: Atmosphere, count = 7) {
  const material = new THREE.MeshLambertMaterial({ color: '#3b2f3c', side: THREE.DoubleSide });
  const uniforms = { uTime: { value: 0 } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float phase = instanceMatrix[3][0] * 0.37 + instanceMatrix[3][2] * 0.21;
          float wing = smoothstep(0.1, 0.9, abs(position.x));
          transformed.y += sin(uTime * 7.0 + phase) * wing * 0.55;
        #endif`,
      );
  };
  material.customProgramCacheKey = () => 'bq-birds';
  const mesh = new THREE.InstancedMesh(birdGeometry(), material, count);
  mesh.frustumCulled = false;
  mesh.name = 'birds';
  atmosphere.adopt(mesh, { cast: false, receive: false });

  const birds = Array.from({ length: count }, (_, i) => ({
    radius: 16 + (i % 3) * 4 + i * 0.7,
    height: 26 + (i % 4) * 1.6,
    speed: 0.14 + (i % 2) * 0.02,
    offset: i * 0.42,
  }));
  const centre = new THREE.Vector3(4, 0, -72);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const scale = new THREE.Vector3(1.1, 1.1, 1.1);
  const pos = new THREE.Vector3();

  return {
    mesh,
    update(time: number) {
      uniforms.uTime.value = time;
      birds.forEach((b, i) => {
        const a = time * b.speed + b.offset;
        pos.set(centre.x + Math.cos(a) * b.radius, b.height + Math.sin(time * 0.6 + i) * 0.8, centre.z + Math.sin(a) * b.radius);
        // Fly along the circle (tangent direction), banking slightly inward.
        q.setFromAxisAngle(up, -a);
        m.compose(pos, q, scale);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
    },
  };
}
