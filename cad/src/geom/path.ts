/**
 * Plane geometry for the drawing editor: lines and circular arcs chained into paths (the shape of
 * lines, arcs, circles and lightweight polylines). Pure functions, in drawing units, with no
 * dependency on the CAD libraries so they can be tested alone.
 *
 * Arc segments carry a signed sweep: positive runs counter-clockwise from `a0`, negative clockwise,
 * which is how a polyline bulge reads. A full circle is a closed path with one arc of sweep 2π.
 */

export interface P { x: number; y: number }

export type Seg =
  | { kind: 'line'; a: P; b: P }
  | { kind: 'arc'; c: P; r: number; a0: number; sweep: number };

export interface Path { segs: Seg[]; closed: boolean }

/** Polyline vertex: the bulge describes the segment that starts at this vertex. */
export interface Vertex { x: number; y: number; bulge: number }

export const TAU = Math.PI * 2;
/** Length tolerance, relative to the size of the geometry at hand. */
export const EPS = 1e-9;

const sub = (a: P, b: P): P => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: P, k: number): P => ({ x: a.x * k, y: a.y * k });
const dot = (a: P, b: P) => a.x * b.x + a.y * b.y;
const cross = (a: P, b: P) => a.x * b.y - a.y * b.x;
export const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: P): P => { const l = Math.hypot(a.x, a.y); return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; };
const polar = (c: P, r: number, angle: number): P => ({ x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) });

/** Angle in [0, 2π). */
export function normAngle(angle: number) {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}

function scaleOf(...points: P[]) {
  let s = 1;
  for (const p of points) s = Math.max(s, Math.abs(p.x), Math.abs(p.y));
  return s;
}

// ---------------------------------------------------------------- segments

export function segStart(seg: Seg): P {
  return seg.kind === 'line' ? seg.a : polar(seg.c, seg.r, seg.a0);
}

export function segEnd(seg: Seg): P {
  return seg.kind === 'line' ? seg.b : polar(seg.c, seg.r, seg.a0 + seg.sweep);
}

export function segPointAt(seg: Seg, t: number): P {
  if (seg.kind === 'line') return add(seg.a, mul(sub(seg.b, seg.a), t));
  return polar(seg.c, seg.r, seg.a0 + seg.sweep * t);
}

export function segLength(seg: Seg) {
  return seg.kind === 'line' ? dist(seg.a, seg.b) : Math.abs(seg.sweep) * seg.r;
}

/** Unit tangent in the direction of travel at parameter t. */
export function segTangent(seg: Seg, t: number): P {
  if (seg.kind === 'line') return unit(sub(seg.b, seg.a));
  const a = seg.a0 + seg.sweep * t;
  const s = Math.sign(seg.sweep) || 1;
  return { x: -Math.sin(a) * s, y: Math.cos(a) * s };
}

/**
 * Parameter of the point on the segment's carrier (infinite line or full circle) closest to p.
 * Lines give any real number; arcs give the angular position measured from a0 in the direction of
 * travel, in units of the sweep, wrapped to [0, 2π/|sweep|).
 */
export function segParamOf(seg: Seg, p: P): number {
  if (seg.kind === 'line') {
    const d = sub(seg.b, seg.a);
    const l2 = dot(d, d);
    return l2 > 0 ? dot(sub(p, seg.a), d) / l2 : 0;
  }
  const angle = Math.atan2(p.y - seg.c.y, p.x - seg.c.x);
  const travelled = seg.sweep >= 0 ? normAngle(angle - seg.a0) : normAngle(seg.a0 - angle);
  return travelled / Math.abs(seg.sweep);
}

/** Closest parameter clamped to the segment, and the distance to it. */
export function segClosest(seg: Seg, p: P): { t: number; d: number } {
  let t = segParamOf(seg, p);
  if (seg.kind === 'arc') {
    if (t > 1) {
      // Past the end: pick the nearer end point.
      const toEnd = (t - 1) * Math.abs(seg.sweep);
      const toStart = TAU - t * Math.abs(seg.sweep);
      t = toEnd <= toStart ? 1 : 0;
    }
  } else t = Math.min(1, Math.max(0, t));
  return { t, d: dist(segPointAt(seg, t), p) };
}

