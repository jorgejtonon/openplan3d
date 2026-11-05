/** Registers the editing, dimension and text commands, with AutoCAD's names and shortcuts and
 * Portuguese names (APARAR, ESTENDER...) that can be typed too. */
import { AcApDocManager, AcEdCommandStack, type AcEdCommand } from '@mlightcad/cad-simple-viewer';
import {
  ArrayCmd, BreakCmd, ChamferCmd, ExplodeCmd, ExtendCmd, FilletCmd, JoinCmd, MirrorCmd, ScaleCmd, StretchCmd, TrimCmd,
} from './modify';
import {
  DimAlignedCmd, DimAngularCmd, DimContinueCmd, DimDiameterCmd, DimLinearCmd, DimRadiusCmd, MatchPropCmd, TextCmd,
  TextEditCmd,
} from './annotate';

/** [AutoCAD name, Portuguese name, command, shortcuts] */
export const EDITOR_COMMANDS: Array<[string, string, () => AcEdCommand, string[]]> = [
  ['TRIM', 'APARAR', () => new TrimCmd(), ['TR']],
  ['EXTEND', 'ESTENDER', () => new ExtendCmd(), ['EX']],
  ['FILLET', 'CONCORDAR', () => new FilletCmd(), ['F']],
  ['CHAMFER', 'CHANFRAR', () => new ChamferCmd(), ['CHA']],
  ['MIRROR', 'ESPELHAR', () => new MirrorCmd(), ['MI']],
  ['SCALE', 'ESCALA', () => new ScaleCmd(), ['SC']],
  ['STRETCH', 'ESTICAR', () => new StretchCmd(), ['S']],
  ['EXPLODE', 'EXPLODIR', () => new ExplodeCmd(), ['X']],
  ['JOIN', 'UNIR', () => new JoinCmd(), ['J']],
  ['BREAK', 'QUEBRAR', () => new BreakCmd(), ['BR']],
  ['ARRAY', 'MATRIZ', () => new ArrayCmd(), ['AR']],
  ['DIMLINEAR', 'COTALINEAR', () => new DimLinearCmd(), ['DLI']],
  ['DIMALIGNED', 'COTAALINHADA', () => new DimAlignedCmd(), ['DAL']],
  ['DIMCONTINUE', 'COTACONTINUA', () => new DimContinueCmd(), ['DCO']],
  ['DIMRADIUS', 'COTARAIO', () => new DimRadiusCmd(), ['DRA']],
  ['DIMDIAMETER', 'COTADIAMETRO', () => new DimDiameterCmd(), ['DDI']],
  ['DIMANGULAR', 'COTAANGULO', () => new DimAngularCmd(), ['DAN']],
  ['TEXT', 'TEXTO', () => new TextCmd(), ['DT']],
  ['TEXTEDIT', 'EDITARTEXTO', () => new TextEditCmd(), ['ED', 'DDEDIT']],
  ['MATCHPROP', 'COPIARPROP', () => new MatchPropCmd(), ['MA']],
];

/** Built-in commands replaced by ours (the built-in linear dimension writes 10000.000). */
const REPLACED = ['DIMLINEAR'];

let registered = false;

export function registerEditorCommands() {
  if (registered) return;
  registered = true;
  const stack = AcApDocManager.instance.commandManager;
  for (const name of REPLACED) stack.removeCmd(AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME, name);
  for (const [global, local, make, aliases] of EDITOR_COMMANDS) {
    try { stack.addCommand('OPENPLAN3D', global, local, make(), aliases); }
    catch (error) { console.warn(`command ${global} not registered`, error); }
  }
}
