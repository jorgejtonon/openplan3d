/**
 * Graphics of dimensions, as plane geometry: extension lines, dimension line, ticks or arrows and
 * the text placement. Sizes come from the dimension style multiplied by its scale (DIMSCALE), so a
 * 2,5 mm text at 1:50 is 125 mm in a millimetre drawing.
 */
import type { P } from './path';

export interface DimSizes {
  /** Text height (DIMTXT × DIMSCALE). */
  text: number;
  /** Arrow or tick size (DIMASZ × DIMSCALE). */
  arrow: number;
  /** Gap between the object and the extension line (DIMEXO × DIMSCALE). */
  offset: number;
  /** Extension beyond the dimension line (DIMEXE × DIMSCALE). */
  extend: number;
  /** Gap between dimension line and text (DIMGAP × DIMSCALE). */
  gap: number;
  /** Architectural ticks instead of arrows. */
  ticks: boolean;
}

export interface DimGraphics {
  lines: Array<[P, P]>;
  /** Filled arrowheads as triangles. */
  arrows: Array<[P, P, P]>;
  text: { at: P; rotation: number; height: number; content: string };
}

const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const len = (a: P) => Math.hypot(a.x, a.y);
const dir = (angle: number): P => ({ x: Math.cos(angle), y: Math.sin(angle) });

/** Rotation that keeps text readable (never upside down), as drawings are read from below or the right. */
export function readableAngle(angle: number) {
  let a = angle % (2 * Math.PI);
  if (a < 0) a += 2 * Math.PI;
  if (a > Math.PI / 2 + 1e-9 && a <= 3 * Math.PI / 2 + 1e-9) a -= Math.PI;
  return a;
}

/** Arrowhead with its tip at `tip`, pointing along `towards` (unit), or a 45° tick across it. */
function terminator(tip: P, towards: P, s: DimSizes, g: DimGraphics) {
  if (s.ticks) {
    const d = mul({ x: towards.x + -towards.y, y: towards.y + towards.x }, s.arrow / 2 / Math.SQRT2);
    g.lines.push([sub(tip, d), add(tip, d)]);
    return;
  }
  const back = sub(tip, mul(towards, s.arrow));
  const n = mul({ x: -towards.y, y: towards.x }, s.arrow / 6);
  g.arrows.push([tip, add(back, n), sub(back, n)]);
}

/** Linear (rotation given) or aligned dimension between p1 and p2 with its line through `at`. */
export function linearDimGraphics(p1: P, p2: P, at: P, rotation: number, s: DimSizes, content: string): DimGraphics {
  const u = dir(rotation);
  const n = { x: -u.y, y: u.x };
  // Feet of the extension lines on the dimension line.
  const d1 = add(p1, mul(n, dot(sub(at, p1), n)));
  const d2 = add(p2, mul(n, dot(sub(at, p2), n)));
  const g: DimGraphics = { lines: [], arrows: [], text: { at: d1, rotation: 0, height: s.text, content } };
  for (const [p, d] of [[p1, d1], [p2, d2]] as const) {
    const v = sub(d, p);
    const l = len(v);
    if (l > 1e-12) {
      const e = mul(v, 1 / l);
      g.lines.push([add(p, mul(e, Math.min(s.offset, l))), add(d, mul(e, s.extend))]);
    }
  }
  g.lines.push([d1, d2]);
  const along = sub(d2, d1);
  const span = len(along);
  const e = span > 1e-12 ? mul(along, 1 / span) : u;
  terminator(d1, mul(e, -1), s, g);
  terminator(d2, e, s, g);
  const mid = mul(add(d1, d2), 0.5);
  const textAngle = readableAngle(Math.atan2(e.y, e.x));
  // Text sits above the dimension line (on the side its "up" points to).
  const up = { x: -Math.sin(textAngle), y: Math.cos(textAngle) };
  g.text = { at: add(mid, mul(up, s.gap)), rotation: textAngle, height: s.text, content };
  return g;
}

