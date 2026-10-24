import jsPDF from 'jspdf';
import type { Floor, Point, Project, Wall } from '$lib/models/types';
import { resolveRooms, getRoomPolygon, roomLabelPosition } from './roomDetection';
import { roomHoles } from './roomNesting';
import { planOpening } from './planOpening';
import { doorSymbol } from './doorSymbol';
import { wallPlanBounds } from './wallPlanGeometry';
import { furniturePlanBounds } from './furniturePlanBounds';
import { columnPlanBounds } from './columnPlanGeometry';
import { getCatalogItem, getFurnitureSize } from './furnitureCatalog';
import { drawFurnitureIcon } from './furnitureIcons';
import { drawStair } from './canvasRenderer';
import { hasPlanExportContent } from './planExportContent';
import { pdfSymbolContext, drawRotatedText, textUp, type Affine } from './pdfSymbolContext';

/* ------------------------------------------------------------------ */
/* Sheet geometry (ABNT / ISO 216)                                     */
/* ------------------------------------------------------------------ */

export type SheetFormat = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export type SheetOrientation = 'landscape' | 'portrait';
export type SheetLanguage = 'pt' | 'en';

/** ISO 216 sizes in mm, as adopted by ABNT for drawing sheets. */
export const SHEET_FORMATS: Record<SheetFormat, { long: number; short: number }> = {
  A0: { long: 1189, short: 841 },
  A1: { long: 841, short: 594 },
  A2: { long: 594, short: 420 },
  A3: { long: 420, short: 297 },
  A4: { long: 297, short: 210 },
};

/** Usual architectural plotting scales (denominators). */
export const STANDARD_SCALES = [20, 25, 50, 75, 100, 125, 200, 250, 500] as const;

export interface Rect { x: number; y: number; width: number; height: number }

export function sheetSize(format: SheetFormat, orientation: SheetOrientation) {
  const f = SHEET_FORMATS[format];
  return orientation === 'landscape' ? { width: f.long, height: f.short } : { width: f.short, height: f.long };
}

/** Binding margin of 25 mm on the left; 10 mm (A0, A1) or 7 mm (A2–A4) elsewhere. */
export function sheetMargins(format: SheetFormat) {
  const other = format === 'A0' || format === 'A1' ? 10 : 7;
  return { left: 25, right: other, top: other, bottom: other };
}

/** Title block (legenda) in the lower-right corner: 175 mm wide on A0/A1, 178 mm otherwise. */
export function titleBlockSize(format: SheetFormat) {
  return { width: format === 'A0' || format === 'A1' ? 175 : 178, height: TITLE_BLOCK_HEIGHT };
}

const TITLE_BLOCK_HEIGHT = 62;
const CAPTION_HEIGHT = 16;
const GAP = 4;

export interface SheetLayout {
  size: { width: number; height: number };
  frame: Rect;
  titleBlock: Rect;
  /** Area reserved for the plan itself. */
  drawing: Rect;
  /** Band under the drawing for its title and scale. */
  caption: Rect;
  /** Free area left of the title block (notes), when wide enough. */
  notes: Rect | null;
}

export function sheetLayout(format: SheetFormat, orientation: SheetOrientation): SheetLayout {
  const size = sheetSize(format, orientation);
  const m = sheetMargins(format);
  const frame = { x: m.left, y: m.top, width: size.width - m.left - m.right, height: size.height - m.top - m.bottom };
  const tb = titleBlockSize(format);
  const tbWidth = Math.min(tb.width, frame.width);
  const titleBlock = { x: frame.x + frame.width - tbWidth, y: frame.y + frame.height - tb.height, width: tbWidth, height: tb.height };
  const caption = { x: frame.x + GAP, y: titleBlock.y - GAP - CAPTION_HEIGHT, width: frame.width - GAP * 2, height: CAPTION_HEIGHT };
  const drawing = { x: frame.x + GAP, y: frame.y + GAP, width: frame.width - GAP * 2, height: caption.y - frame.y - GAP };
  const notesWidth = titleBlock.x - frame.x - GAP * 2;
  const notes = notesWidth >= 50 ? { x: frame.x + GAP, y: titleBlock.y, width: notesWidth, height: tb.height - GAP } : null;
  return { size, frame, titleBlock, drawing, caption, notes };
}

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export interface TitleBlockData {
  company: string;
  responsible: string;
  registry: string;
  art: string;
  client: string;
  work: string;
  address: string;
  drawingTitle: string;
  sheetNumber: string;
  revision: string;
  drawnBy: string;
  date: string;
  notes: string;
}

export function emptyTitleBlock(): TitleBlockData {
  return {
    company: '', responsible: '', registry: '', art: '', client: '', work: '', address: '',
    drawingTitle: '', sheetNumber: '', revision: '00', drawnBy: '', date: '', notes: '',
  };
}

export interface TechnicalSheetOptions {
  format: SheetFormat;
  orientation: SheetOrientation;
  /** Scale denominator (50 = 1:50) or 'auto' for the largest standard scale that fits. */
  scale: number | 'auto';
  /** Black-and-white plot (technical) instead of coloured rooms and symbols. */
  mono: boolean;
  furniture: boolean;
  roomLabels: boolean;
  /** Chain and overall dimensions along the bottom and right, including wall thicknesses. */
  chainDimensions: boolean;
  /** Dimensions and measurements drawn in the editor. */
  dimensions: boolean;
  /** Length written along each wall. */
  wallLengths: boolean;
  textNotes: boolean;
  floors: 'active' | 'all';
  /** Adds a perspective sheet with the current 3D view, when one is available. */
  include3D: boolean;
  titleBlock: TitleBlockData;
}

export function defaultSheetOptions(): TechnicalSheetOptions {
  return {
    format: 'A3', orientation: 'landscape', scale: 'auto', mono: true,
    furniture: true, roomLabels: true, chainDimensions: true, dimensions: true,
    wallLengths: false, textNotes: true, floors: 'active', include3D: false,
    titleBlock: emptyTitleBlock(),
  };
}

/* ------------------------------------------------------------------ */
/* Plan extents and scale                                              */
/* ------------------------------------------------------------------ */

interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const grow = (b: Bounds, x: number, y: number) => {
  b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
  b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
};
const growBox = (b: Bounds, o: Bounds) => { grow(b, o.minX, o.minY); grow(b, o.maxX, o.maxY); };

