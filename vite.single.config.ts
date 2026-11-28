import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildInfo } from './vite.config';

// A single HTML file that can be opened directly or hosted anywhere.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist-single', emptyOutDir: true },
  define: buildInfo,
});
