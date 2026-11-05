/** Short helpers over the editor prompts, so each command reads as its steps. Texts are in Portuguese. */
import {
  AcApDocManager, AcEdPromptAngleOptions, AcEdPromptDistanceOptions, AcEdPromptEntityOptions, AcEdPromptIntegerOptions,
  AcEdPromptKeywordOptions, AcEdPromptPointOptions, AcEdPromptSelectionOptions, AcEdPromptStatus, AcEdPromptStringOptions,
  type AcEdPreviewJig,
} from '@mlightcad/cad-simple-viewer';
import { AcGePoint3d, type AcDbEntity } from '@mlightcad/data-model';
import type { P } from '../geom/path';

const editor = () => AcApDocManager.instance.editor;
const db = () => AcApDocManager.instance.curDocument.database;

/** A command option: [shown text with its letter, English name the editor matches, Portuguese word]. */
export type Option = [display: string, global: string, local: string];

function addOptions(prompt: { keywords: { add(display: string, global: string, local: string): unknown } }, options: Option[]) {
  for (const [display, global, local] of options) prompt.keywords.add(display, global, local);
}

/** Result of a prompt: a value, an option chosen, Enter with nothing (none) or Esc (cancel). */
export type Answer<T> = { kind: 'value'; value: T } | { kind: 'option'; option: string } | { kind: 'none' } | { kind: 'cancel' };

function answer<T>(status: AcEdPromptStatus, value: T | undefined, option?: string): Answer<T> {
  if (status === AcEdPromptStatus.OK && value !== undefined) return { kind: 'value', value };
  if (status === AcEdPromptStatus.Keyword && option) return { kind: 'option', option };
  if (status === AcEdPromptStatus.None) return { kind: 'none' };
  return { kind: 'cancel' };
}

export interface PointAsk {
  base?: P;
  options?: Option[];
  allowNone?: boolean;
  jig?: AcEdPreviewJig<unknown>;
  noSnap?: boolean;
}

export async function askPoint(message: string, ask: PointAsk = {}): Promise<Answer<P>> {
  const prompt = new AcEdPromptPointOptions(message);
  if (ask.options) addOptions(prompt, ask.options);
  prompt.allowNone = ask.allowNone ?? false;
  if (ask.base) {
    prompt.useBasePoint = true;
    prompt.useDashedLine = true;
    prompt.basePoint = new AcGePoint3d(ask.base.x, ask.base.y, 0);
  }
  if (ask.noSnap) prompt.disableOSnap = true;
  if (ask.jig) prompt.jig = ask.jig as AcEdPreviewJig<never>;
  const result = await editor().getPoint(prompt);
  return answer(result.status, result.value ? { x: result.value.x, y: result.value.y } : undefined, result.stringResult);
}

export interface Picked { entity: AcDbEntity; point: P }

export async function askEntity(message: string, options: Option[] = [], allowNone = true): Promise<Answer<Picked>> {
  const prompt = new AcEdPromptEntityOptions(message);
  addOptions(prompt, options);
  prompt.allowNone = allowNone;
  prompt.setRejectMessage('Objeto inválido.');
  const result = await editor().getEntity(prompt);
  if (result.status === AcEdPromptStatus.OK && result.objectId) {
    const entity = db().tables.blockTable.getEntityById(result.objectId);
    const p = result.pickedPoint;
    if (entity) return { kind: 'value', value: { entity, point: p ? { x: p.x, y: p.y } : centreOf(entity) } };
    return { kind: 'cancel' };
  }
  return answer<Picked>(result.status, undefined, result.stringResult);
}

function centreOf(entity: AcDbEntity): P {
  try { const b = entity.geometricExtents; return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2 }; } catch { return { x: 0, y: 0 }; }
}

/** Objects already selected, or a selection asked for now. */
export async function askSelection(message: string): Promise<AcDbEntity[] | null> {
  const view = AcApDocManager.instance.curView;
  const table = db().tables.blockTable;
  const ids = view.selectionSet.count > 0 ? [...view.selectionSet.ids] : null;
  let chosen = ids;
  if (!chosen) {
    const prompt = new AcEdPromptSelectionOptions(message);
    const result = await editor().getSelection(prompt);
    if (result.status !== AcEdPromptStatus.OK || !result.value) return null;
    chosen = [...result.value.ids];
  }
  const layers = db().tables.layerTable;
  const entities = chosen.map(id => table.getEntityById(id)).filter((e): e is AcDbEntity => !!e)
    .filter(e => !layers.getAt(e.layer)?.isLocked);
  return entities.length ? entities : null;
}

