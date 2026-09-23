import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const packageMetadata = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
function currentCommit(): string {
  if (process.env.AUDIOBRAIN_COMMIT && /^[a-f0-9]{40}$/.test(process.env.AUDIOBRAIN_COMMIT)) return process.env.AUDIOBRAIN_COMMIT;
  if (process.env.GITHUB_SHA && /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA)) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'uncommitted';
  }
}
const commit = currentCommit();
const base = process.env.AUDIOBRAIN_BASE_PATH ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('AUDIOBRAIN_BASE_PATH must start and end with /.');

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(packageMetadata.version),
    __COMMIT_SHA__: JSON.stringify(commit),
  },
  plugins: [react(), {
    name: 'audiobrain-build-identity',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build.json',
        source: JSON.stringify({ app: 'audiobrain', version: packageMetadata.version, commit }, null, 2) + '\n',
      });
    },
  }],
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
