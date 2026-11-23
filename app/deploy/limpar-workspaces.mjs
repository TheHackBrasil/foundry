#!/usr/bin/env node
// Limpeza manual de emergência dos workspaces de visitantes (D-I8). O ledger é
// append-only por trigger (T011) e nenhuma rota apaga dado: este script é a
// saída quando o volume do Postgres (5 GB no plano Hobby da Railway) enche.
// Por padrão só simula: roda tudo numa transação e desfaz no fim (ROLLBACK).
//
// Uso, de dentro de app/ (ou de /app no container), com DATABASE_URL definida:
//   node deploy/limpar-workspaces.mjs                        simula: sem atividade há 72 h
//   node deploy/limpar-workspaces.mjs --inativos-horas 24    outro corte de inatividade
//   node deploy/limpar-workspaces.mjs --workspace <uuid>     só este (repetível)
//   node deploy/limpar-workspaces.mjs --executar             apaga e roda VACUUM (ANALYZE)
//
// Nunca toca o WORKSPACE_SEED (padrão "seed"). Apaga o workspace inteiro,
// eventos e fila de revisão: apagar parte quebraria a cadeia de hashes do pedido.

import pg from 'pg';

const AJUDA = `uso: node deploy/limpar-workspaces.mjs [--executar] [--inativos-horas N] [--workspace ID]... [--sem-vacuum]`;

function lerArgs(argv) {
  const opts = { executar: false, horas: 72, workspaces: [], vacuum: true };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--executar') opts.executar = true;
    else if (a === '--sem-vacuum') opts.vacuum = false;
    else if (a === '--inativos-horas') {
      const n = Number(argv[(i += 1)]);
      if (!Number.isFinite(n) || n < 1) throw new Error('--inativos-horas precisa de um número >= 1');
      opts.horas = n;
    } else if (a === '--workspace') {
      const ws = argv[(i += 1)];
      if (!ws) throw new Error('--workspace precisa de um id');
      opts.workspaces.push(ws);
    } else if (a === '--ajuda' || a === '-h') {
      console.log(AJUDA);
      process.exit(0);
    } else throw new Error(`argumento desconhecido: ${a}\n${AJUDA}`);
  }
  return opts;
}

const mb = (n) => `${(Number(n) / 1024 / 1024).toFixed(1)} MB`;

async function tamanhos(client) {
  const r = await client.query(
    `SELECT pg_database_size(current_database()) AS banco,
            pg_total_relation_size('events') AS events,
            pg_total_relation_size('review_queue') AS revisao`,
  );
  return r.rows[0];
}

async function main() {
  const opts = lerArgs(process.argv.slice(2));
  const seed = (process.env.WORKSPACE_SEED ?? '').trim() || 'seed';
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL ausente. No container ela já existe; de fora, use a URL pública do Postgres (DATABASE_PUBLIC_URL).');
    process.exit(2);
  }
  if (opts.workspaces.includes(seed)) {
    console.error(`recusado: "${seed}" é o WORKSPACE_SEED, compartilhado por todos os visitantes.`);
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: url, application_name: 'forseti-limpeza' });
  await client.connect();
  let confirmado = false;
  try {
    let alvos = opts.workspaces;
    if (alvos.length === 0) {
      const r = await client.query(
        `SELECT workspace_id FROM (
           SELECT workspace_id, max(ts) AS ultimo FROM events GROUP BY workspace_id
           UNION ALL
           SELECT workspace_id, max(ts) AS ultimo FROM review_queue GROUP BY workspace_id
         ) t
         WHERE workspace_id <> $1
         GROUP BY workspace_id
         HAVING max(ultimo) < now() - make_interval(hours => $2)
         ORDER BY workspace_id`,
        [seed, opts.horas],
      );
      alvos = r.rows.map((row) => row.workspace_id);
    }

    const antes = await tamanhos(client);
    console.log(`modo: ${opts.executar ? 'EXECUTAR (apaga de verdade)' : 'simulação (desfaz no fim)'}`);
    console.log(`banco ${mb(antes.banco)} · events ${mb(antes.events)} · review_queue ${mb(antes.revisao)}`);
    console.log(
      opts.workspaces.length > 0
        ? `alvos: ${alvos.length} workspace(s) pedidos na linha de comando`
        : `alvos: ${alvos.length} workspace(s) sem atividade há mais de ${opts.horas} h (a seed "${seed}" fica fora)`,
    );
    for (const ws of alvos.slice(0, 20)) console.log(`  - ${ws}`);
    if (alvos.length > 20) console.log(`  ... e mais ${alvos.length - 20}`);
    if (alvos.length === 0) {
      console.log('nada a apagar.');
      return;
    }

    await client.query('BEGIN');
    // Sem lock_timeout, um ALTER TABLE na fila de espera trava todas as
    // consultas do app atrás dele. A transação inteira segura a tabela events.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    // ALTER TABLE é transacional no Postgres: a trigger desligada só existe
    // dentro desta transação e volta antes do COMMIT ou some no ROLLBACK.
    await client.query('ALTER TABLE events DISABLE TRIGGER events_no_delete');
    const ev = await client.query('DELETE FROM events WHERE workspace_id = ANY($1::text[]) AND workspace_id <> $2', [alvos, seed]);
    const rv = await client.query('DELETE FROM review_queue WHERE workspace_id = ANY($1::text[]) AND workspace_id <> $2', [alvos, seed]);
    await client.query('ALTER TABLE events ENABLE TRIGGER events_no_delete');
    const triggers = await client.query(
      `SELECT tgname, tgenabled FROM pg_trigger
       WHERE tgrelid = 'events'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    const desligadas = triggers.rows.filter((t) => t.tgenabled !== 'O').map((t) => t.tgname);
    if (desligadas.length > 0) throw new Error(`trigger desligada antes do fim (${desligadas.join(', ')}): desfazendo`);
    console.log(`eventos: ${ev.rowCount} · itens da fila de revisão: ${rv.rowCount}`);
    console.log(`triggers de events ligadas: ${triggers.rows.map((t) => t.tgname).join(', ')}`);

    if (!opts.executar) {
      await client.query('ROLLBACK');
      console.log('simulação: nada foi apagado. Rode de novo com --executar para confirmar.');
      return;
    }
    await client.query('COMMIT');
    confirmado = true;
    console.log('apagado.');
    // DELETE não devolve espaço ao disco; o VACUUM deixa o espaço reutilizável
    // pelo próprio Postgres. VACUUM FULL exigiria espaço livre do tamanho da
    // tabela, o que um volume cheio não tem.
    if (opts.vacuum) {
      await client.query('VACUUM (ANALYZE) events, review_queue');
      const depois = await tamanhos(client);
      console.log(`depois do VACUUM: banco ${mb(depois.banco)} · events ${mb(depois.events)}`);
    }
  } catch (e) {
    if (confirmado) {
      console.error(`a limpeza foi confirmada, mas o VACUUM falhou: ${e.message}`);
    } else {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`falhou, nada foi apagado: ${e.message}`);
    }
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
