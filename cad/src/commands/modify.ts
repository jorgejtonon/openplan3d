/**
 * Editing commands the viewer library does not have: trim, extend, fillet, chamfer, mirror, scale,
 * stretch, explode, join, break and array. Written for the phone: one tap per object, with
 * Portuguese prompts, and every change undoable.
 */
import {
  AcApDocManager, AcEdCommand, AcEdOpenMode, AcEdPromptBoxOptions, AcEdPromptStatus,
  AcEdSelectionTransformPreviewJig, type AcApContext, type AcEdSelectionPreviewTransform,
} from '@mlightcad/cad-simple-viewer';
import {
  AcDbAlignedDimension, AcDbArc, AcDbBlockReference, AcDbCircle, AcDbEntity, AcDbLine, AcDbMText, AcDbPolyline, AcDbText, AcGeMatrix3d,
  AcGePoint2d, type AcDbDatabase,
} from '@mlightcad/data-model';
import {
  CornerError, breakPath, chamferLines, dist, extendPath, extensionOf, filletLines, joinPaths, mirrorAffine,
  pathClosest, pathEnd, pathFromVertices, pathParamOfPoint, pathStart, polarArrayAngles, rectArrayOffsets, rotateAffine,
  scaleAffine, translateAffine, trimPath, type Affine, type P, type Path,
} from '../geom/path';
import {
  appendWithTraits, copyTraits, entityBox, entityForPath, entityForSeg, intersectionsWith, isEditableCurve, matrixOf,
  polylineVertices, replaceWithPieces, toPath, visibleNeighbours,
} from '../geom/entities';
import { rebuildLinearDimension } from './annotate';
import { askAngle, askDistance, askEntity, askInteger, askNumber, askOption, askPoint, askSelection, say, type Option } from './prompt';

/** Commands that change the drawing. */
abstract class EditCommand extends AcEdCommand {
  constructor() {
    super();
    this.mode = AcEdOpenMode.Write;
  }
}

/** Commands made of many small edits (one per tap): each edit is its own undo step and shows at
 * once, instead of the whole command being one transaction drawn only at the end. */
abstract class StepCommand extends EditCommand {
  constructor() {
    super();
    this.recordsUndoStack = false;
  }

  protected step<T>(database: AcDbDatabase, label: string, fn: () => T): T {
    let result!: T;
    database.runDatabaseEdit(label, () => { result = fn(); });
    return result;
  }
}

const isLocked = (database: AcDbDatabase, entity: AcDbEntity) => !!database.tables.layerTable.getAt(entity.layer)?.isLocked;

function sizeOf(path: Path) {
  let s = 1;
  for (const seg of path.segs) {
    const pts = seg.kind === 'line' ? [seg.a, seg.b] : [seg.c];
    for (const p of pts) s = Math.max(s, Math.abs(p.x), Math.abs(p.y));
    if (seg.kind === 'arc') s = Math.max(s, seg.r);
  }
  return s;
}

/** Diagonal of the drawing, how far an extension may reach. */
function drawingReach(database: AcDbDatabase) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of visibleNeighbours(database, null)) {
    const b = entityBox(e);
    if (!b || Math.abs(b.minX) > 1e11 || Math.abs(b.maxX) > 1e11) continue;
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) * 2 + 1 : 1e6;
}

const CURVES_ONLY = 'Use em linha, arco, círculo ou polilinha.';

// ---------------------------------------------------------------- TRIM

export class TrimCmd extends StepCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    say('Aparar: todas as linhas do desenho servem de limite. Toque nas partes a remover; Enter termina.');
    for (;;) {
      const picked = await askEntity('Toque na parte a aparar');
      if (picked.kind !== 'value') break;
      const { entity, point } = picked.value;
      if (!isEditableCurve(entity)) { say(`Esse objeto não pode ser aparado. ${CURVES_ONLY}`, 'warning'); continue; }
      if (isLocked(database, entity)) { say('O objeto está numa camada bloqueada.', 'warning'); continue; }
      const path = toPath(entity);
      if (!path) continue;
      const tol = sizeOf(path) * 1e-7;
      const hits = intersectionsWith(entity, visibleNeighbours(database, entityBox(entity), entity));
      const cuts = hits.map(h => pathParamOfPoint(path, h, tol)).filter((u): u is number => u !== null);
      const pieces = trimPath(path, cuts, pathClosest(path, point).u);
      if (!pieces) { say('Nada cruza essa parte. Para tirar o objeto inteiro, use Apagar.', 'warning'); continue; }
      this.step(database, 'TRIM', () => replaceWithPieces(database, entity, pieces));
    }
  }
}

