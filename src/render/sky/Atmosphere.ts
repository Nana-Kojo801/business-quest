import * as THREE from 'three';
import { SKY_PRESETS, sunDirection, type SkyPreset, type SkyPresetName } from './presets';
import {
  ATMOSPHERE_UNIFORMS_GLSL,
  FOG_FRAGMENT_GLSL,
  FOG_UNIFORMS_GLSL,
  SKY_COLOR_GLSL,
  WORLD_POS_VERTEX_GLSL,
} from './atmosphereGlsl';

const hdr = (hex: string, boost = 1) => new THREE.Color(hex).multiplyScalar(boost);

/**
 * Owns the sky, sun, ambient light and fog, all driven by one preset.
 * Uniform objects are shared by reference between the sky dome and every
 * patched world material, so changing the preset updates everything at once.
 */
export class Atmosphere {
  readonly uniforms = {
    bqSunDir: { value: new THREE.Vector3(0, 1, 0) },
    bqZenith: { value: new THREE.Color() },
    bqSkyMid: { value: new THREE.Color() },
    bqHorizon: { value: new THREE.Color() },
    bqSunGlow: { value: new THREE.Color() },
    bqGlowPower: { value: 10 },
    bqFogStart: { value: 20 },
    bqFogDensity: { value: 0.02 },
    bqFogHeightFalloff: { value: 0.1 },
  };

  readonly skyUniforms = {
    uTime: { value: 0 },
    uSunDisc: { value: new THREE.Color() },
    uSunCos: { value: 0.999 },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uCloudCover: { value: 0.5 },
  };

  readonly sky: THREE.Mesh;
  readonly sun = new THREE.DirectionalLight();
  readonly ambient = new THREE.HemisphereLight();
  presetName: SkyPresetName = 'goldenHour';

  private patched = new WeakSet<THREE.Material>();
  private shadowExtent = 16;

  constructor(scene: THREE.Scene) {
    this.sky = this.createSky();
    scene.add(this.sky, this.sun, this.sun.target, this.ambient);

    const shadow = this.sun.shadow;
    const cam = shadow.camera;
    cam.left = -this.shadowExtent;
    cam.right = this.shadowExtent;
    cam.top = this.shadowExtent;
    cam.bottom = -this.shadowExtent;
    cam.near = 1;
    cam.far = 120;
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03;
  }

  setPreset(name: SkyPresetName) {
    this.presetName = name;
    const p: SkyPreset = SKY_PRESETS[name];
    const u = this.uniforms;
    u.bqSunDir.value.set(...sunDirection(p.sun.azimuthDeg, p.sun.elevationDeg));
    u.bqZenith.value.copy(hdr(p.zenith));
    u.bqSkyMid.value.copy(hdr(p.skyMid));
    u.bqHorizon.value.copy(hdr(p.horizon, p.horizonBoost));
    u.bqSunGlow.value.copy(hdr(p.sunGlow, p.sunGlowBoost));
    u.bqGlowPower.value = p.glowPower;
    u.bqFogStart.value = p.fog.start;
    u.bqFogDensity.value = p.fog.density;
    u.bqFogHeightFalloff.value = p.fog.heightFalloff;

    const s = this.skyUniforms;
    s.uSunDisc.value.copy(hdr(p.sunDisc, p.sunDiscBoost));
    s.uSunCos.value = Math.cos((p.sunSizeDeg * Math.PI) / 180);
    s.uCloudLit.value.copy(hdr(p.cloudLit, p.cloudLitBoost));
    s.uCloudShade.value.copy(hdr(p.cloudShade));
    s.uCloudCover.value = p.cloudCover;

    this.sun.color.set(p.sun.color);
    this.sun.intensity = p.sun.intensity;
    this.ambient.color.set(p.ambientSky);
    this.ambient.groundColor.set(p.ambientGround);
    this.ambient.intensity = p.ambientIntensity;
  }

  /** Shadow map resolution; 0 turns shadows off. */
  setShadowMapSize(size: number) {
    this.sun.castShadow = size > 0;
    if (size > 0 && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Give a world material the shared atmospheric fog. Safe to call repeatedly. */
  patchMaterial(material: THREE.Material) {
    if (this.patched.has(material) || material instanceof THREE.ShaderMaterial) return;
    this.patched.add(material);
    // Chain onto any shader changes the material already has (e.g. terrain colouring).
    const previous = material.onBeforeCompile.bind(material);
    const previousKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      previous(shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBqWorldPos;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>\n${WORLD_POS_VERTEX_GLSL}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${ATMOSPHERE_UNIFORMS_GLSL}\n${FOG_UNIFORMS_GLSL}\n${SKY_COLOR_GLSL}`)
        .replace('#include <fog_fragment>', FOG_FRAGMENT_GLSL);
    };
    material.customProgramCacheKey = () => previousKey() + '|bq-atmosphere';
    material.needsUpdate = true;
  }

  /** Patch every mesh material in a subtree, and set shadow flags. */
  adopt(root: THREE.Object3D, { cast = true, receive = true } = {}) {
    root.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o === this.sky) return;
      o.castShadow = cast;
      o.receiveShadow = receive;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => this.patchMaterial(m));
    });
  }

  /** Per frame: keep the sky around the camera and the shadow box around the focus point. */
  update(time: number, camera: THREE.Camera, focus: THREE.Vector3) {
    this.skyUniforms.uTime.value = time;
    this.sky.position.copy(camera.position);

    // Snap the shadow centre to whole shadow-map texels so shadows do not shimmer as you move.
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const cx = Math.round(focus.x / texel) * texel;
    const cz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.copy(this.uniforms.bqSunDir.value).multiplyScalar(60).add(this.sun.target.position);
  }

  private createSky() {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, ...this.skyUniforms },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww; // always at the far plane
        }
      `,
      fragmentShader: /* glsl */ `
        ${ATMOSPHERE_UNIFORMS_GLSL}
        ${SKY_COLOR_GLSL}
        uniform float uTime;
        uniform vec3 uSunDisc;
        uniform float uSunCos;
        uniform vec3 uCloudLit;
        uniform vec3 uCloudShade;
        uniform float uCloudCover;
        varying vec3 vDir;

        float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
          for (int i = 0; i < 5; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
          return v;
        }

        void main() {
          vec3 dir = normalize(vDir);
          vec3 col = bqSkyColor(dir);
          float s = dot(dir, bqSunDir);

          // Sun disc with a soft edge.
          col += uSunDisc * smoothstep(uSunCos - 0.00025, uSunCos + 0.00015, s);

          if (dir.y > 0.0) {
            // Project onto a cloud layer; clouds stretch toward the horizon.
            vec2 p = dir.xz / (dir.y + 0.14) * 0.85 + vec2(uTime * 0.008, uTime * 0.003);
            float d = fbm(p);
            float cover = smoothstep(uCloudCover, uCloudCover + 0.2, d);
            // Self-shadowing: denser toward the sun means this side is in shade.
            float d2 = fbm(p + bqSunDir.xz * 0.18);
            float lit = clamp(0.55 + (d - d2) * 3.5, 0.0, 1.0);
            vec3 cloud = mix(uCloudShade, uCloudLit, lit);
            // Thin cloud edges near the sun glow.
            float rim = pow(max(s, 0.0), 6.0) * (1.0 - smoothstep(0.0, 1.0, (d - uCloudCover) * 5.0));
            cloud += bqSunGlow * rim * 1.4;
            float fade = smoothstep(0.0, 0.18, dir.y);
            col = mix(col, cloud, cover * fade * 0.92);
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1;
    return mesh;
  }
}
