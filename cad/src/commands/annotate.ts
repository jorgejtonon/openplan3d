/**
 * Dimensions and text: aligned, linear, radius, diameter, angular and continued dimensions, single
 * line text, text editing and copying properties. Measurements are written the Brazilian way:
 * decimal comma, decimals by drawing unit (mm 0, cm 1, m 2).
 */
import { AcEdCommand, AcEdOpenMode, type AcApContext } from '@mlightcad/cad-simple-viewer';
import {
  AcDb3PointAngularDimension, AcDbAlignedDimension, AcDbArc, AcDbCircle, AcDbDiametricDimension, AcDbDimension,
  AcDbLine, AcDbMText, AcDbRadialDimension, AcDbText, AcGePoint3d, type AcDbDatabase,
} from '@mlightcad/data-model';
import { dist, filletLines, type P } from '../geom/path';
import { copyTraits } from '../geom/entities';
import { angularDimGraphics, diameterDimGraphics, linearDimGraphics, radialDimGraphics } from '../geom/dimgeom';
import { attachDimBlock, dimSizes } from './dimblock';
import { askAngle, askDistance, askEntity, askPoint, askSelection, askText, say } from './prompt';

abstract class EditCommand extends AcEdCommand {
  constructor() { super(); this.mode = AcEdOpenMode.Write; }
}

const p3 = (p: P) => new AcGePoint3d(p.x, p.y, 0);

/** Decimals shown for a drawing unit (INSUNITS). */
export function unitDecimals(insunits: number) {
  if (insunits === 4) return 0; // mm
  if (insunits === 5) return 1; // cm
  return 2; // m and unitless drawings
}

/** Measurement text with a decimal comma, e.g. 2,35. */
export function formatMeasure(value: number, insunits: number) {
  return value.toFixed(unitDecimals(insunits)).replace('.', ',');
}

export function formatAngle(rad: number) {
  const deg = rad * 180 / Math.PI;
  return `${(Math.abs(deg - Math.round(deg)) < 0.05 ? deg.toFixed(0) : deg.toFixed(1)).replace('.', ',')}°`;
}

const appendDim = (database: AcDbDatabase, dim: AcDbDimension) => {
  dim.layer = database.clayer || '0';
  database.tables.blockTable.modelSpace.appendEntity(dim);
};

/** Last linear dimension, which DIMCONTINUE carries on from. */
let lastLinear: { second: P; dimLine: P; rotation: number | null } | null = null;

/** Linear or aligned dimension between two points, along `rotation` (null: aligned to the points). */
function linearDimension(database: AcDbDatabase, a: P, b: P, dimLine: P, rotation: number | null) {
  const along = rotation ?? Math.atan2(b.y - a.y, b.x - a.x);
  const measured = Math.abs((b.x - a.x) * Math.cos(along) + (b.y - a.y) * Math.sin(along));
  const text = formatMeasure(measured, database.insunits ?? 0);
  const dim = new AcDbAlignedDimension(p3(a), p3(b), p3(dimLine), text);
  if (rotation !== null) dim.rotation = rotation;
  attachDimBlock(database, dim, linearDimGraphics(a, b, dimLine, along, dimSizes(database), text));
  appendDim(database, dim);
  lastLinear = { second: b, dimLine, rotation };
  return dim;
}

/**
 * Redraws a linear or aligned dimension from its definition points, after they moved (stretch).
 * The measurement is rewritten unless the text was replaced by hand.
 */
export function rebuildLinearDimension(database: AcDbDatabase, dim: AcDbAlignedDimension) {
  const xy = (p: { x: number; y: number }) => ({ x: p.x, y: p.y });
  const a = xy(dim.xLine1Point), b = xy(dim.xLine2Point), at = xy(dim.dimLinePoint);
  const rotation = dim.rotation;
  const measured = Math.abs((b.x - a.x) * Math.cos(rotation) + (b.y - a.y) * Math.sin(rotation));
  const current = dim.dimensionText ?? '';
  const text = !current || /^[\d.,\s]*$/.test(current) ? formatMeasure(measured, database.insunits ?? 0) : current;
  dim.dimensionText = text;
  // The new graphics are drawn where they belong, so the block is no longer offset or turned.
  dim.dimBlockPosition = { x: 0, y: 0, z: 0 };
  (dim as unknown as { _dimBlockRotation?: number })._dimBlockRotation = 0;
  attachDimBlock(database, dim, linearDimGraphics(a, b, at, rotation, dimSizes(database), text));
}

/** Horizontal or vertical, as AutoCAD decides it: by where the dimension line is placed. */
function linearRotation(a: P, b: P, at: P) {
  const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
  const outsideX = at.x < minX || at.x > maxX;
  const outsideY = at.y < minY || at.y > maxY;
  if (outsideX && !outsideY) return Math.PI / 2;
  if (outsideY && !outsideX) return 0;
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? 0 : Math.PI / 2;
}