// ---------------------------------------------------------------- EXTEND

export class ExtendCmd extends StepCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    say('Estender: toque perto da ponta que deve ir até a próxima linha; Enter termina.');
    const reach = drawingReach(database);
    for (;;) {
      const picked = await askEntity('Toque perto da ponta a estender');
      if (picked.kind !== 'value') break;
      const { entity, point } = picked.value;
      if (!isEditableCurve(entity) || entity instanceof AcDbCircle) { say('Use em linha, arco ou polilinha aberta.', 'warning'); continue; }
      const path = toPath(entity);
      if (!path || path.closed) { say('Polilinha fechada não tem ponta para estender.', 'warning'); continue; }
      if (isLocked(database, entity)) { say('O objeto está numa camada bloqueada.', 'warning'); continue; }
      const atEnd = dist(point, pathEnd(path)) <= dist(point, pathStart(path));
      const extension = entityForSeg(extensionOf(path, atEnd, reach));
      const hits = intersectionsWith(extension, visibleNeighbours(database, entityBox(extension), entity));
      const extended = extendPath(path, atEnd, hits, reach);
      if (!extended) { say('Nenhuma linha à frente dessa ponta.', 'warning'); continue; }
      this.step(database, 'EXTEND', () => replaceWithPieces(database, entity, [extended]));
    }
  }
}

// ---------------------------------------------------------------- FILLET / CHAMFER

const lineOf = (e: AcDbLine) => ({ a: { x: e.startPoint.x, y: e.startPoint.y }, b: { x: e.endPoint.x, y: e.endPoint.y } });

function applyCorner(database: AcDbDatabase, first: AcDbLine, second: AcDbLine, result: ReturnType<typeof filletLines>) {
  for (const [entity, geometry] of [[first, result.line1], [second, result.line2]] as const) {
    const line = database.openEntityForWrite(entity) as AcDbLine | undefined;
    if (!line) continue;
    if (!geometry) { line.erase(); continue; }
    line.startPoint = { x: geometry.a.x, y: geometry.a.y, z: 0 };
    line.endPoint = { x: geometry.b.x, y: geometry.b.y, z: 0 };
  }
  if (result.joint) appendWithTraits(database, first, [entityForPath({ closed: false, segs: [result.joint] })]);
}

async function pickTwoLines(first: string, second: string, options: Option[], onOption: (option: string) => Promise<boolean>) {
  let a: { entity: AcDbLine; point: P } | null = null;
  while (!a) {
    const picked = await askEntity(first, options);
    if (picked.kind === 'option') { if (!(await onOption(picked.option))) return null; continue; }
    if (picked.kind !== 'value') return null;
    if (!(picked.value.entity instanceof AcDbLine)) { say('Por enquanto funciona entre duas linhas.', 'warning'); continue; }
    a = { entity: picked.value.entity, point: picked.value.point };
  }
  for (;;) {
    const picked = await askEntity(second);
    if (picked.kind !== 'value') return null;
    if (!(picked.value.entity instanceof AcDbLine) || picked.value.entity === a.entity) { say('Escolha outra linha.', 'warning'); continue; }
    return { a, b: { entity: picked.value.entity, point: picked.value.point } };
  }
}

export class FilletCmd extends StepCommand {
  static radius = 0;

  async execute(context: AcApContext) {
    const database = context.doc.database;
    for (;;) {
      say(`Concordância com raio ${FilletCmd.radius}. Raio 0 fecha o canto.`);
      const pair = await pickTwoLines('Toque na primeira linha', 'Toque na segunda linha', [['Raio(R)', 'Radius', 'Raio']], async () => {
        const r = await askDistance('Raio da concordância', FilletCmd.radius);
        if (r.kind === 'value') FilletCmd.radius = r.value;
        return r.kind !== 'cancel';
      });
      if (!pair) return;
      try {
        const result = filletLines(lineOf(pair.a.entity), pair.a.point, lineOf(pair.b.entity), pair.b.point, FilletCmd.radius);
        this.step(database, 'FILLET', () => applyCorner(database, pair.a.entity, pair.b.entity, result));
      } catch (error) {
        if (error instanceof CornerError) say(error.reason === 'parallel' ? 'As linhas são paralelas.' : 'O raio não cabe nessas linhas.', 'warning');
        else throw error;
      }
    }
  }
}