/** World extents (cm) of what the sheet will draw for a floor. */
export function floorExtents(floor: Floor, options: Pick<TechnicalSheetOptions, 'furniture' | 'dimensions' | 'textNotes'>): Bounds | null {
  const b: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const w of floor.walls) growBox(b, wallPlanBounds(w));
  for (const d of floor.doors) {
    const wall = floor.walls.find(w => w.id === d.wallId);
    const frame = wall && planOpening(wall, d.position, d.width);
    if (!frame) continue;
    // Exact ink of the door glyph: an inward swing must not enlarge the sheet.
    for (const part of doorSymbol(frame.wall, { ...d, position: frame.position, width: frame.width })) {
      if (part.role === 'swing') {
        for (let i = 0; i <= 16; i++) {
          const a = part.from + (part.to - part.from) * i / 16;
          grow(b, part.cx + part.r * Math.cos(a), part.cy + part.r * Math.sin(a));
        }
      } else if (part.role === 'hinge') grow(b, part.x, part.y);
      else for (const p of part.points) grow(b, p.x, p.y);
    }
  }
  if (options.furniture) for (const item of floor.furniture) growBox(b, furniturePlanBounds(item));
  for (const s of floor.stairs ?? []) {
    const r = Math.hypot(s.width, s.depth) / 2;
    grow(b, s.position.x - r, s.position.y - r); grow(b, s.position.x + r, s.position.y + r);
  }
  for (const c of floor.columns ?? []) growBox(b, columnPlanBounds(c));
  if (options.dimensions) {
    for (const a of floor.annotations ?? []) {
      const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
      if (len < 1) continue;
      const nx = -(a.y2 - a.y1) / len, ny = (a.x2 - a.x1) / len, off = a.offset ?? 40;
      grow(b, a.x1, a.y1); grow(b, a.x2, a.y2);
      grow(b, a.x1 + nx * off, a.y1 + ny * off); grow(b, a.x2 + nx * off, a.y2 + ny * off);
    }
    for (const m of floor.measurements ?? []) { grow(b, m.x1, m.y1); grow(b, m.x2, m.y2); }
  }
  if (options.textNotes) for (const t of floor.textAnnotations ?? []) if (t.text.trim()) grow(b, t.x, t.y);
  if (!Number.isFinite(b.minX)) return null;
  return b;
}

/** Paper space (mm) reserved around the plan for chain dimensions. */
export function dimensionAllowance(options: Pick<TechnicalSheetOptions, 'chainDimensions'>) {
  return options.chainDimensions ? { left: 4, top: 4, right: 22, bottom: 22 } : { left: 4, top: 4, right: 4, bottom: 4 };
}

/** Does a plan of `extent` (cm) fit the drawing area (mm) at 1:`scale`? */
export function planFits(extent: { width: number; height: number }, area: { width: number; height: number }, scale: number, allowance = { left: 0, top: 0, right: 0, bottom: 0 }) {
  const k = 10 / scale;
  return extent.width * k + allowance.left + allowance.right <= area.width + 1e-6
    && extent.height * k + allowance.top + allowance.bottom <= area.height + 1e-6;
}

/** Largest standard scale (smallest denominator) that fits, or null when even 1:500 is too big. */
export function chooseScale(extent: { width: number; height: number }, area: { width: number; height: number }, allowance = { left: 0, top: 0, right: 0, bottom: 0 }): number | null {
  for (const s of STANDARD_SCALES) if (planFits(extent, area, s, allowance)) return s;
  return null;
}

export interface SheetPlanEntry {
  floor: Floor;
  extents: Bounds;
  scale: number;
  /** False when a fixed scale was requested and the plan does not fit the sheet. */
  fits: boolean;
  /** Largest standard scale that would fit this sheet. */
  suggestedScale: number | null;
}

