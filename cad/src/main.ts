import { AcApDocManager, AcApSettingManager, AcEdOpenMode, acedApplyUiTheme, eventBus, type AcApOpenDatabaseOptions } from '@mlightcad/cad-simple-viewer';
import { AcDbDatabaseConverterManager, AcDbFileType } from '@mlightcad/data-model';
import { AcDbLibreDwgConverter } from '@mlightcad/libredwg-converter';
import { acuiRegisterSimpleUiPlugin } from '@mlightcad/cad-simple-ui-plugin/register';
import { emptyTitleBlock, type TitleBlockData, type SheetFormat, type SheetOrientation } from '$lib/utils/sheetFrame';
import { installNativeHooks, isNativeApp } from '$lib/native/appBridge';
import { PLOT_SCALES, drawingExtents, isUsableBox, planPlot, plotDrawing, plotFileName, type Box2, type DrawingUnitChoice, type PlotArea, type PlotOptions } from './plot';
import { applyPortuguese } from './i18nPt';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const container = $<HTMLDivElement>('cad-container');
const viewerPane = $<HTMLElement>('viewerPane');
const emptyState = $<HTMLDivElement>('emptyState');
const fileInput = $<HTMLInputElement>('fileInput');
const fileNameLabel = $<HTMLSpanElement>('fileName');
const plotBtn = $<HTMLButtonElement>('plotBtn');
const saveBtn = $<HTMLButtonElement>('saveBtn');
const dialog = $<HTMLDialogElement>('plotDialog');
const form = $<HTMLFormElement>('plotForm');
const plotStatus = $<HTMLDivElement>('plotStatus');
const toastEl = $<HTMLDivElement>('toast');

const CDN_FONTS = 'https://cdn.jsdelivr.net/gh/mlightcad/cad-data@main/';
const LOCAL_FONTS = new URL('./cad-data/', location.href).href;

let initialized: Promise<void> | null = null;
let currentFile = '';

function toast(text: string, kind: 'ok' | 'error' | 'info' = 'info', ms = 4500) {
  toastEl.textContent = text;
  toastEl.className = kind;
  toastEl.style.display = 'block';
  clearTimeout((toast as unknown as { t?: number }).t);
  (toast as unknown as { t?: number }).t = window.setTimeout(() => { toastEl.style.display = 'none'; }, ms);
}

function openOptions(): AcApOpenDatabaseOptions {
  return { minimumChunkSize: 1000, mode: AcEdOpenMode.Write, progressiveRendering: false, sysVars: { lwdisplay: false } } as AcApOpenDatabaseOptions;
}

/** Uses the CDN fonts only when they actually answer: a phone can report "online" on a dead network. */
async function fontBaseUrl(): Promise<string> {
  if (!navigator.onLine) return LOCAL_FONTS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const response = await fetch(`${CDN_FONTS}fonts/fonts.json`, { signal: controller.signal, cache: 'force-cache' });
    return response.ok ? CDN_FONTS : LOCAL_FONTS;
  } catch { return LOCAL_FONTS; }
  finally { clearTimeout(timer); }
}

