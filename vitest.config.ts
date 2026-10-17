import { defineConfig } from 'vitest/config';

// Dev-only dependency; never ships. Type-level assertions are checked by
// `pnpm typecheck` (tsc -p tsconfig.test.json), not by the runtime test run here.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