export class ChamferCmd extends StepCommand {
  static d1 = 0;
  static d2 = 0;

  async execute(context: AcApContext) {
    const database = context.doc.database;
    for (;;) {
      say(`Chanfro com distâncias ${ChamferCmd.d1} e ${ChamferCmd.d2}.`);
      const pair = await pickTwoLines('Toque na primeira linha', 'Toque na segunda linha', [['Distância(D)', 'Distance', 'Distancia']], async () => {
        const a = await askDistance('Primeira distância do chanfro', ChamferCmd.d1);
        if (a.kind !== 'value') return a.kind !== 'cancel';
        ChamferCmd.d1 = a.value;
        const b = await askDistance('Segunda distância do chanfro', a.value);
        if (b.kind === 'value') ChamferCmd.d2 = b.value;
        return b.kind !== 'cancel';
      });
      if (!pair) return;
      try {
        const result = chamferLines(lineOf(pair.a.entity), pair.a.point, lineOf(pair.b.entity), pair.b.point, ChamferCmd.d1, ChamferCmd.d2);
        this.step(database, 'CHAMFER', () => applyCorner(database, pair.a.entity, pair.b.entity, result));
      } catch (error) {
        if (error instanceof CornerError) say(error.reason === 'parallel' ? 'As linhas são paralelas.' : 'A distância não cabe nessas linhas.', 'warning');
        else throw error;
      }
    }
  }
}

// ---------------------------------------------------------------- transforms with preview

class AffinePreviewJig extends AcEdSelectionTransformPreviewJig<{ x: number; y: number; z: number }> {
  constructor(view: AcApContext['view'], entities: AcDbEntity[], private readonly build: (p: P) => Affine | null) {
    super(view, entities);
  }

  protected buildTransforms(point: { x: number; y: number }): AcEdSelectionPreviewTransform[] {
    const m = this.build({ x: point.x, y: point.y });
    const matrix = m ? matrixOf(m) : new AcGeMatrix3d();
    return this.previewEntries.map(entry => ({ objectId: entry.entity.objectId, matrix }));
  }
}

const isText = (e: AcDbEntity) => e instanceof AcDbText || e instanceof AcDbMText;

/** Mirrors keeping text readable (as AutoCAD with MIRRTEXT 0): text moves to its mirrored spot. */
function mirrorEntity(entity: AcDbEntity, m: Affine) {
  if (isText(entity)) {
    const b = entityBox(entity);
    if (!b) return;
    const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    const t = { x: m[0] * c.x + m[1] * c.y + m[2], y: m[3] * c.x + m[4] * c.y + m[5] };
    entity.transformBy(matrixOf(translateAffine(t.x - c.x, t.y - c.y)));
    return;
  }
  entity.transformBy(matrixOf(m));
}

export class MirrorCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const entities = await askSelection('Selecione os objetos a espelhar');
    if (!entities) return;
    const first = await askPoint('Primeiro ponto do eixo de espelhamento');
    if (first.kind !== 'value') return;
    const p1 = first.value;
    const jig = new AffinePreviewJig(context.view, entities, p => (dist(p, p1) > 0 ? mirrorAffine(p1, p) : null));
    const second = await askPoint('Segundo ponto do eixo', { base: p1, jig });
    if (second.kind !== 'value') return;
    const m = mirrorAffine(p1, second.value);
    const erase = await askOption('Apagar os objetos de origem?', [['Sim(S)', 'Yes', 'Sim'], ['Não(N)', 'No', 'Nao']], 'No');
    if (erase === null) return;
    if (erase === 'Yes') {
      for (const entity of entities) { const e = database.openEntityForWrite(entity); if (e) mirrorEntity(e, m); }
    } else {
      const copies = entities.map(e => e.clone()).filter((e): e is AcDbEntity => !!e);
      copies.forEach(e => mirrorEntity(e, m));
      database.tables.blockTable.modelSpace.appendEntity(copies);
    }
    context.view.selectionSet.clear();
  }
}

