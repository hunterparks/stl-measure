// Everything runs in the browser (three.js + local file parsing), so skip SSR
// and prerender the page shell as static files.
export const ssr = false;
export const prerender = true;
