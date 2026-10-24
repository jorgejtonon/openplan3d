<script lang="ts">
  import { t, locale } from '$lib/i18n';
  import { get } from 'svelte/store';
  import { modalDialog } from '$lib/utils/modalDialog';
  import type { Project } from '$lib/models/types';
  import { buildTechnicalSheets, planSheets, technicalSheetFilename, SHEET_FORMATS, STANDARD_SCALES, type SheetFormat, type PerspectiveImage } from '$lib/utils/technicalSheet';
  import { loadSheetOptions, saveSheetOptions } from '$lib/stores/sheetPreferences';
  import { captureMain3DPNG } from '$lib/utils/captureMain3D';

  let { project, onclose }: { project: Project; onclose: () => void } = $props();

  // Read once when the dialog opens; edits stay local until a PDF is generated.
  // svelte-ignore state_referenced_locally
  let options = $state(loadSheetOptions(project.id));
  let busy = $state(false);
  let status = $state<{ kind: 'done' | 'error'; text: string } | null>(null);

  const formats = Object.keys(SHEET_FORMATS) as SheetFormat[];
  const entries = $derived(planSheets(project, options));
  const scaleValue = $derived(String(options.scale));

  function setScale(value: string) {
    options.scale = value === 'auto' ? 'auto' : Number(value);
  }

  async function capture3D(): Promise<PerspectiveImage | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const blob = await captureMain3DPNG(controller.signal);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const size = await new Promise<{ width: number; height: number }>((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve({ width: 16, height: 9 });
        image.src = dataUrl;
      });
      return { dataUrl, ...size };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function generate() {
    if (busy) return;
    busy = true; status = null;
    try {
      const snapshot = $state.snapshot(project) as Project;
      const chosen = $state.snapshot(options);
      const perspective = chosen.include3D ? await capture3D() : null;
      const language = get(locale) === 'pt' ? 'pt' : 'en';
      const result = buildTechnicalSheets(snapshot, chosen, language, perspective);
      if (!result) { status = { kind: 'error', text: $t('sheet.empty') }; return; }
      const blob = result.pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = technicalSheetFilename(snapshot, chosen);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      saveSheetOptions(project.id, chosen);
      status = { kind: 'done', text: $t('sheet.done', { pages: result.pages }) };
    } catch (error) {
      console.error(error);
      status = { kind: 'error', text: $t('sheet.failed') };
    } finally {
      busy = false;
    }
  }

  const field = 'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200';
  const label = 'block text-xs font-semibold uppercase tracking-wide text-gray-500';
</script>