export class ScaleCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const entities = await askSelection('Selecione os objetos para mudar a escala');
    if (!entities) return;
    const basePick = await askPoint('Ponto base');
    if (basePick.kind !== 'value') return;
    const base = basePick.value;
    let factor: number | null = null;
    const factorAnswer = await askNumber('Fator de escala (ex.: 2, 0.5) ou [Referência(R)]', 1);
    if (factorAnswer.kind === 'value') factor = factorAnswer.value;
    else if (factorAnswer.kind === 'option' || factorAnswer.kind === 'none') factor = 1;
    if (factorAnswer.kind === 'cancel') return;
    if (factor === 1) {
      const ref = await askOption('Usar referência? Informe um comprimento atual e o novo', [['Referência(R)', 'Reference', 'Referencia'], ['Fator(F)', 'Factor', 'Fator']], 'Factor');
      if (ref === 'Reference') {
        const current = await askDistance('Comprimento atual (digite ou marque dois pontos)', undefined, base);
        if (current.kind !== 'value' || current.value <= 0) return;
        const wanted = await askDistance('Comprimento novo', undefined, base);
        if (wanted.kind !== 'value' || wanted.value <= 0) return;
        factor = wanted.value / current.value;
      } else if (ref === null) return;
    }
    if (!factor || factor <= 0) { say('O fator precisa ser maior que zero.', 'warning'); return; }
    const matrix = matrixOf(scaleAffine(base, factor));
    for (const entity of entities) database.openEntityForWrite(entity)?.transformBy(matrix);
    say(`Escala ${factor} aplicada a ${entities.length} objeto(s).`);
    context.view.selectionSet.clear();
  }
}

// ---------------------------------------------------------------- STRETCH

export class StretchCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const box = await AcApDocManager.instance.editor.getBox(new AcEdPromptBoxOptions(
      'Esticar: primeiro canto da janela que pega as pontas a mover', 'Canto oposto'));
    if (box.status !== AcEdPromptStatus.OK || !box.value) return;
    const win = { minX: Math.min(box.value.min.x, box.value.max.x), minY: Math.min(box.value.min.y, box.value.max.y),
      maxX: Math.max(box.value.min.x, box.value.max.x), maxY: Math.max(box.value.min.y, box.value.max.y) };
    const inside = (p: { x: number; y: number }) => p.x >= win.minX && p.x <= win.maxX && p.y >= win.minY && p.y <= win.maxY;
    const touched = visibleNeighbours(database, win).filter(e => !isLocked(database, e));
    if (!touched.length) { say('Nenhum objeto na janela.', 'warning'); return; }
    const basePick = await askPoint('Ponto base');
    if (basePick.kind !== 'value') return;
    const second = await askPoint('Segundo ponto', { base: basePick.value });
    if (second.kind !== 'value') return;
    const d = { x: second.value.x - basePick.value.x, y: second.value.y - basePick.value.y };
    const move = matrixOf(translateAffine(d.x, d.y));
    let count = 0;
    for (const entity of touched) {
      const e = database.openEntityForWrite(entity);
      if (!e) continue;
      if (e instanceof AcDbPolyline) {
        const vertices = polylineVertices(e);
        if (!vertices.some(inside)) continue;
        const closed = e.closed;
        e.reset(false);
        vertices.forEach((v, i) => {
          const p = inside(v) ? { x: v.x + d.x, y: v.y + d.y } : v;
          e.addVertexAt(i, new AcGePoint2d(p.x, p.y), v.bulge);
        });
        e.closed = closed;
        count++;
      } else if (e instanceof AcDbLine) {
        const a = inside(e.startPoint), b = inside(e.endPoint);
        if (!a && !b) continue;
        if (a) e.startPoint = { x: e.startPoint.x + d.x, y: e.startPoint.y + d.y, z: e.startPoint.z };
        if (b) e.endPoint = { x: e.endPoint.x + d.x, y: e.endPoint.y + d.y, z: e.endPoint.z };
        count++;
      } else if (e instanceof AcDbCircle || e instanceof AcDbArc) {
        if (inside(e.center)) { e.transformBy(move); count++; }
      } else if (e instanceof AcDbAlignedDimension) {
        const points = [e.xLine1Point, e.xLine2Point, e.dimLinePoint];
        const flags = points.map(inside);
        if (!flags.some(Boolean)) continue;
        if (flags.every(Boolean)) { e.transformBy(move); count++; continue; }
        const shift = (p: { x: number; y: number; z: number }) => ({ x: p.x + d.x, y: p.y + d.y, z: p.z });
        if (flags[0]) e.xLine1Point = shift(e.xLine1Point);
        if (flags[1]) e.xLine2Point = shift(e.xLine2Point);
        if (flags[2]) e.dimLinePoint = shift(e.dimLinePoint);
        rebuildLinearDimension(database, e);
        count++;
      } else {
        // Blocks, text and others move when their insertion point is in the window; dimensions
        // move the definition points inside it.
        let grips: { x: number; y: number }[] = [];
        try { grips = e.subGetGripPoints(); } catch { /* none */ }
        const indices = grips.map((g, i) => (inside(g) ? i : -1)).filter(i => i >= 0);
        if (!indices.length) continue;
        if (indices.length === grips.length || e instanceof AcDbBlockReference || isText(e)) e.transformBy(move);
        else e.subMoveGripPointsAt(indices, { x: d.x, y: d.y, z: 0 });
        count++;
      }
    }
    say(`${count} objeto(s) esticado(s).`);
  }
}

