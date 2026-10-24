<script>
  import '../app.css';
  import { initializeLocale } from '$lib/i18n';
  onMount(initializeLocale);
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { themePreference } from '$lib/stores/theme';
  import DeploymentNotice from '$lib/components/DeploymentNotice.svelte';
  import InstallAppButton from '$lib/components/InstallAppButton.svelte';
  import { listenForInstallPrompt } from '$lib/stores/installPrompt';
  import { base } from '$app/paths';
  import { page } from '$app/state';
  import { installNativeHooks, isNativeApp } from '$lib/native/appBridge';
  // Android/iOS app: save-and-share instead of browser downloads, Back button handling.
  onMount(() => { if (isNativeApp()) void installNativeHooks(); });
  // Installed app: offline copy and the install button (static-site build, browsers only).
  onMount(() => {
    if (import.meta.env.VITE_STATIC_SITE !== '1' || isNativeApp()) return;
    listenForInstallPrompt();
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register(`${base}/service-worker.js`).catch(() => {});
    // Ask the browser not to evict saved projects (usually granted to installed apps).
    void navigator.storage?.persist?.().catch(() => false);
  });
  // Analytics are opt-in (PUBLIC_ENABLE_ANALYTICS=true): this copy sends nothing to third parties by default.
  onMount(() => { if (window.location.pathname !== '/render-lab' && env.PUBLIC_ENABLE_ANALYTICS === 'true') void import('$lib/firebase'); });
  let { children } = $props();
</script>

{@render children()}
<DeploymentNotice />
{#if page.route.id === '/'}<InstallAppButton />{/if}
