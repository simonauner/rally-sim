import { defineConfig } from 'vite';

export default defineConfig({
  // Relativa sökvägar, så bygget fungerar under /rally-sim/ på GitHub Pages och var som helst.
  base: './',
  build: { target: 'es2022' },
});
