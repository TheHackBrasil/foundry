// Tunel de desenvolvimento (spec 0017): `npm run tunel` sobe um tunel rapido
// da Cloudflare para a API local (porta PORT, padrao 3000) e aponta o
// webhook do agente da Retell para ele. O endereco muda a cada execucao, por
// isso o comando refaz o registro sozinho. So para o PC: em producao o
// servidor usa URL_PUBLICA ao subir.
//
// Quem chega pelo tunel nunca cai no workspace local (WORKSPACE_LOCAL vale
// so para conexao direta da propria maquina), entao os dados do PC nao
// ficam expostos.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { configRetellDoEnv, sincronizarWebhookRetell } from '../operador/canais/voz/retell.js';

await import('dotenv/config');

const porta = process.env['PORT']?.trim() || '3000';
const candidatos = [
  process.env['CLOUDFLARED_BIN'],
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
].filter((c): c is string => !!c);
const binario = candidatos.find((c) => existsSync(c)) ?? 'cloudflared';

const retell = configRetellDoEnv();
if (!retell) console.warn('tunel: Retell sem credencial completa no .env; o tunel sobe, mas o webhook nao e registrado.');

const filho = spawn(binario, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${porta}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
filho.on('error', (e) => {
  console.error(`tunel: nao foi possivel rodar o cloudflared (${e.message}). Instale com: winget install Cloudflare.cloudflared`);
  process.exit(1);
});

let registrado = false;
const ler = (bloco: Buffer): void => {
  const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(bloco.toString())?.[0];
  if (!url || registrado) return;
  registrado = true;
  console.log(`tunel: ${url} -> http://127.0.0.1:${porta}`);
  if (!retell) return;
  void sincronizarWebhookRetell(retell, url).then((r) => {
    console.log(r.ok ? `tunel: webhook da Retell em ${r.url}` : `tunel: webhook nao atualizado (${r.motivo})`);
  });
};
filho.stdout.on('data', ler);
filho.stderr.on('data', ler);
filho.on('exit', (codigo) => process.exit(codigo ?? 0));
for (const sinal of ['SIGINT', 'SIGTERM'] as const) process.once(sinal, () => filho.kill());
