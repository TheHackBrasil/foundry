// O teste de contracts/ e do Hardhat (mocha, deps em contracts/package.json)
// e roda com `npx hardhat test` la dentro; sem este filtro, `npx vitest run`
// na raiz de app/ tenta carregar o hardhat e falha (D-C10 do brief-core).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts'],
  },
});
