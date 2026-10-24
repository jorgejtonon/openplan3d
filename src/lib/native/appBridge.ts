import { Capacitor } from '@capacitor/core';

/** True inside the Android/iOS app (Capacitor), false in any browser. */
export function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsDataURL(blob);
  });
}

/** A file name the phone's storage accepts. */
export function nativeFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim();
  return clean.slice(0, 120) || 'arquivo';
}

/** Saves a file in Documents/OpenPlan3D and opens the share sheet (WhatsApp, Drive, e-mail…). */
export async function saveAndShare(blob: Blob, filename: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const name = nativeFileName(filename);
  const data = await blobToBase64(blob);
  let uri: string;
  try {
    uri = (await Filesystem.writeFile({ path: `OpenPlan3D/${name}`, data, directory: Directory.Documents, recursive: true })).uri;
  } catch {
    // Some phones refuse shared storage; the app's own cache can still be shared.
    uri = (await Filesystem.writeFile({ path: name, data, directory: Directory.Cache })).uri;
  }
  try {
    const { Share } = await import('@capacitor/share');
    await Share.share({ title: name, files: [uri], dialogTitle: name });
  } catch { /* Closing the share sheet is not an error; the file is already saved. */ }
  return uri;
}

let backConsumedAt = -Infinity;
/** A screen that handled the Back gesture itself (the VR view) calls this so the app does not also go back. */
export function markBackHandled() { backConsumedAt = performance.now(); }

/** Landscape and no status bar while presenting in a headset. */
export async function enterImmersive() {
  if (!isNativeApp()) return;
  try { const { ScreenOrientation } = await import('@capacitor/screen-orientation'); await ScreenOrientation.lock({ orientation: 'landscape' }); } catch { /* optional */ }
  try { const { StatusBar } = await import('@capacitor/status-bar'); await StatusBar.hide(); } catch { /* optional */ }
}

export async function exitImmersive() {
  if (!isNativeApp()) return;
  try { const { ScreenOrientation } = await import('@capacitor/screen-orientation'); await ScreenOrientation.unlock(); } catch { /* optional */ }
  try { const { StatusBar } = await import('@capacitor/status-bar'); await StatusBar.show(); } catch { /* optional */ }
}

type AnchorLike = { href: string; hasAttribute(name: string): boolean; getAttribute(name: string): string | null; click(): void };
type UrlApi = { createObjectURL(object: Blob | MediaSource): string; revokeObjectURL(url: string): void };

/** Turns `<a download>` clicks on blob:/data: links into `save(blob, name)`; other links behave normally.
 * Blobs stay reachable for a minute after revokeObjectURL, because exporters revoke right after click(). */
export function interceptDownloads(env: { anchor: { prototype: AnchorLike }; url: UrlApi }, save: (blob: Blob, name: string) => Promise<unknown>, keepMs = 60_000) {
  const blobs = new Map<string, Blob>();
  const create = env.url.createObjectURL.bind(env.url), revoke = env.url.revokeObjectURL.bind(env.url);
  env.url.createObjectURL = (object: Blob | MediaSource) => {
    const url = create(object);
    if (object instanceof Blob) blobs.set(url, object);
    return url;
  };
  env.url.revokeObjectURL = (url: string) => {
    setTimeout(() => { blobs.delete(url); revoke(url); }, keepMs);
  };
  const click = env.anchor.prototype.click;
  env.anchor.prototype.click = function (this: AnchorLike) {
    const href = this.href;
    if (this.hasAttribute('download') && /^(blob:|data:)/.test(href)) {
      const name = this.getAttribute('download') || 'arquivo';
      void (async () => {
        const blob = blobs.get(href) ?? await (await fetch(href)).blob();
        await save(blob, name);
      })().catch(error => console.error('Could not save file', error));
      return;
    }
    return click.call(this);
  };
}

let installed = false;

/** App-only behaviour: downloads become "save + share", and the Android Back button closes
 * the VR view or an open dialog before navigating back or leaving the app. */
export async function installNativeHooks() {
  if (installed || !isNativeApp()) return;
  installed = true;

  interceptDownloads({ anchor: HTMLAnchorElement, url: URL }, saveAndShare);

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#0f172a' });
  } catch { /* optional */ }

  const { App } = await import('@capacitor/app');
  await App.addListener('backButton', ({ canGoBack }) => {
    if (performance.now() - backConsumedAt < 800) return;
    const exitVr = document.querySelector<HTMLButtonElement>('button[data-headset-ui]');
    if (exitVr) { exitVr.click(); return; }
    const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]');
    const dialog = dialogs[dialogs.length - 1];
    if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return; }
    if (canGoBack) window.history.back();
    else void App.exitApp();
  });
}