// ---------------------------------------------------------------- EXPLODE / JOIN / BREAK

export class ExplodeCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const entities = await askSelection('Selecione polilinhas ou blocos para explodir');
    if (!entities) return;
    let done = 0, skipped = 0;
    for (const entity of entities) {
      let parts: AcDbEntity[] = [];
      if (entity instanceof AcDbPolyline) {
        const path = toPath(entity);
        parts = path ? path.segs.map(seg => entityForPath({ closed: false, segs: [seg] })) : [];
        parts.forEach(p => copyTraits(entity, p));
      } else if (entity instanceof AcDbBlockReference) {
        const record = entity.blockTableRecord;
        const transform = entity.blockTransform;
        if (record) for (const child of record.newIterator()) {
          const copy = child.clone();
          if (!copy) continue;
          copy.transformBy(transform);
          // Objects on layer 0 inside a block take the block's layer.
          if (copy.layer === '0') copy.layer = entity.layer;
          parts.push(copy);
        }
      }
      if (!parts.length) { skipped++; continue; }
      database.openEntityForWrite(entity)?.erase();
      database.tables.blockTable.modelSpace.appendEntity(parts);
      done++;
    }
    say(`${done} objeto(s) explodido(s)${skipped ? `; ${skipped} não podem ser explodidos` : ''}.`);
    context.view.selectionSet.clear();
  }
}

export class JoinCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const entities = await askSelection('Selecione linhas, arcos e polilinhas que se tocam');
    if (!entities) return;
    const paths: { e: AcDbEntity; path: Path }[] = [];
    for (const e of entities) {
      if (!isEditableCurve(e) || e instanceof AcDbCircle) continue;
      const path = toPath(e);
      if (path && !path.closed) paths.push({ e, path });
    }
    if (paths.length < 2) { say('Selecione pelo menos dois objetos abertos que se toquem.', 'warning'); return; }
    const size = Math.max(...paths.map(x => sizeOf(x.path)));
    const joined = joinPaths(paths.map(x => x.path), size * 1e-6);
    const created = joined.filter(p => p.segs.length > 1).map(p => { const pl = entityForPath(p, true); copyTraits(paths[0].e, pl); return pl; });
    if (!created.length) { say('Nada para unir: as pontas não se tocam.', 'warning'); return; }
    // Sources that went into a chain are replaced by it; isolated ones stay.
    const used = new Set<AcDbEntity>();
    for (const chain of joined.filter(p => p.segs.length > 1)) {
      for (const x of paths) if (chain.segs.some(s => x.path.segs.some(t => sameSeg(s, t)))) used.add(x.e);
    }
    for (const e of used) database.openEntityForWrite(e)?.erase();
    database.tables.blockTable.modelSpace.appendEntity(created);
    say(`${used.size} objeto(s) unidos em ${created.length} polilinha(s).`);
    context.view.selectionSet.clear();
  }
}

