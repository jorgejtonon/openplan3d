import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { houseTemplates } from '$lib/utils/houseTemplates';
import {
  buildTechnicalSheets, chooseScale, defaultSheetOptions, dimensionAllowance, formatMeters, formatSquareMeters,
  planFits, planSheets, readableAngle, scaleBarSpec, sheetLayout, sheetMargins, sheetSize, technicalSheetFilename,
  titleBlockSize, wallOutline, type TechnicalSheetOptions,
} from '$lib/utils/technicalSheet';
import { parseColor, pdfSymbolContext } from '$lib/utils/pdfSymbolContext';
import type { Project, Wall } from '$lib/models/types';
import jsPDF from 'jspdf';

const template = (name: string): Project => houseTemplates.find(t => t.name === name)!.create();

function options(patch: Partial<TechnicalSheetOptions> = {}): TechnicalSheetOptions {
  const base = defaultSheetOptions();
  return { ...base, ...patch, titleBlock: { ...base.titleBlock, ...(patch.titleBlock ?? {}) } };
}

describe('sheet geometry', () => {
  it('uses ISO 216 / ABNT sizes in both orientations', () => {
    expect(sheetSize('A4', 'portrait')).toEqual({ width: 210, height: 297 });
    expect(sheetSize('A3', 'landscape')).toEqual({ width: 420, height: 297 });
    expect(sheetSize('A0', 'landscape')).toEqual({ width: 1189, height: 841 });
  });

  it('keeps a 25 mm binding margin and the standard title block widths', () => {
    expect(sheetMargins('A4')).toEqual({ left: 25, right: 7, top: 7, bottom: 7 });
    expect(sheetMargins('A1').right).toBe(10);
    expect(titleBlockSize('A3').width).toBe(178);
    expect(titleBlockSize('A0').width).toBe(175);
  });

  it('puts the title block in the lower-right corner of the frame, inside A4 portrait', () => {
    const layout = sheetLayout('A4', 'portrait');
    expect(layout.frame.width).toBe(178);
    expect(layout.titleBlock.x + layout.titleBlock.width).toBeCloseTo(layout.frame.x + layout.frame.width);
    expect(layout.titleBlock.y + layout.titleBlock.height).toBeCloseTo(layout.frame.y + layout.frame.height);
    expect(layout.drawing.y + layout.drawing.height).toBeLessThan(layout.caption.y + 1e-6);
    expect(layout.notes).toBeNull();
    expect(sheetLayout('A3', 'landscape').notes?.width).toBeGreaterThan(150);
  });
});

describe('scale selection', () => {
  const allowance = dimensionAllowance({ chainDimensions: true });

  it('picks 1:50 for a 10 × 8 m house on A3 landscape', () => {
    const area = sheetLayout('A3', 'landscape').drawing;
    expect(chooseScale({ width: 1000, height: 800 }, area, allowance)).toBe(50);
  });

  it('needs a smaller scale on A4 and reports fixed scales that do not fit', () => {
    const area = sheetLayout('A4', 'landscape').drawing;
    const scale = chooseScale({ width: 1000, height: 800 }, area, allowance)!;
    expect(scale).toBeGreaterThan(50);
    expect(planFits({ width: 1000, height: 800 }, area, 50, allowance)).toBe(false);
    expect(planFits({ width: 1000, height: 800 }, area, scale, allowance)).toBe(true);
  });

  it('marks a forced scale that overflows the sheet and suggests one that fits', () => {
    const project = template('2-Bedroom House');
    const [entry] = planSheets(project, options({ format: 'A4', orientation: 'portrait', scale: 20 }));
    expect(entry.scale).toBe(20);
    expect(entry.fits).toBe(false);
    expect(entry.suggestedScale).toBeGreaterThan(20);
  });

  it('sizes the graphic scale in whole metres', () => {
    expect(scaleBarSpec(50)).toEqual({ meters: 2, length: 40 });
    expect(scaleBarSpec(100).meters).toBe(5);
  });
});

describe('formatting', () => {
  it('writes metres with a decimal comma in Portuguese', () => {
    expect(formatMeters(345, 'pt')).toBe('3,45');
    expect(formatMeters(15, 'pt')).toBe('0,15');
    expect(formatMeters(345, 'en')).toBe('3.45');
    expect(formatSquareMeters(12.5, 'pt')).toBe('12,50 m²');
  });

  it('keeps dimension text readable left-to-right or bottom-to-top', () => {
    expect(readableAngle(1, 0)).toBe(0);
    expect(readableAngle(-1, 0)).toBe(0);
    expect(readableAngle(0, -1)).toBeCloseTo(90);
    expect(readableAngle(0, 1)).toBeCloseTo(90);
  });
});

