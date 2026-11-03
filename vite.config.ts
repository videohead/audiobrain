import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const packageMetadata = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
function currentCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'uncommitted';
  }
}
const commit = currentCommit();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version),
    __COMMIT_SHA__: JSON.stringify(commit),
  },
  plugins: [react()],
  server: {
    // @brain/control is linked from a sibling directory (mounted at /brain-control in Docker).
    fs: { allow: ['.', '../brain-control', '/brain-control'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.ts'],
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      exclude: ['src/test/**', 'src/main.tsx'],
    },
  },
});
