// Vitest local da frente harness-transp: o vitest.config do app cobre so
// shared/, server/ e operador/ (paths de outra frente). Rode da pasta app/:
//   npx vitest run --config harness/vitest.config.ts
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // root preso a esta pasta: o include *.test.ts nao depende do cwd.
  root: dirname(fileURLToPath(import.meta.url)),
  test: {
    include: ['*.test.ts'],
    // Sockets reais (SMTP/IMAP) e PGlite podem passar de 5 s na suite inteira.
    testTimeout: 20_000,
  },
});
