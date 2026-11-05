import { describe, expect, it } from 'vitest';
import {
  CornerError, TAU, applyAffine, arcThrough, breakPath, bulgeSeg, chamferLines, dist, extendPath, extensionOf,
  filletLines, intersectSegs, joinPaths, mirrorAffine, pathClosest, pathEnd, pathFromVertices, pathLength,
  pathParamOfPoint, pathStart, polarArrayAngles, rectArrayOffsets, rotateAffine, scaleAffine, segEnd, segLength,
  segStart, trimPath, verticesFromPath, type P, type Path, type Seg,
} from '../cad/src/geom/path';

const line = (ax: number, ay: number, bx: number, by: number): Seg => ({ kind: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } });
const path = (...segs: Seg[]): Path => ({ segs, closed: false });
const circle = (cx: number, cy: number, r: number): Path => ({ closed: true, segs: [{ kind: 'arc', c: { x: cx, y: cy }, r, a0: 0, sweep: TAU }] });
const close = (a: P, b: P, digits = 9) => { expect(a.x).toBeCloseTo(b.x, digits); expect(a.y).toBeCloseTo(b.y, digits); };

/** Cuts of a path against other segments, as the trim command computes them. */
function cutsOf(p: Path, others: Seg[]) {
  const cuts: number[] = [];
  for (const seg of p.segs) for (const o of others) for (const x of intersectSegs(seg, o)) {
    const u = pathParamOfPoint(p, x, 1e-7);
    if (u !== null) cuts.push(u);
  }
  return cuts;
}

describe('intersections', () => {
  it('finds line, circle and arc crossings, bounded or extended', () => {
    expect(intersectSegs(line(0, 0, 10, 0), line(5, -5, 5, 5))).toHaveLength(1);
    expect(intersectSegs(line(0, 0, 4, 0), line(5, -5, 5, 5))).toHaveLength(0);
    expect(intersectSegs(line(0, 0, 4, 0), line(5, -5, 5, 5), true)).toHaveLength(1);
    const c = circle(0, 0, 5).segs[0];
    const hits = intersectSegs(line(-10, 3, 10, 3), c);
    expect(hits).toHaveLength(2);
    hits.forEach(h => expect(Math.hypot(h.x, h.y)).toBeCloseTo(5, 9));
    // Upper half arc only meets the line y = -3 when extended to its circle.
    const upper: Seg = { kind: 'arc', c: { x: 0, y: 0 }, r: 5, a0: 0, sweep: Math.PI };
    expect(intersectSegs(line(-10, -3, 10, -3), upper)).toHaveLength(0);
    expect(intersectSegs(line(-10, -3, 10, -3), upper, false, true)).toHaveLength(2);
  });
});

describe('trim', () => {
  it('cuts the picked span of a line between two crossing walls', () => {
    const p = path(line(0, 0, 10, 0));
    const cuts = cutsOf(p, [line(3, -1, 3, 1), line(7, -1, 7, 1)]);
    const pieces = trimPath(p, cuts, pathClosest(p, { x: 5, y: 0.1 }).u)!;
    expect(pieces).toHaveLength(2);
    close(pathEnd(pieces[0]), { x: 3, y: 0 });
    close(pathStart(pieces[1]), { x: 7, y: 0 });
  });

  it('cuts a line end beyond the last edge', () => {
    const p = path(line(0, 0, 10, 0));
    const pieces = trimPath(p, cutsOf(p, [line(3, -1, 3, 1)]), pathClosest(p, { x: 9, y: 0 }).u)!;
    expect(pieces).toHaveLength(1);
    close(pathStart(pieces[0]), { x: 0, y: 0 });
    close(pathEnd(pieces[0]), { x: 3, y: 0 });
  });

  it('refuses when nothing crosses', () => {
    const p = path(line(0, 0, 10, 0));
    expect(trimPath(p, [], 0.5)).toBeNull();
  });

  it('opens a circle cut by a line, removing the picked side', () => {
    const p = circle(0, 0, 5);
    const cuts = cutsOf(p, [line(-10, 0, 10, 0)]);
    const pieces = trimPath(p, cuts, pathClosest(p, { x: 0, y: -5 }).u)!;
    expect(pieces).toHaveLength(1);
    expect(pathLength(pieces[0])).toBeCloseTo(Math.PI * 5, 9); // upper half left
    expect(pieces[0].segs[0].kind).toBe('arc');
    const mid = pathClosest(pieces[0], { x: 0, y: 5 });
    expect(mid.d).toBeCloseTo(0, 9);
  });

  it('trims a polyline with an arc segment', () => {
    // 0,0 → 10,0 then a half circle bulge back to 10,10
    const p = pathFromVertices([{ x: 0, y: 0, bulge: 0 }, { x: 10, y: 0, bulge: 1 }, { x: 10, y: 10, bulge: 0 }], false);
    expect(pathLength(p)).toBeCloseTo(10 + Math.PI * 5, 9);
    const cuts = cutsOf(p, [line(5, -1, 5, 1)]);
    const pieces = trimPath(p, cuts, pathClosest(p, { x: 1, y: 0 }).u)!;
    expect(pieces).toHaveLength(1);
    close(pathStart(pieces[0]), { x: 5, y: 0 });
    expect(pathLength(pieces[0])).toBeCloseTo(5 + Math.PI * 5, 9);
  });
});