<dialog use:modalDialog aria-labelledby="sheet-title" aria-describedby="sheet-description"
  oncancel={(event) => { if (busy) event.preventDefault(); else onclose(); }}
  onclose={() => { if (!busy) onclose(); }}
  class="m-auto w-[40rem] max-w-[calc(100vw-1rem)] max-h-[92vh] rounded-2xl bg-white p-0 shadow-2xl backdrop:bg-black/50">
  <div class="flex max-h-[92vh] flex-col text-gray-800">
    <div class="border-b border-gray-100 px-5 py-4">
      <h2 id="sheet-title" class="text-lg font-semibold">{$t('sheet.title')}</h2>
      <p id="sheet-description" class="mt-1 text-sm text-gray-500">{$t('sheet.help')}</p>
    </div>

    <div class="space-y-5 overflow-y-auto px-5 py-4">
      <section class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label class="col-span-1"><span class={label}>{$t('sheet.format')}</span>
          <select class={field} bind:value={options.format}>
            {#each formats as format}<option value={format}>{format}</option>{/each}
          </select>
        </label>
        <label class="col-span-1"><span class={label}>{$t('sheet.orientation')}</span>
          <select class={field} bind:value={options.orientation}>
            <option value="landscape">{$t('sheet.landscape')}</option>
            <option value="portrait">{$t('sheet.portrait')}</option>
          </select>
        </label>
        <label class="col-span-1"><span class={label}>{$t('sheet.scale')}</span>
          <select class={field} value={scaleValue} onchange={(event) => setScale((event.currentTarget as HTMLSelectElement).value)}>
            <option value="auto">{$t('sheet.scaleAuto')}</option>
            {#each STANDARD_SCALES as scale}<option value={String(scale)}>1:{scale}</option>{/each}
          </select>
        </label>
        <label class="col-span-1"><span class={label}>{$t('sheet.style')}</span>
          <select class={field} value={options.mono ? 'mono' : 'color'} onchange={(event) => options.mono = (event.currentTarget as HTMLSelectElement).value === 'mono'}>
            <option value="mono">{$t('sheet.mono')}</option>
            <option value="color">{$t('sheet.color')}</option>
          </select>
        </label>
        <label class="col-span-2 sm:col-span-4"><span class={label}>{$t('sheet.floors')}</span>
          <select class={field} bind:value={options.floors}>
            <option value="active">{$t('sheet.floorsActive')}</option>
            <option value="all">{$t('sheet.floorsAll')}</option>
          </select>
        </label>
      </section>

      <div role="status" class="space-y-1 text-sm">
        {#if !entries.length}
          <p class="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{$t('sheet.empty')}</p>
        {:else}
          {#each entries as entry (entry.floor.id)}
            {#if entry.fits}
              <p class="rounded-lg bg-green-50 px-3 py-2 text-green-900">✓ {$t('sheet.fits', { floor: entry.floor.name, scale: entry.scale })}</p>
            {:else if entry.suggestedScale}
              <p class="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">⚠ {$t('sheet.overflow', { floor: entry.floor.name, scale: entry.scale, suggested: entry.suggestedScale })}</p>
            {:else}
              <p class="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">⚠ {$t('sheet.overflowNone', { floor: entry.floor.name })}</p>
            {/if}
          {/each}
        {/if}
      </div>

      <fieldset>
        <legend class={label}>{$t('sheet.content')}</legend>
        <div class="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" bind:checked={options.furniture} />{$t('sheet.furniture')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" bind:checked={options.roomLabels} />{$t('sheet.roomLabels')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" bind:checked={options.chainDimensions} />{$t('sheet.chainDimensions')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" bind:checked={options.dimensions} />{$t('sheet.dimensions')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" bind:checked={options.wallLengths} />{$t('sheet.wallLengths')}</label>
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" class="h-4 w-4" bind:checked={options.textNotes} />{$t('sheet.textNotes')}</label>
          <label class="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" class="mt-0.5 h-4 w-4" bind:checked={options.include3D} />
            <span>{$t('sheet.include3D')}<span class="block text-xs text-gray-500">{$t('sheet.include3DHelp')}</span></span></label>
        </div>
      </fieldset>

      <fieldset class="space-y-3">
        <legend class={label}>{$t('sheet.titleBlock')}</legend>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.company')}</span><input class={field} bind:value={options.titleBlock.company} autocomplete="organization" /></label>
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.work')}</span><input class={field} bind:value={options.titleBlock.work} /></label>
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.address')}</span><input class={field} bind:value={options.titleBlock.address} autocomplete="street-address" /></label>
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.client')}</span><input class={field} bind:value={options.titleBlock.client} /></label>
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.drawingTitle')}</span><input class={field} bind:value={options.titleBlock.drawingTitle} placeholder={$t('sheet.drawingTitleHint')} /></label>
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.responsible')}</span><input class={field} bind:value={options.titleBlock.responsible} autocomplete="name" /></label>
          <label><span class="text-sm">{$t('sheet.registry')}</span><input class={field} bind:value={options.titleBlock.registry} /></label>
          <label><span class="text-sm">{$t('sheet.art')}</span><input class={field} bind:value={options.titleBlock.art} inputmode="numeric" /></label>
          <label><span class="text-sm">{$t('sheet.drawnBy')}</span><input class={field} bind:value={options.titleBlock.drawnBy} /></label>
          <label><span class="text-sm">{$t('sheet.revision')}</span><input class={field} bind:value={options.titleBlock.revision} /></label>
          <label><span class="text-sm">{$t('sheet.sheetNumber')}</span><input class={field} bind:value={options.titleBlock.sheetNumber} placeholder={$t('sheet.sheetNumberHint')} /></label>
          <label><span class="text-sm">{$t('sheet.date')}</span><input class={field} bind:value={options.titleBlock.date} placeholder={$t('sheet.dateHint')} /></label>
          <label class="sm:col-span-2"><span class="text-sm">{$t('sheet.notes')}</span><textarea class={field} rows="3" bind:value={options.titleBlock.notes}></textarea></label>
        </div>
        <p class="text-xs text-gray-500">{$t('sheet.remember')}</p>
      </fieldset>

      <p class="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{$t('sheet.printTip')}</p>
      {#if status}
        <p role="status" class="rounded-lg px-3 py-2 text-sm {status.kind === 'done' ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900'}">{status.text}</p>
      {/if}
    </div>

    <div class="flex justify-end gap-2 border-t border-gray-100 px-5 py-3">
      <button class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold hover:bg-gray-50" onclick={onclose} disabled={busy}>{$t('sheet.cancel')}</button>
      <button class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60" onclick={generate} disabled={busy || !entries.length && !options.include3D}>
        {busy ? $t('sheet.generating') : $t('sheet.generate')}
      </button>
    </div>
  </div>
</dialog>
