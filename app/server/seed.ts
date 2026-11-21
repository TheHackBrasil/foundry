// Seed do cenario canonico (spec 0004, T041 + onda 4): ingere
// app/seed/** (corpus da frente escopo-produto) e app/server/fixtures
// (fallback interno do core). Idempotente: pedido ja existente e pulado.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { detectarTipo } from './ingest/detect.js';
import { ingerir } from './pipeline.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIRS = [join(AQUI, '..', 'seed'), join(AQUI, 'fixtures')];
const ORDEM = ['.xml', '.csv', '.xlsx', '.pdf'];
// NF-e cria o pedido; CT-e/eventos/planilha/PDF enriquecem depois.
const PRIORIDADE_TIPO: Record<string, number> = {
  nfe: 0,
  cte: 1,
  eventoNFe: 2,
  csv: 3,
  xlsx: 3,
  pdf: 4,
};

async function main(): Promise<void> {
  await import('dotenv/config'); // mesma convencao do boot do server
  const db = await createDb();
  const store = new LedgerStore(db);
  await store.init();
  const canal = new CanalSSE(); // seed nao tem clientes SSE; broadcast e no-op

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
      try {
        const r = await ingerir(store, canal, arq, readFileSync(join(dir, arq)));
        if (r.docs > 0 && r.eventos.length === 0 && r.revisaoId === null) {
          pulados += 1;
        } else {
          ingeridos += r.docs;
          console.log(`seed: ${arq} -> pedido ${r.pedidoId ?? '(revisao)'}, ${r.eventos.length} eventos`);
        }
      } catch (e) {
        // Doc invalido no corpus nao derruba o seed: vai como rejeitado.
        pulados += 1;
        console.log(`seed: ${arq} rejeitado (${(e as Error).message})`);
      }
    }
  }
  console.log(`seed: ${ingeridos} doc(s) processados, ${pulados} arquivo(s) sem efeito`);
  await db.close();
}

await main();