/** Starts the CAD engine once: DWG converter, fonts, toolbar and Portuguese labels. */
function initialize(): Promise<void> {
  if (initialized) return initialized;
  initialized = (async () => {
    const fontBase = await fontBaseUrl();
    acedApplyUiTheme('dark', document.documentElement);
    acedApplyUiTheme('dark', viewerPane);
    AcApSettingManager.configure({ storageKey: 'openplan3d.cad.settings' });
    const dwgParserUrl = new URL('./workers/libredwg-parser-worker.js', location.href).href;
    AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, new AcDbLibreDwgConverter({ convertByEntityType: false, useWorker: true, parserWorkerUrl: dwgParserUrl }));
    AcApDocManager.createInstance({
      container,
      busyIndicatorHost: viewerPane,
      autoResize: true,
      // Original fonts from the library's CDN when online (cached by the installed app);
      // an open font (SIL OFL) answers for the usual font names when offline.
      baseUrl: fontBase,
      useMainThreadDraw: true,
      openDocumentDefaults: () => openOptions(),
      webworkerFileUrls: {
        mtextRender: new URL('./workers/mtext-renderer-worker.js', location.href).href,
        dwgParser: dwgParserUrl,
      },
    });
    await acuiRegisterSimpleUiPlugin(AcApDocManager.instance.pluginManager, {
      host: viewerPane,
      dockPanel: { defaultOpen: false, defaultHeight: 240, defaultWidth: 280 },
      toolbar: { placement: 'right', items: 'default', collapsible: true },
      layouts: {
        phone: {
          toolbar: {
            placement: 'bottom', showLabels: true, size: 'stretch', edgeOffset: 0, collapsible: false, inCanvasParent: true,
            subToolbar: { showLabels: true, showSeparators: false, size: 'stretch', overflow: 'wrap', replaceOnNested: true },
          },
        },
      },
    } as never);
    applyPortuguese();
    const docManager = AcApDocManager.instance;
    docManager.events.documentActivated.addEventListener(() => onDocumentShown());
    eventBus.on('failed-to-open-file', (event: { fileName: string }) => {
      toast(`Não foi possível abrir "${event.fileName}". Se for um DWG muito grande ou muito novo, salve-o como DXF no programa de origem.`, 'error', 9000);
    });
  })();
  return initialized;
}

let opening = false;

function onDocumentShown() {
  // While a file opens, the viewer may announce the document before it is complete.
  if (opening) return;
  const doc = AcApDocManager.instance?.curDocument;
  if (!doc) return;
  currentFile = doc.fileName || doc.docTitle || 'desenho';
  fileNameLabel.textContent = currentFile;
  emptyState.classList.add('hide');
  setDrawingActions(true);
  extentsCache = null;
}

/** Main-drawing extents are worked out in the background; a plot waits for them. */
async function extentsReady() {
  currentExtents('extents');
  await extentsCache?.ready;
}

let extentsCache: { db: unknown; all: Box2 | null; main: Box2 | null; ready: Promise<void> } | null = null;
/** Extents for the plot area: the whole drawing, or its main part without far-off stray objects
 * (the viewer's smart extents, which cluster the drawing as "zoom smart" does). */
function currentExtents(area: PlotArea): Box2 | null {
  const db = AcApDocManager.instance?.curDocument?.database;
  if (!db) return null;
  if (!extentsCache || extentsCache.db !== db) {
    const cache: NonNullable<typeof extentsCache> = { db, all: drawingExtents(db), main: null, ready: Promise.resolve() };
    extentsCache = cache;
    cache.ready = computeMainExtents(cache);
  }
  return area === 'all' ? extentsCache.all : (extentsCache.main ?? extentsCache.all);
}

type SmartView = { resolveSmartFitBox?: () => Promise<Box2 | undefined> };
async function computeMainExtents(cache: NonNullable<typeof extentsCache>) {
  try {
    const view = AcApDocManager.instance?.curView as unknown as SmartView | undefined;
    const box = await view?.resolveSmartFitBox?.();
    if (!box || !isUsableBox(box) || extentsCache !== cache) return;
    cache.main = { min: { x: box.min.x, y: box.min.y }, max: { x: box.max.x, y: box.max.y } };
    if (dialog.open) updateStatus();
  } catch (error) { console.warn('smart extents failed', error); }
}

/** Main drawing on screen, as "zoom smart" does (far-off stray objects would leave it tiny). */
function zoomToDrawing() {
  const view = AcApDocManager.instance?.curView as unknown as { zoomToSmartExtents?: () => Promise<void>; zoomToFitDrawing?: () => void } | undefined;
  if (!view) return;
  const fit = () => { try { view.zoomToFitDrawing?.(); } catch (error) { console.warn('zoom extents failed', error); } };
  if (view.zoomToSmartExtents) view.zoomToSmartExtents().catch(fit);
  else fit();
}

async function openFile(file: File) {
  if (!/\.(dwg|dxf)$/i.test(file.name)) { toast('Escolha um arquivo DWG ou DXF.', 'error'); return; }
  await initialize();
  emptyState.classList.add('hide');
  fileNameLabel.textContent = `Abrindo ${file.name}…`;
  // No plotting or saving while the next drawing replaces the current one.
  setDrawingActions(false);
  opening = true;
  try {
    const content = await file.arrayBuffer();
    const ok = await AcApDocManager.instance.openDocument(file.name, content, openOptions()).finally(() => { opening = false; });
    if (ok) { onDocumentShown(); zoomToDrawing(); toast(`${file.name} aberto.`, 'ok', 2500); }
    else openFailed();
  } catch (error) {
    opening = false;
    console.error(error);
    toast(`Erro ao abrir ${file.name}.`, 'error');
    openFailed();
  }
}

