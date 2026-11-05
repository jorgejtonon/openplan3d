/**
 * Working on drawings rather than only viewing them: new drawings from the engineering templates,
 * an automatic draft kept on the device, and a properties panel for the selection.
 */
import { AcApDocManager } from '@mlightcad/cad-simple-viewer';
import { AcCmColor, AcDbArc, AcDbCircle, AcDbLine, AcDbPolyline, type AcDbDatabase, type AcDbEntity } from '@mlightcad/data-model';
import { pathLength } from './geom/path';
import { toPath } from './geom/entities';
import { formatMeasure } from './commands/annotate';

// ---------------------------------------------------------------- new drawing

export type NewUnit = 'mm' | 'cm' | 'm';

/** Paper millimetres to drawing units at 1:scale (2,5 mm of text on paper is 2,5 × this). */
export function paperFactor(unit: NewUnit, scale: number) {
  return unit === 'mm' ? scale : unit === 'cm' ? scale / 10 : scale / 1000;
}

export async function templateFor(unit: NewUnit): Promise<ArrayBuffer> {
  const response = await fetch(new URL(`./templates/novo-${unit}.dxf`, location.href));
  if (!response.ok) throw new Error(`modelo ${unit} indisponível`);
  return response.arrayBuffer();
}

/** Sizes dimensions, text and linetypes of the open drawing for plotting at 1:scale. */
export function setupForScale(db: AcDbDatabase, unit: NewUnit, scale: number) {
  const k = paperFactor(unit, scale);
  db.ltscale = k;
  const style = db.tables.dimStyleTable.getAt(db.dimstyle || 'Standard') ?? db.tables.dimStyleTable.getAt('Standard');
  if (style) {
    style.dimscale = k;
    style.dimdsep = ',';
    style.dimdec = unit === 'mm' ? 0 : unit === 'cm' ? 1 : 2;
  }
}

// ---------------------------------------------------------------- draft on the device

export interface Draft { name: string; savedAt: number; dxf: string | Uint8Array }

const DB_NAME = 'openplan3d-cad';
const STORE = 'drafts';
const KEY = 'current';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const idb = await openStore();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(idb.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { idb.close(); }
}

export async function saveDraft(draft: Draft) {
  try { await withStore('readwrite', s => s.put(draft, KEY)); return true; } catch (error) { console.warn('draft not saved', error); return false; }
}

export async function loadDraft(): Promise<Draft | null> {
  try { return (await withStore<Draft | undefined>('readonly', s => s.get(KEY))) ?? null; } catch { return null; }
}

export async function clearDraft() {
  try { await withStore('readwrite', s => s.delete(KEY)); } catch { /* nothing kept */ }
}

/**
 * Keeps a draft of the open drawing: written a few seconds after the last change, and at once when
 * the app goes to the background (Android may close it there). Returns a function that stops it.
 */
export function keepDraft(db: AcDbDatabase, name: () => string, onSaved?: (when: Date) => void) {
  let timer = 0;
  let dirty = false;
  const write = async () => {
    if (!dirty) return;
    dirty = false;
    window.clearTimeout(timer);
    try {
      const dxf = db.dxfOut(undefined, 8);
      if (await saveDraft({ name: name(), savedAt: Date.now(), dxf })) onSaved?.(new Date());
    } catch (error) { console.warn('draft failed', error); }
  };
  const changed = () => {
    dirty = true;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { void write(); }, 8000);
  };
  const hidden = () => { if (document.visibilityState === 'hidden') void write(); };
  const events = [db.events.entityAppended, db.events.entityModified, db.events.entityErased, db.events.layerAppended, db.events.layerModified];
  events.forEach(e => e.addEventListener(changed));
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', write);
  return () => {
    events.forEach(e => e.removeEventListener(changed));
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', write);
    window.clearTimeout(timer);
  };
}

// ---------------------------------------------------------------- properties of the selection

const COLORS: Array<[string, string]> = [
  ['bylayer', 'Da camada'], ['1', 'Vermelho'], ['2', 'Amarelo'], ['3', 'Verde'], ['4', 'Ciano'], ['5', 'Azul'],
  ['6', 'Magenta'], ['7', 'Branco/preto'], ['8', 'Cinza'], ['9', 'Cinza claro'], ['30', 'Laranja'],
];
const WEIGHTS: Array<[string, string]> = [
  ['-1', 'Da camada'], ['0', '0,00'], ['9', '0,09'], ['13', '0,13'], ['18', '0,18'], ['25', '0,25'], ['35', '0,35'],
  ['50', '0,50'], ['70', '0,70'], ['100', '1,00'], ['140', '1,40'], ['200', '2,00'],
];