/** Floors that will be printed and the scale each one gets. Used by the dialog and the renderer. */
export function planSheets(project: Project, options: TechnicalSheetOptions): SheetPlanEntry[] {
  const layout = sheetLayout(options.format, options.orientation);
  const allowance = dimensionAllowance(options);
  const floors = options.floors === 'all'
    ? [...project.floors].sort((a, b) => a.level - b.level)
    : project.floors.filter(f => f.id === project.activeFloorId);
  const entries: SheetPlanEntry[] = [];
  for (const floor of floors) {
    if (!hasPlanExportContent(floor)) continue;
    const extents = floorExtents(floor, options);
    if (!extents) continue;
    const extent = { width: extents.maxX - extents.minX, height: extents.maxY - extents.minY };
    const suggestedScale = chooseScale(extent, layout.drawing, allowance);
    const scale = options.scale === 'auto' ? (suggestedScale ?? 500) : options.scale;
    entries.push({ floor, extents, scale, fits: planFits(extent, layout.drawing, scale, allowance), suggestedScale });
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/* Labels and number formatting                                        */
/* ------------------------------------------------------------------ */

const LABELS = {
  pt: {
    work: 'OBRA / PROJETO', address: 'ENDEREÇO', client: 'PROPRIETÁRIO / CLIENTE', area: 'ÁREA ÚTIL (AMBIENTES)',
    content: 'CONTEÚDO', responsible: 'RESPONSÁVEL TÉCNICO', registry: 'CREA / CAU', art: 'ART / RRT',
    scale: 'ESCALA', date: 'DATA', drawnBy: 'DESENHO', revision: 'REVISÃO', sheet: 'FOLHA',
    signResponsible: 'ASSINATURA DO RESPONSÁVEL TÉCNICO', signClient: 'ASSINATURA DO PROPRIETÁRIO',
    notes: 'OBSERVAÇÕES', plan: 'PLANTA BAIXA', perspective: 'PERSPECTIVA', noScale: 'SEM ESCALA',
    scalePrefix: 'ESCALA', units: 'Cotas em metros. Conferir as medidas na obra.', area_short: 'A',
  },
  en: {
    work: 'PROJECT', address: 'ADDRESS', client: 'OWNER / CLIENT', area: 'NET FLOOR AREA (ROOMS)',
    content: 'DRAWING', responsible: 'RESPONSIBLE ENGINEER', registry: 'LICENSE NO.', art: 'PERMIT / RECORD',
    scale: 'SCALE', date: 'DATE', drawnBy: 'DRAWN BY', revision: 'REVISION', sheet: 'SHEET',
    signResponsible: 'SIGNATURE — RESPONSIBLE ENGINEER', signClient: 'SIGNATURE — OWNER',
    notes: 'NOTES', plan: 'FLOOR PLAN', perspective: 'PERSPECTIVE', noScale: 'NOT TO SCALE',
    scalePrefix: 'SCALE', units: 'Dimensions in metres. Verify on site.', area_short: 'A',
  },
} as const;

export function formatMeters(cm: number, language: SheetLanguage, decimals = 2): string {
  const text = (cm / 100).toFixed(decimals);
  return language === 'pt' ? text.replace('.', ',') : text;
}

export function formatSquareMeters(m2: number, language: SheetLanguage): string {
  return `${formatAreaNumber(m2, language)} m²`;
}

function formatAreaNumber(m2: number, language: SheetLanguage): string {
  const text = (Number.isFinite(m2) ? m2 : 0).toFixed(2);
  return language === 'pt' ? text.replace('.', ',') : text;
}

/** "12,50 m²" with a drawn superscript, so it prints even where the font lacks the ² glyph.
 * `y` is the alphabetic baseline. */
function drawSquareMeters(pdf: jsPDF, lang: SheetLanguage, prefix: string, m2: number, x: number, y: number, heightMm: number, align: 'left' | 'center', bold = false, grey = 0) {
  setText(pdf, heightMm, bold, grey);
  const base = `${prefix}${formatAreaNumber(m2, lang)} m`;
  const wBase = pdf.getTextWidth(base);
  setText(pdf, heightMm * 0.62, bold, grey);
  const wSup = pdf.getTextWidth('2');
  const start = align === 'center' ? x - (wBase + wSup) / 2 : x;
  setText(pdf, heightMm, bold, grey);
  pdf.text(base, start, y);
  setText(pdf, heightMm * 0.62, bold, grey);
  pdf.text('2', start + wBase + 0.1, y - heightMm * 0.42);
}

function todayText(language: SheetLanguage, now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0'), mm = String(now.getMonth() + 1).padStart(2, '0');
  return language === 'pt' ? `${dd}/${mm}/${now.getFullYear()}` : `${now.getFullYear()}-${mm}-${dd}`;
}

/** Net area of the floor's rooms (m²), excluding slab openings. */
export function floorNetArea(floor: Floor): number {
  const rooms = resolveRooms(floor);
  return rooms.filter(r => !r.floorOpening).reduce((sum, r) => sum + (Number.isFinite(r.area) ? r.area : 0), 0);
}

/* ------------------------------------------------------------------ */
/* Wall geometry for the plot                                          */
/* ------------------------------------------------------------------ */

function quadPoint(w: Wall, t: number): Point {
  const c = w.curvePoint!;
  const mt = 1 - t;
  return { x: mt * mt * w.start.x + 2 * mt * t * c.x + t * t * w.end.x, y: mt * mt * w.start.y + 2 * mt * t * c.y + t * t * w.end.y };
}

function quadTangent(w: Wall, t: number): Point {
  const c = w.curvePoint!;
  const x = 2 * (1 - t) * (c.x - w.start.x) + 2 * t * (w.end.x - c.x);
  const y = 2 * (1 - t) * (c.y - w.start.y) + 2 * t * (w.end.y - c.y);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/** Is a wall end joined to another wall's end? Joined ends get square caps so corners close. */
function endJoined(point: Point, wall: Wall, walls: Wall[]): boolean {
  return walls.some(o => o !== wall && (Math.hypot(o.start.x - point.x, o.start.y - point.y) < 1.5 || Math.hypot(o.end.x - point.x, o.end.y - point.y) < 1.5));
}

/** Half thickness of another wall that this wall end meets (corner or T-junction), else 0. */
function endInset(point: Point, wall: Wall, walls: Wall[]): number {
  let inset = 0;
  for (const o of walls) {
    if (o === wall || o.curvePoint) continue;
    const dx = o.end.x - o.start.x, dy = o.end.y - o.start.y, len2 = dx * dx + dy * dy;
    if (len2 < 0.01) continue;
    const t = Math.max(0, Math.min(1, ((point.x - o.start.x) * dx + (point.y - o.start.y) * dy) / len2));
    const d = Math.hypot(o.start.x + dx * t - point.x, o.start.y + dy * t - point.y);
    if (d < 1.5) inset = Math.max(inset, o.thickness / 2);
  }
  return inset;
}

/** Plan outline of a wall (cm), with square caps at joined ends. */
export function wallOutline(wall: Wall, walls: Wall[]): Point[] {
  const half = Math.max(wall.thickness, 1) / 2;
  const capStart = endJoined(wall.start, wall, walls) ? half : 0;
  const capEnd = endJoined(wall.end, wall, walls) ? half : 0;
  if (!wall.curvePoint) {
    const dx = wall.end.x - wall.start.x, dy = wall.end.y - wall.start.y, len = Math.hypot(dx, dy);
    if (len < 0.01) return [];
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const s = { x: wall.start.x - ux * capStart, y: wall.start.y - uy * capStart };
    const e = { x: wall.end.x + ux * capEnd, y: wall.end.y + uy * capEnd };
    return [
      { x: s.x + nx * half, y: s.y + ny * half }, { x: e.x + nx * half, y: e.y + ny * half },
      { x: e.x - nx * half, y: e.y - ny * half }, { x: s.x - nx * half, y: s.y - ny * half },
    ];
  }
  const steps = 32, left: Point[] = [], right: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, p = quadPoint(wall, t), u = quadTangent(wall, t);
    const ext = i === 0 ? -capStart : i === steps ? capEnd : 0;
    const q = { x: p.x + u.x * ext, y: p.y + u.y * ext };
    left.push({ x: q.x - u.y * half, y: q.y + u.x * half });
    right.push({ x: q.x + u.y * half, y: q.y - u.x * half });
  }
  return [...left, ...right.reverse()];
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

interface DrawContext {
  pdf: jsPDF;
  k: number; // mm per cm
  ox: number; oy: number; // paper offset of world (minX, minY)
  minX: number; minY: number;
  mono: boolean;
  language: SheetLanguage;
}

const P = (c: DrawContext, x: number, y: number) => ({ x: c.ox + (x - c.minX) * c.k, y: c.oy + (y - c.minY) * c.k });

function polygonPath(pdf: jsPDF, pts: { x: number; y: number }[]) {
  if (pts.length < 2) return;
  pdf.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) pdf.lineTo(pts[i].x, pts[i].y);
  pdf.close();
}

function line(pdf: jsPDF, a: { x: number; y: number }, b: { x: number; y: number }) {
  pdf.moveTo(a.x, a.y); pdf.lineTo(b.x, b.y); pdf.stroke();
}

/** Text height (mm) → jsPDF font size (pt). */
const pt = (mm: number) => mm / 0.3528;

function setText(pdf: jsPDF, heightMm: number, bold = false, grey = 0) {
  pdf.setFont('helvetica', bold ? 'bold' : 'normal');
  pdf.setFontSize(pt(heightMm));
  pdf.setTextColor(grey, grey, grey);
}

const ROOM_TINTS = ['#e8f1fd', '#fdf5dc', '#e7f8ec', '#fdeaea', '#efeafe', '#e3f8fb', '#fdefe2'];

function drawRooms(c: DrawContext, floor: Floor, labels: boolean) {
  const { pdf } = c;
  const rooms = resolveRooms(floor);
  const polygons = rooms.map(r => getRoomPolygon(r, floor.walls));
  const holes = roomHoles(polygons);
  if (!c.mono) {
    rooms.forEach((room, i) => {
      const poly = polygons[i];
      if (poly.length < 3 || room.floorOpening) return;
      const tint = ROOM_TINTS[i % ROOM_TINTS.length];
      pdf.setFillColor(tint);
      for (const ring of [poly, ...holes[i]]) polygonPath(pdf, ring.map(p => P(c, p.x, p.y)));
      pdf.fillEvenOdd();
    });
  }
  return { rooms, polygons, holes, drawLabels: () => {
    if (!labels) return;
    rooms.forEach((room, i) => {
      const poly = polygons[i];
      if (poly.length < 3) return;
      const anchor = roomLabelPosition(room, poly, holes[i]);
      const p = P(c, anchor.x, anchor.y);
      setText(pdf, 2.5, true, 20);
      drawRotatedText(pdf, (room.name || '').toUpperCase(), p.x, p.y - 0.5, { align: 'center', baseline: 'bottom', heightMm: 2.5 });
      if (!room.floorOpening) {
        drawSquareMeters(pdf, c.language, `${LABELS[c.language].area_short} = `, room.area, p.x, p.y + 0.5 + 0.78 * 2, 2, 'center', false, 60);
      }
    });
  } };
}

function drawWalls(c: DrawContext, floor: Floor) {
  const { pdf } = c;
  const outlines = floor.walls.map(w => wallOutline(w, floor.walls).map(p => P(c, p.x, p.y))).filter(o => o.length >= 3);
  // Stroke every outline, then fill every outline on top: shared seams vanish and only
  // the outer contour stays, at half the stroke width (0.35 mm, a thick "cut" line).
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.7);
  pdf.setLineJoin('miter');
  pdf.setLineMiterLimit(4);
  for (const o of outlines) { polygonPath(pdf, o); pdf.stroke(); }
  if (c.mono) pdf.setFillColor(178, 178, 178); else pdf.setFillColor(120, 120, 128);
  for (const o of outlines) { polygonPath(pdf, o); pdf.fill(); }
  pdf.setLineJoin('round');
}

/** White band clearing a wall where an opening sits, plus the jamb lines that close the wall ends. */
function clearOpening(c: DrawContext, wall: Wall, frame: NonNullable<ReturnType<typeof planOpening>>, walls: Wall[]) {
  const { pdf } = c;
  const half = Math.max(wall.thickness, 4) / 2;
  const extra = 0.36 / c.k; // cover the outline that sticks out of the wall faces
  pdf.setFillColor(255, 255, 255);
  if (frame.curve) {
    const { start, control, end } = frame.curve;
    const left: Point[] = [], right: Point[] = [];
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, mt = 1 - t;
      const p = { x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x, y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y };
      const tx = 2 * mt * (control.x - start.x) + 2 * t * (end.x - control.x), ty = 2 * mt * (control.y - start.y) + 2 * t * (end.y - control.y);
      const len = Math.hypot(tx, ty) || 1, nx = -ty / len, ny = tx / len;
      left.push({ x: p.x + nx * (half + extra), y: p.y + ny * (half + extra) });
      right.push({ x: p.x - nx * (half + extra), y: p.y - ny * (half + extra) });
    }
    polygonPath(pdf, [...left, ...right.reverse()].map(p => P(c, p.x, p.y)));
    pdf.fill();
    pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.35);
    for (const [a, b] of [[left[0], right[right.length - 1]], [left[left.length - 1], right[0]]]) {
      line(pdf, P(c, a.x, a.y), P(c, b.x, b.y));
    }
    return;
  }
  const w = frame.wall;
  const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const overhang = 0.36 / c.k; // outline ink outside the wall faces
  const h = half + overhang;
  // Keep the cut inside this wall: never into the face or outline of a wall it meets.
  const center = frame.position * len;
  const insetStart = endInset(wall.start, wall, walls), insetEnd = len - endInset(wall.end, wall, walls);
  const from = Math.max(center - frame.width / 2, insetStart);
  const to = Math.min(center + frame.width / 2, insetEnd);
  if (to - from < 1) return;
  const bandFrom = from <= insetStart + 1e-6 && insetStart > 0 ? from + overhang : from;
  const bandTo = to >= insetEnd - 1e-6 && insetEnd < len ? to - overhang : to;
  const at = (d: number, n: number) => P(c, w.start.x + ux * d + nx * n, w.start.y + uy * d + ny * n);
  polygonPath(pdf, [at(bandFrom, h), at(bandTo, h), at(bandTo, -h), at(bandFrom, -h)]);
  pdf.fill();
  pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.35);
  for (const d of [bandFrom, bandTo]) line(pdf, at(d, h), at(d, -h));
}