describe('extend', () => {
  it('extends a line end up to the next boundary', () => {
    const p = path(line(0, 0, 4, 0));
    const ext = extensionOf(p, true, 100);
    const hits = [line(9, -1, 9, 1), line(60, -1, 60, 1), line(6, -1, 6, 1), line(-3, -1, -3, 1)].flatMap(b => intersectSegs(ext, b, false, false));
    const out = extendPath(p, true, hits, 100)!;
    close(pathEnd(out), { x: 6, y: 0 });
    close(pathStart(out), { x: 0, y: 0 });
  });

  it('extends the start of a line backwards', () => {
    const p = path(line(0, 0, 4, 0));
    const ext = extensionOf(p, false);
    const hits = [line(-3, -1, -3, 1)].flatMap(b => intersectSegs(ext, b, true, false));
    close(pathStart(extendPath(p, false, hits)!), { x: -3, y: 0 });
  });

  it('extends an arc along its circle', () => {
    const p = path({ kind: 'arc', c: { x: 0, y: 0 }, r: 5, a0: 0, sweep: Math.PI / 4 });
    const ext = extensionOf(p, true);
    const hits = intersectSegs(ext, line(0, 0, 0, 10), false, false);
    const out = extendPath(p, true, hits)!;
    close(pathEnd(out), { x: 0, y: 5 });
  });

  it('reports when nothing lies ahead', () => {
    const p = path(line(0, 0, 4, 0));
    expect(extendPath(p, true, [])).toBeNull();
  });
});

describe('fillet and chamfer', () => {
  const wallA = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  const wallB = { a: { x: 12, y: 2 }, b: { x: 12, y: 10 } };

  it('closes a corner with radius zero', () => {
    const r = filletLines(wallA, { x: 2, y: 0 }, wallB, { x: 12, y: 8 }, 0);
    close(r.line1!.b, { x: 12, y: 0 });
    close(r.line2!.b, { x: 12, y: 0 });
    close(r.line1!.a, { x: 0, y: 0 });
    close(r.line2!.a, { x: 12, y: 10 });
    expect(r.joint).toBeNull();
  });

  it('rounds a right-angle corner with a tangent arc', () => {
    const r = filletLines(wallA, { x: 2, y: 0 }, wallB, { x: 12, y: 8 }, 2);
    close(r.line1!.b, { x: 10, y: 0 });
    close(r.line2!.b, { x: 12, y: 2 });
    const arc = r.joint as Extract<Seg, { kind: 'arc' }>;
    expect(arc.kind).toBe('arc');
    close(arc.c, { x: 10, y: 2 });
    expect(arc.r).toBe(2);
    expect(Math.abs(arc.sweep)).toBeCloseTo(Math.PI / 2, 12);
    close(segStart(arc), { x: 10, y: 0 });
    close(segEnd(arc), { x: 12, y: 2 });
  });

  it('keeps the picked sides of crossing lines', () => {
    const h = { a: { x: -5, y: 0 }, b: { x: 5, y: 0 } };
    const v = { a: { x: 0, y: -5 }, b: { x: 0, y: 5 } };
    const r = filletLines(h, { x: -4, y: 0 }, v, { x: 0, y: 4 }, 0);
    close(r.line1!.a, { x: -5, y: 0 });
    close(r.line2!.a, { x: 0, y: 5 });
  });

  it('refuses parallel lines and radii that do not fit', () => {
    expect(() => filletLines(wallA, { x: 1, y: 0 }, { a: { x: 0, y: 3 }, b: { x: 10, y: 3 } }, { x: 1, y: 3 }, 1)).toThrow(CornerError);
    expect(() => filletLines(wallA, { x: 2, y: 0 }, wallB, { x: 12, y: 8 }, 50)).toThrow(CornerError);
  });

  it('chamfers at the given distances', () => {
    const r = chamferLines(wallA, { x: 2, y: 0 }, wallB, { x: 12, y: 8 }, 3, 1);
    close(r.line1!.b, { x: 9, y: 0 });
    close(r.line2!.b, { x: 12, y: 1 });
    expect(segLength(r.joint!)).toBeCloseTo(Math.hypot(3, 1), 12);
  });
});

