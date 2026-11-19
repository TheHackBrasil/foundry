#!/usr/bin/env node
// repo-guard.mjs — guarda local do repo (substitui CI). READ-ONLY.
// Uso: node scripts/repo-guard.mjs   → exit 0 ok, exit 1 em qualquer falha.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });

// commitados + staged + untracked não-ignorados (guarda pré-commit, não só pós).
// -z + quotepath=false: nomes com acento/espaço voltam literais.
let tracked;
try {
  tracked = git(['-c', 'core.quotepath=false', 'ls-files', '-z',
    '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean);
} catch {
  console.error('[FALHA] git indisponível ou fora de um repositório git');
  process.exit(1);
}
const present = tracked.filter((f) => existsSync(join(ROOT, f)));
const headFiles = (() => {
  try {
    return git(['ls-tree', '-r', '--name-only', '-z', 'HEAD'])
      .split('\0').filter(Boolean);
  } catch { return null; } // repo sem commits ainda
})();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const inHead = (p) => headFiles !== null && headFiles.includes(p);

// --- 1. segredos -------------------------------------------------------------
{
  const whitelist = /\.(example|sample|template|pub)$/;
  const badName = present.filter((f) =>
    !whitelist.test(f) &&
    (/^\.env($|\.)/.test(f.split('/').pop()) || /\.(pem|key|p12|pfx|jks|keystore)$/i.test(f) ||
     /(^|\/)(id_rsa|id_ed25519|id_ecdsa|id_dsa|credentials|secrets?)(\.|_|-|$)/i.test(f)));
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bghp_[A-Za-z0-9]{20,}\b/, /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bsk_(?:live|test)_[A-Za-z0-9]{10,}\b/, /\bsk-(?:proj|ant)-[A-Za-z0-9_-]{10,}\b/,
    /\bAIza[0-9A-Za-z_-]{35}\b/, /\bxox[bapors]-[0-9A-Za-z-]{10,}\b/,
    /_authToken\s*=\s*\S+/,
  ];
  const hits = [];
  for (const f of present) {
    if (whitelist.test(f)) continue;
    try {
      if (statSync(join(ROOT, f)).size > 512 * 1024) continue;
      const c = read(f);
      for (const re of patterns) if (re.test(c)) hits.push(`${f} (${re.source.slice(0, 30)}…)`);
    } catch { /* binário ou ilegível */ }
  }
  check('secrets', badName.length + hits.length === 0,
    [...badName, ...hits].join('; ') || 'nenhum segredo versionado');
}

// --- 2. specs: numeração única/crescente, spec.md, índice ----------------------
{
  const specDirs = [...new Set(
    tracked.filter((f) => f.startsWith('specs/')).map((f) => f.split('/')[1])
      .filter((d) => /^\d{4}-[^/]+$/.test(d)),
  )].sort();
  const errs = [];
  const numbers = specDirs.map((d) => d.slice(0, 4));
  const dupes = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (dupes.length) errs.push(`número(s) duplicado(s): ${[...new Set(dupes)].join(', ')}`);
  const index = existsSync(join(ROOT, 'specs/README.md')) ? read('specs/README.md') : '';
  for (const d of specDirs) {
    if (!present.includes(`specs/${d}/spec.md`)) errs.push(`${d}: falta spec.md`);
    if (!new RegExp(`\\((?:\\./)?(?:specs/)?${d}/`).test(index))
      errs.push(`${d}: fora do índice specs/README.md`);
  }
  // lacunas: cada número faltante no intervalo deve constar no índice
  if (numbers.length > 1) {
    const [min, max] = [Number(numbers[0]), Number(numbers[numbers.length - 1])];
    for (let n = min + 1; n < max; n++) {
      const nn = String(n).padStart(4, '0');
      if (!numbers.includes(nn) && !index.includes(nn))
        errs.push(`lacuna ${nn} não registrada em specs/README.md`);
    }
  }
  check('specs', errs.length === 0, errs.join('; ') || `${specDirs.length} spec(s) íntegra(s)`);
}

// --- 2b. índice de docs/ (A4) --------------------------------------------------
{
  const missing = existsSync(join(ROOT, 'docs/README.md'))
    ? tracked
        .filter((f) => f.startsWith('docs/') && f !== 'docs/README.md')
        .map((f) => f.slice(5))
        .filter((name) => !read('docs/README.md').includes(name))
    : tracked.filter((f) => f.startsWith('docs/')).concat('(docs/README.md ausente)');
  check('docs-index', missing.length === 0,
    missing.join('; ') || 'todo arquivo de docs/ indexado');
}

// --- 3. imutáveis: fontes primárias + specs entregues (A9) ----------------------
// O conjunto protegido deriva do HEAD — status lido do worktree não anula A9.
{
  const errs = [];
  const manifestPath = '.specify/immutable.txt';
  const manifest = existsSync(join(ROOT, manifestPath))
    ? read(manifestPath).split('\n')
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  for (const p of manifest)
    if (p.endsWith('/')) errs.push(`${manifestPath}: "${p}" é diretório — o manifest aceita só arquivos`);
  const protectedPaths = new Set([manifestPath, ...manifest]);
  if (headFiles) {
    for (const f of headFiles.filter((f) => /^specs\/\d{4}-[^/]+\/spec\.md$/.test(f))) {
      try {
        if (/\*{0,2}Status:?\*{0,2}:?\s*\**entregue\b/i.test(git(['show', `HEAD:${f}`])))
          protectedPaths.add(f);
      } catch { errs.push(`${f}: erro ao ler HEAD`); }
    }
    for (const p of protectedPaths) {
      if (!existsSync(join(ROOT, p))) { errs.push(`${p}: apagado`); continue; }
      if (!inHead(p)) continue; // artefato novo nesta PR — ainda não é ledger
      try {
        execFileSync('git', ['diff', '--quiet', 'HEAD', '--', p],
          { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        if (e.status === 1) errs.push(`${p}: editado (imutável — correção é artefato novo/errata)`);
        else errs.push(`${p}: erro no diff vs HEAD (${String(e.stderr).split('\n')[0]})`);
      }
    }
  }
  check('immutable', errs.length === 0,
    errs.join('; ') ||
    (headFiles ? `${protectedPaths.size} artefato(s) protegido(s)` : 'sem HEAD — ledger ainda não iniciado'));
}

// --- 4. links relativos em markdown -------------------------------------------
{
  const errs = [];
  const linkRe = /\[[^\]]*\]\((<[^>]+>|[^)\s]+)[^)]*\)/g;
  let inFence = false;
  for (const f of present.filter((f) => f.endsWith('.md'))) {
    read(f).split('\n').forEach((rawLine, i) => {
      if (/^\s*(```|~~~)/.test(rawLine)) { inFence = !inFence; return; }
      if (inFence) return;
      const line = rawLine.replace(/`[^`]*`/g, ''); // ignora inline code
      let m;
      while ((m = linkRe.exec(line))) {
        let raw = m[1].replace(/^<|>$/g, '');
        if (/^(https?:|mailto:|tel:|data:|#|\/\/|ftp:)/i.test(raw)) continue;
        raw = raw.split('#')[0].split('?')[0];
        if (!raw) continue;
        let target;
        try { target = decodeURIComponent(raw); } catch { target = raw.replace(/%20/g, ' '); }
        const base = target.startsWith('/') ? ROOT : resolve(ROOT, dirname(f));
        if (!existsSync(resolve(base, target.replace(/^\//, ''))))
          errs.push(`${f}:${i + 1} → ${raw}`);
      }
    });
  }
  check('md-links', errs.length === 0,
    errs.slice(0, 8).join('; ') + (errs.length > 8 ? ` (+${errs.length - 8})` : '') || 'todos resolvem');
}

// --- 4c. prosa: travessão (U+2014) proibido em markdown — STYLE.md --------------
// Artefatos protegidos (A9) são história congelada: ficam fora da regra.
{
  const manifest = existsSync(join(ROOT, '.specify/immutable.txt'))
    ? read('.specify/immutable.txt').split('\n')
        .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : [];
  const frozen = new Set(manifest);
  if (headFiles) {
    for (const f of headFiles.filter((f) => /^specs\/\d{4}-[^/]+\/spec\.md$/.test(f))) {
      try {
        if (/\*{0,2}Status:?\*{0,2}:?\s*\**entregue\b/i.test(git(['show', `HEAD:${f}`])))
          frozen.add(f);
      } catch { /* ignora */ }
    }
  }
  const slopChars = [
    ['—', 'travessão'], ['–', 'meia-risca'], ['“', 'aspa curva'], ['”', 'aspa curva'], ['‘', 'aspa curva'], ['’', 'aspa curva'],
  ];
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
  const errs = [];
  for (const f of present.filter((f) => f.endsWith('.md') && !frozen.has(f))) {
    const hits = read(f).split('\n').flatMap((line, i) => {
      const tags = slopChars.filter(([c]) => line.includes(c)).map(([, n]) => n);
      if (emojiRe.test(line)) tags.push('emoji');
      return tags.length ? [`${f}:${i + 1} (${[...new Set(tags)].join(', ')})`] : [];
    });
    errs.push(...hits);
  }
  check('prose', errs.length === 0,
    errs.slice(0, 8).join('; ') + (errs.length > 8 ? ` (+${errs.length - 8})` : '')
      || 'sem travessão/meia-risca/aspa curva/emoji em markdown');
}

// --- 4b. assets referenciados em HTML/SVG -------------------------------------
{
  const errs = [];
  const refRe = /(?:src|href)\s*=\s*["']([^"']+)["']/g;
  for (const f of present.filter((f) => /\.(html?|svg)$/.test(f))) {
    read(f).split('\n').forEach((line, i) => {
      let m;
      while ((m = refRe.exec(line))) {
        const raw = m[1];
        if (/^(https?:|mailto:|tel:|data:|#|\/\/)/i.test(raw)) continue;
        const target = raw.split('#')[0].split('?')[0].replace(/%20/g, ' ');
        if (!target) continue;
        const base = target.startsWith('/') ? ROOT : resolve(ROOT, dirname(f));
        if (!existsSync(resolve(base, target.replace(/^\//, ''))))
          errs.push(`${f}:${i + 1} → ${raw}`);
      }
    });
  }
  check('html-assets', errs.length === 0,
    errs.slice(0, 8).join('; ') + (errs.length > 8 ? ` (+${errs.length - 8})` : '') || 'todos resolvem');
}

// --- 5. marcadores do AGENTS.md ------------------------------------------------
{
  const required = ['Ordem de leitura', 'Regras duras', 'Definition of Done', 'Não faça'];
  const agents = existsSync(join(ROOT, 'AGENTS.md')) ? read('AGENTS.md') : '';
  const missing = required.filter((s) => !new RegExp(`^## ${s}\\s*$`, 'm').test(agents));
  check('agents', missing.length === 0,
    missing.length ? `marcadores ausentes: ${missing.join(', ')}` : 'marcadores intactos');
}

// --- 6. scripts: node --check ---------------------------------------------------
{
  const errs = [];
  for (const f of present.filter((f) => /\.(mjs|cjs|js)$/.test(f) && !f.includes('node_modules'))) {
    try { execFileSync(process.execPath, ['--check', join(ROOT, f)], { stdio: 'pipe' }); }
    catch (e) { errs.push(`${f}: ${String(e.stderr).split('\n')[0]}`); }
  }
  check('scripts', errs.length === 0, errs.join('; ') || 'sintaxe ok');
}

// --- 7. JSON versionado válido --------------------------------------------------
{
  const errs = [];
  for (const f of present.filter((f) => f.endsWith('.json'))) {
    try { JSON.parse(read(f)); } catch (e) { errs.push(`${f}: ${e.message}`); }
  }
  check('json', errs.length === 0, errs.join('; ') || 'válidos');
}

// --- 8. versão de runtime coerente -----------------------------------------------
{
  const nvmrc = existsSync(join(ROOT, '.nvmrc')) ? read('.nvmrc').trim() : null;
  let engines = null;
  if (existsSync(join(ROOT, 'package.json'))) {
    try { engines = JSON.parse(read('package.json')).engines?.node ?? null; }
    catch { /* JSON inválido — o check 'json' já reporta */ }
  }
  const declared = nvmrc || engines;
  const major = declared?.match(/\d+/)?.[0];
  if (!major) {
    check('runtime', true, 'n/a — sem .nvmrc/engines');
  } else {
    const docs = present.filter((f) => f.endsWith('.md')).map(read).join('\n');
    const mentioned = new RegExp(`\\b(node|node\\.js|nvm|v)\\s*v?${major}\\b`, 'i').test(docs);
    check('runtime', mentioned, `declarado ${declared} (major ${major}) — docs não mencionam`);
  }
}

// --- saída -----------------------------------------------------------------------
let fail = 0;
for (const r of results) {
  console.log(`${r.ok ? '[OK]   ' : '[FALHA]'} ${r.name} — ${r.detail}`);
  if (!r.ok) fail++;
}
console.log(`\n${fail === 0 ? 'guard verde' : `${fail} falha(s)`} · ${results.length} checks`);
process.exit(fail === 0 ? 0 : 1);
