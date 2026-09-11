/** Internal frame: X forward, Y left, Z up. Three.js frame: (X,Z,-Y). */
export const toRender = (x: number, y: number, z = 0) => ({ x, y: z, z: -y });
export const fromRender = (x: number, y: number, z: number) => ({
  x,
  y: -z,
  z: y,
});
export const wrapAngle = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));
export const rotate = (x: number, y: number, angle: number) => ({
  x: x * Math.cos(angle) - y * Math.sin(angle),
  y: x * Math.sin(angle) + y * Math.cos(angle),
});
export const fieldToRobot = (x: number, y: number, yaw: number) =>
  rotate(x, y, -yaw);
export const clamp = (x: number, low: number, high: number) =>
  Math.max(low, Math.min(high, x));