function drawOpenings(c: DrawContext, floor: Floor) {
  const { pdf } = c;
  for (const door of floor.doors) {
    const wall = floor.walls.find(w => w.id === door.wallId);
    const frame = wall && planOpening(wall, door.position, door.width);
    if (!wall || !frame) continue;
    clearOpening(c, wall, frame, floor.walls);
    const symbolDoor = { ...door, position: frame.position, width: frame.width };
    for (const part of doorSymbol(frame.wall, symbolDoor)) {
      if (part.role === 'swing') {
        pdf.setDrawColor(60, 60, 60); pdf.setLineWidth(0.13);
        const steps = 24, pts = [];
        for (let i = 0; i <= steps; i++) {
          const a = part.from + (part.to - part.from) * i / steps;
          pts.push(P(c, part.cx + part.r * Math.cos(a), part.cy + part.r * Math.sin(a)));
        }
        pdf.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) pdf.lineTo(p.x, p.y);
        pdf.stroke();
      } else if (part.role === 'hinge') {
        continue;
      } else {
        const dashed = part.role === 'track' || part.role === 'threshold';
        pdf.setDrawColor(30, 30, 30);
        pdf.setLineWidth(part.role === 'leaf' ? 0.35 : 0.25);
        if (dashed) pdf.setLineDashPattern([1.5, 1], 0);
        const pts = part.points.map(p => P(c, p.x, p.y));
        pdf.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) pdf.lineTo(p.x, p.y);
        pdf.stroke();
        if (dashed) pdf.setLineDashPattern([], 0);
      }
    }
  }
  for (const win of floor.windows) {
    const wall = floor.walls.find(w => w.id === win.wallId);
    const frame = wall && planOpening(wall, win.position, win.width);
    if (!wall || !frame) continue;
    clearOpening(c, wall, frame, floor.walls);
    if (frame.curve) {
      const { start, control, end } = frame.curve;
      pdf.setDrawColor(30, 30, 30); pdf.setLineWidth(0.2);
      for (const offset of [-0.35, 0, 0.35]) {
        const pts: { x: number; y: number }[] = [];
        for (let i = 0; i <= 12; i++) {
          const t = i / 12, mt = 1 - t;
          const p = { x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x, y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y };
          const tx = 2 * mt * (control.x - start.x) + 2 * t * (end.x - control.x), ty = 2 * mt * (control.y - start.y) + 2 * t * (end.y - control.y);
          const len = Math.hypot(tx, ty) || 1, half = Math.max(wall.thickness, 4) / 2;
          pts.push(P(c, p.x + (-ty / len) * half * offset * 2, p.y + (tx / len) * half * offset * 2));
        }
        pdf.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) pdf.lineTo(p.x, p.y);
        pdf.stroke();
      }
      continue;
    }
    const w = frame.wall;
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    const px = w.start.x + dx * frame.position, py = w.start.y + dy * frame.position;
    const hw = frame.width / 2, half = Math.max(wall.thickness, 4) / 2;
    // Window in plan: both wall faces (sill/frame) plus the glazing line in the middle.
    pdf.setDrawColor(30, 30, 30);
    for (const [offset, width] of [[half, 0.25], [-half, 0.25], [half * 0.18, 0.18], [-half * 0.18, 0.18]] as const) {
      pdf.setLineWidth(width);
      line(pdf, P(c, px - ux * hw + nx * offset, py - uy * hw + ny * offset), P(c, px + ux * hw + nx * offset, py + uy * hw + ny * offset));
    }
  }
}

