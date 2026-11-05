import { describe, expect, it } from 'vitest';
import { angularDimGraphics, diameterDimGraphics, linearDimGraphics, radialDimGraphics, readableAngle, type DimSizes } from '../cad/src/geom/dimgeom';

const sizes: DimSizes = { text: 0.125, arrow: 0.1, offset: 0.05, extend: 0.0625, gap: 0.04, ticks: false };

describe('dimension graphics', () => {
  it('draws a horizontal dimension below a wall', () => {
    const g = linearDimGraphics({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2.5, y: -1 }, 0, sizes, '5,00');
    // two extension lines, the dimension line, two arrows
    expect(g.lines).toHaveLength(3);
    expect(g.arrows).toHaveLength(2);
    const [, , dimLine] = g.lines;
    expect(dimLine[0]).toEqual({ x: 0, y: -1 });
    expect(dimLine[1]).toEqual({ x: 5, y: -1 });
    // extension line starts a little off the object and passes the dimension line
    expect(g.lines[0][0].y).toBeCloseTo(-0.05, 12);
    expect(g.lines[0][1].y).toBeCloseTo(-1.0625, 12);
    expect(g.text.at.x).toBeCloseTo(2.5, 12);
    expect(g.text.at.y).toBeCloseTo(-0.96, 12); // above the line by the gap
    expect(g.text.rotation).toBe(0);
    expect(g.text.height).toBe(0.125);
  });

  it('measures a sloped edge horizontally when rotation is 0', () => {
    const g = linearDimGraphics({ x: 0, y: 0 }, { x: 4, y: 3 }, { x: 2, y: 5 }, 0, sizes, '4,00');
    const dimLine = g.lines[2];
    expect(dimLine[0]).toEqual({ x: 0, y: 5 });
    expect(dimLine[1]).toEqual({ x: 4, y: 5 });
  });

  it('keeps text readable on vertical and reversed dimensions', () => {
    expect(readableAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(readableAngle(Math.PI)).toBeCloseTo(0, 12);
    expect(readableAngle(-Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    const g = linearDimGraphics({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 2.5, y: -1 }, Math.PI, sizes, '5,00');
    expect(g.text.rotation).toBeCloseTo(0, 12);
    expect(g.text.at.y).toBeGreaterThan(-1);
  });

  it('uses ticks when the style asks for them', () => {
    const g = linearDimGraphics({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 2.5, y: -1 }, 0, { ...sizes, ticks: true }, '5,00');
    expect(g.arrows).toHaveLength(0);
    expect(g.lines).toHaveLength(5);
  });

  it('draws radius and diameter from the arc', () => {
    const r = radialDimGraphics({ x: 0, y: 0 }, 1, { x: 2, y: 0 }, sizes, 'R1,00');
    expect(r.lines[0][0]).toEqual({ x: 1, y: 0 });
    expect(r.lines[0][1]).toEqual({ x: 2, y: 0 });
    expect(r.arrows[0][0]).toEqual({ x: 1, y: 0 });
    const d = diameterDimGraphics({ x: 0, y: 0 }, 1, { x: 0, y: 0.5 }, sizes, 'Ø2,00');
    expect(d.lines[0][0].y).toBeCloseTo(-1, 12);
    expect(d.lines[0][1].y).toBeCloseTo(1, 12);
    expect(d.arrows).toHaveLength(2);
  });

  it('draws an angle arc on the side of the text point', () => {
    const g = angularDimGraphics({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 5 }, { x: 1, y: 1 }, sizes, '90°', 12);
    const r = Math.SQRT2;
    for (const [a, b] of g.lines.slice(0, 12)) {
      expect(Math.hypot(a.x, a.y)).toBeCloseTo(r, 9);
      expect(Math.hypot(b.x, b.y)).toBeCloseTo(r, 9);
      expect(a.x).toBeGreaterThanOrEqual(-1e-9);
      expect(a.y).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(g.arrows).toHaveLength(2);
  });
});
