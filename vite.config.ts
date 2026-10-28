import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vite';

// The site is served from the domain root (https://stl.stup.dev). To host it
// under a subpath instead, build with e.g. BASE_PATH=/stl-measure.
const raw = (process.env.BASE_PATH ?? '').replace(/^\/+|\/+$/g, '');
const base: '' | `/${string}` = raw ? `/${raw}` : '';

export default defineConfig({
	plugins: [
		sveltekit({
			// GitHub Pages compresses on its own; the Docker/nginx build sets PRECOMPRESS=true.
			adapter: adapter({ precompress: process.env.PRECOMPRESS === 'true' }),
			paths: { base }
		})
	],
	// three.js is one large chunk; that's expected.
	build: { chunkSizeWarningLimit: 1000 }
});