function drawFurniture(c: DrawContext, floor: Floor) {
  const { pdf } = c;
  const base: Affine = [c.k, 0, 0, c.k, c.ox - c.minX * c.k, c.oy - c.minY * c.k];
  for (const item of floor.furniture) {
    const cat = getCatalogItem(item.catalogId);
    const { width, depth } = getFurnitureSize(item);
    const color = item.color ?? cat?.color ?? '#888888';
    const ctx = pdfSymbolContext(pdf, base, { mono: c.mono, minLine: 0.09, maxLine: 0.25 });
    try {
      ctx.save();
      ctx.translate(item.position.x, item.position.y);
      ctx.rotate((item.rotation || 0) * Math.PI / 180);
      (ctx as unknown as { scale(x: number, y: number): void }).scale(Math.sign(item.scale?.x ?? 1) || 1, Math.sign(item.scale?.y ?? 1) || 1);
      drawFurnitureIcon(ctx, item.catalogId, width, depth, color, c.mono ? '#444444' : color);
      ctx.restore();
    } catch {
      // Unknown drawing command: fall back to the item's footprint.
      const a = (item.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const lx = sx * width / 2, ly = sy * depth / 2;
        return P(c, item.position.x + lx * cos - ly * sin, item.position.y + lx * sin + ly * cos);
      });
      pdf.setDrawColor(70, 70, 70); pdf.setLineWidth(0.13);
      polygonPath(pdf, corners); pdf.stroke();
    }
  }
}

function drawStairsAndColumns(c: DrawContext, floor: Floor) {
  const { pdf } = c;
  const base: Affine = [c.k, 0, 0, c.k, c.ox - c.minX * c.k, c.oy - c.minY * c.k];
  for (const stair of floor.stairs ?? []) {
    const ctx = pdfSymbolContext(pdf, base, { mono: true, minLine: 0.13, maxLine: 0.3, strokeColor: '#222222' });
    try { drawStair({ ctx, width: 0, height: 0, zoom: 1, camX: 0, camY: 0 }, stair, false); }
    catch {
      const a = stair.rotation * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
        const lx = sx * stair.width / 2, ly = sy * stair.depth / 2;
        return P(c, stair.position.x + lx * cos - ly * sin, stair.position.y + lx * sin + ly * cos);
      });
      pdf.setDrawColor(30, 30, 30); pdf.setLineWidth(0.25);
      polygonPath(pdf, corners); pdf.stroke();
    }
  }
  for (const col of floor.columns ?? []) {
    const center = P(c, col.position.x, col.position.y), r = col.diameter / 2 * c.k;
    pdf.setFillColor(90, 90, 90); pdf.setDrawColor(0, 0, 0); pdf.setLineWidth(0.35);
    if (col.shape === 'round') pdf.circle(center.x, center.y, r, 'FD');
    else {
      const a = (col.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), h = col.diameter / 2;
      polygonPath(pdf, [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => P(c, col.position.x + sx * h * cos - sy * h * sin, col.position.y + sx * h * sin + sy * h * cos)));
      pdf.fillStroke();
    }
  }
}

/** Technical dimension (cota): extension lines, dimension line with 45° ticks and the value above it.
 * Points are in paper mm. */
export function drawDimension(pdf: jsPDF, a: { x: number; y: number }, b: { x: number; y: number }, offsetMm: number, label: string, options: { extensionFrom?: number; textHeight?: number; stagger?: number } = {}) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len < 0.2) return;
  const ux = dx / len, uy = dy / len;
  const nx = -uy, ny = ux;
  const d1 = { x: a.x + nx * offsetMm, y: a.y + ny * offsetMm }, d2 = { x: b.x + nx * offsetMm, y: b.y + ny * offsetMm };
  const sign = Math.sign(offsetMm) || 1;
  const gap = options.extensionFrom ?? 1;
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.13);
  if (Math.abs(offsetMm) > gap) {
    for (const [p, d] of [[a, d1], [b, d2]] as const) {
      line(pdf, { x: p.x + nx * gap * sign, y: p.y + ny * gap * sign }, { x: d.x + nx * 1.2 * sign, y: d.y + ny * 1.2 * sign });
    }
  }
  line(pdf, { x: d1.x - ux * 1.2, y: d1.y - uy * 1.2 }, { x: d2.x + ux * 1.2, y: d2.y + uy * 1.2 });
  pdf.setLineWidth(0.35);
  const tick = 1.0;
  for (const d of [d1, d2]) {
    const tx = (ux + nx) / Math.SQRT2 * tick, ty = (uy + ny) / Math.SQRT2 * tick;
    line(pdf, { x: d.x - tx, y: d.y - ty }, { x: d.x + tx, y: d.y + ty });
  }
  // Text reads left-to-right or bottom-to-top, above the dimension line (NBR 10126 practice).
  const angle = readableAngle(ux, uy);
  const textHeight = options.textHeight ?? 1.8;
  // Positive stagger lifts the text further above the line; negative puts it below (outside).
  const stagger = options.stagger ?? 0;
  const up = textUp(angle), lift = stagger >= 0 ? 0.7 + stagger : -(0.7 + Math.abs(stagger) + 0.78 * textHeight);
  const mid = { x: (d1.x + d2.x) / 2 + up.x * lift, y: (d1.y + d2.y) / 2 + up.y * lift };
  setText(pdf, textHeight, false, 0);
  drawRotatedText(pdf, label, mid.x, mid.y, { angle, align: 'center', heightMm: textHeight });
}

