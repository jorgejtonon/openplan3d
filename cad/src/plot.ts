import { PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { exportDatabaseToPdf } from '@mlightcad/pdf-renderer';
import type { AcDbDatabase } from '@mlightcad/data-model';
import { buildSheetFrame, sheetLayout, sheetSize, type Rect } from '$lib/utils/sheetFrame';
import { boxCenter, chooseCadScale, isUsableBox, paperMmPerUnit, plotInsunits, scaledWindow, blackenContent, RENDERER_PADDING, PT_PER_MM, type Box2, type PlotOptions } from './plotMath';
export * from './plotMath';
import { createViewerPdfGlyphProvider } from './pdfGlyphProvider';

export async function toMonochrome(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes);
  const context = doc.context;
  const skipKeys = ['Filter', 'Length', 'DecodeParms'].map(k => PDFName.of(k));
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const dict = object.dict;
    const subtype = dict.get(PDFName.of('Subtype'));
    const type = dict.get(PDFName.of('Type'));
    // Page content streams carry no Type/Subtype; forms are XObjects of subtype Form.
    if (subtype && subtype !== PDFName.of('Form')) continue;
    if (type && type !== PDFName.of('XObject')) continue;
    if (dict.has(PDFName.of('Length1')) || dict.has(PDFName.of('Length2'))) continue; // embedded fonts
    let decoded: Uint8Array;
    try { decoded = decodePDFRawStream(object).decode(); } catch { continue; }
    const text = latin1(decoded);
    const changed = blackenContent(text);
    if (changed === text) continue;
    const stream = context.flateStream(fromLatin1(changed));
    for (const [key, value] of dict.entries()) if (!skipKeys.includes(key)) stream.dict.set(key, value);
    context.assign(ref, stream);
  }
  return doc.save();
}

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
}

function fromLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export interface PlotRequest {
  db: AcDbDatabase;
  options: PlotOptions;
  /** World box currently on screen (for area 'view'). */
  viewBox: Box2 | null;
  /** Drawing extents, when already computed. */
  extents?: Box2 | null;
  fileName: string;
  fontMapping?: Record<string, string>;
  now?: Date;
}

export interface PlotResult {
  bytes: Uint8Array;
  scale: number | null;
  insunits: number;
  /** Plot window in drawing units. */
  window: Box2;
}

/** Union of the entities' own extents in the current space. Header extents ($EXTMIN/$EXTMAX) are
 * often stale or left at their ±1e20 defaults, so they are only a fallback. */
export function drawingExtents(db: AcDbDatabase): Box2 | null {
  const table = db.tables.blockTable;
  const space = (table.getIdAt(db.currentSpaceId) ?? table.modelSpace) as typeof table.modelSpace;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const entity of space.newIterator()) {
    let box: { min: { x: number; y: number }; max: { x: number; y: number } } | undefined;
    try { box = entity.geometricExtents; } catch { continue; }
    if (!box) continue;
    const values = [box.min.x, box.min.y, box.max.x, box.max.y];
    if (!values.every(v => Number.isFinite(v) && Math.abs(v) < 1e11)) continue;
    minX = Math.min(minX, box.min.x); minY = Math.min(minY, box.min.y);
    maxX = Math.max(maxX, box.max.x); maxY = Math.max(maxY, box.max.y);
  }
  const result = { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } };
  if (isUsableBox(result)) return result;
  const header = db.extents;
  const fallback: Box2 | null = header ? { min: { x: header.min.x, y: header.min.y }, max: { x: header.max.x, y: header.max.y } } : null;
  return isUsableBox(fallback) ? fallback : null;
}

export function plotSource(request: Pick<PlotRequest, 'db' | 'options' | 'viewBox'> & { extents?: Box2 | null }): Box2 | null {
  const ext = request.extents !== undefined ? request.extents : drawingExtents(request.db);
  if (request.options.area === 'view') return isUsableBox(request.viewBox) ? request.viewBox : (isUsableBox(ext) ? ext : null);
  return isUsableBox(ext) ? ext : (isUsableBox(request.viewBox) ? request.viewBox : null);
}