function setDrawingActions(enabled: boolean) {
  plotBtn.disabled = !enabled;
  saveBtn.disabled = !enabled;
}

/** The viewer keeps whatever drawing it still has; with none, back to the start screen. */
function openFailed() {
  const doc = AcApDocManager.instance?.curDocument;
  const name = doc?.fileName || '';
  if (name) { currentFile = name; fileNameLabel.textContent = name; setDrawingActions(true); extentsCache = null; return; }
  currentFile = '';
  fileNameLabel.textContent = 'Visualizador DWG/DXF';
  emptyState.classList.remove('hide');
}

// Android pickers filter by MIME type, and DWG files shared by WhatsApp or Drive usually arrive as
// application/octet-stream, which would show greyed out: list every file there and check the name.
if (/Android/i.test(navigator.userAgent) || isNativeApp()) fileInput.removeAttribute('accept');
for (const id of ['openBtn', 'emptyOpenBtn']) $(id).addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (file) void openFile(file);
});
// Drag and drop on computers.
window.addEventListener('dragover', event => { event.preventDefault(); });
window.addEventListener('drop', event => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) void openFile(file);
});

function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

saveBtn.addEventListener('click', () => {
  const db = AcApDocManager.instance?.curDocument?.database;
  if (!db) return;
  try {
    const dxf = db.dxfOut(undefined, 8);
    const name = currentFile.replace(/\.(dwg|dxf)$/i, '') + '.dxf';
    download(dxf, name, 'application/dxf');
    toast(`Salvo como ${name}.`, 'ok');
  } catch (error) {
    console.error(error);
    toast('Não foi possível salvar o DXF.', 'error');
  }
});

/* ------------------------------ Plot dialog ------------------------------ */

const PERSONAL_KEY = 'o3d_sheet_personal';
const PERSONAL_FIELDS = ['company', 'responsible', 'registry', 'drawnBy'] as const;
const fileKey = (name: string) => `o3d_cad_plot_${name}`;

function readJSON(key: string): Record<string, unknown> {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}
function writeJSON(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

const scaleSelect = $<HTMLSelectElement>('scaleSelect');
scaleSelect.innerHTML = `<option value="auto" selected>Automática</option><option value="fit">Ajustar à folha (sem escala)</option>`
  + PLOT_SCALES.map(s => `<option value="${s}">1:${s}</option>`).join('');

const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function readForm(): PlotOptions {
  const tb = emptyTitleBlock();
  for (const key of Object.keys(tb) as (keyof TitleBlockData)[]) {
    const el = field(key);
    if (el) tb[key] = el.value;
  }
  const scale = field('scale').value;
  return {
    format: field('format').value as SheetFormat,
    orientation: field('orientation').value as SheetOrientation,
    scale: scale === 'auto' || scale === 'fit' ? scale : Number(scale),
    units: field('units').value as DrawingUnitChoice,
    area: field('area').value as PlotArea,
    mono: field('mono').value === '1',
    lineweights: (field('lineweights') as HTMLInputElement).checked,
    titleBlock: tb,
  };
}

function fillForm() {
  const saved = readJSON(fileKey(currentFile));
  const personal = readJSON(PERSONAL_KEY);
  const tb = { ...emptyTitleBlock(), ...(saved.titleBlock as object ?? {}) } as TitleBlockData;
  for (const key of PERSONAL_FIELDS) if (!tb[key] && typeof personal[key] === 'string') tb[key] = personal[key] as string;
  for (const key of Object.keys(tb) as (keyof TitleBlockData)[]) { const el = field(key); if (el) el.value = tb[key] ?? ''; }
  for (const key of ['format', 'orientation', 'scale', 'units', 'area', 'mono'] as const) {
    if (typeof saved[key] === 'string' && [...(field(key) as HTMLSelectElement).options].some(o => o.value === saved[key])) field(key).value = saved[key] as string;
  }
  if (typeof saved.lineweights === 'boolean') (field('lineweights') as HTMLInputElement).checked = saved.lineweights;
}

function saveForm(options: PlotOptions) {
  writeJSON(fileKey(currentFile), {
    format: options.format, orientation: options.orientation, scale: String(options.scale), units: options.units,
    area: options.area, mono: options.mono ? '1' : '0', lineweights: options.lineweights, titleBlock: options.titleBlock,
  });
  const personal = readJSON(PERSONAL_KEY);
  for (const key of PERSONAL_FIELDS) if (options.titleBlock[key]) personal[key] = options.titleBlock[key];
  writeJSON(PERSONAL_KEY, personal);
}

function currentViewBox(): Box2 | null {
  const view = AcApDocManager.instance?.curView;
  if (!view || !view.width || !view.height) return null;
  const a = view.screenToWorld({ x: 0, y: 0 }), b = view.screenToWorld({ x: view.width, y: view.height });
  return { min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) } };
}

