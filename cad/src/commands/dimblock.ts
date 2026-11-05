/**
 * Turns dimension graphics (../geom/dimgeom) into the anonymous block a dimension is drawn from,
 * sized by the drawing's current dimension style.
 */
import {
  AcDbBlockTableRecord, AcDbDimension, AcDbLine, AcDbMText, AcDbSolid, AcGePoint3d, type AcDbDatabase,
} from '@mlightcad/data-model';
import type { DimGraphics, DimSizes } from '../geom/dimgeom';

/** Sizes from the current dimension style (or AutoCAD's metric defaults) times its scale. */
export function dimSizes(db: AcDbDatabase): DimSizes {
  const table = db.tables.dimStyleTable;
  const style = table.getAt(db.dimstyle || 'Standard') ?? table.getAt('Standard') ?? table.getAt('ISO-25');
  const k = style?.dimscale && style.dimscale > 0 ? style.dimscale : 1;
  const pick = (value: number | undefined, fallback: number) => (value && value > 0 ? value : fallback);
  // Very small text with no scale usually means a millimetre or metre drawing never set up for
  // plotting: fall back to a size readable at 1:50.
  let scale = k;
  if (k === 1 && (db.insunits === 4 || db.insunits === 6)) scale = db.insunits === 4 ? 50 : 0.05;
  const blk = (style as unknown as { dimblk?: string; dimtsz?: number } | undefined);
  return {
    text: pick(style?.dimtxt, 2.5) * scale,
    arrow: pick(style?.dimasz, 2.5) * scale,
    offset: pick(style?.dimexo, 0.625) * scale,
    extend: pick(style?.dimexe, 1.25) * scale,
    gap: pick(style?.dimgap, 0.625) * scale,
    ticks: !!blk && ((blk.dimtsz ?? 0) > 0 || /TICK|OBLIQUE/i.test(blk.dimblk ?? '')),
  };
}

function nextBlockName(db: AcDbDatabase) {
  let max = 0;
  for (const block of db.tables.blockTable.newIterator()) {
    const m = /^\*D(\d+)$/.exec(block.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `*D${max + 1}`;
}

const p3 = (p: { x: number; y: number }) => new AcGePoint3d(p.x, p.y, 0);

/** Writes the graphics into a new anonymous block and points the dimension at it. */
export function attachDimBlock(db: AcDbDatabase, dim: AcDbDimension, g: DimGraphics) {
  const block = new AcDbBlockTableRecord();
  block.name = nextBlockName(db);
  for (const [a, b] of g.lines) {
    const line = new AcDbLine(p3(a), p3(b));
    line.layer = '0';
    block.appendEntity(line);
  }
  for (const [a, b, c] of g.arrows) {
    const solid = new AcDbSolid();
    solid.setPointAt(0, p3(a));
    solid.setPointAt(1, p3(b));
    solid.setPointAt(2, p3(c));
    solid.setPointAt(3, p3(c));
    solid.layer = '0';
    block.appendEntity(solid);
  }
  const text = new AcDbMText();
  text.layer = '0';
  text.attachmentPoint = 8 as never; // bottom centre: sits on the dimension line
  text.location = p3(g.text.at);
  text.height = g.text.height;
  text.rotation = g.text.rotation;
  // The renderer reads the text direction; keep both in step.
  text.direction = { x: Math.cos(g.text.rotation), y: Math.sin(g.text.rotation), z: 0 };
  text.contents = g.text.content;
  block.appendEntity(text);
  // Replace a previous block of this dimension (after a stretch).
  const previous = dim.dimBlockId;
  db.tables.blockTable.add(block);
  dim.dimBlockId = block.name;
  if (previous && previous !== block.name && /^\*D\d+$/.test(previous)) db.tables.blockTable.remove(previous);
}
