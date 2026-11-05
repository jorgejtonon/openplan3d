// Runs the DXF → DWG conversion (acadrust, compiled to WebAssembly) off the main thread.
// op3d_dwg_writer.js and its .wasm are generated at build time from cad/dwg-writer.
let ready = null;

self.onmessage = async event => {
  const { id, dxf, year } = event.data;
  try {
    if (!ready) {
      ready = import('./op3d_dwg_writer.js').then(async module => {
        await module.default({ module_or_path: new URL('./op3d_dwg_writer_bg.wasm', import.meta.url) });
        return module;
      });
    }
    const module = await ready;
    const dwg = module.dxf_to_dwg(new Uint8Array(dxf), year);
    self.postMessage({ id, ok: true, dwg: dwg.buffer }, [dwg.buffer]);
  } catch (error) {
    ready = null;
    self.postMessage({ id, ok: false, error: String((error && error.message) || error) });
  }
};
