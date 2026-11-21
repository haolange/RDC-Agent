/** One stroke primitive in a 24 × 24 icon: a path, a circle (cx, cy, r) or a rounded rect (x, y, width, height, rx). */
export type IconPart =
  | { d: string }
  | { c: readonly [number, number, number] }
  | { r: readonly [number, number, number, number, number?] };
