import { describe, expect, it } from 'vitest';
import dictionary from '../cad/src/pt-dictionary.json';

const pt = dictionary as Record<string, string>;
const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

describe('DWG viewer in Portuguese', () => {
  it('covers the viewer interface', () => {
    expect(Object.keys(pt).length).toBeGreaterThan(800);
    expect(pt['Type command']).toBe('Digite um comando');
    expect(pt['Layers']).toBe('Camadas');
  });

  it('keeps every placeholder of the original text', () => {
    for (const [english, portuguese] of Object.entries(pt)) expect(placeholders(portuguese), english).toEqual(placeholders(english));
  });

  it('keeps the shortcut letters of command options', () => {
    for (const [english, portuguese] of Object.entries(pt)) {
      const letters = english.match(/\(([A-Z?]+)\)$/);
      if (letters) expect(portuguese.endsWith(`(${letters[1]})`), english).toBe(true);
    }
  });
});