/** Counter-clockwise text angle (degrees) for a page direction, kept within (-90°, 90°]. */
export function readableAngle(ux: number, uy: number): number {
  let angle = Math.atan2(-uy, ux) * 180 / Math.PI;
  if (angle > 90.01) angle -= 180;
  else if (angle <= -89.99) angle += 180;
  return Math.abs(angle) < 1e-9 ? 0 : angle;
}

/** Labels that do not fit between their ticks are lifted clear of the line, alternating heights in a run. */
export function narrowStagger(run: number): number {
  return run === 0 ? 0 : run % 2 === 1 ? -0.4 : 2.4;
}

function uniqueSorted(values: number[], tolerance = 0.5): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) if (!out.length || v - out[out.length - 1] > tolerance) out.push(v);
  return out;
}

/** Chain dimensions (including wall thicknesses) and overall dimensions, in the Brazilian style. */
function drawChainDimensions(c: DrawContext, floor: Floor, planBottom: number, planRight: number) {
  const { pdf, language } = c;
  const straight = floor.walls.filter(w => !w.curvePoint);
  if (!floor.walls.length) return;
  const wb: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const w of floor.walls) growBox(wb, wallPlanBounds(w));
  const xs: number[] = [wb.minX, wb.maxX], ys: number[] = [wb.minY, wb.maxY];
  for (const w of straight) {
    const half = w.thickness / 2;
    if (Math.abs(w.end.x - w.start.x) < 0.5) xs.push(w.start.x - half, w.start.x + half);
    if (Math.abs(w.end.y - w.start.y) < 0.5) ys.push(w.start.y - half, w.start.y + half);
  }
  const chainX = uniqueSorted(xs.filter(x => x >= wb.minX - 0.01 && x <= wb.maxX + 0.01));
  const chainY = uniqueSorted(ys.filter(y => y >= wb.minY - 0.01 && y <= wb.maxY + 0.01));
  const fitsLabel = (mm: number, text: string) => mm > pdf.getTextWidth(text) + 0.8;

  // Bottom: chain at +7 mm, overall at +14 mm from the plan's lowest ink.
  setText(pdf, 1.8);
  const yChain = planBottom + 7, yTotal = planBottom + 14;
  let narrowRun = 0;
  chainX.slice(1).forEach((x, i) => {
    const x0 = chainX[i];
    const a = { x: P(c, x0, 0).x, y: yChain }, b = { x: P(c, x, 0).x, y: yChain };
    const text = formatMeters(x - x0, language);
    narrowRun = fitsLabel(b.x - a.x, text) ? 0 : narrowRun + 1;
    drawDimension(pdf, a, b, 0, text, { stagger: narrowStagger(narrowRun) });
  });
  if (chainX.length > 2 || chainX.length === 2) {
    drawDimension(pdf, { x: P(c, wb.minX, 0).x, y: yTotal }, { x: P(c, wb.maxX, 0).x, y: yTotal }, 0, formatMeters(wb.maxX - wb.minX, language));
  }
  // Extension lines from the plan to the chains.
  pdf.setLineWidth(0.1); pdf.setDrawColor(90, 90, 90);
  for (const x of chainX) {
    const px = P(c, x, 0).x;
    line(pdf, { x: px, y: P(c, 0, wb.maxY).y + 1.5 }, { x: px, y: (x === wb.minX || x === wb.maxX ? yTotal : yChain) + 1.2 });
  }

  // Right: vertical chains reading bottom-to-top.
  const xChain = planRight + 7, xTotal = planRight + 14;
  narrowRun = 0;
  chainY.slice(1).forEach((y, i) => {
    const y0 = chainY[i];
    const a = { x: xChain, y: P(c, 0, y).y }, b = { x: xChain, y: P(c, 0, y0).y };
    const text = formatMeters(y - y0, language);
    narrowRun = fitsLabel(a.y - b.y, text) ? 0 : narrowRun + 1;
    drawDimension(pdf, a, b, 0, text, { stagger: narrowStagger(narrowRun) });
  });
  if (chainY.length >= 2) {
    drawDimension(pdf, { x: xTotal, y: P(c, 0, wb.maxY).y }, { x: xTotal, y: P(c, 0, wb.minY).y }, 0, formatMeters(wb.maxY - wb.minY, language));
  }
  pdf.setLineWidth(0.1); pdf.setDrawColor(90, 90, 90);
  for (const y of chainY) {
    const py = P(c, 0, y).y;
    line(pdf, { x: P(c, wb.maxX, 0).x + 1.5, y: py }, { x: (y === wb.minY || y === wb.maxY ? xTotal : xChain) + 1.2, y: py });
  }
}

function drawEditorDimensions(c: DrawContext, floor: Floor) {
  for (const a of floor.annotations ?? []) {
    const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    if (len < 1) continue;
    const label = a.label?.trim() || formatMeters(len, c.language);
    drawDimension(c.pdf, P(c, a.x1, a.y1), P(c, a.x2, a.y2), (a.offset ?? 40) * c.k, label, { extensionFrom: 1 });
  }
  for (const m of floor.measurements ?? []) {
    const len = Math.hypot(m.x2 - m.x1, m.y2 - m.y1);
    if (len < 1) continue;
    drawDimension(c.pdf, P(c, m.x1, m.y1), P(c, m.x2, m.y2), 0, formatMeters(len, c.language));
  }
}

function drawWallLengths(c: DrawContext, floor: Floor) {
  const { pdf } = c;
  setText(pdf, 1.6, false, 70);
  for (const w of floor.walls) {
    if (w.curvePoint) continue;
    const dx = w.end.x - w.start.x, dy = w.end.y - w.start.y, len = Math.hypot(dx, dy);
    if (len < 20) continue;
    const mid = P(c, (w.start.x + w.end.x) / 2, (w.start.y + w.end.y) / 2);
    const angle = readableAngle(dx / len, dy / len);
    const off = w.thickness / 2 * c.k + 0.8, up = textUp(angle);
    drawRotatedText(pdf, formatMeters(len, c.language), mid.x + up.x * off, mid.y + up.y * off, { angle, align: 'center', heightMm: 1.6 });
  }
}

