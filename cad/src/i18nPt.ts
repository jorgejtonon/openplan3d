import { AcApI18n } from '@mlightcad/cad-simple-viewer';
import dictionary from './pt-dictionary.json';

type Tree = { [key: string]: string | Tree };

const pt = dictionary as Record<string, string>;

/** Number of English strings replaced; used by tests and to spot untranslated releases. */
export let translatedCount = 0;

function translateTree(tree: Tree) {
  for (const [key, value] of Object.entries(tree)) {
    // Command options keep their English global name: the editor matches typed input and derives the
    // one-letter alias from it, and the commands compare against it in code.
    if (key === 'global') continue;
    if (typeof value === 'string') {
      const translated = pt[value];
      if (translated !== undefined && translated !== value) { tree[key] = translated; translatedCount++; }
    } else if (value && typeof value === 'object') translateTree(value);
  }
}

/** The viewer ships English, Chinese, Arabic, Czech and Turkish. Portuguese replaces the English
 * texts by their wording (not their keys), so it survives changes in the message layout. */
export function applyPortuguese() {
  const english = AcApI18n.getLocaleMessage('en') as Tree | undefined;
  if (!english) return;
  translateTree(english);
  // Ask every component to redraw its labels with the new texts.
  AcApI18n.setCurrentLocale('zh');
  AcApI18n.setCurrentLocale('en');
  document.documentElement.lang = 'pt-BR';
  relabelFixedTexts();
}

/** A few labels are written in English straight into the markup, outside the message tables. */
const FIXED_LABELS: Record<string, string> = {
  'Close notifications': 'Fechar notificações',
  Notifications: 'Notificações',
};

function relabel(root: ParentNode) {
  for (const attr of ['aria-label', 'title']) {
    for (const el of root.querySelectorAll<HTMLElement>(`[${attr}]`)) {
      const value = el.getAttribute(attr);
      if (value && FIXED_LABELS[value]) el.setAttribute(attr, FIXED_LABELS[value]);
    }
  }
}

function relabelFixedTexts() {
  relabel(document);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; relabel(document); });
  }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
}
