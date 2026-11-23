// Seed (spec 0004, T041): ingere app/seed/** e app/server/fixtures.
// Idempotente: pedido ja existente e pulado. Roda pela CLI (npm run seed) ou no
// boot do servidor com SEED_ON_BOOT=1, antes do listen.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDoEnv } from './config.js';
import { createDb } from './db.js';
import { detectarTipo } from './ingest/detect.js';
import { nomeAnexoSeguro } from './ingest/imap.js';
import { ingerir } from './pipeline.js';
import { ehProcessoPrincipal } from './processo.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIRS = [join(AQUI, '..', 'seed'), join(AQUI, 'fixtures')];
const ORDEM = ['.xml', '.csv', '.pdf'];
// NF-e cria o pedido; CT-e/eventos/planilha/PDF enriquecem depois.
const PRIORIDADE_TIPO: Record<string, number> = {
  nfe: 0,
  cte: 1,
  eventoNFe: 2,
  csv: 3,
  pdf: 4,
};

// store precisa estar no workspace da seed.
export async function carregarSeed(
  store: LedgerStore,
  canal: CanalSSE,
  log: (msg: string) => void = console.log,
): Promise<{ ingeridos: number; pulados: number }> {
  let ingeridos = 0;
  let pulados = 0;
  for (const dir of DIRS) {
    if (!existsSync(dir)) continue;
    const arquivos = readdirSync(dir)
      .filter((f) => ORDEM.includes(f.slice(f.lastIndexOf('.')).toLowerCase()))
      .map((f) => {
        let prioridade = 9;
        try {
          prioridade = PRIORIDADE_TIPO[detectarTipo(f, readFileSync(join(dir, f)))] ?? 9;
        } catch {
          prioridade = 9;
        }
        return { f, prioridade };
      })
      .sort((a, b) => a.prioridade - b.prioridade)
      .map((x) => x.f);
    for (const arq of arquivos) {
      // Nome vem do disco: no log entra so a forma segura (basename, sem
      // controle, truncado) — mesmo cuidado do anexo de e-mail.
      const seguro = nomeAnexoSeguro(arq);
      try {
        const r = await ingerir(store, canal, arq, readFileSync(join(dir, arq)));
        if (r.docs > 0 && r.eventos.length === 0 && r.revisaoId === null) {
          pulados += 1;
        } else {
          ingeridos += r.docs;
          log(`seed: ${seguro} -> pedido ${r.pedidoId ?? '(revisao)'}, ${r.eventos.length} eventos`);
        }
      } catch (e) {
        // Doc invalido vai como rejeitado, nao derruba o seed.
        pulados += 1;
        log(`seed: ${seguro} rejeitado (${(e as Error).message})`);
      }
    }
  }
  return { ingeridos, pulados };
}

async function main(): Promise<void> {
  await import('dotenv/config');
  const db = await createDb();
  const { seedWs } = configDoEnv();
  const store = new LedgerStore(db, seedWs, seedWs);
  await store.init();
  const { ingeridos, pulados } = await carregarSeed(store, new CanalSSE(seedWs));
  console.log(`seed: ${ingeridos} doc(s) processados, ${pulados} arquivo(s) sem efeito`);
  await db.close();
}

if (ehProcessoPrincipal(import.meta.url, process.argv[1])) await main();