describe('break and join', () => {
  it('breaks a line between two points and at one point', () => {
    const p = path(line(0, 0, 10, 0));
    const two = breakPath(p, 0.2, 0.6);
    expect(two).toHaveLength(2);
    close(pathEnd(two[0]), { x: 2, y: 0 });
    close(pathStart(two[1]), { x: 6, y: 0 });
    const one = breakPath(p, 0.5, 0.5);
    expect(one).toHaveLength(2);
    close(pathEnd(one[0]), pathStart(one[1]));
  });

  it('joins touching lines and arcs into one path, closing loops', () => {
    const joined = joinPaths([path(line(0, 0, 10, 0)), path(line(10, 10, 10, 0)), path(line(0, 10, 10, 10)), path(line(0, 0, 0, 10))], 1e-6);
    expect(joined).toHaveLength(1);
    expect(joined[0].closed).toBe(true);
    expect(pathLength(joined[0])).toBeCloseTo(40, 9);
    const apart = joinPaths([path(line(0, 0, 1, 0)), path(line(5, 0, 6, 0))], 1e-6);
    expect(apart).toHaveLength(2);
  });
});

describe('polylines and arcs', () => {
  it('round-trips bulges through paths', () => {
    const vertices = [{ x: 0, y: 0, bulge: 0.5 }, { x: 10, y: 0, bulge: -0.25 }, { x: 10, y: 10, bulge: 0 }];
    const p = pathFromVertices(vertices, false);
    const back = verticesFromPath(p);
    expect(back).toHaveLength(3);
    back.forEach((v, i) => { expect(v.x).toBeCloseTo(vertices[i].x, 9); expect(v.y).toBeCloseTo(vertices[i].y, 9); expect(v.bulge).toBeCloseTo(vertices[i].bulge, 9); });
  });

  it('builds a semicircle from a bulge of 1', () => {
    const s = bulgeSeg({ x: 0, y: 0 }, { x: 10, y: 0 }, 1) as Extract<Seg, { kind: 'arc' }>;
    expect(s.r).toBeCloseTo(5, 12);
    close(s.c, { x: 5, y: 0 });
    close(segEnd(s), { x: 10, y: 0 });
    // Positive bulge turns counter-clockwise: from (0,0) to (10,0) the arc passes below.
    expect(pathClosest(path(s), { x: 5, y: -5 }).d).toBeCloseTo(0, 9);
  });

  it('finds the arc through three points in either direction', () => {
    const ccw = arcThrough({ x: 5, y: 0 }, { x: 0, y: 5 }, { x: -5, y: 0 })!;
    expect(ccw.kind === 'arc' && ccw.sweep).toBeCloseTo(Math.PI, 12);
    const cw = arcThrough({ x: -5, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 0 })!;
    expect(cw.kind === 'arc' && cw.sweep).toBeCloseTo(-Math.PI, 12);
    expect(arcThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe('transforms and arrays', () => {
  it('mirrors, scales and rotates about a base point', () => {
    close(applyAffine(mirrorAffine({ x: 0, y: 0 }, { x: 0, y: 1 }), { x: 3, y: 2 }), { x: -3, y: 2 });
    close(applyAffine(mirrorAffine({ x: 0, y: 1 }, { x: 1, y: 2 }), { x: 1, y: 0 }), { x: -1, y: 2 });
    close(applyAffine(scaleAffine({ x: 1, y: 1 }, 2), { x: 3, y: 1 }), { x: 5, y: 1 });
    close(applyAffine(rotateAffine({ x: 1, y: 0 }, Math.PI / 2), { x: 2, y: 0 }), { x: 1, y: 1 });
  });

  it('lays out rectangular and polar arrays', () => {
    const offsets = rectArrayOffsets(2, 3, 5, 4);
    expect(offsets).toHaveLength(5);
    expect(offsets).toContainEqual({ x: 8, y: 5 });
    expect(polarArrayAngles(4)).toEqual([Math.PI / 2, Math.PI, 3 * Math.PI / 2]);
    expect(polarArrayAngles(3, Math.PI)).toEqual([Math.PI / 2, Math.PI]);
  });

  it('measures distances', () => { expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5); });
});
