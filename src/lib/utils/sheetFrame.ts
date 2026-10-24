import jsPDF from 'jspdf';

/* Sheet, title block and caption drawing shared by every plot: the technical sheet of the
 * floor-plan editor and the DWG/DXF plot of the CAD viewer. Depends on jsPDF only. */

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

/* ------------------------------------------------------------------ */
/* Labels and number formatting                                        */
/* ------------------------------------------------------------------ */

export const LABELS = {
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
export function drawSquareMeters(pdf: jsPDF, lang: SheetLanguage, prefix: string, m2: number, x: number, y: number, heightMm: number, align: 'left' | 'center', bold = false, grey = 0) {
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

export function todayText(language: SheetLanguage, now = new Date()): string {
  const dd = String(now.getDate()).padStart(2, '0'), mm = String(now.getMonth() + 1).padStart(2, '0');
  return language === 'pt' ? `${dd}/${mm}/${now.getFullYear()}` : `${now.getFullYear()}-${mm}-${dd}`;
}

export function line(pdf: jsPDF, a: { x: number; y: number }, b: { x: number; y: number }) {
  pdf.moveTo(a.x, a.y); pdf.lineTo(b.x, b.y); pdf.stroke();
}

/** Text height (mm) → jsPDF font size (pt). */
const pt = (mm: number) => mm / 0.3528;

export function setText(pdf: jsPDF, heightMm: number, bold = false, grey = 0) {
  pdf.setFont('helvetica', bold ? 'bold' : 'normal');
  pdf.setFontSize(pt(heightMm));
  pdf.setTextColor(grey, grey, grey);
}

/** Graphic scale: whole metres, about 30–75 mm long on paper. */
export function scaleBarSpec(scale: number) {
  const mmPerMeter = 1000 / scale;
  const meters = [1, 2, 5, 10, 20, 50].find(m => m * mmPerMeter >= 30) ?? 50;
  return { meters, length: meters * mmPerMeter };
}

export function drawScaleBar(pdf: jsPDF, x: number, y: number, scale: number, language: SheetLanguage) {
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

export function drawCaption(pdf: jsPDF, rect: Rect, title: string, scaleText: string, scale: number | null, language: SheetLanguage) {
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

export function drawFrame(pdf: jsPDF, layout: SheetLayout) {
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

export function cell(pdf: jsPDF, x: number, y: number, w: number, h: number, label: string, value: string, valueSize = 2.4, bold = false) {
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

export function drawNotes(pdf: jsPDF, rect: Rect, notes: string, language: SheetLanguage, footer: string = LABELS[language].units) {
  const body = [notes.trim(), footer].filter(Boolean).join('\n');
  const L = LABELS[language];
  pdf.setLineWidth(0.25); pdf.setDrawColor(0, 0, 0);
  pdf.rect(rect.x, rect.y, rect.width, rect.height, 'S');
  setText(pdf, 1.8, true, 40);
  pdf.text(L.notes, rect.x + 1.5, rect.y + 3);
  setText(pdf, 2.0, false, 0);
  const lines = pdf.splitTextToSize(body, rect.width - 3) as string[];
  const max = Math.floor((rect.height - 6) / (2.0 * 1.3));
  pdf.text(lines.slice(0, max), rect.x + 1.5, rect.y + 7, { lineHeightFactor: 1.3 } as never);
}

export interface SheetFrameInput {
  format: SheetFormat;
  orientation: SheetOrientation;
  titleBlock: TitleBlockData;
  language: SheetLanguage;
  /** Drawing title for the caption and the title block (upper-cased here). */
  drawingTitle: string;
  /** Scale denominator for the caption, scale bar and title block; null when not to scale. */
  scale: number | null;
  sheetText?: string;
  areaM2?: number | null;
  /** Last line of the notes box. */
  notesFooter?: string;
  now?: Date;
  compress?: boolean;
}

/** A sheet with frame, caption, title block and notes, and an empty drawing area to plot into. */
export function buildSheetFrame(input: SheetFrameInput): { pdf: jsPDF; layout: SheetLayout } {
  const layout = sheetLayout(input.format, input.orientation);
  const pdf = new jsPDF({ orientation: input.orientation, unit: 'mm', format: input.format.toLowerCase(), compress: input.compress ?? true });
  const L = LABELS[input.language];
  const tb = input.titleBlock;
  const title = (input.drawingTitle || L.plan).toUpperCase();
  const scaleText = input.scale ? `1:${input.scale}` : L.noScale;
  drawFrame(pdf, layout);
  drawCaption(pdf, layout.caption, title, input.scale ? `${L.scalePrefix} ${scaleText}` : L.noScale, input.scale, input.language);
  drawTitleBlock(pdf, layout.titleBlock, tb, {
    drawingTitle: title, scaleText,
    sheetText: input.sheetText ?? (tb.sheetNumber.trim() || '01/01'),
    areaM2: input.areaM2 ?? null,
    dateText: tb.date.trim() || todayText(input.language, input.now),
  }, input.language);
  if (layout.notes) drawNotes(pdf, layout.notes, tb.notes, input.language, input.notesFooter);
  return { pdf, layout };
}
