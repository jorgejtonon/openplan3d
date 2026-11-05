/**
 * Bridges the plane geometry (./path) and drawing objects: reads lines, arcs, circles and
 * lightweight polylines as paths, and writes edited paths back, in place when the type allows so
 * handles, extended data and properties survive.
 */
import {
  AcDbArc, AcDbCircle, AcDbCurve, AcDbEntity, AcDbIntersect, AcDbLine, AcDbPolyline, AcGeMatrix3d, AcGePoint2d,
  AcGePoint3d, type AcDbDatabase,
} from '@mlightcad/data-model';
import {
  TAU, arcThrough, pathFromVertices, verticesFromPath, type Affine, type P, type Path, type Seg, type Vertex,
} from './path';

/** Objects the editing commands can reshape. */
export function isEditableCurve(entity: AcDbEntity | undefined): entity is AcDbLine | AcDbArc | AcDbCircle | AcDbPolyline {
  return entity instanceof AcDbLine || entity instanceof AcDbArc || entity instanceof AcDbCircle || entity instanceof AcDbPolyline;
}

type PolylineInternals = { _geo?: { vertices?: Array<{ bulge?: number }> } };

export function polylineVertices(pl: AcDbPolyline): Vertex[] {
  const internal = (pl as unknown as PolylineInternals)._geo?.vertices;
  const out: Vertex[] = [];
  for (let i = 0; i < pl.numberOfVertices; i++) {
    const p = pl.getPoint2dAt(i);
    out.push({ x: p.x, y: p.y, bulge: internal?.[i]?.bulge ?? 0 });
  }
  return out;
}

/** The object's shape as a path, in world XY, or null for other object types. */
export function toPath(entity: AcDbEntity): Path | null {
  if (entity instanceof AcDbLine) {
    const a = entity.startPoint, b = entity.endPoint;
    return { closed: false, segs: [{ kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }] };
  }
  if (entity instanceof AcDbArc) {
    // Read through points on the arc: they are world points whatever the arc's normal.
    const seg = arcThrough(xy(entity.startPoint), xy(entity.midPoint), xy(entity.endPoint));
    return seg ? { closed: false, segs: [seg] } : null;
  }
  if (entity instanceof AcDbCircle) {
    const c = entity.center;
    return { closed: true, segs: [{ kind: 'arc', c: { x: c.x, y: c.y }, r: entity.radius, a0: 0, sweep: TAU }] };
  }
  if (entity instanceof AcDbPolyline) {
    const path = pathFromVertices(polylineVertices(entity), entity.closed);
    return path.segs.length ? path : null;
  }
  return null;
}

const xy = (p: { x: number; y: number }): P => ({ x: p.x, y: p.y });
const p3 = (p: P) => new AcGePoint3d(p.x, p.y, 0);

/** Start and end angles (counter-clockwise) of an arc segment, as AcDbArc stores them. */
function arcAngles(seg: Extract<Seg, { kind: 'arc' }>) {
  return seg.sweep >= 0 ? [seg.a0, seg.a0 + seg.sweep] : [seg.a0 + seg.sweep, seg.a0];
}

function setPolyline(pl: AcDbPolyline, path: Path) {
  pl.reset(false);
  verticesFromPath(path).forEach((v, i) => pl.addVertexAt(i, new AcGePoint2d(v.x, v.y), v.bulge));
  pl.closed = path.closed;
}

/** Writes the path onto the entity when its type can hold it; false otherwise. */
function writeInPlace(entity: AcDbEntity, path: Path): boolean {
  const single = path.segs.length === 1 ? path.segs[0] : null;
  if (entity instanceof AcDbLine && single?.kind === 'line') {
    entity.startPoint = p3(single.a);
    entity.endPoint = p3(single.b);
    return true;
  }
  if (entity instanceof AcDbArc && single?.kind === 'arc' && Math.abs(single.sweep) < TAU - 1e-9) {
    const [start, end] = arcAngles(single);
    entity.normal = { x: 0, y: 0, z: 1 };
    entity.center = p3(single.c);
    entity.radius = single.r;
    entity.startAngle = start;
    entity.endAngle = end;
    return true;
  }
  if (entity instanceof AcDbPolyline) { setPolyline(entity, path); return true; }
  return false;
}

/** A new object for the path: line, arc, circle or polyline. */
export function entityForPath(path: Path, asPolyline = false): AcDbEntity {
  const single = path.segs.length === 1 ? path.segs[0] : null;
  if (!asPolyline && single?.kind === 'line') return new AcDbLine(p3(single.a), p3(single.b));
  if (!asPolyline && single?.kind === 'arc') {
    if (Math.abs(single.sweep) >= TAU - 1e-9) return new AcDbCircle(p3(single.c), single.r);
    const [start, end] = arcAngles(single);
    return new AcDbArc(p3(single.c), single.r, start, end);
  }
  const pl = new AcDbPolyline();
  setPolyline(pl, path);
  return pl;
}