const TYPE_NAMES: Record<string, string> = {
  LINE: 'Linha', LWPOLYLINE: 'Polilinha', POLYLINE: 'Polilinha', CIRCLE: 'Círculo', ARC: 'Arco', TEXT: 'Texto',
  MTEXT: 'Texto multilinha', DIMENSION: 'Cota', INSERT: 'Bloco', HATCH: 'Hachura', SPLINE: 'Spline', ELLIPSE: 'Elipse',
  POINT: 'Ponto', SOLID: 'Sólido', XLINE: 'Linha de construção', RAY: 'Semirreta', LEADER: 'Chamada', MLINE: 'Multilinha',
};

function describe(db: AcDbDatabase, entity: AcDbEntity) {
  const unit = db.insunits ?? 0;
  const type = TYPE_NAMES[entity.dxfTypeName] ?? entity.dxfTypeName;
  const f = (v: number) => formatMeasure(v, unit);
  if (entity instanceof AcDbLine) return `${type} · comprimento ${f(entity.startPoint.distanceTo(entity.endPoint))}`;
  if (entity instanceof AcDbCircle) return `${type} · raio ${f(entity.radius)} · área ${f(Math.PI * entity.radius ** 2)}`;
  if (entity instanceof AcDbArc) { const p = toPath(entity); return `${type} · raio ${f(entity.radius)}${p ? ` · comprimento ${f(pathLength(p))}` : ''}`; }
  if (entity instanceof AcDbPolyline) {
    const p = toPath(entity);
    const parts = [type];
    if (p) parts.push(`comprimento ${f(pathLength(p))}`);
    if (entity.closed) parts.push(`área ${f(Math.abs(entity.area))}`);
    return parts.join(' · ');
  }
  return type;
}

function options(select: HTMLSelectElement, list: Array<[string, string]>, current: string | null) {
  select.innerHTML = '';
  if (current === null) select.append(new Option('(vários)', '', true, true));
  for (const [value, label] of list) select.append(new Option(label, value, false, value === current));
}

function same<T>(values: T[]): T | null {
  return values.length && values.every(v => v === values[0]) ? values[0] : null;
}

/** Shows and edits layer, colour and lineweight of the selected objects. */
export function installPropertiesPanel(panel: HTMLElement) {
  const info = panel.querySelector<HTMLElement>('[data-prop=info]')!;
  const layerSel = panel.querySelector<HTMLSelectElement>('[data-prop=layer]')!;
  const colorSel = panel.querySelector<HTMLSelectElement>('[data-prop=color]')!;
  const weightSel = panel.querySelector<HTMLSelectElement>('[data-prop=weight]')!;
  let selected: AcDbEntity[] = [];

  const refresh = () => {
    const manager = AcApDocManager.instance;
    const view = manager?.curView;
    const db = manager?.curDocument?.database;
    if (!view || !db) { panel.classList.add('hide'); return; }
    const table = db.tables.blockTable;
    selected = [...view.selectionSet.ids].map(id => table.getEntityById(id)).filter((e): e is AcDbEntity => !!e);
    if (!selected.length) { panel.classList.add('hide'); return; }
    panel.classList.remove('hide');
    info.textContent = selected.length === 1 ? describe(db, selected[0]) : `${selected.length} objetos selecionados`;
    const layers: Array<[string, string]> = [];
    for (const layer of db.tables.layerTable.newIterator()) layers.push([layer.name, layer.name]);
    layers.sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
    options(layerSel, layers, same(selected.map(e => e.layer)));
    options(colorSel, COLORS, same(selected.map(e => (e.color.isByLayer ? 'bylayer' : String(e.color.colorIndex ?? '')))));
    options(weightSel, WEIGHTS, same(selected.map(e => String(e.lineWeight))));
  };

  const apply = (label: string, change: (e: AcDbEntity) => void) => {
    const db = AcApDocManager.instance?.curDocument?.database;
    if (!db || !selected.length) return;
    db.runDatabaseEdit(label, () => {
      for (const e of selected) { const target = db.openEntityForWrite(e); if (target) change(target); }
    });
    refresh();
  };

  layerSel.addEventListener('change', () => { const v = layerSel.value; if (v) apply('LAYER', e => { e.layer = v; }); });
  colorSel.addEventListener('change', () => {
    const v = colorSel.value;
    if (!v) return;
    apply('COLOR', e => {
      const color = new AcCmColor();
      if (v === 'bylayer') color.setByLayer(); else color.colorIndex = Number(v);
      e.color = color;
    });
  });
  weightSel.addEventListener('change', () => { const v = weightSel.value; if (v !== '') apply('LWEIGHT', e => { e.lineWeight = Number(v) as never; }); });

  let bound: unknown = null;
  const bind = () => {
    const view = AcApDocManager.instance?.curView;
    if (!view || bound === view.selectionSet) return;
    bound = view.selectionSet;
    view.selectionSet.events.selectionAdded.addEventListener(refresh);
    view.selectionSet.events.selectionRemoved.addEventListener(refresh);
  };
  return { bind, refresh };
}