describe('wall outlines', () => {
  const wall = (id: string, x1: number, y1: number, x2: number, y2: number): Wall => ({
    id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 20, height: 280, color: '#fff',
  });

  it('squares joined corners and leaves free ends flush', () => {
    const a = wall('a', 0, 0, 400, 0), b = wall('b', 400, 0, 400, 300);
    const outline = wallOutline(a, [a, b]);
    const xs = outline.map(p => p.x);
    expect(Math.min(...xs)).toBe(0); // free end
    expect(Math.max(...xs)).toBe(410); // joined end extends by half the thickness
  });

  it('follows curved walls with an offset band', () => {
    const curved: Wall = { ...wall('c', 0, 0, 400, 0), curvePoint: { x: 200, y: 200 } };
    const outline = wallOutline(curved, [curved]);
    expect(outline.length).toBeGreaterThan(40);
  });
});

describe('symbol PDF adapter', () => {
  it('parses canvas colours including translucent hex', () => {
    expect(parseColor('#ff000060')).toEqual({ r: 255, g: 0, b: 0, a: 0x60 / 255 });
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
  });

  it('rejects drawing commands the symbols are not allowed to use', () => {
    const pdf = new jsPDF({ unit: 'mm' });
    const ctx = pdfSymbolContext(pdf, [1, 0, 0, 1, 0, 0], { mono: true, minLine: 0.1, maxLine: 0.3 });
    expect(() => (ctx as unknown as { drawImage(): void }).drawImage()).toThrow(/Unsupported symbol PDF command/);
  });
});

describe('technical sheet PDF', () => {
  const titleBlock = {
    company: 'Tonon Engenharia', responsible: 'Eng. Civil Fulano de Tal', registry: 'CREA-ES 000000/D', art: '0000000000',
    client: 'Cliente Exemplo', work: 'Residência Unifamiliar', address: 'Rua Exemplo, 100 — Serra/ES', drawnBy: 'J.T.',
    revision: '00', notes: 'Medidas internas de face a face de parede.',
  };

  it('draws a vector A3 sheet at 1:50 with title block, chain dimensions and furniture', () => {
    const project = template('2-Bedroom House');
    const result = buildTechnicalSheets(project, options({ titleBlock: { ...defaultSheetOptions().titleBlock, ...titleBlock } }), 'pt', null, new Date(2026, 9, 24), { compress: false })!;
    expect(result.pages).toBe(1);
    expect(result.overflow).toEqual([]);
    const e = result.entries[0];
    expect([50, 75]).toContain(e.scale);
    expect(e.fits).toBe(true);
    const width = result.pdf.internal.pageSize.getWidth(), height = result.pdf.internal.pageSize.getHeight();
    expect(width).toBeCloseTo(420, 0);
    expect(height).toBeCloseTo(297, 0);
    const raw = result.pdf.output();
    for (const text of ['PLANTA BAIXA', `ESCALA 1:${e.scale}`, 'RESPONS', 'CREA-ES 000000/D', '01/01', '24/10/2026', 'ASSINATURA']) {
      expect(raw).toContain(text);
    }
    // Vector output: plenty of line segments and no raster plan image.
    expect((raw.match(/ l\n/g) ?? []).length).toBeGreaterThan(400);
    expect(raw).not.toContain('/Subtype /Image');
    if (process.env.SHEET_OUT) {
      mkdirSync(dirname(process.env.SHEET_OUT), { recursive: true });
      writeFileSync(process.env.SHEET_OUT, Buffer.from(result.pdf.output('arraybuffer')));
    }
  });

  it('prints one numbered sheet per floor and an optional perspective sheet', () => {
    const project = template('2-Bedroom House');
    const second = structuredClone(project.floors[0]);
    second.id = 'upper'; second.name = 'Pavimento Superior'; second.level = 1;
    project.floors.push(second);
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const result = buildTechnicalSheets(project, options({ floors: 'all', include3D: true, format: 'A4', orientation: 'landscape' }), 'pt', { dataUrl: pixel, width: 1600, height: 900 }, new Date(), { compress: false })!;
    expect(result.pages).toBe(3);
    const raw = result.pdf.output();
    expect(raw).toContain('01/03');
    expect(raw).toContain('03/03');
    expect(raw).toContain('PERSPECTIVA 3D');
    expect(raw).toContain('SEM ESCALA');
  });

  it('can print in colour and skip furniture', () => {
    const project = template('1-Bedroom Apartment');
    const mono = buildTechnicalSheets(project, options(), 'pt', null, new Date(), { compress: false })!.pdf.output();
    const bare = buildTechnicalSheets(project, options({ furniture: false, mono: false }), 'pt', null, new Date(), { compress: false })!.pdf.output();
    expect(bare.length).toBeLessThan(mono.length);
  });

  it('names the file after the work', () => {
    expect(technicalSheetFilename(template('Studio Apartment'), options({ titleBlock: { ...defaultSheetOptions().titleBlock, work: 'Casa / Lote 3' } })))
      .toBe('Casa - Lote 3 - A3.pdf');
  });
});