async function twoPoints(): Promise<[P, P] | null> {
  const first = await askPoint('Origem da primeira linha de chamada (ou toque no ponto)');
  if (first.kind !== 'value') return null;
  const second = await askPoint('Origem da segunda linha de chamada', { base: first.value });
  if (second.kind !== 'value') return null;
  return [first.value, second.value];
}

export class DimLinearCmd extends EditCommand {
  async execute(context: AcApContext) {
    const points = await twoPoints();
    if (!points) return;
    const at = await askPoint('Posição da linha de cota', { base: points[1] });
    if (at.kind !== 'value') return;
    linearDimension(context.doc.database, points[0], points[1], at.value, linearRotation(points[0], points[1], at.value));
  }
}

export class DimAlignedCmd extends EditCommand {
  async execute(context: AcApContext) {
    const points = await twoPoints();
    if (!points) return;
    const at = await askPoint('Posição da linha de cota', { base: points[1] });
    if (at.kind !== 'value') return;
    linearDimension(context.doc.database, points[0], points[1], at.value, null);
  }
}

export class DimContinueCmd extends EditCommand {
  async execute(context: AcApContext) {
    if (!lastLinear) { say('Faça antes uma cota linear ou alinhada; a contínua segue a partir dela.', 'warning'); return; }
    const database = context.doc.database;
    say('Cota contínua: toque nos próximos pontos; Enter termina.');
    for (;;) {
      const from = lastLinear;
      if (!from) return;
      const next = await askPoint('Próximo ponto', { base: from.second, allowNone: true });
      if (next.kind !== 'value') return;
      const rotation = from.rotation ?? Math.atan2(next.value.y - from.second.y, next.value.x - from.second.x);
      // Keep the new dimension line on the same line as the previous one.
      linearDimension(database, from.second, next.value, from.dimLine, from.rotation === null ? null : rotation);
    }
  }
}

async function pickCircular(message: string) {
  for (;;) {
    const picked = await askEntity(message, [], false);
    if (picked.kind !== 'value') return null;
    const e = picked.value.entity;
    if (e instanceof AcDbCircle || e instanceof AcDbArc) return { entity: e, point: picked.value.point };
    say('Toque num arco ou círculo.', 'warning');
  }
}

export class DimRadiusCmd extends EditCommand {
  async execute(context: AcApContext) {
    const picked = await pickCircular('Toque no arco ou círculo');
    if (!picked) return;
    const c = picked.entity.center, r = picked.entity.radius;
    const at = await askPoint('Posição do texto da cota', { base: { x: c.x, y: c.y } });
    if (at.kind !== 'value') return;
    const angle = Math.atan2(at.value.y - c.y, at.value.x - c.x);
    const chord = { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
    const database = context.doc.database;
    const text = `R${formatMeasure(r, database.insunits ?? 0)}`;
    const dim = new AcDbRadialDimension(c, p3(chord), Math.max(0, dist(at.value, { x: c.x, y: c.y }) - r), text);
    attachDimBlock(database, dim, radialDimGraphics({ x: c.x, y: c.y }, r, at.value, dimSizes(database), text));
    appendDim(database, dim);
  }
}

export class DimDiameterCmd extends EditCommand {
  async execute(context: AcApContext) {
    const picked = await pickCircular('Toque no arco ou círculo');
    if (!picked) return;
    const c = picked.entity.center, r = picked.entity.radius;
    const at = await askPoint('Posição do texto da cota', { base: { x: c.x, y: c.y } });
    if (at.kind !== 'value') return;
    const angle = Math.atan2(at.value.y - c.y, at.value.x - c.x);
    const chord = { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
    const far = { x: c.x - r * Math.cos(angle), y: c.y - r * Math.sin(angle) };
    const database = context.doc.database;
    const text = `Ø${formatMeasure(2 * r, database.insunits ?? 0)}`;
    const dim = new AcDbDiametricDimension(p3(chord), p3(far), Math.max(0, dist(at.value, { x: c.x, y: c.y }) - r), text);
    attachDimBlock(database, dim, diameterDimGraphics({ x: c.x, y: c.y }, r, at.value, dimSizes(database), text));
    appendDim(database, dim);
  }
}

export class DimAngularCmd extends EditCommand {
  async execute(context: AcApContext) {
    const first = await askEntity('Toque na primeira linha do ângulo', [], false);
    if (first.kind !== 'value' || !(first.value.entity instanceof AcDbLine)) { if (first.kind === 'value') say('Toque numa linha.', 'warning'); return; }
    const second = await askEntity('Toque na segunda linha', [], false);
    if (second.kind !== 'value' || !(second.value.entity instanceof AcDbLine)) { if (second.kind === 'value') say('Toque numa linha.', 'warning'); return; }
    const l1 = first.value.entity, l2 = second.value.entity;
    let corner: P;
    try {
      const r = filletLines(
        { a: { x: l1.startPoint.x, y: l1.startPoint.y }, b: { x: l1.endPoint.x, y: l1.endPoint.y } }, first.value.point,
        { a: { x: l2.startPoint.x, y: l2.startPoint.y }, b: { x: l2.endPoint.x, y: l2.endPoint.y } }, second.value.point, 0);
      corner = r.line1!.b;
    } catch { say('As linhas são paralelas.', 'warning'); return; }
    const at = await askPoint('Posição do arco da cota', { base: corner });
    if (at.kind !== 'value') return;
    const a1 = Math.atan2(first.value.point.y - corner.y, first.value.point.x - corner.x);
    const a2 = Math.atan2(second.value.point.y - corner.y, second.value.point.x - corner.x);
    let sweep = Math.abs(a2 - a1);
    if (sweep > Math.PI) sweep = 2 * Math.PI - sweep;
    const database = context.doc.database;
    const text = formatAngle(sweep);
    const dim = new AcDb3PointAngularDimension(p3(corner), p3(first.value.point), p3(second.value.point), p3(at.value), text);
    attachDimBlock(database, dim, angularDimGraphics(corner, first.value.point, second.value.point, at.value, dimSizes(database), text));
    appendDim(database, dim);
  }
}

// ---------------------------------------------------------------- text

export class TextCmd extends EditCommand {
  static height = 0;
  static rotation = 0;

