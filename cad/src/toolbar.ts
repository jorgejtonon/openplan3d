/**
 * Drafting groups for the toolbar (Desenhar, Editar, Cotar), placed before the viewer's own
 * buttons. Icons are plain line drawings made for this app.
 */
import type { AcUiToolbarItem } from '@mlightcad/cad-simple-viewer';

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

const I = {
  draw: svg('<path d="M4 20 L16 8"/><path d="M14 6 l4 4"/><path d="M16 4 l4 4 -2 2 -4 -4z"/>'),
  line: svg('<path d="M4 19 L20 5"/><circle cx="4" cy="19" r="1.6"/><circle cx="20" cy="5" r="1.6"/>'),
  pline: svg('<path d="M3 18 L9 8 L15 14 L21 5"/>'),
  circle: svg('<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/>'),
  arc: svg('<path d="M4 18 A9 9 0 0 1 20 18"/>'),
  rect: svg('<rect x="4" y="6" width="16" height="12"/>'),
  polygon: svg('<path d="M12 3 L20 9 L17 19 H7 L4 9 Z"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="9" ry="5.5"/>'),
  spline: svg('<path d="M3 16 C7 4, 11 20, 15 10 S20 6, 21 8"/>'),
  hatch: svg('<rect x="4" y="4" width="16" height="16"/><path d="M4 12 L12 4 M4 20 L20 4 M12 20 L20 12"/>'),
  text: svg('<path d="M5 6 V4 H19 V6"/><path d="M12 4 V20"/><path d="M9 20 H15"/>'),
  mtext: svg('<path d="M4 5 H20 M4 10 H20 M4 15 H16 M4 20 H12"/>'),
  xline: svg('<path d="M2 20 L22 4"/><circle cx="12" cy="12" r="1.6"/>'),
  point: svg('<path d="M12 7 V17 M7 12 H17"/><circle cx="12" cy="12" r="1.5"/>'),
  modify: svg('<path d="M4 20 L8 19 L19 8 L16 5 L5 16 Z"/><path d="M14 7 l3 3"/>'),
  move: svg('<path d="M12 3 V21 M3 12 H21"/><path d="M9 6 L12 3 L15 6 M9 18 L12 21 L15 18 M6 9 L3 12 L6 15 M18 9 L21 12 L18 15"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12"/><path d="M4 16 V4 H16"/>'),
  rotate: svg('<path d="M20 12 A8 8 0 1 1 17 5.7"/><path d="M17 2 V6 H21"/>'),
  mirror: svg('<path d="M12 3 V21" stroke-dasharray="2 2"/><path d="M9 7 L4 17 H9 Z"/><path d="M15 7 L20 17 H15 Z"/>'),
  scale: svg('<rect x="3" y="11" width="10" height="10"/><path d="M13 11 L21 3 M15 3 H21 V9"/>'),
  offset: svg('<path d="M4 18 L12 6 L20 18"/><path d="M8 20 L12 14 L16 20" stroke-dasharray="2 2"/>'),
  trim: svg('<path d="M12 3 V21"/><path d="M3 12 H12"/><path d="M14 12 H21" stroke-dasharray="1.5 2.5"/><path d="M17 9 l3 6 M20 9 l-3 6"/>'),
  extend: svg('<path d="M20 3 V21"/><path d="M3 12 H12"/><path d="M12 12 H20" stroke-dasharray="2 2"/><path d="M15 9 l3 3 -3 3"/>'),
  fillet: svg('<path d="M4 20 V12 A8 8 0 0 1 12 4 H20"/>'),
  chamfer: svg('<path d="M4 20 V10 L10 4 H20"/>'),
  stretch: svg('<rect x="3" y="7" width="8" height="10" stroke-dasharray="2 2"/><path d="M11 7 H21 V17 H11"/><path d="M15 12 H21"/>'),
  array: svg('<rect x="3" y="3" width="6" height="6"/><rect x="15" y="3" width="6" height="6"/><rect x="3" y="15" width="6" height="6"/><rect x="15" y="15" width="6" height="6"/>'),
  explode: svg('<path d="M12 2 V7 M12 17 V22 M2 12 H7 M17 12 H22 M5 5 L8 8 M16 16 L19 19 M19 5 L16 8 M8 16 L5 19"/>'),
  join: svg('<path d="M3 17 L10 10"/><path d="M14 10 L21 17"/><path d="M10 10 H14"/><circle cx="10" cy="10" r="1.3"/><circle cx="14" cy="10" r="1.3"/>'),
  break: svg('<path d="M3 12 H9 M15 12 H21"/><path d="M9 8 V16 M15 8 V16"/>'),
  erase: svg('<path d="M5 7 H19 M9 7 V4 H15 V7 M7 7 L8 21 H16 L17 7"/>'),
  matchprop: svg('<path d="M4 20 L12 12"/><path d="M12 12 L15 3 L21 9 L12 12 Z"/>'),
  undo: svg('<path d="M9 7 L4 12 L9 17"/><path d="M4 12 H15 A5 5 0 0 1 15 22"/>'),
  redo: svg('<path d="M15 7 L20 12 L15 17"/><path d="M20 12 H9 A5 5 0 0 0 9 22"/>'),
  dim: svg('<path d="M4 6 V18 M20 6 V18"/><path d="M4 12 H20"/><path d="M7 9 L4 12 L7 15 M17 9 L20 12 L17 15"/>'),
  dimaligned: svg('<path d="M3 15 L15 3 M9 21 L21 9"/><path d="M6 18 L18 6"/>'),
  dimcont: svg('<path d="M3 6 V18 M12 6 V18 M21 6 V18"/><path d="M3 12 H21"/>'),
  dimradius: svg('<circle cx="12" cy="12" r="8"/><path d="M12 12 L18 6"/><path d="M15 6 H18 V9"/>'),
  dimdiam: svg('<circle cx="12" cy="12" r="8"/><path d="M6 18 L18 6"/>'),
  dimangle: svg('<path d="M4 20 H20 M4 20 L16 6"/><path d="M12 20 A8 8 0 0 0 9.5 14"/>'),
  textedit: svg('<path d="M4 18 H10"/><path d="M14 20 L21 13 L18 10 L11 17 L11 20 Z"/><path d="M4 6 H16 M10 6 V14"/>'),
};

