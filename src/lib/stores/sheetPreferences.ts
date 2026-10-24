import { defaultSheetOptions, emptyTitleBlock, SHEET_FORMATS, STANDARD_SCALES, type SheetFormat, type TechnicalSheetOptions, type TitleBlockData } from '$lib/utils/technicalSheet';

/** Fields that belong to the professional, reused across projects on this device. */
const PERSONAL_FIELDS = ['company', 'responsible', 'registry', 'drawnBy'] as const;
const PERSONAL_KEY = 'o3d_sheet_personal';
const projectKey = (projectId: string) => `o3d_sheet_project_${projectId}`;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

function read(store: Storage | null, key: string): Record<string, unknown> {
  if (!store) return {};
  try {
    const value = JSON.parse(store.getItem(key) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

const text = (value: unknown, max = 400) => typeof value === 'string' ? value.slice(0, max) : undefined;

/** Accepts only well-formed saved values, so a damaged entry can never break the dialog. */
export function sanitizeSheetOptions(saved: Record<string, unknown>, base: TechnicalSheetOptions = defaultSheetOptions()): TechnicalSheetOptions {
  const out: TechnicalSheetOptions = { ...base, titleBlock: { ...base.titleBlock } };
  if (typeof saved.format === 'string' && saved.format in SHEET_FORMATS) out.format = saved.format as SheetFormat;
  if (saved.orientation === 'landscape' || saved.orientation === 'portrait') out.orientation = saved.orientation;
  if (saved.scale === 'auto' || (typeof saved.scale === 'number' && (STANDARD_SCALES as readonly number[]).includes(saved.scale))) out.scale = saved.scale as number | 'auto';
  if (saved.floors === 'active' || saved.floors === 'all') out.floors = saved.floors;
  for (const key of ['mono', 'furniture', 'roomLabels', 'chainDimensions', 'dimensions', 'wallLengths', 'textNotes', 'include3D'] as const) {
    if (typeof saved[key] === 'boolean') out[key] = saved[key] as boolean;
  }
  const block = saved.titleBlock && typeof saved.titleBlock === 'object' ? saved.titleBlock as Record<string, unknown> : {};
  for (const key of Object.keys(emptyTitleBlock()) as (keyof TitleBlockData)[]) {
    const value = text(block[key], key === 'notes' ? 2000 : 400);
    if (value !== undefined) out.titleBlock[key] = value;
  }
  return out;
}

/** Saved options for a project, with the professional's own details filled in. */
export function loadSheetOptions(projectId: string, store: Storage | null = storage()): TechnicalSheetOptions {
  const options = sanitizeSheetOptions(read(store, projectKey(projectId)));
  const personal = read(store, PERSONAL_KEY);
  for (const key of PERSONAL_FIELDS) {
    const value = text(personal[key]);
    if (value !== undefined && !options.titleBlock[key]) options.titleBlock[key] = value;
  }
  return options;
}

export function saveSheetOptions(projectId: string, options: TechnicalSheetOptions, store: Storage | null = storage()) {
  if (!store) return;
  try {
    store.setItem(projectKey(projectId), JSON.stringify(options));
    const personal = Object.fromEntries(PERSONAL_FIELDS.map(key => [key, options.titleBlock[key]]).filter(([, value]) => value));
    store.setItem(PERSONAL_KEY, JSON.stringify(personal));
  } catch { /* Storage full or disabled: the PDF still exports. */ }
}
