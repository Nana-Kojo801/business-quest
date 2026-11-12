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

  /** Call once per frame. Only sends a command when the intent changes. */
  update(cameraYaw: number) {
    const m = this.input.read();
    // Screen "up" (m.y > 0) means away from the camera.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const x = m.x * cos + m.y * sin;
    const z = m.x * sin - m.y * cos;
    if (Math.abs(x - this.last.x) < 1e-3 && Math.abs(z - this.last.z) < 1e-3) return;
    this.last = { x, z };
    this.transport.send({ type: 'move', playerId: this.playerId, x, z });
  }
}
