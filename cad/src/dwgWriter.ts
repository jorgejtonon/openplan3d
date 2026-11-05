/**
 * Saving as DWG: the drawing is exported as DXF and converted to native DWG by acadrust compiled
 * to WebAssembly (cad/dwg-writer), in a worker so the screen stays responsive.
 */

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();

const asset = (name: string) => new URL(`./dwg/${name}`, location.href).href;

/** True when this build carries the DWG writer (it is generated in the release builds). Reads its
 * small loader script: an app shell answering for a missing file would be HTML, not code. */
export async function dwgWriterAvailable(): Promise<boolean> {
  try {
    const response = await fetch(asset('op3d_dwg_writer.js'));
    if (!response.ok) return false;
    const text = await response.text();
    return text.includes('dxf_to_dwg') && !text.trimStart().startsWith('<');
  } catch { return false; }
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(asset('dwg-worker.js'), { type: 'module' });
  worker.onmessage = (event: MessageEvent<{ id: number; ok: boolean; dwg?: ArrayBuffer; error?: string }>) => {
    const job = pending.get(event.data.id);
    if (!job) return;
    pending.delete(event.data.id);
    if (event.data.ok && event.data.dwg) job.resolve(new Uint8Array(event.data.dwg));
    else job.reject(new Error(event.data.error || 'conversão falhou'));
  };
  worker.onerror = event => {
    for (const job of pending.values()) job.reject(new Error(event.message || 'o conversor DWG parou'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Converts DXF content to DWG of the given AutoCAD release (2004, 2007, 2010, 2013, 2018). */
export function dxfToDwg(dxf: string | Uint8Array, year: number): Promise<Uint8Array> {
  const bytes = typeof dxf === 'string' ? new TextEncoder().encode(dxf) : dxf.slice();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, dxf: bytes.buffer, year }, [bytes.buffer]);
  });
}
