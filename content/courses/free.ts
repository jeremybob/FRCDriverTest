import type { CourseDefinition } from "../../src/types";
/** Open-lane free-drive markers share exact visible and physical extents. */
export const FREE_GATES = Array.from({ length: 5 }, (_, i) => ({
  x: 5 + i * 1.8,
  y: 3 + (i % 2) * 2,
  yaw: 0,
  width: 1.7,
}));
export const FREE_OBSTACLES: CourseDefinition["obstacles"] = FREE_GATES.flatMap(
  (g, i) =>
    [-1, 1].map((side) => ({
      id: `practice-post-${i}-${side}`,
      x: g.x,
      y: g.y + side * (g.width / 2 + 0.07),
      width: 0.14,
      length: 0.14,
      yaw: 0,
    })),
);