  async execute(context: AcApContext) {
    const database = context.doc.database;
    const at = await askPoint('Ponto de inserção do texto');
    if (at.kind !== 'value') return;
    const fallbackHeight = TextCmd.height || defaultTextHeight(database);
    const h = await askDistance('Altura do texto', fallbackHeight, at.value);
    if (h.kind !== 'value' || h.value <= 0) return;
    TextCmd.height = h.value;
    const r = await askAngle('Rotação (graus)', TextCmd.rotation, at.value);
    if (r.kind !== 'value') return;
    TextCmd.rotation = r.value;
    let y = 0;
    for (;;) {
      const content = await askText('Texto (Enter vazio termina)');
      if (!content) return;
      const text = new AcDbText();
      const pos = { x: at.value.x - Math.sin(r.value) * y, y: at.value.y + Math.cos(r.value) * y };
      text.position = p3(pos);
      text.height = h.value;
      text.rotation = r.value;
      text.textString = content;
      text.layer = database.clayer || '0';
      database.tables.blockTable.modelSpace.appendEntity(text);
      y -= h.value * 1.6; // next line below, as AutoCAD's TEXT does
    }
  }
}

/** A readable text size for the drawing's unit, plotted at 1:50 (2,5 mm on paper). */
export function defaultTextHeight(database: AcDbDatabase) {
  const unit = database.insunits ?? 0;
  if (unit === 4) return 125;
  if (unit === 5) return 12.5;
  return 0.125;
}

export class TextEditCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    for (;;) {
      const picked = await askEntity('Toque no texto ou na cota a editar (Enter termina)');
      if (picked.kind !== 'value') return;
      const e = picked.value.entity;
      const current = e instanceof AcDbText ? e.textString : e instanceof AcDbMText ? e.contents : e instanceof AcDbDimension ? e.dimensionText ?? '' : null;
      if (current === null) { say('Toque num texto ou numa cota.', 'warning'); continue; }
      const updated = await askText('Novo texto', current);
      if (updated === null || updated === current) continue;
      const target = database.openEntityForWrite(e);
      if (target instanceof AcDbText) target.textString = updated;
      else if (target instanceof AcDbMText) target.contents = updated;
      else if (target instanceof AcDbDimension) target.dimensionText = updated;
    }
  }
}

export class MatchPropCmd extends EditCommand {
  async execute(context: AcApContext) {
    const source = await askEntity('Toque no objeto de origem das propriedades', [], false);
    if (source.kind !== 'value') return;
    const targets = await (async () => {
      context.view.selectionSet.clear();
      return askSelection('Selecione os objetos que recebem as propriedades');
    })();
    if (!targets) return;
    const database = context.doc.database;
    for (const t of targets) { const e = database.openEntityForWrite(t); if (e && e !== source.value.entity) copyTraits(source.value.entity, e); }
    say(`Camada, cor, tipo e espessura de linha copiados para ${targets.length} objeto(s).`);
    context.view.selectionSet.clear();
  }
}