function sameSeg(a: Path['segs'][number], b: Path['segs'][number]) {
  const ends = (s: Path['segs'][number]) => s.kind === 'line' ? [s.a, s.b] : [s.c];
  const pa = ends(a), pb = ends(b);
  if (a.kind !== b.kind) return false;
  if (a.kind === 'line') return (dist(pa[0], pb[0]) < 1e-9 && dist(pa[1], pb[1]) < 1e-9) || (dist(pa[0], pb[1]) < 1e-9 && dist(pa[1], pb[0]) < 1e-9);
  return dist(pa[0], pb[0]) < 1e-9 && a.kind === 'arc' && b.kind === 'arc' && Math.abs(a.r - b.r) < 1e-9;
}

export class BreakCmd extends StepCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const picked = await askEntity('Toque no objeto a quebrar (o toque é o primeiro ponto)', [], false);
    if (picked.kind !== 'value') return;
    const { entity } = picked.value;
    let p1 = picked.value.point;
    if (!isEditableCurve(entity)) { say(`Esse objeto não pode ser quebrado. ${CURVES_ONLY}`, 'warning'); return; }
    const path = toPath(entity);
    if (!path) return;
    let second = await askPoint('Segundo ponto (Enter quebra só no primeiro) ou [Primeiro ponto(F)]', {
      allowNone: true, options: [['Primeiro ponto(F)', 'First', 'Primeiro']] });
    if (second.kind === 'option') {
      const first = await askPoint('Primeiro ponto da quebra');
      if (first.kind !== 'value') return;
      p1 = first.value;
      second = await askPoint('Segundo ponto (Enter quebra só no primeiro)', { allowNone: true, base: p1 });
    }
    if (second.kind === 'cancel') return;
    const u1 = pathClosest(path, p1).u;
    const u2 = second.kind === 'value' ? pathClosest(path, second.value).u : u1;
    if (path.closed && Math.abs(u1 - u2) < 1e-9) { say('Para quebrar um objeto fechado, marque dois pontos.', 'warning'); return; }
    this.step(database, 'BREAK', () => replaceWithPieces(database, entity, breakPath(path, u1, u2)));
  }
}

// ---------------------------------------------------------------- ARRAY

export class ArrayCmd extends EditCommand {
  async execute(context: AcApContext) {
    const database = context.doc.database;
    const entities = await askSelection('Selecione os objetos da matriz');
    if (!entities) return;
    const kind = await askOption('Tipo de matriz', [['Retangular(R)', 'Rectangular', 'Retangular'], ['Polar(P)', 'Polar', 'Polar']], 'Rectangular');
    if (!kind) return;
    const copies: AcDbEntity[] = [];
    const place = (m: Affine) => {
      for (const e of entities) { const c = e.clone(); if (c) { c.transformBy(matrixOf(m)); copies.push(c); } }
    };
    if (kind === 'Rectangular') {
      const rows = await askInteger('Número de linhas', 1); if (rows.kind !== 'value') return;
      const cols = await askInteger('Número de colunas', 3); if (cols.kind !== 'value') return;
      let dy = 0, dx = 0;
      if (rows.value > 1) { const a = await askNumber('Distância entre linhas (negativa vai para baixo)', 1000, true); if (a.kind !== 'value') return; dy = a.value; }
      if (cols.value > 1) { const a = await askNumber('Distância entre colunas (negativa vai para a esquerda)', 1000, true); if (a.kind !== 'value') return; dx = a.value; }
      for (const o of rectArrayOffsets(rows.value, cols.value, dy, dx)) place(translateAffine(o.x, o.y));
    } else {
      const centre = await askPoint('Centro da matriz polar');
      if (centre.kind !== 'value') return;
      const count = await askInteger('Número de itens (contando o original)', 6, 2); if (count.kind !== 'value') return;
      const fill = await askAngle('Ângulo a preencher (graus; 360 = volta completa)', Math.PI * 2);
      if (fill.kind !== 'value') return;
      for (const a of polarArrayAngles(count.value, fill.value || Math.PI * 2)) place(rotateAffine(centre.value, a));
    }
    database.tables.blockTable.modelSpace.appendEntity(copies);
    say(`${copies.length} cópia(s) criada(s).`);
    context.view.selectionSet.clear();
  }
}

/** Used by the tests and the toolbar: polyline built from a list of points. */
export function polylineFrom(points: P[], closed = false) {
  const pl = entityForPath(pathFromVertices(points.map(p => ({ ...p, bulge: 0 })), closed), true) as AcDbPolyline;
  return pl;
}
