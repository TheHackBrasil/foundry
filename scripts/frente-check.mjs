#!/usr/bin/env node
// Pre-commit das frentes (D-019, specs/0005): em wt/<nome> só entram os paths
// da frente (speckit/frentes.json); na main, só commit de integração.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const fail = (msg) => { console.error(`[frente-check] ${msg}`); process.exit(1); };

const ROOT = git(['rev-parse', '--show-toplevel']);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
// --no-renames: um rename aparece como remoção + adição, e as duas pontas contam
const staged = git(['diff', '--cached', '--name-only', '--no-renames'])
  .split('\n').filter(Boolean);

if (branch === 'main') {
  if (process.env.FOUNDRY_INTEGRA === '1') process.exit(0);
  fail('commit direto na main é só para integração.\n'
    + '  Trabalhe no worktree da sua frente (speckit/frentes.md) ou, se você integra:\n'
    + '  FOUNDRY_INTEGRA=1 git commit ...');
}

if (!branch.startsWith('wt/')) process.exit(0);

const nome = branch.slice(3);
const mapPath = join(ROOT, 'speckit/frentes.json');
if (!existsSync(mapPath)) fail('speckit/frentes.json ausente.');
const frente = JSON.parse(readFileSync(mapPath, 'utf8')).frentes?.[nome];
if (!frente) fail(`a frente "${nome}" não está em speckit/frentes.json. A integração registra a frente e o brief na main antes do worktree.`);

// "pasta/" vale para a pasta inteira, um * vale dentro de um nome de arquivo
const casa = (p, f) => {
  if (p.endsWith('/')) return f.startsWith(p);
  if (!p.includes('*')) return f === p;
  const re = p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  return new RegExp(`^${re}$`).test(f);
};
const dentro = (f) => frente.paths.some((p) => casa(p, f));
const fora = staged.filter((f) => !dentro(f));
if (fora.length) {
  fail(`a frente "${nome}" não pode commitar estes arquivos:\n`
    + fora.map((f) => `  - ${f}`).join('\n')
    + `\n  Paths da frente: ${frente.paths.join(', ')}`
    + '\n  Arquivo de outra frente: combine com a dona ou sequencie. Arquivo da integração: anote no brief e peça na main.');
}