const UNIT_NAMES: Record<number, string> = { 0: 'sem unidade (lido como mm)', 1: 'polegadas', 2: 'pés', 4: 'milímetros', 5: 'centímetros', 6: 'metros' };

function updateStatus() {
  const db = AcApDocManager.instance?.curDocument?.database;
  if (!db) { plotStatus.textContent = 'Abra um desenho primeiro.'; plotStatus.className = 'status warn'; return; }
  const options = readForm();
  const plan = planPlot({ db, options, viewBox: currentViewBox(), extents: currentExtents(options.area) });
  if (!plan) { plotStatus.textContent = 'Não há nada para plotar nesta área.'; plotStatus.className = 'status warn'; return; }
  const units = `Unidade do arquivo: ${UNIT_NAMES[db.insunits ?? 0] ?? `código ${db.insunits}`}.`;
  if (!plan.scale) {
    plotStatus.textContent = `${options.scale === 'fit' ? 'Ajustado à folha, sem escala.' : 'Grande demais até para 1:10000 nesta folha: será ajustado, sem escala.'} ${units}`;
    plotStatus.className = 'status warn';
  } else if (!plan.fits) {
    plotStatus.textContent = `Em 1:${plan.scale}, só a parte central da área escolhida cabe na folha.${plan.suggested ? ` Para caber tudo use 1:${plan.suggested}` : ''} ou uma folha maior. ${units}`;
    plotStatus.className = 'status warn';
  } else {
    plotStatus.textContent = `Escala 1:${plan.scale} em ${options.format}. ${units} Se as medidas estiverem erradas, ajuste "Unidade do desenho".`;
    plotStatus.className = 'status ok';
  }
}

form.addEventListener('change', updateStatus);
plotBtn.addEventListener('click', () => {
  if (!AcApDocManager.instance?.curDocument) return;
  fillForm();
  updateStatus();
  dialog.showModal();
});

$('plotGo').addEventListener('click', async () => {
  const db = AcApDocManager.instance?.curDocument?.database;
  if (!db) return;
  const go = $<HTMLButtonElement>('plotGo');
  const options = readForm();
  go.disabled = true;
  go.textContent = 'Gerando…';
  try {
    if (options.area === 'extents') await extentsReady();
    const result = await plotDrawing({ db, options, viewBox: currentViewBox(), extents: currentExtents(options.area), fileName: currentFile, fontMapping: AcApSettingManager.instance.fontMapping as Record<string, string> });
    saveForm(options);
    download(result.bytes, plotFileName(currentFile, options, result.scale), 'application/pdf');
    dialog.close();
    toast(result.scale ? `PDF gerado na escala 1:${result.scale}.` : 'PDF gerado (ajustado à folha).', 'ok');
  } catch (error) {
    console.error(error);
    plotStatus.textContent = `Não foi possível gerar o PDF: ${error instanceof Error ? error.message : error}`;
    plotStatus.className = 'status warn';
  } finally {
    go.disabled = false;
    go.textContent = 'Gerar PDF';
  }
});

// Android app: downloads become "save + share"; Back closes dialogs.
if (isNativeApp()) void installNativeHooks();
// Start the engine right away so the first file opens faster.
void initialize();