/** Scale, units and window a plot will use; the dialog shows this before generating. */
export function planPlot(request: Pick<PlotRequest, 'db' | 'options' | 'viewBox'> & { extents?: Box2 | null }) {
  const { options } = request;
  const layout = sheetLayout(options.format, options.orientation);
  const insunits = plotInsunits(request.db.insunits ?? 0, options.units);
  const source = plotSource(request);
  if (!source) return null;
  const area = layout.drawing;
  let scale: number | null;
  if (options.scale === 'fit') scale = null;
  else if (options.scale === 'auto') scale = chooseCadScale(source, area, insunits);
  else scale = options.scale;
  const window = scale ? scaledWindow(boxCenter(source), area, insunits, scale) : source;
  // Does the chosen area fit at the chosen scale?
  const fits = scale ? (() => {
    const k = paperMmPerUnit(insunits, scale);
    return (source.max.x - source.min.x) * k <= area.width * (1 - 2 * RENDERER_PADDING) + 1e-6
      && (source.max.y - source.min.y) * k <= area.height * (1 - 2 * RENDERER_PADDING) + 1e-6;
  })() : true;
  return { layout, insunits, source, scale, window, fits, suggested: chooseCadScale(source, area, insunits) };
}

/** Plots the drawing on a standard sheet at true scale, with frame, caption and title block. */
export async function plotDrawing(request: PlotRequest): Promise<PlotResult> {
  const plan = planPlot(request);
  if (!plan) throw new Error('O desenho está vazio.');
  const { db, options } = request;
  const { layout, insunits, scale, window } = plan;
  const area: Rect = layout.drawing;

  // The renderer converts lineweights with INSUNITS: plot with the units chosen in the dialog.
  const savedInsunits = db.insunits;
  let drawingBytes: Uint8Array;
  try {
    if (db.insunits !== insunits) db.insunits = insunits;
    drawingBytes = await exportDatabaseToPdf(db, {
      title: request.fileName,
      paper: { widthMm: area.width, heightMm: area.height },
      marginMm: 0,
      fitBox: window,
      background: 'none',
      showLineWeight: options.lineweights,
      ltscale: db.ltscale,
      celtscale: db.celtscale,
      fontMapping: request.fontMapping,
      glyphProvider: createViewerPdfGlyphProvider(),
      textMode: 'vector',
    });
  } finally {
    if (db.insunits !== savedInsunits) db.insunits = savedInsunits;
  }
  if (options.mono) drawingBytes = await toMonochrome(drawingBytes);

  const title = options.titleBlock.drawingTitle.trim() || request.fileName.replace(/\.(dwg|dxf)$/i, '');
  const unitName = insunits === 6 ? 'metros' : insunits === 5 ? 'centímetros' : 'milímetros';
  const frame = buildSheetFrame({
    format: options.format, orientation: options.orientation, titleBlock: options.titleBlock, language: 'pt',
    drawingTitle: title, scale, now: request.now,
    notesFooter: scale ? `Desenho em ${unitName}, plotado na escala indicada. Conferir as medidas na obra.` : 'Desenho ajustado à folha, sem escala. Não medir no papel.',
  });

  const sheet = sheetSize(options.format, options.orientation);
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('OpenPlan3D');
  const page = out.addPage([sheet.width * PT_PER_MM, sheet.height * PT_PER_MM]);
  const [drawing] = await out.embedPdf(drawingBytes, [0]);
  page.drawPage(drawing, {
    x: area.x * PT_PER_MM,
    y: (sheet.height - area.y - area.height) * PT_PER_MM,
    width: area.width * PT_PER_MM,
    height: area.height * PT_PER_MM,
  });
  const [sheetFrame] = await out.embedPdf(new Uint8Array(frame.pdf.output('arraybuffer')), [0]);
  page.drawPage(sheetFrame, { x: 0, y: 0, width: sheet.width * PT_PER_MM, height: sheet.height * PT_PER_MM });
  return { bytes: await out.save(), scale, insunits, window };
}