export function reverseSeg(seg: Seg): Seg {
  if (seg.kind === 'line') return { kind: 'line', a: seg.b, b: seg.a };
  return { kind: 'arc', c: seg.c, r: seg.r, a0: seg.a0 + seg.sweep, sweep: -seg.sweep };
}

/** Piece of a segment between parameters t0 < t1 (both in the segment's own parameter space). */
export function segPiece(seg: Seg, t0: number, t1: number): Seg {
  if (seg.kind === 'line') return { kind: 'line', a: segPointAt(seg, t0), b: segPointAt(seg, t1) };
  return { kind: 'arc', c: seg.c, r: seg.r, a0: seg.a0 + seg.sweep * t0, sweep: seg.sweep * (t1 - t0) };
}

// ---------------------------------------------------------------- intersections

function lineLine(a1: P, b1: P, a2: P, b2: P): P[] {
  const d1 = sub(b1, a1), d2 = sub(b2, a2);
  const den = cross(d1, d2);
  const scale = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y);
  if (scale === 0 || Math.abs(den) <= 1e-12 * scale) return [];
  const t = cross(sub(a2, a1), d2) / den;
  return [add(a1, mul(d1, t))];
}

function lineCircle(a: P, b: P, c: P, r: number): P[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  if (A === 0) return [];
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  let disc = B * B - 4 * A * C;
  const tol = 1e-10 * Math.max(B * B, Math.abs(4 * A * C), 1e-300);
  if (disc < -tol) return [];
  if (disc < 0) disc = 0;
  const s = Math.sqrt(disc);
  const ts = s === 0 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
  return ts.map(t => add(a, mul(d, t)));
}

function circleCircle(c1: P, r1: number, c2: P, r2: number): P[] {
  const d = dist(c1, c2);
  if (d === 0) return [];
  const tol = 1e-10 * scaleOf(c1, c2, { x: r1, y: r2 });
  if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const u = mul(sub(c2, c1), 1 / d);
  const m = add(c1, mul(u, a));
  if (h === 0) return [m];
  const n = { x: -u.y * h, y: u.x * h };
  return [add(m, n), sub(m, n)];
}

/** Is the point (known to lie on the carrier) within the bounded segment? */
export function onSeg(seg: Seg, p: P, tol = 1e-9): boolean {
  const t = segParamOf(seg, p);
  const len = Math.max(segLength(seg), EPS);
  const slack = tol * scaleOf(p) / len;
  if (seg.kind === 'line') return t >= -slack && t <= 1 + slack;
  const wrap = TAU / Math.abs(seg.sweep);
  return t <= 1 + slack || t >= wrap - slack;
}

/** Intersection points of two segments. With extend, a line is taken as infinite and an arc as its
 * full circle. */
export function intersectSegs(s1: Seg, s2: Seg, extend1 = false, extend2 = false): P[] {
  let points: P[];
  if (s1.kind === 'line' && s2.kind === 'line') points = lineLine(s1.a, s1.b, s2.a, s2.b);
  else if (s1.kind === 'line' && s2.kind === 'arc') points = lineCircle(s1.a, s1.b, s2.c, s2.r);
  else if (s1.kind === 'arc' && s2.kind === 'line') points = lineCircle(s2.a, s2.b, s1.c, s1.r);
  else if (s1.kind === 'arc' && s2.kind === 'arc') points = circleCircle(s1.c, s1.r, s2.c, s2.r);
  else points = [];
  return points.filter(p => (extend1 || onSeg(s1, p)) && (extend2 || onSeg(s2, p)));
}

// ---------------------------------------------------------------- paths

export function pathLength(path: Path) {
  return path.segs.reduce((sum, seg) => sum + segLength(seg), 0);
}

export function pathStart(path: Path): P { return segStart(path.segs[0]); }
export function pathEnd(path: Path): P { return segEnd(path.segs[path.segs.length - 1]); }

export function reversePath(path: Path): Path {
  return { closed: path.closed, segs: path.segs.slice().reverse().map(reverseSeg) };
}

/** Path parameter: segment index plus the parameter inside it, in [0, n]. */
export function pathPointAt(path: Path, u: number): P {
  const n = path.segs.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor(u)));
  return segPointAt(path.segs[i], u - i);
}