type Entry = [id: string, label: string, icon: string, command: string];

function group(id: string, label: string, icon: string, entries: Entry[]): AcUiToolbarItem {
  return {
    id, label, icon, requiresDocument: true,
    children: entries.map(([cid, clabel, cicon, command]) => ({ id: cid, label: clabel, icon: cicon, command, requiresDocument: true })),
  };
}

export function draftingToolbarItems(): AcUiToolbarItem[] {
  return [
    group('op3d-draw', 'Desenho', I.draw, [
      ['op3d-line', 'Linha', I.line, 'LINE'],
      ['op3d-pline', 'Polilinha', I.pline, 'PLINE'],
      ['op3d-rect', 'Retângulo', I.rect, 'RECTANG'],
      ['op3d-circle', 'Círculo', I.circle, 'CIRCLE'],
      ['op3d-arc', 'Arco', I.arc, 'ARC'],
      ['op3d-polygon', 'Polígono', I.polygon, 'POLYGON'],
      ['op3d-ellipse', 'Elipse', I.ellipse, 'ELLIPSE'],
      ['op3d-spline', 'Spline', I.spline, 'SPLINE'],
      ['op3d-hatch', 'Hachura', I.hatch, '-HATCH'],
      ['op3d-text', 'Texto', I.text, 'TEXT'],
      ['op3d-mtext', 'Texto multilinha', I.mtext, 'MTEXT'],
      ['op3d-xline', 'Linha de construção', I.xline, 'XLINE'],
      ['op3d-point', 'Ponto', I.point, 'POINT'],
    ]),
    group('op3d-modify', 'Editar', I.modify, [
      ['op3d-move', 'Mover', I.move, 'MOVE'],
      ['op3d-copy', 'Copiar', I.copy, 'COPY'],
      ['op3d-rotate', 'Girar', I.rotate, 'ROTATE'],
      ['op3d-mirror', 'Espelhar', I.mirror, 'MIRROR'],
      ['op3d-scale', 'Escala', I.scale, 'SCALE'],
      ['op3d-offset', 'Paralela', I.offset, 'OFFSET'],
      ['op3d-trim', 'Aparar', I.trim, 'TRIM'],
      ['op3d-extend', 'Estender', I.extend, 'EXTEND'],
      ['op3d-fillet', 'Concordar', I.fillet, 'FILLET'],
      ['op3d-chamfer', 'Chanfrar', I.chamfer, 'CHAMFER'],
      ['op3d-stretch', 'Esticar', I.stretch, 'STRETCH'],
      ['op3d-array', 'Matriz', I.array, 'ARRAY'],
      ['op3d-explode', 'Explodir', I.explode, 'EXPLODE'],
      ['op3d-join', 'Unir', I.join, 'JOIN'],
      ['op3d-break', 'Quebrar', I.break, 'BREAK'],
      ['op3d-matchprop', 'Copiar propriedades', I.matchprop, 'MATCHPROP'],
      ['op3d-erase', 'Apagar', I.erase, 'ERASE'],
      ['op3d-undo', 'Desfazer', I.undo, 'UNDO'],
      ['op3d-redo', 'Refazer', I.redo, 'REDO'],
    ]),
    group('op3d-dim', 'Cotar', I.dim, [
      ['op3d-dimlinear', 'Linear', I.dim, 'DIMLINEAR'],
      ['op3d-dimaligned', 'Alinhada', I.dimaligned, 'DIMALIGNED'],
      ['op3d-dimcontinue', 'Contínua', I.dimcont, 'DIMCONTINUE'],
      ['op3d-dimradius', 'Raio', I.dimradius, 'DIMRADIUS'],
      ['op3d-dimdiameter', 'Diâmetro', I.dimdiam, 'DIMDIAMETER'],
      ['op3d-dimangular', 'Angular', I.dimangle, 'DIMANGULAR'],
      ['op3d-textedit', 'Editar texto', I.textedit, 'TEXTEDIT'],
    ]),
  ];
}
