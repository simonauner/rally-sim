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

/** The version (commit) and build time, shown by the main menu. The build runs in the same job as the deployment. */
export const buildInfo = {
  'import.meta.env.VITE_COMMIT': JSON.stringify(commit),
  'import.meta.env.VITE_BUILT_AT': JSON.stringify(new Date().toISOString()),
};

export default defineConfig({
  // Relative paths, so the build works under /rally-sim/ on GitHub Pages and anywhere else.
  base: './',
  build: { target: 'es2022' },
  define: buildInfo,
});
