import { Euler, Quaternion, Vector3 } from 'three';

const DEG = Math.PI / 180;
const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);
// Device frame looks out of the screen; a camera looks down -Z. Rotate -90° about X.
const SCREEN_TO_CAMERA = new Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));

/** Camera orientation for a phone's DeviceOrientation reading (degrees) and screen angle (degrees).
 * Same convention as the former three.js DeviceOrientationControls. */
export function deviceQuaternion(alpha: number, beta: number, gamma: number, screenAngle: number, out = new Quaternion()): Quaternion {
  const euler = new Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ');
  out.setFromEuler(euler);
  out.multiply(SCREEN_TO_CAMERA);
  out.multiply(new Quaternion().setFromAxisAngle(Z_AXIS, -screenAngle * DEG));
  return out;
}

/** Heading (radians) of a camera orientation; 0 looks down -Z, positive turns left (towards -X). */
export function yawOf(q: Quaternion): number {
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-forward.x, -forward.z);
}

export function yawQuaternion(yaw: number, out = new Quaternion()): Quaternion {
  return out.setFromAxisAngle(Y_AXIS, yaw);
}

/** Heading correction so that the phone's current heading shows `targetYaw` in the model. */
export function headingOffset(device: Quaternion, targetYaw: number): number {
  return targetYaw - yawOf(device);
}

/** Final camera orientation: the heading correction applied around the world's vertical axis. */
export function headsetQuaternion(device: Quaternion, offset: number, out = new Quaternion()): Quaternion {
  return out.copy(yawQuaternion(offset)).multiply(device);
}

/** Unit vector of the gaze projected on the floor (x, z), for walking where the user looks. */
export function walkDirection(q: Quaternion): { x: number; z: number } {
  const forward = new Vector3(0, 0, -1).applyQuaternion(q);
  const length = Math.hypot(forward.x, forward.z);
  // Looking straight down or up: fall back to the heading.
  if (length < 1e-3) { const yaw = yawOf(q); return { x: -Math.sin(yaw), z: -Math.cos(yaw) }; }
  return { x: forward.x / length, z: forward.z / length };
}

/** Orientation from a drag gesture, used where a gyroscope is not available (desktop testing). */
export function dragQuaternion(yaw: number, pitch: number, out = new Quaternion()): Quaternion {
  return out.setFromEuler(new Euler(Math.max(-1.45, Math.min(1.45, pitch)), yaw, 0, 'YXZ'));
}

/** Distance (cm) from `origin` along heading `yaw` to the nearest wall segment, or Infinity. */
export function wallDistance(origin: { x: number; z: number }, yaw: number, walls: { start: { x: number; y: number }; end: { x: number; y: number } }[]): number {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  let best = Infinity;
  for (const wall of walls) {
    const ex = wall.end.x - wall.start.x, ez = wall.end.y - wall.start.y;
    const denom = dx * ez - dz * ex;
    if (Math.abs(denom) < 1e-9) continue;
    const wx = wall.start.x - origin.x, wz = wall.start.y - origin.z;
    const t = (wx * ez - wz * ex) / denom;
    const u = (wx * dz - wz * dx) / denom;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.min(best, t);
  }
  return best;
}

/** Heading with the deepest view from a point: where a presentation should start looking. */
export function deepestViewYaw(origin: { x: number; z: number }, walls: Parameters<typeof wallDistance>[2], steps = 16): number {
  let bestYaw = 0, bestDistance = -1;
  for (let i = 0; i < steps; i++) {
    const yaw = (i / steps) * Math.PI * 2;
    const d = wallDistance(origin, yaw, walls);
    const score = Number.isFinite(d) ? d : 0; // An open side (no wall) is not a view into the room.
    if (score > bestDistance + 1e-6) { bestDistance = score; bestYaw = yaw; }
  }
  return bestYaw > Math.PI ? bestYaw - Math.PI * 2 : bestYaw;
}
