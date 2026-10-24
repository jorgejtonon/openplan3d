import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { installPrompt, listenForInstallPrompt, promptInstall, type InstallPromptEvent } from '$lib/stores/installPrompt';
import { nativeFileName } from '$lib/native/appBridge';

describe('installable app', () => {
  it('declares a home-screen app that opens standalone with maskable icons', () => {
    const manifest = JSON.parse(readFileSync('static/manifest.webmanifest', 'utf8'));
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('./'); // Relative: works at the root and under /openplan3d.
    expect(manifest.icons.some((i: { purpose: string; sizes: string }) => i.purpose === 'maskable' && i.sizes === '512x512')).toBe(true);
    expect(manifest.icons.some((i: { sizes: string }) => i.sizes === '192x192')).toBe(true);
    const html = readFileSync('src/app.html', 'utf8');
    expect(html).toContain('href="%sveltekit.assets%/manifest.webmanifest"');
  });

  it('keeps the browser install offer for our button and shows it once', async () => {
    const handlers: Record<string, (event: Event) => void> = {};
    listenForInstallPrompt({ addEventListener: (type: string, handler: (event: Event) => void) => { handlers[type] = handler; } } as unknown as Window);
    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: 'accepted' as const }) }) as InstallPromptEvent;
    handlers.beforeinstallprompt(event);
    expect(event.defaultPrevented).toBe(true);
    expect(get(installPrompt)).toBe(event);
    expect(await promptInstall(event)).toBe(true);
    expect(prompt).toHaveBeenCalledOnce();
    expect(get(installPrompt)).toBeNull();
    expect(await promptInstall(null)).toBe(false);
  });
});

describe('Android app files', () => {
  it('names saved files so the phone storage accepts them', () => {
    expect(nativeFileName('Casa: Lote 3 / A3.pdf')).toBe('Casa- Lote 3 - A3.pdf');
    expect(nativeFileName('  ')).toBe('arquivo');
  });

  it('packages the static build with the plugins the app uses', () => {
    const config = readFileSync('capacitor.config.ts', 'utf8');
    expect(config).toContain("webDir: 'site'");
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    for (const plugin of ['@capacitor/filesystem', '@capacitor/share', '@capacitor/app', '@capacitor/screen-orientation', '@capacitor/status-bar']) {
      expect(pkg.dependencies[plugin]).toBeTruthy();
    }
  });
});

describe('Android download interception', () => {
  class FakeAnchor {
    href = ''; attrs = new Map<string, string>(); clicked = 0;
    hasAttribute(name: string) { return this.attrs.has(name); }
    getAttribute(name: string) { return this.attrs.get(name) ?? null; }
    click() { this.clicked++; }
  }
  it('saves exported files even when the exporter revokes the URL immediately', async () => {
    const { interceptDownloads } = await import('$lib/native/appBridge');
    let counter = 0;
    const url = { createObjectURL: (_object: Blob | MediaSource) => `blob:app/${++counter}`, revokeObjectURL: vi.fn((_url: string) => {}) };
    const saved: [Blob, string][] = [];
    interceptDownloads({ anchor: FakeAnchor, url }, async (blob, name) => { saved.push([blob, name]); }, 5);
    const pdf = new Blob(['%PDF'], { type: 'application/pdf' });
    const link = new FakeAnchor();
    link.href = url.createObjectURL(pdf);
    link.attrs.set('download', 'Prancha - A3.pdf');
    link.click();
    url.revokeObjectURL(link.href);
    await new Promise(r => setTimeout(r, 0));
    expect(saved).toEqual([[pdf, 'Prancha - A3.pdf']]);
    expect(link.clicked).toBe(0); // Not handed to the WebView, which cannot download.

    const external = new FakeAnchor();
    external.href = 'https://example.com/guide';
    external.click();
    expect(external.clicked).toBe(1); // Ordinary links keep working.
  });
});
