/* Plot geometry for CAD drawings: scales, units and the drawing window that maps onto the sheet
 * at exactly 1:scale. No rendering dependencies, so it is unit-tested with the main app. */

/** Millimetres per drawing unit for AutoCAD INSUNITS (0 = unitless, read as millimetres). */
const INSUNITS_MM: Readonly<Record<number, number>> = {
  0: 1, 1: 25.4, 2: 304.8, 3: 1609344, 4: 1, 5: 10, 6: 1000, 7: 1000000, 8: 0.0000254, 9: 0.0254,
  10: 914.4, 13: 0.001, 14: 100, 15: 10000, 16: 100000, 21: 304.80060960121926,
};

export function mmPerDrawingUnit(insunits: number): number {
  return Number.isFinite(insunits) ? (INSUNITS_MM[Math.trunc(insunits)] ?? 1) : 1;
}

/** Plot scales offered for CAD drawings (denominators): details to site plans and networks. */
export const PLOT_SCALES = [1, 2, 5, 10, 20, 25, 50, 75, 100, 125, 200, 250, 500, 1000, 2000, 2500, 5000, 10000] as const;

/** AutoCAD INSUNITS codes offered in the dialog. */
export const DRAWING_UNITS = { mm: 4, cm: 5, m: 6 } as const;
export type DrawingUnitChoice = 'auto' | keyof typeof DRAWING_UNITS;

export interface Box2 { min: { x: number; y: number }; max: { x: number; y: number } }

import type { SheetFormat, SheetOrientation, TitleBlockData } from '$lib/utils/sheetFrame';

export type PlotArea = 'view' | 'extents' | 'all';

export interface PlotOptions {
  format: SheetFormat;
  orientation: SheetOrientation;
  /** Denominator (100 = 1:100), 'auto' = largest standard scale that fits, 'fit' = fill the sheet (no scale). */
  scale: number | 'auto' | 'fit';
  units: DrawingUnitChoice;
  /** 'view': what is on screen; 'extents': the main drawing, without far-off stray objects;
   * 'all': every object, however far. */
  area: PlotArea;
  mono: boolean;
  lineweights: boolean;
  titleBlock: TitleBlockData;
}

/** Fraction of the page the PDF renderer keeps free on each side (PDF_PAGE_PADDING_FRACTION). */
export const RENDERER_PADDING = 0.02;
export const PT_PER_MM = 72 / 25.4;

export function isUsableBox(box: Box2 | null | undefined): box is Box2 {
  if (!box) return false;
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  return [box.min.x, box.min.y, box.max.x, box.max.y].every(Number.isFinite) && w > 0 && h > 0 && w < 1e12 && h < 1e12;
}

/** INSUNITS used for the plot: the drawing's own, or the one chosen in the dialog. */
export function plotInsunits(dbInsunits: number, choice: DrawingUnitChoice): number {
  return choice === 'auto' ? dbInsunits : DRAWING_UNITS[choice];
}

/** Millimetres on paper per drawing unit at 1:scale. */
export function paperMmPerUnit(insunits: number, scale: number): number {
  return mmPerDrawingUnit(insunits) / scale;
}

/** Largest standard scale (smallest denominator) at which `box` fits the drawing area. */
export function chooseCadScale(box: Box2, area: { width: number; height: number }, insunits: number): number | null {
  const w = box.max.x - box.min.x, h = box.max.y - box.min.y;
  for (const scale of PLOT_SCALES) {
    const k = paperMmPerUnit(insunits, scale);
    if (w * k <= area.width + 1e-9 && h * k <= area.height + 1e-9) return scale;
  }
  return null;
}

/** Drawing window (drawing units) that the renderer maps onto `area` at exactly 1:scale, centred on `center`.
 * The renderer keeps 2% of the page free on each side, so the window is sized to the usable 96%. */
export function scaledWindow(center: { x: number; y: number }, area: { width: number; height: number }, insunits: number, scale: number): Box2 {
  const k = paperMmPerUnit(insunits, scale);
  const halfW = (area.width * (1 - 2 * RENDERER_PADDING)) / k / 2;
  const halfH = (area.height * (1 - 2 * RENDERER_PADDING)) / k / 2;
  return { min: { x: center.x - halfW, y: center.y - halfH }, max: { x: center.x + halfW, y: center.y + halfH } };
}

export function boxCenter(box: Box2) {
  return { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2 };
}

const COLOR_OPERATOR = /(^|[\s\]>)])(-?(?:\d+\.?\d*|\.\d+))\s+(-?(?:\d+\.?\d*|\.\d+))\s+(-?(?:\d+\.?\d*|\.\d+))\s+(RG|rg)(?=[\s/\[<(]|$)/g;

/** Rewrites every RGB stroke and fill colour of page and form content to black, like monochrome.ctb. */
export function blackenContent(content: string): string {
  return content.replace(COLOR_OPERATOR, (_m, lead, _r, _g, _b, op) => `${lead}0 0 0 ${op}`);
}

export function plotFileName(fileName: string, options: PlotOptions, scale: number | null): string {
  const base = (options.titleBlock.work.trim() || fileName.replace(/\.(dwg|dxf)$/i, '') || 'desenho')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[‐-―]/g, '-')
    .replace(/[^A-Za-z0-9 ._()-]+/g, '-').replace(/\s+/g, ' ').replace(/-{2,}/g, '-').replace(/^[\s.-]+|[\s.-]+$/g, '').slice(0, 80) || 'desenho';
  return `${base} - ${options.format}${scale ? ` - 1-${scale}` : ''}.pdf`;
}
