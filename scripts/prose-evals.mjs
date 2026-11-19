#!/usr/bin/env node
// prose-evals: avaliação repetível de prosa em .md (STYLE.md).
// Padrões duros reprovam (exit 1); leves só avisam. `--strict` reprova leves.
// Artefatos A9 (fontes primárias + specs entregues no HEAD) e STYLE.md
// (que cita as frases proibidas como regra) ficam fora da avaliação.
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STRICT = process.argv.includes('--strict');
const git = (a) =>
  execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

const SELF = new Set(['STYLE.md', 'scripts/prose-evals.mjs']);

let present, headFiles;
try {
  const ls = (args) =>
    git(['-c', 'core.quotepath=false', ...args]).split('\0').filter(Boolean);
  present = [...new Set([...ls(['ls-files', '-z']), ...ls(['ls-files', '-z', '--others', '--exclude-standard'])])]
    .filter((f) => existsSync(join(ROOT, f)));
  headFiles = ls(['ls-tree', '-r', '--name-only', '-z', 'HEAD']);
} catch {
  console.log('[FALHA] git indisponível ou fora de um repositório git');
  process.exit(1);
}

const manifest = existsSync(join(ROOT, '.specify/immutable.txt'))
  ? readFileSync(join(ROOT, '.specify/immutable.txt'), 'utf8').split('\n')
      .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const frozen = new Set(manifest);
for (const f of headFiles.filter((f) => /^specs\/\d{4}-[^/]+\/spec\.md$/.test(f))) {
  try {
    if (/\*{0,2}Status:?\*{0,2}:?\s*\**entregue\b/i.test(git(['show', `HEAD:${f}`])))
      frozen.add(f);
  } catch { /* ignora */ }
}

// Duros: frases proibidas pelo STYLE.md detectáveis por padrão.
const HARD = [
  [/—|–/, 'travessão'],
  [/“|”|‘|’/, 'aspa curva'],
  [/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'emoji'],
  [/\bnão apenas\b[^.\n]*\bmas\b|\bnão só\b[^.\n]*\bmas\b/i, 'fórmula "não apenas X, mas Y"'],
  [/\b(é|seria|foi)\s+importante\s+(notar|ressaltar|destacar|mencionar|dizer)/i, 'inflador "é importante notar"'],
  [/\bvale\s+(ressaltar|notar|destacar|mencionar)/i, 'inflador "vale ressaltar"'],
  [/\b(no entanto|entretanto|todavia|ademais|além disso|por sua vez|dessa forma|desse modo|nesse sentido|por outro lado)\s*,/i, 'conectivo automático'],
  [/^(em resumo|em conclusão|em suma|concluindo|por fim)\s*,/im, 'fecho escolar'],
  [/\butiliz(a|e|ar|ando|ação|ações|amos|am|ava|avam|ou)\b/i, 'burocratês "utilizar"'],
  [/\bpor meio de\b/i, 'burocratês "por meio de"'],
  [/\b(a fim de|de modo a|de forma a)\b/i, 'burocratês "a fim de"'],
  [/\b(crucial|pivotal|delve|landscape|tapestry|testament)\b/i, 'AI-anglicismo'],
  [/\b(espero|esperamos) que (isso |esse |este |esta )?ajude\b/i, 'fecho de chatbot'],
  [/\bfique à vontade para\b|\bse (tiver|tiverem) (alguma )?dúvida[, ]/i, 'fecho de chatbot'],
];

// Leves: revisar, não reprovar.
const SOFT = [
  [/\b(revolucionári[oa]s?|disruptiv[oa]s?|de ponta(?! a)|última geração|cutting-edge|state-of-the-art|game-changer)\b/i, 'adjetivo de marketing'],
  [/,\s*\w+(ando|endo|indo)\s*\.?\s*$/i, 'gerúndio final raso'],
];

const files = present.filter((f) => f.endsWith('.md') && !frozen.has(f) && !SELF.has(f));
const hard = [], soft = [];
for (const f of files) {
  const lines = readFileSync(join(ROOT, f), 'utf8').split('\n');
  let inFence = false, bolds = 0;
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; return; }
    if (inFence) return;
    const line = raw.replace(/`[^`]*`/g, '');
    bolds += (line.match(/\*\*/g) || []).length;
    for (const [re, name] of HARD)
      if (re.test(line)) hard.push(`${f}:${i + 1} — ${name}: ${line.trim().slice(0, 70)}`);
    for (const [re, name] of SOFT)
      if (re.test(line)) soft.push(`${f}:${i + 1} — ${name}: ${line.trim().slice(0, 70)}`);
  });
  if (bolds > 40) soft.push(`${f} — excesso de negrito (${bolds / 2} pares)`);
}

console.log(`prose-evals · ${files.length} arquivo(s), ${frozen.size} congelado(s) A9\n`);
for (const h of hard) console.log(`[duro]  ${h}`);
for (const s of soft) console.log(`[leve]  ${s}`);
console.log(`\n${hard.length ? 'FALHOU' : 'OK'} · ${hard.length} dura(s) · ${soft.length} leve(s)`);
process.exit(hard.length || (STRICT && soft.length) ? 1 : 0);
