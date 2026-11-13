import * as THREE from 'three';
import { heightAt } from '../core';

/**
 * Third-person orbit camera, framed for a tall portrait screen first.
 *
 * - Orbit (yaw/pitch) and zoom from input, eased so it never snaps.
 * - The player sits in the lower part of a portrait frame, leaving the world and
 *   sky ahead visible; landscape frames sit a little further back and lower.
 * - Gently swings behind the player when they walk sideways and nobody has touched
 *   the camera for a moment.
 * - Never dips below the ground or looks through a hill.
 */
export class CameraRig {
  /** Yaw: 0 looks toward -z. */
  yaw = 0;
  pitch = 0.3;
  distance = 6.5;
  private yawTarget = 0;
  private pitchTarget = 0.3;
  private distTarget = 6.5;
  private focus = new THREE.Vector3();
  private focusInit = false;
  private camHeightBoost = 0;
  private framed = false;
  /** Multiplies orbit drag speed (settings). */
  sensitivity = 1;
  /** While set, the camera frames a two-person conversation instead of following. */
  conversation: { a: THREE.Vector3; b: THREE.Vector3; cover: number } | null = null;
  /** An explicit camera pose for scripted scenes (wins over conversation). */
  shot: { pos: THREE.Vector3; look: THREE.Vector3; cover: number } | null = null;
  private convBlend = 0;
  private convPos = new THREE.Vector3();
  private convLook = new THREE.Vector3();
  /** Enabled while the player is using touch controls. */
  autoFollow = false;

  static readonly MIN_DIST = 3;
  static readonly MAX_DIST = 11;
  static readonly MIN_PITCH = 0.06;
  static readonly MAX_PITCH = 1.05;

  constructor(private camera: THREE.PerspectiveCamera, private close = false) {
    if (close) {
      this.distTarget = this.distance = 3.2;
      this.pitchTarget = this.pitch = 0.1;
    }
  }

  /** Apply input: orbit drag in pixels, zoom in steps. */
  input(dx: number, dy: number, zoom: number, viewHeight: number) {
    if (this.conversation) return;
    const k = (3.2 / Math.max(viewHeight, 300)) * this.sensitivity; // a full-height drag turns about 180 degrees
    this.yawTarget += dx * k;
    this.pitchTarget = THREE.MathUtils.clamp(this.pitchTarget + dy * k * 0.7, CameraRig.MIN_PITCH, CameraRig.MAX_PITCH);
    this.distTarget = THREE.MathUtils.clamp(this.distTarget * Math.pow(1.12, zoom), CameraRig.MIN_DIST, CameraRig.MAX_DIST);
  }

  /**
   * @param player feet position
   * @param heading player facing (0 = -z)
   * @param moving 0..1 how fast the player is moving
   * @param idleCam seconds since the camera was last moved by hand
   */
  update(dt: number, player: THREE.Vector3, heading: number, moving: number, idleCam: number) {
    const portrait = this.camera.aspect < 1;
    if (!this.framed) {
      // First frame (the aspect is known by now): landscape sits further back and lower,
      // so the sky and distance show; portrait stays closer.
      this.framed = true;
      if (!portrait && !this.close) {
        this.distTarget = this.distance = 7.5;
        this.pitchTarget = this.pitch = 0.2;
      }
    }

    // Auto-follow (touch only, where steering the camera while walking is awkward): gently swing
    // behind the player when they move across the view, never when they walk toward it.
    if (this.autoFollow && moving > 0.2 && idleCam > 2 && !this.close) {
      let d = heading - this.yawTarget;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      if (Math.cos(d) > -0.35) this.yawTarget += d * Math.min(1, dt * 0.35 * moving * Math.abs(Math.sin(d)));
    }

    const ease = (rate: number) => 1 - Math.exp(-rate * dt);
    let dy = this.yawTarget - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw += dy * ease(10);
    this.pitch += (this.pitchTarget - this.pitch) * ease(10);
    this.distance += (this.distTarget - this.distance) * ease(8);

    // Focus follows the player, smoothing out small ground bumps vertically.
    if (!this.focusInit) { this.focus.copy(player); this.focusInit = true; }
    this.focus.x = player.x;
    this.focus.z = player.z;
    this.focus.y += (player.y - this.focus.y) * ease(6);

    // Look at a point above the head: in portrait, higher, so the player sits low and the view opens up ahead.
    const lookHeight = this.close ? 1.0 : portrait ? 1.75 + this.distance * 0.08 : 1.6 + this.distance * 0.06;
    const target = new THREE.Vector3(this.focus.x, this.focus.y + lookHeight, this.focus.z);
    const back = new THREE.Vector3(-Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const pos = target.clone()
      .addScaledVector(back, Math.cos(this.pitch) * this.distance)
      .add(new THREE.Vector3(0, Math.sin(this.pitch) * this.distance, 0));

    // Keep the camera, and the line to the player, above the ground.
    let need = 0;
    for (const t of [1, 0.75, 0.5, 0.3]) {
      const p = target.clone().lerp(pos, t);
      const ground = heightAt(p.x, p.z) + (t === 1 ? 0.6 : 0.35);
      need = Math.max(need, (ground - p.y) / t);
    }
    this.camHeightBoost += (need - this.camHeightBoost) * ease(need > this.camHeightBoost ? 20 : 4);
    pos.y += Math.max(0, this.camHeightBoost);

    // Conversation shot: from the side of the pair, both in frame, faces kept above the dialogue box.
    this.convBlend += ((this.conversation || this.shot ? 1 : 0) - this.convBlend) * ease(3.5);
    if (this.shot) {
      const { pos: sp, look, cover } = this.shot;
      this.convPos.copy(sp);
      const d = sp.distanceTo(look);
      const fovRad = (this.camera.fov * Math.PI) / 180;
      // Tilt the aim down so the subject sits in the clear area above any panel.
      const dir = look.clone().sub(sp).normalize();
      const upv = new THREE.Vector3(0, 1, 0).sub(dir.clone().multiplyScalar(dir.y)).normalize();
      this.convLook.copy(look).addScaledVector(upv, -Math.tan(fovRad / 2) * d * cover);
    } else if (this.conversation) {
      const { a, b, cover } = this.conversation;
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const ab = b.clone().sub(a);
      ab.y = 0;
      const sep = Math.max(ab.length(), 0.8);
      ab.normalize();
      // Perpendicular to the pair, on whichever side the camera already is.
      let side = new THREE.Vector3(-ab.z, 0, ab.x);
      if (side.dot(pos.clone().sub(mid)) < 0) side.negate();
      // Over the player's shoulder (a is the player, b the villager), close and at eye level,
      // so the villager's face and expression read clearly.
      side.addScaledVector(ab, -0.85).normalize();
      const d = (portrait ? 2.1 : 2.2) + sep * 0.5;
      const focus = mid.clone().lerp(b, 0.3);
      this.convPos.copy(focus).addScaledVector(side, d);
      this.convPos.y = focus.y + 1.62;
      // Aim lower when the dialogue box covers more of the screen, so faces sit in the clear area above it.
      const fovRad = (this.camera.fov * Math.PI) / 180;
      const drop = Math.tan(fovRad / 2) * d * cover;
      this.convLook.set(focus.x, focus.y + 1.42 - drop, focus.z);
      const g = heightAt(this.convPos.x, this.convPos.z) + 0.6;
      if (this.convPos.y < g) this.convPos.y = g;
    }
    if (this.convBlend > 0.001) {
      const t = this.convBlend * this.convBlend * (3 - 2 * this.convBlend);
      pos.lerp(this.convPos, t);
      target.lerp(this.convLook, t);
    }

    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }
}