function drawTextNotes(c: DrawContext, floor: Floor) {
  const { pdf } = c;
  for (const note of floor.textAnnotations ?? []) {
    const text = note.text.trim();
    if (!text) continue;
    const p = P(c, note.x, note.y);
    const height = Math.max(1.8, Math.min(6, (note.fontSize || 14) * c.k * 0.7));
    setText(pdf, height, false, c.mono ? 20 : 0);
    if (!c.mono) { const col = /^#([0-9a-f]{6})$/i.exec(note.color || ''); if (col) pdf.setTextColor(`#${col[1]}`); }
    drawRotatedText(pdf, text.split('\n'), p.x, p.y, { angle: -(note.rotation || 0), align: 'center', baseline: 'middle', heightMm: height });
  }
}

/** Graphic scale: whole metres, about 30–75 mm long on paper. */
export function scaleBarSpec(scale: number) {
  const mmPerMeter = 1000 / scale;
  const meters = [1, 2, 5, 10, 20, 50].find(m => m * mmPerMeter >= 30) ?? 50;
  return { meters, length: meters * mmPerMeter };
}

function drawScaleBar(pdf: jsPDF, x: number, y: number, scale: number, language: SheetLanguage) {
  const { meters, length: total } = scaleBarSpec(scale);
  const segments = meters === 1 || meters === 2 ? 4 : 5, seg = total / segments;
  pdf.setLineWidth(0.18); pdf.setDrawColor(0, 0, 0);
  for (let i = 0; i < segments; i++) {
    pdf.setFillColor(i % 2 ? 255 : 0, i % 2 ? 255 : 0, i % 2 ? 255 : 0);
    pdf.rect(x + i * seg, y, seg, 1.4, 'FD');
  }
  setText(pdf, 1.6);
  for (let i = 0; i <= segments; i++) {
    const value = meters * i / segments;
    const text = Number.isInteger(value) ? String(value) : (language === 'pt' ? String(value).replace('.', ',') : String(value));
    pdf.text(text, x + i * seg, y + 3.6, { align: 'center' });
  }
  pdf.text('m', x + total + 2, y + 1.3);
}

function drawCaption(pdf: jsPDF, rect: Rect, title: string, scaleText: string, scale: number | null, language: SheetLanguage) {
  const cx = rect.x + rect.width / 2;
  setText(pdf, 3.5, true);
  pdf.text(title, cx, rect.y + 5.2, { align: 'center' });
  const w = pdf.getTextWidth(title);
  pdf.setLineWidth(0.5); pdf.setDrawColor(0, 0, 0);
  line(pdf, { x: cx - w / 2, y: rect.y + 6.3 }, { x: cx + w / 2, y: rect.y + 6.3 });
  setText(pdf, 2.5);
  pdf.text(scaleText, cx, rect.y + 10.4, { align: 'center' });
  if (!scale) return;
  const bar = scaleBarSpec(scale).length;
  const right = cx + w / 2 + 8;
  if (right + bar + 6 <= rect.x + rect.width) drawScaleBar(pdf, right, rect.y + 3.2, scale, language);
  else if (cx - w / 2 - 8 - bar - 4 >= rect.x) drawScaleBar(pdf, cx - w / 2 - 8 - bar - 4, rect.y + 3.2, scale, language);
}

function drawFrame(pdf: jsPDF, layout: SheetLayout) {
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(0.7);
  const f = layout.frame;
  pdf.rect(f.x, f.y, f.width, f.height, 'S');
}

export interface TitleBlockInfo {
  drawingTitle: string;
  scaleText: string;
  sheetText: string;
  /** Net room area in m², or null to leave the field blank. */
  areaM2: number | null;
  dateText: string;
}

function cell(pdf: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, valueSize = 2.4, bold = false) {
  pdf.setLineWidth(0.25); pdf.setDrawColor(0, 0, 0);
  pdf.rect(x, y, w, h, 'S');
  setText(pdf, 1.5, false, 70);
  pdf.text(label, x + 1.2, y + 2.2);
  if (!value) return;
  setText(pdf, valueSize, bold, 0);
  const lines = pdf.splitTextToSize(value, w - 2.4) as string[];
  const shown = lines.slice(0, Math.max(1, Math.floor((h - 3) / (valueSize * 1.25))));
  pdf.text(shown, x + 1.2, y + 3.4 + valueSize * 0.85, { lineHeightFactor: 1.15 } as never);
}

/** Title block (legenda/carimbo) with the fields Brazilian utilities and city halls expect. */
export function drawTitleBlock(pdf: jsPDF, rect: Rect, data: TitleBlockData, info: TitleBlockInfo, language: SheetLanguage) {
  const L = LABELS[language];
  const { x, width: W } = rect;
  let y = rect.y;
  pdf.setLineWidth(0.5); pdf.setDrawColor(0, 0, 0);
  pdf.rect(rect.x, rect.y, rect.width, rect.height, 'S');
  // Row 1: company and sheet number
  const sheetW = 30;
  pdf.setLineWidth(0.25); pdf.rect(x, y, W - sheetW, 9, 'S');
  setText(pdf, 3.6, true);
  pdf.text((data.company || '').toUpperCase(), x + 2, y + 6.2, { maxWidth: W - sheetW - 4 } as never);
  cell(pdf, x + W - sheetW, y, sheetW, 9, L.sheet, info.sheetText, 3.6, true);
  y += 9;
  cell(pdf, x, y, W, 7, L.work, data.work, 2.6, true); y += 7;
  cell(pdf, x, y, W, 6.5, L.address, data.address, 2.2); y += 6.5;
  const areaW = 46;
  cell(pdf, x, y, W - areaW, 6.5, L.client, data.client, 2.2);
  cell(pdf, x + W - areaW, y, areaW, 6.5, L.area, '', 2.4, true);
  if (info.areaM2 !== null) drawSquareMeters(pdf, language, '', info.areaM2, x + W - areaW + 1.2, y + 3.4 + 2.4 * 0.85, 2.4, 'left', true);
  y += 6.5;
  cell(pdf, x, y, W, 7, L.content, info.drawingTitle, 2.8, true); y += 7;
  const regW = 46, artW = 46;
  cell(pdf, x, y, W - regW - artW, 7, L.responsible, data.responsible, 2.4);
  cell(pdf, x + W - regW - artW, y, regW, 7, L.registry, data.registry, 2.4);
  cell(pdf, x + W - artW, y, artW, 7, L.art, data.art, 2.4); y += 7;
  const q = W / 4;
  cell(pdf, x, y, q, 6.5, L.scale, info.scaleText, 2.4, true);
  cell(pdf, x + q, y, q, 6.5, L.date, info.dateText, 2.4);
  cell(pdf, x + q * 2, y, q, 6.5, L.drawnBy, data.drawnBy, 2.4);
  cell(pdf, x + q * 3, y, q, 6.5, L.revision, data.revision, 2.4); y += 6.5;
  // Signatures
  const sigH = rect.y + rect.height - y;
  pdf.setLineWidth(0.25);
  pdf.rect(x, y, W / 2, sigH, 'S'); pdf.rect(x + W / 2, y, W / 2, sigH, 'S');
  pdf.setLineWidth(0.18);
  for (const [i, label] of [L.signResponsible, L.signClient].entries()) {
    const sx = x + i * W / 2;
    line(pdf, { x: sx + 6, y: y + sigH - 4.2 }, { x: sx + W / 2 - 6, y: y + sigH - 4.2 });
    setText(pdf, 1.5, false, 70);
    pdf.text(label, sx + W / 4, y + sigH - 1.8, { align: 'center' });
  }
}

function drawNotes(pdf: jsPDF, rect: Rect, notes: string, language: SheetLanguage) {
  const L = LABELS[language];
  const body = [notes.trim(), L.units].filter(Boolean).join('\n');
  pdf.setLineWidth(0.25); pdf.setDrawColor(0, 0, 0);
  pdf.rect(rect.x, rect.y, rect.width, rect.height, 'S');
  setText(pdf, 1.8, true, 40);
  pdf.text(L.notes, rect.x + 1.5, rect.y + 3);
  setText(pdf, 2.0, false, 0);
  const lines = pdf.splitTextToSize(body, rect.width - 3) as string[];
  const max = Math.floor((rect.height - 6) / (2.0 * 1.3));
  pdf.text(lines.slice(0, max), rect.x + 1.5, rect.y + 7, { lineHeightFactor: 1.3 } as never);
}

export interface TechnicalSheetResult {
  pdf: jsPDF;
  pages: number;
  entries: SheetPlanEntry[];
  /** Floors whose fixed scale does not fit the sheet. */
  overflow: string[];
}

export interface PerspectiveImage { dataUrl: string; width: number; height: number }

/** Builds the technical drawing set: one sheet per floor, plus an optional perspective sheet. */
export function buildTechnicalSheets(project: Project, options: TechnicalSheetOptions, language: SheetLanguage, perspective?: PerspectiveImage | null, now = new Date(), output: { compress?: boolean } = {}): TechnicalSheetResult | null {
  const entries = planSheets(project, options);
  const withPerspective = !!(options.include3D && perspective?.dataUrl);
  if (!entries.length && !withPerspective) return null;
  const layout = sheetLayout(options.format, options.orientation);
  const pdf = new jsPDF({ orientation: options.orientation, unit: 'mm', format: options.format.toLowerCase(), compress: output.compress ?? true });
  pdf.setProperties({ title: project.name || 'Planta', creator: 'OpenPlan3D', subject: options.titleBlock.work || project.name || '' });
  const L = LABELS[language];
  const total = entries.length + (withPerspective ? 1 : 0);
  const tb = options.titleBlock;
  const sheetText = (index: number) => total === 1 && tb.sheetNumber.trim() ? tb.sheetNumber.trim() : `${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
  const dateText = tb.date.trim() || todayText(language, now);
  const overflow: string[] = [];
  const allowance = dimensionAllowance(options);

  entries.forEach((entry, index) => {
    if (index > 0) pdf.addPage(options.format.toLowerCase(), options.orientation);
    const { floor, extents, scale } = entry;
    if (!entry.fits) overflow.push(floor.name);
    const k = 10 / scale;
    const planW = (extents.maxX - extents.minX) * k, planH = (extents.maxY - extents.minY) * k;
    const totalW = planW + allowance.left + allowance.right, totalH = planH + allowance.top + allowance.bottom;
    const area = layout.drawing;
    const ox = area.x + Math.max(0, (area.width - totalW) / 2) + allowance.left;
    const oy = area.y + Math.max(0, (area.height - totalH) / 2) + allowance.top;
    const c: DrawContext = { pdf, k, ox, oy, minX: extents.minX, minY: extents.minY, mono: options.mono, language };

    drawFrame(pdf, layout);
    pdf.saveGraphicsState();
    pdf.rect(area.x, area.y, area.width, area.height, null as never);
    pdf.clip();
    pdf.discardPath();
    const rooms = drawRooms(c, floor, options.roomLabels);
    if (options.furniture) drawFurniture(c, floor);
    drawStairsAndColumns(c, floor);
    drawWalls(c, floor);
    drawOpenings(c, floor);
    rooms.drawLabels();
    if (options.wallLengths) drawWallLengths(c, floor);
    if (options.dimensions) drawEditorDimensions(c, floor);
    if (options.textNotes) drawTextNotes(c, floor);
    if (options.chainDimensions) drawChainDimensions(c, floor, oy + planH, ox + planW);
    pdf.restoreGraphicsState();

    const multi = entries.length > 1;
    const baseTitle = tb.drawingTitle.trim();
    const drawingTitle = baseTitle ? (multi ? `${baseTitle} — ${floor.name}` : baseTitle) : `${L.plan} — ${floor.name}`.toUpperCase();
    const scaleText = `1:${scale}`;
    drawCaption(pdf, layout.caption, drawingTitle.toUpperCase(), `${L.scalePrefix} ${scaleText}`, scale, language);
    drawTitleBlock(pdf, layout.titleBlock, tb, {
      drawingTitle: drawingTitle.toUpperCase(), scaleText, sheetText: sheetText(index),
      areaM2: floorNetArea(floor), dateText,
    }, language);
    if (layout.notes) drawNotes(pdf, layout.notes, tb.notes, language);
  });

  if (withPerspective && perspective) {
    if (entries.length) pdf.addPage(options.format.toLowerCase(), options.orientation);
    drawFrame(pdf, layout);
    const area = layout.drawing;
    const ratio = perspective.width / perspective.height || 1.6;
    let w = area.width, h = w / ratio;
    if (h > area.height) { h = area.height; w = h * ratio; }
    try { pdf.addImage(perspective.dataUrl, 'PNG', area.x + (area.width - w) / 2, area.y + (area.height - h) / 2, w, h, undefined, 'FAST'); }
    catch { /* A broken capture still leaves a valid sheet. */ }
    const title = `${L.perspective} 3D`;
    drawCaption(pdf, layout.caption, title, L.noScale, null, language);
    const areaM2 = entries.length ? entries.reduce((s, e) => s + floorNetArea(e.floor), 0) : null;
    drawTitleBlock(pdf, layout.titleBlock, tb, { drawingTitle: title, scaleText: L.noScale, sheetText: sheetText(entries.length), areaM2, dateText }, language);
    if (layout.notes) drawNotes(pdf, layout.notes, tb.notes, language);
  }
  return { pdf, pages: total, entries, overflow };
}

/** File name safe for every browser's download handling: no accents, long dashes or symbols. */
export function technicalSheetFilename(project: Project, options: TechnicalSheetOptions): string {
  const raw = (options.titleBlock.work || project.name || 'planta').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const base = raw.replace(/[\u2010-\u2015]/g, '-').replace(/[^A-Za-z0-9 ._()-]+/g, '-')
    .replace(/\s+/g, ' ').replace(/-{2,}/g, '-').replace(/^[\s.-]+|[\s.-]+$/g, '').slice(0, 80) || 'planta';
  return `${base} - ${options.format}.pdf`;
}