/** Closest path parameter to p, and the distance. */
export function pathClosest(path: Path, p: P): { u: number; d: number } {
  let best = { u: 0, d: Infinity };
  path.segs.forEach((seg, i) => {
    const { t, d } = segClosest(seg, p);
    if (d < best.d) best = { u: i + t, d };
  });
  return best;
}

/** Path parameter of a point that lies on the path (an intersection), or null if it does not. */
export function pathParamOfPoint(path: Path, p: P, tol: number): number | null {
  const { u, d } = pathClosest(path, p);
  return d <= tol ? u : null;
}

/** Sub-path between path parameters from < to (for closed paths to may exceed n to wrap). */
export function subPath(path: Path, from: number, to: number): Path {
  const n = path.segs.length;
  const segs: Seg[] = [];
  let u = from;
  while (u < to - 1e-12) {
    const k = Math.floor(u + 1e-12);
    const i = ((k % n) + n) % n;
    const t0 = u - k;
    const t1 = Math.min(1, to - k);
    if (t1 - t0 > 1e-12) segs.push(segPiece(path.segs[i], t0, t1));
    u = k + 1;
  }
  return { closed: false, segs: dropTiny(segs) };
}

function dropTiny(segs: Seg[]) {
  const scale = segs.reduce((s, seg) => Math.max(s, scaleOf(segStart(seg), segEnd(seg))), 1);
  return segs.filter(seg => segLength(seg) > 1e-9 * scale);
}

// ---------------------------------------------------------------- trim / break

/**
 * Removes the part of the path between the cuts that surround the picked parameter.
 * Returns the pieces left (zero, one or two), or null when there is nothing to cut
 * (an open path with no cut inside it, or a closed one with fewer than two cuts).
 */
export function trimPath(path: Path, cuts: number[], pick: number): Path[] | null {
  const n = path.segs.length;
  const tol = 1e-9;
  if (!path.closed) {
    const inside = cuts.filter(c => c > tol && c < n - tol);
    const lo = Math.max(-Infinity, ...inside.filter(c => c < pick));
    const hi = Math.min(Infinity, ...inside.filter(c => c > pick));
    if (!Number.isFinite(lo) && !Number.isFinite(hi)) return null;
    const pieces: Path[] = [];
    if (Number.isFinite(lo)) pieces.push(subPath(path, 0, lo));
    if (Number.isFinite(hi)) pieces.push(subPath(path, hi, n));
    return pieces.filter(p => p.segs.length > 0);
  }
  const unique = uniqueSorted(cuts.map(c => ((c % n) + n) % n));
  if (unique.length < 2) return null;
  const p = ((pick % n) + n) % n;
  let hi = unique.find(c => c > p);
  let lo = [...unique].reverse().find(c => c < p);
  if (hi === undefined) hi = unique[0] + n;
  if (lo === undefined) lo = unique[unique.length - 1] - n;
  // Keep from hi forward round to lo.
  const kept = subPath(path, hi, lo + n);
  return kept.segs.length ? [kept] : [];
}

/** Breaks the path between two of its parameters (break at one point when they are equal). */
export function breakPath(path: Path, u1: number, u2: number): Path[] {
  const n = path.segs.length;
  const [a, b] = u1 <= u2 ? [u1, u2] : [u2, u1];
  if (!path.closed) {
    if (b - a < 1e-12) return [subPath(path, 0, a), subPath(path, a, n)].filter(p => p.segs.length);
    return [subPath(path, 0, a), subPath(path, b, n)].filter(p => p.segs.length);
  }
  // Closed: the part removed runs forward from the first pick to the second (AutoCAD removes the
  // counter-clockwise part of circles from the first point to the second).
  const kept = subPath(path, u2, u1 + (u1 <= u2 ? n : 0));
  return kept.segs.length ? [kept] : [];
}

function uniqueSorted(values: number[]) {
  const sorted = [...values].sort((x, y) => x - y);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > 1e-9) out.push(v);
  return out;
}

// ---------------------------------------------------------------- extend

/** Segment carrying the extension of an open path's end: a ray `reach` long, or the rest of the
 * circle. Pass a reach of the drawing's size so far boundaries are found. */
