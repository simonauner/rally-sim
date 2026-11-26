import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';

const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'okänd';
  }
})();

/** Versionen (commit) och byggtiden, som huvudmenyn visar. Bygget görs i samma körning som driftsättningen. */
export const buildInfo = {
  'import.meta.env.VITE_COMMIT': JSON.stringify(commit),
  'import.meta.env.VITE_BUILT_AT': JSON.stringify(new Date().toISOString()),
};

export default defineConfig({
  // Relativa sökvägar, så bygget fungerar under /rally-sim/ på GitHub Pages och var som helst.
  base: './',
  build: { target: 'es2022' },
  define: buildInfo,
});
