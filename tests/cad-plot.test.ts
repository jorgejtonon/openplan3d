import { describe, expect, it } from 'vitest';
import {
  PLOT_SCALES, PT_PER_MM, RENDERER_PADDING, blackenContent, boxCenter, chooseCadScale, isUsableBox, mmPerDrawingUnit,
  paperMmPerUnit, plotFileName, plotInsunits, scaledWindow, type PlotOptions,
} from '../cad/src/plotMath';
import { emptyTitleBlock, sheetLayout } from '$lib/utils/sheetFrame';

/** The PDF renderer's own fit (pdf-renderer fitToPage with a fixed paper and no margin). */
function rendererScale(window: { min: { x: number; y: number }; max: { x: number; y: number } }, paper: { width: number; height: number }) {
  const pageW = paper.width * PT_PER_MM, pageH = paper.height * PT_PER_MM;
  const usableW = pageW - 2 * pageW * RENDERER_PADDING, usableH = pageH - 2 * pageH * RENDERER_PADDING;
  return Math.min(usableW / (window.max.x - window.min.x), usableH / (window.max.y - window.min.y));
}

const options = (patch: Partial<PlotOptions> = {}): PlotOptions => ({
  format: 'A3', orientation: 'landscape', scale: 'auto', units: 'auto', area: 'extents', mono: true, lineweights: true,
  titleBlock: emptyTitleBlock(), ...patch,
});

describe('CAD plot scale', () => {
  it('reads AutoCAD drawing units', () => {
    expect(mmPerDrawingUnit(4)).toBe(1);
    expect(mmPerDrawingUnit(5)).toBe(10);
    expect(mmPerDrawingUnit(6)).toBe(1000);
    expect(mmPerDrawingUnit(0)).toBe(1); // unitless files read as millimetres
    expect(paperMmPerUnit(6, 100)).toBe(10); // 1 m at 1:100 = 10 mm
    expect(plotInsunits(0, 'm')).toBe(6);
    expect(plotInsunits(5, 'auto')).toBe(5);
  });

  it('maps the drawing window onto the sheet at exactly 1:scale', () => {
    const area = sheetLayout('A3', 'landscape').drawing;
    for (const [insunits, scale] of [[4, 100], [6, 50], [5, 200], [6, 1000]] as const) {
      const window = scaledWindow({ x: 1234.5, y: -987 }, area, insunits, scale);
      // points per drawing unit the renderer will use, back to millimetres per unit
      const mmPerUnitOnPaper = rendererScale(window, area) / PT_PER_MM;
      expect(mmPerUnitOnPaper).toBeCloseTo(paperMmPerUnit(insunits, scale), 9);
      expect(boxCenter(window).x).toBeCloseTo(1234.5, 6);
    }
  });

  it('picks the largest standard scale that fits, including network and site scales', () => {
    const area = sheetLayout('A3', 'landscape').drawing;
    const house = { min: { x: 0, y: 0 }, max: { x: 10000, y: 8000 } }; // 10 × 8 m in mm
    expect(chooseCadScale(house, area, 4)).toBe(50);
    const network = { min: { x: 0, y: 0 }, max: { x: 1800, y: 900 } }; // 1.8 km of sewer in metres
    const scale = chooseCadScale(network, area, 6)!;
    expect(PLOT_SCALES).toContain(scale);
    expect(scale).toBeGreaterThanOrEqual(5000);
    expect(chooseCadScale({ min: { x: 0, y: 0 }, max: { x: 1e9, y: 1e9 } }, area, 6)).toBeNull();
  });

  it('rejects header extents left at their defaults', () => {
    expect(isUsableBox({ min: { x: 1e20, y: 1e20 }, max: { x: -1e20, y: -1e20 } })).toBe(false);
    expect(isUsableBox({ min: { x: -1e20, y: -1e20 }, max: { x: 1e20, y: 1e20 } })).toBe(false);
    expect(isUsableBox({ min: { x: 0, y: 0 }, max: { x: 1, y: 1 } })).toBe(true);
  });
});

describe('monochrome plot', () => {
  it('turns stroke and fill colours black and leaves geometry and text alone', () => {
    const content = 'q\n0.5 0.25 1 RG 0.35 w 1 J\n1 0 0 rg\n10 20 30 40 re f\n.2 .4 .6 RG\nBT (1 0 0 rg) Tj ET\nQ';
    const black = blackenContent(content);
    expect(black).toContain('0 0 0 RG 0.35 w');
    expect(black).toContain('\n0 0 0 rg\n');
    expect(black).toContain('10 20 30 40 re f');
    expect(black).toContain('\n0 0 0 RG\n');
    expect(black).toContain('(1 0 0 rg) Tj');
  });
});

describe('plot file name', () => {
  it('names the file after the work, sheet and scale without accents', () => {
    const tb = { ...emptyTitleBlock(), work: 'Ampliação SES — Bacia 8.1' };
    expect(plotFileName('rede.dwg', options({ titleBlock: tb, format: 'A1' }), 1000)).toBe('Ampliacao SES - Bacia 8.1 - A1 - 1-1000.pdf');
    expect(plotFileName('Planta Térreo.dxf', options(), null)).toBe('Planta Terreo - A3.pdf');
  });
});
