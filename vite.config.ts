// defineConfig is an identity function — it returns the object unchanged.
// Its only job is giving your editor autocomplete + type checking on the config.
import { defineConfig } from 'vite'

// "export default" = this file's single main export, which Vite looks for by name.
export default defineConfig({
  // './' makes asset URLs in the built HTML relative instead of absolute.
  // Pages serves us from /corvinus_annotator/, not /, so absolute paths would 404.
  // Relative also means the same dist/ works anywhere — Pages, Netlify, local file.
  base: './',
  build: {
    target: 'es2022', // modern browsers only: smaller output, no transpilation noise
    sourcemap: true,  // readable stack traces when debugging the deployed demo
    rollupOptions: {
      // Two pages, two entry points. Vite treats each HTML file as a build
      // entry and follows its module graph, so they share chunks rather than
      // duplicating the canvas and viewport code.
      input: { main: 'index.html', compare: 'compare.html' },
    },
  },
})