/** Radius dimension: from the arc out to the text, arrow on the arc. */
export function radialDimGraphics(c: P, r: number, at: P, s: DimSizes, content: string): DimGraphics {
  const v = sub(at, c);
  const l = len(v) || 1;
  const e = mul(v, 1 / l);
  const onArc = add(c, mul(e, r));
  const g: DimGraphics = { lines: [], arrows: [], text: { at, rotation: 0, height: s.text, content } };
  const outside = l > r;
  g.lines.push(outside ? [onArc, at] : [c, onArc]);
  terminator(onArc, outside ? mul(e, -1) : e, { ...s, ticks: false }, g);
  const angle = readableAngle(Math.atan2(e.y, e.x));
  const up = { x: -Math.sin(angle), y: Math.cos(angle) };
  const textAt = outside ? add(at, mul(e, s.text * content.length * 0.3)) : add(c, mul(e, r / 2));
  g.text = { at: add(textAt, mul(up, s.gap)), rotation: angle, height: s.text, content };
  return g;
}

/** Diameter dimension across the circle through the text side. */
export function diameterDimGraphics(c: P, r: number, at: P, s: DimSizes, content: string): DimGraphics {
  const v = sub(at, c);
  const e = mul(v, 1 / (len(v) || 1));
  const a = add(c, mul(e, r)), b = sub(c, mul(e, r));
  const g: DimGraphics = { lines: [[b, a]], arrows: [], text: { at, rotation: 0, height: s.text, content } };
  terminator(a, e, { ...s, ticks: false }, g);
  terminator(b, mul(e, -1), { ...s, ticks: false }, g);
  if (len(v) > r) g.lines.push([a, at]);
  const angle = readableAngle(Math.atan2(e.y, e.x));
  const up = { x: -Math.sin(angle), y: Math.cos(angle) };
  const textAt = len(v) > r ? add(at, mul(e, s.text * content.length * 0.3)) : c;
  g.text = { at: add(textAt, mul(up, s.gap)), rotation: angle, height: s.text, content };
  return g;
}

/** Angular dimension between directions from `corner` through p1 and p2, its arc through `at`. */
export function angularDimGraphics(corner: P, p1: P, p2: P, at: P, s: DimSizes, content: string, segments = 24): DimGraphics {
  const r = len(sub(at, corner)) || 1;
  let a1 = Math.atan2(p1.y - corner.y, p1.x - corner.x);
  let a2 = Math.atan2(p2.y - corner.y, p2.x - corner.x);
  const t = Math.atan2(at.y - corner.y, at.x - corner.x);
  // Sweep from a1 to a2 counter-clockwise; flip when the text point is on the other side.
  const ccw = (from: number, to: number) => { let d = (to - from) % (2 * Math.PI); if (d < 0) d += 2 * Math.PI; return d; };
  if (ccw(a1, t) > ccw(a1, a2)) [a1, a2] = [a2, a1];
  const sweep = ccw(a1, a2);
  const g: DimGraphics = { lines: [], arrows: [], text: { at, rotation: 0, height: s.text, content } };
  let prev = add(corner, mul(dir(a1), r));
  for (let i = 1; i <= segments; i++) {
    const next = add(corner, mul(dir(a1 + (sweep * i) / segments), r));
    g.lines.push([prev, next]);
    prev = next;
  }
  for (const [p, a] of [[p1, a1], [p2, a2]] as const) {
    const lp = len(sub(p, corner));
    if (lp < r) g.lines.push([add(corner, mul(dir(a), lp + s.offset)), add(corner, mul(dir(a), r + s.extend))]);
  }
  const startTip = add(corner, mul(dir(a1), r));
  const endTip = add(corner, mul(dir(a1 + sweep), r));
  terminator(startTip, { x: Math.sin(a1), y: -Math.cos(a1) }, { ...s, ticks: false }, g);
  terminator(endTip, { x: -Math.sin(a1 + sweep), y: Math.cos(a1 + sweep) }, { ...s, ticks: false }, g);
  const mid = a1 + sweep / 2;
  const angle = readableAngle(mid - Math.PI / 2);
  g.text = { at: add(corner, mul(dir(mid), r + s.gap)), rotation: angle, height: s.text, content };
  return g;
}