export function extensionOf(path: Path, atEnd: boolean, reach?: number): Seg {
  const seg = atEnd ? path.segs[path.segs.length - 1] : reverseSeg(path.segs[0]);
  const end = segEnd(seg);
  if (seg.kind === 'line') {
    const dir = unit(sub(seg.b, seg.a));
    const len = reach ?? Math.max(segLength(seg), 1) * 1000;
    return { kind: 'line', a: end, b: add(end, mul(dir, len)) };
  }
  const s = Math.sign(seg.sweep) || 1;
  return { kind: 'arc', c: seg.c, r: seg.r, a0: seg.a0 + seg.sweep, sweep: s * (TAU - Math.abs(seg.sweep)) };
}

/**
 * Extends the end of an open path nearest to `pick` up to the nearest of the boundary points,
 * which are intersections already computed against the extension (see extensionOf).
 * Returns null when no boundary lies ahead.
 */
export function extendPath(path: Path, atEnd: boolean, hits: P[], reach?: number): Path | null {
  const ext = extensionOf(path, atEnd, reach);
  const end = segStart(ext);
  const scale = scaleOf(end);
  let best: { t: number; p: P } | null = null;
  for (const h of hits) {
    let t = segParamOf(ext, h);
    if (ext.kind === 'arc') { if (t > 1 + 1e-9) continue; }
    if (t <= 1e-9 * scale / Math.max(segLength(ext), EPS)) continue;
    if (ext.kind === 'line' && dist(h, end) <= 1e-9 * scale) continue;
    if (!best || t < best.t) best = { t, p: h };
  }
  if (!best) return null;
  const segs = path.segs.slice();
  if (atEnd) {
    const last = segs[segs.length - 1];
    segs[segs.length - 1] = last.kind === 'line'
      ? { kind: 'line', a: last.a, b: best.p }
      : { ...last, sweep: last.sweep + (ext.kind === 'arc' ? ext.sweep * best.t : 0) };
  } else {
    const first = segs[0];
    if (first.kind === 'line') segs[0] = { kind: 'line', a: best.p, b: first.b };
    else {
      const extra = ext.kind === 'arc' ? Math.abs(ext.sweep * best.t) : 0;
      const s = Math.sign(first.sweep) || 1;
      segs[0] = { ...first, a0: first.a0 - s * extra, sweep: first.sweep + s * extra };
    }
  }
  return { closed: false, segs };
}

// ---------------------------------------------------------------- fillet / chamfer of two lines

export interface CornerResult {
  /** New geometry of the first and second lines (null when a line vanishes entirely). */
  line1: { a: P; b: P } | null;
  line2: { a: P; b: P } | null;
  /** Arc (fillet) or line (chamfer) joining them, if any. */
  joint: Seg | null;
}

export class CornerError extends Error {
  constructor(readonly reason: 'parallel' | 'too-big') { super(reason); }
}

interface Arm { keep: P; x: P; u: P; reach: number }

/** The part of a line kept on the picked side of the corner point x. */
function arm(line: { a: P; b: P }, pick: P, x: P): Arm {
  const along = sub(line.b, line.a);
  const dir = unit(along);
  // Side of x where the pick lies, measured along the line.
  const side = Math.sign(dot(sub(pick, x), dir)) || 1;
  const u = mul(dir, side);
  const ta = dot(sub(line.a, x), u), tb = dot(sub(line.b, x), u);
  const keep = ta >= tb ? line.a : line.b;
  return { keep, x, u, reach: Math.max(ta, tb) };
}

function cornerPoint(l1: { a: P; b: P }, l2: { a: P; b: P }): P {
  const [x] = lineLine(l1.a, l1.b, l2.a, l2.b);
  if (!x) throw new CornerError('parallel');
  return x;
}