export function copyTraits(source: AcDbEntity, target: AcDbEntity) {
  target.layer = source.layer;
  target.color = source.color.clone();
  target.lineType = source.lineType;
  target.lineWeight = source.lineWeight;
  target.linetypeScale = source.linetypeScale;
  target.transparency = source.transparency;
}

/**
 * Replaces the entity's shape by the given pieces: the first piece goes into the entity itself
 * when its type allows, the others become new objects with the same properties. No pieces erases
 * the entity.
 */
export function replaceWithPieces(db: AcDbDatabase, entity: AcDbEntity, pieces: Path[]) {
  const target = db.openEntityForWrite(entity);
  if (!target) return false;
  if (pieces.length === 0) { target.erase(); return true; }
  const keepPolyline = entity instanceof AcDbPolyline;
  const created: AcDbEntity[] = [];
  let first = true;
  for (const piece of pieces) {
    if (first && writeInPlace(target, piece)) { first = false; continue; }
    const fresh = entityForPath(piece, keepPolyline);
    copyTraits(entity, fresh);
    created.push(fresh);
  }
  if (first) target.erase(); // the original type could not hold any piece (a circle that became an arc)
  if (created.length) db.tables.blockTable.modelSpace.appendEntity(created);
  return true;
}

export function appendWithTraits(db: AcDbDatabase, source: AcDbEntity | null, entities: AcDbEntity[]) {
  if (source) entities.forEach(e => copyTraits(source, e));
  if (entities.length) db.tables.blockTable.modelSpace.appendEntity(entities);
}

// ---------------------------------------------------------------- neighbours and intersections

interface Box { minX: number; minY: number; maxX: number; maxY: number }

function boxOf(entity: AcDbEntity): Box | null {
  try {
    const b = entity.geometricExtents;
    if (!b || !Number.isFinite(b.min.x) || !Number.isFinite(b.max.x)) return null;
    return { minX: b.min.x, minY: b.min.y, maxX: b.max.x, maxY: b.max.y };
  } catch { return null; }
}

function overlaps(a: Box, b: Box, pad: number) {
  return a.minX - pad <= b.maxX && b.minX - pad <= a.maxX && a.minY - pad <= b.maxY && b.minY - pad <= a.maxY;
}

/** Visible objects of the current space that may touch the box (all of them when box is null). */
export function visibleNeighbours(db: AcDbDatabase, near: Box | null, exclude?: AcDbEntity): AcDbEntity[] {
  const table = db.tables.blockTable;
  const space = (table.getIdAt(db.currentSpaceId) ?? table.modelSpace) as typeof table.modelSpace;
  const layers = db.tables.layerTable;
  const out: AcDbEntity[] = [];
  const pad = near ? Math.max(near.maxX - near.minX, near.maxY - near.minY) * 1e-6 + 1e-9 : 0;
  for (const entity of space.newIterator()) {
    if (entity === exclude || (exclude && entity.objectId === exclude.objectId)) continue;
    if (entity.visibility === false) continue;
    const layer = layers.getAt(entity.layer);
    if (layer && (layer.isOff || layer.isFrozen)) continue;
    if (near) { const b = boxOf(entity); if (!b || !overlaps(b, near, pad)) continue; }
    out.push(entity);
  }
  return out;
}

export function entityBox(entity: AcDbEntity): Box | null { return boxOf(entity); }

/** World points where `entity` meets the others, using the library's intersection of any curve type. */
export function intersectionsWith(entity: AcDbEntity, others: AcDbEntity[], extendThis = false): P[] {
  const out: P[] = [];
  for (const other of others) {
    try {
      const points = entity.intersectWith(other, extendThis ? AcDbIntersect.ExtendThis : AcDbIntersect.OnBothOperands);
      for (const p of points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ x: p.x, y: p.y });
    } catch { /* objects without curve geometry (text, images) are not edges */ }
  }
  return out;
}

/** A temporary object for a segment, to intersect it with drawing objects. */
export function entityForSeg(seg: Seg): AcDbEntity {
  return entityForPath({ closed: false, segs: [seg] });
}

export function isCurve(entity: AcDbEntity): entity is AcDbCurve { return entity instanceof AcDbCurve; }

// ---------------------------------------------------------------- transforms

export function matrixOf(m: Affine): AcGeMatrix3d {
  return new AcGeMatrix3d().set(
    m[0], m[1], 0, m[2],
    m[3], m[4], 0, m[5],
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
}
