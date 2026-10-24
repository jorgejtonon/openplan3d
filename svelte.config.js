import adapterNode from '@sveltejs/adapter-node';
import adapterStatic from '@sveltejs/adapter-static';

// STATIC_SITE=1 builds a server-free copy for static hosting (GitHub Pages, Netlify,
// Cloudflare Pages). BASE_PATH is the sub-folder it is served from, e.g. /openplan3d.
// Share links, assistant uploads and the MCP endpoint need the Node server and are off there.
const staticSite = process.env.STATIC_SITE === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: staticSite
			? adapterStatic({ pages: 'site', assets: 'site', fallback: 'index.html', precompress: false, strict: false })
			: adapterNode(),
		paths: { base: staticSite ? (process.env.BASE_PATH ?? '') : '' },
		...(staticSite ? { prerender: { entries: [] } } : {}),
	}
};

export default config;
