import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		// SPA mode: output to ../dist (where the Dockerfile expects it); fallback serves dynamic routes like /event/[id]
		adapter: adapter({ pages: '../dist', assets: '../dist', fallback: 'index.html' })
	}
};

export default config;