export async function askDistance(message: string, fallback?: number, base?: P): Promise<Answer<number>> {
  const prompt = new AcEdPromptDistanceOptions(message);
  if (fallback !== undefined) { prompt.defaultValue = fallback; prompt.useDefaultValue = true; prompt.allowNone = true; }
  prompt.allowNegative = false;
  prompt.allowZero = true;
  if (base) { prompt.useBasePoint = true; prompt.useDashedLine = true; prompt.basePoint = new AcGePoint3d(base.x, base.y, 0); }
  const result = await editor().getDistance(prompt);
  if (result.status === AcEdPromptStatus.None && fallback !== undefined) return { kind: 'value', value: fallback };
  return answer(result.status, result.value, result.stringResult);
}

export async function askNumber(message: string, fallback?: number, allowNegative = false): Promise<Answer<number>> {
  // A distance prompt also takes a typed number, and on the phone shows the numeric pad.
  const prompt = new AcEdPromptDistanceOptions(message);
  if (fallback !== undefined) { prompt.defaultValue = fallback; prompt.useDefaultValue = true; prompt.allowNone = true; }
  prompt.allowNegative = allowNegative;
  prompt.allowZero = false;
  const result = await editor().getDistance(prompt);
  if (result.status === AcEdPromptStatus.None && fallback !== undefined) return { kind: 'value', value: fallback };
  return answer(result.status, result.value, result.stringResult);
}

export async function askInteger(message: string, fallback: number, min = 1, max = 10000): Promise<Answer<number>> {
  const prompt = new AcEdPromptIntegerOptions(message, min, max);
  prompt.defaultValue = fallback;
  prompt.useDefaultValue = true;
  prompt.allowNone = true;
  const result = await editor().getInteger(prompt);
  if (result.status === AcEdPromptStatus.None) return { kind: 'value', value: fallback };
  return answer(result.status, result.value, result.stringResult);
}

/** Angle in radians; typed values are degrees. */
export async function askAngle(message: string, fallbackRad?: number, base?: P): Promise<Answer<number>> {
  const prompt = new AcEdPromptAngleOptions(message);
  if (fallbackRad !== undefined) { prompt.defaultValue = fallbackRad; prompt.useDefaultValue = true; prompt.allowNone = true; }
  prompt.allowNegative = true;
  prompt.allowZero = true;
  if (base) { prompt.useBasePoint = true; prompt.useDashedLine = true; prompt.basePoint = new AcGePoint3d(base.x, base.y, 0); }
  const result = await editor().getAngle(prompt);
  if (result.status === AcEdPromptStatus.None && fallbackRad !== undefined) return { kind: 'value', value: fallbackRad };
  return answer(result.status, result.value, result.stringResult);
}

export async function askOption(message: string, options: Option[], fallback?: string): Promise<string | null> {
  const prompt = new AcEdPromptKeywordOptions(message);
  addOptions(prompt, options);
  prompt.allowNone = fallback !== undefined;
  const result = await editor().getKeywords(prompt);
  if (result.status === AcEdPromptStatus.Keyword || result.status === AcEdPromptStatus.OK) return result.stringResult ?? fallback ?? null;
  if (result.status === AcEdPromptStatus.None) return fallback ?? null;
  return null;
}

export async function askText(message: string, fallback = ''): Promise<string | null> {
  const prompt = new AcEdPromptStringOptions(message);
  prompt.allowSpaces = true;
  prompt.allowEmpty = fallback !== '';
  if (fallback) { prompt.defaultValue = fallback; prompt.useDefaultValue = true; }
  const result = await editor().getString(prompt);
  if (result.status === AcEdPromptStatus.OK) return result.stringResult ?? fallback;
  if (result.status === AcEdPromptStatus.None) return fallback || null;
  return null;
}

export function say(message: string, type: 'info' | 'warning' | 'error' = 'info') {
  editor().showMessage(message, type);
}
