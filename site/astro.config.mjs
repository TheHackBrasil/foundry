// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  integrations: [react()],
  vite: {
    build: {
      // forge.js is three.js (~620 kB). It is already split out and loaded by a
      // dynamic import after first paint, only with WebGL and without reduced
      // motion, so the 500 kB default warning does not apply to it.
      chunkSizeWarningLimit: 700,
    },
  },
});