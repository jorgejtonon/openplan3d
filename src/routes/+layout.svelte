<script>
  import '../app.css';
  import { initializeLocale } from '$lib/i18n';
  onMount(initializeLocale);
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import { env } from '$env/dynamic/public';
  import { themePreference } from '$lib/stores/theme';
  import DeploymentNotice from '$lib/components/DeploymentNotice.svelte';
  // Analytics are opt-in (PUBLIC_ENABLE_ANALYTICS=true): this copy sends nothing to third parties by default.
  onMount(() => { if (window.location.pathname !== '/render-lab' && env.PUBLIC_ENABLE_ANALYTICS === 'true') void import('$lib/firebase'); });
  let { children } = $props();
</script>

{@render children()}
<DeploymentNotice />