/** Fillet of two lines with radius r (r = 0 joins them at their corner). */
export function filletLines(l1: { a: P; b: P }, pick1: P, l2: { a: P; b: P }, pick2: P, r: number): CornerResult {
  const x = cornerPoint(l1, l2);
  const A = arm(l1, pick1, x), B = arm(l2, pick2, x);
  if (r <= 0) return { line1: { a: A.keep, b: x }, line2: { a: B.keep, b: x }, joint: null };
  const cos = Math.max(-1, Math.min(1, dot(A.u, B.u)));
  const theta = Math.acos(cos) / 2;
  if (theta < 1e-9 || theta > Math.PI / 2 - 1e-9) throw new CornerError('parallel');
  const d = r / Math.tan(theta);
  if (d > A.reach + 1e-9 * scaleOf(x) || d > B.reach + 1e-9 * scaleOf(x)) throw new CornerError('too-big');
  const t1 = add(x, mul(A.u, d)), t2 = add(x, mul(B.u, d));
  const bis = unit(add(A.u, B.u));
  const c = add(x, mul(bis, r / Math.sin(theta)));
  const a0 = Math.atan2(t1.y - c.y, t1.x - c.x);
  const a1 = Math.atan2(t2.y - c.y, t2.x - c.x);
  let sweep = normAngle(a1 - a0);
  if (sweep > Math.PI) sweep -= TAU;
  return {
    line1: dist(A.keep, t1) > 1e-12 ? { a: A.keep, b: t1 } : null,
    line2: dist(B.keep, t2) > 1e-12 ? { a: B.keep, b: t2 } : null,
    joint: { kind: 'arc', c, r, a0, sweep },
  };
}

/** Chamfer of two lines at distances d1 and d2 from their corner. */
export function chamferLines(l1: { a: P; b: P }, pick1: P, l2: { a: P; b: P }, pick2: P, d1: number, d2: number): CornerResult {
  const x = cornerPoint(l1, l2);
  const A = arm(l1, pick1, x), B = arm(l2, pick2, x);
  if (d1 <= 0 && d2 <= 0) return { line1: { a: A.keep, b: x }, line2: { a: B.keep, b: x }, joint: null };
  const tol = 1e-9 * scaleOf(x);
  if (d1 > A.reach + tol || d2 > B.reach + tol) throw new CornerError('too-big');
  const t1 = add(x, mul(A.u, d1)), t2 = add(x, mul(B.u, d2));
  return {
    line1: dist(A.keep, t1) > 1e-12 ? { a: A.keep, b: t1 } : null,
    line2: dist(B.keep, t2) > 1e-12 ? { a: B.keep, b: t2 } : null,
    joint: { kind: 'line', a: t1, b: t2 },
  };
}

// ---------------------------------------------------------------- join

/** Chains open paths that touch end to end. Returns the joined paths (closed when a chain loops). */
export function joinPaths(paths: Path[], tol: number): Path[] {
  const pool = paths.filter(p => !p.closed && p.segs.length).map(p => ({ ...p, segs: p.segs.slice() }));
  const out: Path[] = paths.filter(p => p.closed);
  while (pool.length) {
    const chain = pool.shift()!;
    let grown = true;
    while (grown) {
      grown = false;
      for (let i = 0; i < pool.length; i++) {
        const other = pool[i];
        const end = pathEnd(chain), start = pathStart(chain);
        if (dist(end, pathStart(other)) <= tol) chain.segs.push(...other.segs);
        else if (dist(end, pathEnd(other)) <= tol) chain.segs.push(...reversePath(other).segs);
        else if (dist(start, pathEnd(other)) <= tol) chain.segs.unshift(...other.segs);
        else if (dist(start, pathStart(other)) <= tol) chain.segs.unshift(...reversePath(other).segs);
        else continue;
        pool.splice(i, 1);
        grown = true;
        break;
      }
    }
    if (chain.segs.length > 1 && dist(pathStart(chain), pathEnd(chain)) <= tol) chain.closed = true;
    out.push(chain);
  }
  return out;
}

// ---------------------------------------------------------------- polylines

/** Segment from a bulged polyline vertex to the next. */
export function bulgeSeg(a: P, b: P, bulge: number): Seg {
  if (Math.abs(bulge) < 1e-12) return { kind: 'line', a, b };
  const sweep = 4 * Math.atan(bulge);
  const chord = dist(a, b);
  const r = chord / (2 * Math.abs(Math.sin(sweep / 2)));
  // The centre lies on the chord's perpendicular bisector; of the two candidates, take the one
  // from which travelling `sweep` from a lands on b.
  const m = mul(add(a, b), 0.5);
  const n = unit({ x: -(b.y - a.y), y: b.x - a.x });
  const h = r * Math.cos(sweep / 2);
  const candidates = [add(m, mul(n, h)), sub(m, mul(n, h))];
  let best = candidates[0], bestErr = Infinity;
  for (const cc of candidates) {
    const a0 = Math.atan2(a.y - cc.y, a.x - cc.x);
    const err = dist(polar(cc, r, a0 + sweep), b);
    if (err < bestErr) { bestErr = err; best = cc; }
  }
  return { kind: 'arc', c: best, r, a0: Math.atan2(a.y - best.y, a.x - best.x), sweep };
}

