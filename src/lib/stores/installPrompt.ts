import { writable } from 'svelte/store';

export type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** Chrome/Edge/Samsung Internet offer installation through this event; null when not offered. */
export const installPrompt = writable<InstallPromptEvent | null>(null);

let listening = false;
export function listenForInstallPrompt(target: Pick<Window, 'addEventListener'> = window) {
  if (listening) return;
  listening = true;
  target.addEventListener('beforeinstallprompt', event => {
    event.preventDefault(); // Show our own button instead of the mini-infobar.
    installPrompt.set(event as InstallPromptEvent);
  });
  target.addEventListener('appinstalled', () => installPrompt.set(null));
}

export async function promptInstall(event: InstallPromptEvent | null): Promise<boolean> {
  if (!event) return false;
  installPrompt.set(null); // A prompt can be shown only once.
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}
