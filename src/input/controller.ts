import type { PlayerId } from '../core';
import type { CommandTransport } from '../net/transport';
import type { Input } from './devices';

/**
 * Turns device input into commands for one local player.
 * Screen-relative input is rotated by the camera's yaw into world space.
 */
export class LocalController {
  private last = { x: 0, z: 0 };

  constructor(
    private input: Input,
    private transport: CommandTransport,
    readonly playerId: PlayerId,
  ) {}

  /** Call once per frame. Sends a move command only when the intent changes. */
  update(cameraYaw: number, enabled = true) {
    // While talking or in a menu the player stands still, and presses go to the UI instead.
    const m = enabled ? this.input.read() : { x: 0, y: 0 };
    // Screen "up" (m.y > 0) means away from the camera.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const x = m.x * cos + m.y * sin;
    const z = m.x * sin - m.y * cos;
    if (Math.abs(x - this.last.x) > 1e-3 || Math.abs(z - this.last.z) > 1e-3) {
      this.last = { x, z };
      this.transport.send({ type: 'move', playerId: this.playerId, x, z });
    }
    if (enabled && this.input.takeInteract()) this.transport.send({ type: 'interact', playerId: this.playerId });
  }
}