export function pathFromVertices(vertices: Vertex[], closed: boolean): Path {
  const segs: Seg[] = [];
  const n = vertices.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const v = vertices[i], w = vertices[(i + 1) % n];
    if (dist(v, w) < 1e-12) continue;
    segs.push(bulgeSeg(v, w, v.bulge));
  }
  return { segs, closed: closed && segs.length > 0 };
}

/** Polyline vertices for a path (arc segments become bulges). */
export function verticesFromPath(path: Path): Vertex[] {
  const out: Vertex[] = path.segs.map(seg => {
    const s = segStart(seg);
    return { x: s.x, y: s.y, bulge: seg.kind === 'arc' ? Math.tan(seg.sweep / 4) : 0 };
  });
  if (!path.closed && path.segs.length) { const e = pathEnd(path); out.push({ x: e.x, y: e.y, bulge: 0 }); }
  return out;
}

/** Arc through three points (start, a point on it, end), or null when they are collinear. */
export function arcThrough(a: P, m: P, b: P): Seg | null {
  const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
  if (Math.abs(d) < 1e-12 * scaleOf(a, m, b) ** 2) return null;
  const a2 = a.x * a.x + a.y * a.y, m2 = m.x * m.x + m.y * m.y, b2 = b.x * b.x + b.y * b.y;
  const c = {
    x: (a2 * (m.y - b.y) + m2 * (b.y - a.y) + b2 * (a.y - m.y)) / d,
    y: (a2 * (b.x - m.x) + m2 * (a.x - b.x) + b2 * (m.x - a.x)) / d,
  };
  const r = dist(c, a);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const am = normAngle(Math.atan2(m.y - c.y, m.x - c.x) - a0);
  const ab = normAngle(Math.atan2(b.y - c.y, b.x - c.x) - a0);
  // Counter-clockwise if the middle point comes before the end going CCW.
  const sweep = am <= ab ? (ab || TAU) : -(TAU - ab);
  return { kind: 'arc', c, r, a0, sweep };
}

// ---------------------------------------------------------------- transforms (3×3, row-major, affine)

export type Affine = [number, number, number, number, number, number]; // x' = a x + b y + c ; y' = d x + e y + f

export function mirrorAffine(p1: P, p2: P): Affine {
  const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const c = Math.cos(2 * ang), s = Math.sin(2 * ang);
  // Reflection about the line through p1 with direction ang.
  return [c, s, p1.x - c * p1.x - s * p1.y, s, -c, p1.y - s * p1.x + c * p1.y];
}

export function scaleAffine(base: P, k: number): Affine {
  return [k, 0, base.x * (1 - k), 0, k, base.y * (1 - k)];
}

export function rotateAffine(base: P, angle: number): Affine {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [c, -s, base.x - c * base.x + s * base.y, s, c, base.y - s * base.x - c * base.y];
}

export function translateAffine(dx: number, dy: number): Affine {
  return [1, 0, dx, 0, 1, dy];
}

export function applyAffine(m: Affine, p: P): P {
  return { x: m[0] * p.x + m[1] * p.y + m[2], y: m[3] * p.x + m[4] * p.y + m[5] };
}

/** Rectangular array offsets (the first item is the original, not included). */
export function rectArrayOffsets(rows: number, cols: number, rowSpacing: number, colSpacing: number, angle = 0): P[] {
  const out: P[] = [];
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    if (i === 0 && j === 0) continue;
    const x = j * colSpacing, y = i * rowSpacing;
    out.push({ x: x * c - y * s, y: x * s + y * c });
  }
  return out;
}

/** Polar array rotations (excluding the original): count items over the fill angle. */
export function polarArrayAngles(count: number, fill = TAU): number[] {
  if (count < 2) return [];
  const full = Math.abs(Math.abs(fill) - TAU) < 1e-9;
  const step = full ? fill / count : fill / (count - 1);
  return Array.from({ length: count - 1 }, (_, i) => step * (i + 1));
}
