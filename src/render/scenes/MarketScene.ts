import * as THREE from 'three';
import { STRUCTURES, heightAt, obstacleAt, structureAt, type MarketResult } from '../../core';
import { Character } from '../characters/Character';
import { villagerLook } from '../characters/looks';
import type { Atmosphere } from '../sky/Atmosphere';

/**
 * A morning crowd at the market stall. Shoppers stand in an arc facing the
 * stall; those who'd buy at the current price raise a hand. Playing a result
 * walks buyers up to the counter and away; those who missed out stomp off.
 */
interface Shopper {
  character: Character;
  home: THREE.Vector3;
  limit: number;
  path: THREE.Vector3[];
  speed: number;
  /** Seconds to wait before starting to walk. */
  delay: number;
  done: boolean;
}

export interface SceneEvents {
  /** Show a short bubble above shopper i. */
  bubble(i: number, text: string): void;
}

export class MarketScene {
  readonly group = new THREE.Group();
  private shoppers: Shopper[] = [];
  readonly stall = STRUCTURES.find((s) => s.kind === 'stall')!;
  /** Unit vector from the stall toward its customers. */
  readonly front: THREE.Vector3;
  readonly side: THREE.Vector3;
  private playing = false;
  private onDone: (() => void) | null = null;
  private elapsed = 0;

  constructor(atmosphere: Atmosphere, limits: number[], seeds: number[], private events: SceneEvents) {
    this.front = new THREE.Vector3(Math.sin(this.stall.rot), 0, Math.cos(this.stall.rot));
    this.side = new THREE.Vector3(-this.front.z, 0, this.front.x);
    const n = limits.length;
    const perRow = Math.ceil(n / 2);
    limits.forEach((limit, i) => {
      // Two staggered rows facing the counter, compact enough for a tall portrait frame.
      const row = i % 2;
      const col = Math.floor(i / 2);
      const t = perRow === 1 ? 0 : col / (perRow - 1) - 0.5;
      const home = new THREE.Vector3(this.stall.x, 0, this.stall.z)
        .addScaledVector(this.front, 3.3 + row * 1.0 + Math.abs(t) * 0.5)
        .addScaledVector(this.side, t * 3.0 + row * 0.42);
      // Nudge off anything solid.
      for (let k = 0; k < 8 && (obstacleAt(home.x, home.z, 0.5) || structureAt(home.x, home.z, 0.5)); k++) home.addScaledVector(this.front, 0.4);
      home.y = heightAt(home.x, home.z);
      const character = new Character(villagerLook(seeds[i]), atmosphere, seeds[i] * 0.37);
      character.root.position.copy(home);
      this.group.add(character.root);
      this.shoppers.push({ character, home, limit, path: [], speed: 0, delay: 0, done: true });
    });
    this.faceStall();
  }

  get count() {
    return this.shoppers.length;
  }

  /** Centre of the crowd (feet). */
  get centre() {
    const c = new THREE.Vector3();
    for (const s of this.shoppers) c.add(s.home);
    return c.divideScalar(Math.max(1, this.shoppers.length));
  }

  /** A high shot from behind the counter, looking out at the crowd. */
  cameraShot(portrait: boolean) {
    // Beside the stall (not over the awning), high enough to see every raised hand,
    // with Mira's counter at the edge of the frame.
    const c = this.centre;
    const sideOff = portrait ? 4.4 : 4.4;
    const pos = new THREE.Vector3(this.stall.x, 0, this.stall.z)
      .addScaledVector(this.side, -sideOff)
      .addScaledVector(this.front, portrait ? -0.6 : 0.9);
    pos.y = heightAt(pos.x, pos.z) + (portrait ? 6.4 : 3.6);
    const look = new THREE.Vector3(c.x, c.y + 1.0, c.z).addScaledVector(this.side, portrait ? 0.2 : -0.4).addScaledVector(this.front, portrait ? 0.2 : -0.8);
    return { pos, look };
  }

  head(i: number) {
    const p = this.shoppers[i].character.root.position;
    return { x: p.x, y: p.y + 2.0, z: p.z };
  }

  /** Hands up for everyone who'd buy at this price. */
  setPrice(price: number) {
    if (this.playing) return;
    for (const s of this.shoppers) s.character.raised = s.limit >= price;
  }

  private faceStall() {
    for (const s of this.shoppers) {
      const p = s.character.root.position;
      s.character.root.rotation.y = Math.atan2(this.stall.x - p.x, this.stall.z - p.z);
    }
  }

  /** Put everyone back in the arc (a new morning). */
  reset() {
    this.playing = false;
    for (const s of this.shoppers) {
      s.character.root.position.copy(s.home);
      s.path = [];
      s.done = true;
      s.character.raised = false;
    }
    this.faceStall();
  }

  /** Act out a day of trading, then call done. */
  play(result: MarketResult, done: () => void) {
    this.playing = true;
    this.onDone = done;
    this.elapsed = 0;
    const counter = (k: number) =>
      new THREE.Vector3(this.stall.x, 0, this.stall.z).addScaledVector(this.front, 2.05).addScaledVector(this.side, (k - 1) * 0.55);
    const away = (s: Shopper, extra: number) => s.home.clone().addScaledVector(this.front, 6 + extra).addScaledVector(this.side, s.home.clone().sub(this.centre).dot(this.side) > 0 ? 3 : -3);
    result.buyers.forEach((idx, k) => {
      const s = this.shoppers[idx];
      s.character.raised = false;
      s.path = [counter(k % 3), away(s, k * 0.4)];
      s.speed = 3.2;
      s.delay = 0.25 + k * 0.45;
      s.done = false;
    });
    result.missedOut.forEach((idx, k) => {
      const s = this.shoppers[idx];
      s.character.raised = false;
      s.path = [away(s, 1 + k * 0.3)];
      s.speed = 3.8;
      s.delay = 0.8 + result.buyers.length * 0.45 + k * 0.2;
      s.done = false;
      setTimeout(() => this.events.bubble(idx, '!'), s.delay * 1000 - 300);
    });
    result.buyers.forEach((idx, k) => setTimeout(() => this.events.bubble(idx, '♥'), (1.6 + k * 0.45) * 1000));
    for (const s of this.shoppers) if (s.done) s.character.raised = false;
  }

  update(dt: number, time: number) {
    if (this.playing) this.elapsed += dt;
    let walking = 0;
    for (const s of this.shoppers) {
      let speed = 0;
      if (!s.done) {
        walking++;
        if (this.elapsed >= s.delay && s.path.length) {
          const pos = s.character.root.position;
          const target = s.path[0];
          const dx = target.x - pos.x;
          const dz = target.z - pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.08) {
            s.path.shift();
            if (!s.path.length) s.done = true;
          } else {
            const step = Math.min(d, s.speed * dt);
            pos.x += (dx / d) * step;
            pos.z += (dz / d) * step;
            pos.y = heightAt(pos.x, pos.z);
            speed = s.speed;
            let dy = Math.atan2(dx, dz) - s.character.root.rotation.y;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            s.character.root.rotation.y += dy * Math.min(1, dt * 10);
          }
        }
      }
      s.character.update(dt, time, speed);
    }
    if (this.playing && walking === 0 && this.elapsed > 0.5) {
      this.playing = false;
      const done = this.onDone;
      this.onDone = null;
      done?.();
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}
