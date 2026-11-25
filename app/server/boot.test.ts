import { describe, expect, it } from 'vitest';
import { ehProcessoPrincipal } from './index.js';

describe('ehProcessoPrincipal', () => {
  it.runIf(process.platform !== 'win32')('reconhece o arquivo rodado direto em caminho POSIX', () => {
    expect(ehProcessoPrincipal('file:///home/ana/app/server/index.ts', '/home/ana/app/server/index.ts')).toBe(true);
  });

  it.runIf(process.platform !== 'win32')('reconhece caminho com espaço, que o import.meta.url codifica', () => {
    expect(ehProcessoPrincipal('file:///home/ana/meu%20app/server/index.ts', '/home/ana/meu app/server/index.ts')).toBe(true);
  });

  it.runIf(process.platform !== 'win32')('recusa quando outro arquivo é o ponto de entrada, como no vitest', () => {
    expect(ehProcessoPrincipal('file:///home/ana/app/server/index.ts', '/home/ana/app/node_modules/vitest/vitest.mjs')).toBe(false);
  });

  it('recusa sem argv[1]', () => {
    expect(ehProcessoPrincipal('file:///home/ana/app/server/index.ts', undefined)).toBe(false);
  });

  it.runIf(process.platform === 'win32')('reconhece caminho do Windows', () => {
    expect(ehProcessoPrincipal('file:///C:/ana/app/server/index.ts', 'C:\\ana\\app\\server\\index.ts')).toBe(true);
  });
});
