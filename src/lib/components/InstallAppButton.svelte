<script lang="ts">
  import { t } from '$lib/i18n';
  import { installPrompt, promptInstall } from '$lib/stores/installPrompt';
</script>

{#if $installPrompt}
  <button
    onclick={() => promptInstall($installPrompt)}
    class="fixed bottom-4 right-4 z-[70] flex items-center gap-2 rounded-full bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-blue-700"
    title={$t('app.installHelp')}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><rect x="5" y="18" width="14" height="3" rx="1"/></svg>
    {$t('app.install')}
  </button>
{/if}
