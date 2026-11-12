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
    const k = 3.2 / Math.max(viewHeight, 300); // a full-height drag turns about 180 degrees
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

    this.camera.position.copy(pos);
    this.camera.lookAt(target);
  }
}
