import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { buildInfo } from './vite.config';

// En enda HTML-fil som går att öppna direkt eller hosta var som helst.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist-single', emptyOutDir: true },
  define: buildInfo,
});
