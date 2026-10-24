import { describe, expect, it } from 'vitest';
import { loadSheetOptions, sanitizeSheetOptions, saveSheetOptions } from '$lib/stores/sheetPreferences';
import { defaultSheetOptions } from '$lib/utils/technicalSheet';

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, data };
}

describe('sheet preferences', () => {
  it('reuses the professional details on other projects but keeps project fields apart', () => {
    const store = memory();
    const options = defaultSheetOptions();
    options.format = 'A1';
    options.scale = 100;
    options.titleBlock.responsible = 'Eng. Fulano';
    options.titleBlock.registry = 'CREA-ES 123/D';
    options.titleBlock.work = 'Residência A';
    saveSheetOptions('p1', options, store);

    const same = loadSheetOptions('p1', store);
    expect(same.format).toBe('A1');
    expect(same.scale).toBe(100);
    expect(same.titleBlock.work).toBe('Residência A');

    const other = loadSheetOptions('p2', store);
    expect(other.format).toBe(defaultSheetOptions().format);
    expect(other.titleBlock.responsible).toBe('Eng. Fulano');
    expect(other.titleBlock.registry).toBe('CREA-ES 123/D');
    expect(other.titleBlock.work).toBe('');
  });

  it('ignores damaged or unexpected saved values', () => {
    const clean = sanitizeSheetOptions({ format: 'B5', orientation: 'sideways', scale: 33, mono: 'yes', titleBlock: { work: 42, client: 'Ana' } });
    expect(clean.format).toBe('A3');
    expect(clean.orientation).toBe('landscape');
    expect(clean.scale).toBe('auto');
    expect(clean.mono).toBe(true);
    expect(clean.titleBlock.work).toBe('');
    expect(clean.titleBlock.client).toBe('Ana');
    const store = memory();
    store.setItem('o3d_sheet_project_x', '{not json');
    expect(() => loadSheetOptions('x', store)).not.toThrow();
  });

  it('works without storage', () => {
    expect(loadSheetOptions('p', null).format).toBe('A3');
    expect(() => saveSheetOptions('p', defaultSheetOptions(), null)).not.toThrow();
  });
});
