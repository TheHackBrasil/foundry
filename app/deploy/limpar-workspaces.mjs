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
//   node deploy/limpar-workspaces.mjs --so-retencao          só as evidências vencidas
//   node deploy/limpar-workspaces.mjs --executar             apaga e roda VACUUM (ANALYZE)
//
// Nunca toca o WORKSPACE_SEED (padrão "seed"). Apaga o workspace inteiro,
// eventos e fila de revisão: apagar parte quebraria a cadeia de hashes do pedido.
//
// Retenção (spec 0017, RF25): áudio, transcrição e mensagem do operador ficam
// em evidencias com apagar_em (90 dias por padrão). Toda rodada também apaga
// as linhas vencidas (apagar_em < now()); linha sem apagar_em, como o .eml da
// spec 0010, fica. É idempotente: rodar de novo só acha o que venceu depois.
// --so-retencao pula os workspaces, para rodar a retenção sem apagar visitante.

import pg from 'pg';

const AJUDA = `uso: node deploy/limpar-workspaces.mjs [--executar] [--inativos-horas N] [--workspace ID]... [--so-retencao] [--sem-vacuum]`;

function lerArgs(argv) {
  const opts = { executar: false, horas: 72, horasInformadas: false, workspaces: [], vacuum: true, soRetencao: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--executar') opts.executar = true;
    else if (a === '--sem-vacuum') opts.vacuum = false;
    else if (a === '--so-retencao') opts.soRetencao = true;
    else if (a === '--inativos-horas') {
      const n = Number(argv[(i += 1)]);
      if (!Number.isFinite(n) || n < 1) throw new Error('--inativos-horas precisa de um número >= 1');
      opts.horas = n;
      opts.horasInformadas = true;
    } else if (a === '--workspace') {
      const ws = argv[(i += 1)];
      if (!ws) throw new Error('--workspace precisa de um id');
      opts.workspaces.push(ws);
    } else if (a === '--ajuda' || a === '-h') {
      console.log(AJUDA);
      process.exit(0);
    } else throw new Error(`argumento desconhecido: ${a}\n${AJUDA}`);
  }
  if (opts.soRetencao && (opts.workspaces.length > 0 || opts.horasInformadas)) {
    throw new Error('--so-retencao não apaga workspace: tire --workspace e --inativos-horas');
  }
  return opts;
}

const mb = (n) => `${(Number(n) / 1024 / 1024).toFixed(1)} MB`;

async function tamanhos(client) {
  const r = await client.query(
    `SELECT pg_database_size(current_database()) AS banco,
            pg_total_relation_size('events') AS events,
            pg_total_relation_size('review_queue') AS revisao,
            COALESCE(pg_total_relation_size(to_regclass('evidencias')), 0) AS evidencias`,
  );
  return r.rows[0];
}

// Banco anterior à spec 0017 não tem a coluna: a retenção fica de fora,
// declarada, em vez de falhar a limpeza de emergência.
async function temRetencao(client) {
  const r = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'evidencias' AND column_name = 'apagar_em'`,
  );
  return r.rowCount > 0;
}

const FILTRO_VENCIDAS = 'apagar_em IS NOT NULL AND apagar_em < now()';

// Quantas evidências já passaram do apagar_em; 0 quando o banco não tem a
// coluna. Só aviso: o número que vale é o do DELETE, dentro da transação.
async function contarVencidas(client) {
  if (!(await temRetencao(client))) {
    console.log('retenção: evidencias sem a coluna apagar_em neste banco; passo pulado.');
    return 0;
  }
  const r = await client.query(`SELECT count(*)::int AS n FROM evidencias WHERE ${FILTRO_VENCIDAS}`);
  console.log(`evidências com apagar_em vencido: ${r.rows[0].n}`);
  return r.rows[0].n;
}

// Dentro da transação aberta por main. A seed entra: a retenção vale para
// qualquer workspace.
async function apagarVencidas(client) {
  const r = await client.query(`DELETE FROM evidencias WHERE ${FILTRO_VENCIDAS}`);
  console.log(`evidências vencidas apagadas: ${r.rowCount}`);
  return r.rowCount;
}

// Dentro da transação aberta por main. ALTER TABLE é transacional no
// Postgres: a trigger desligada só existe dentro desta transação e volta
// antes do COMMIT ou some no ROLLBACK.
async function apagarWorkspaces(client, alvos, seed) {
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
    if (opts.soRetencao) alvos = [];
    else if (alvos.length === 0) {
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
    console.log(
      `banco ${mb(antes.banco)} · events ${mb(antes.events)} · review_queue ${mb(antes.revisao)} · evidencias ${mb(antes.evidencias)}`,
    );
    if (opts.soRetencao) console.log('alvos: nenhum workspace (--so-retencao)');
    else {
      console.log(
        opts.workspaces.length > 0
          ? `alvos: ${alvos.length} workspace(s) pedidos na linha de comando`
          : `alvos: ${alvos.length} workspace(s) sem atividade há mais de ${opts.horas} h (a seed "${seed}" fica fora)`,
      );
    }
    for (const ws of alvos.slice(0, 20)) console.log(`  - ${ws}`);
    if (alvos.length > 20) console.log(`  ... e mais ${alvos.length - 20}`);

    const vencidas = await contarVencidas(client);
    if (alvos.length === 0 && vencidas === 0) {
      console.log('nada a apagar.');
      return;
    }

    await client.query('BEGIN');
    // Sem lock_timeout, um ALTER TABLE na fila de espera trava todas as
    // consultas do app atrás dele. A transação inteira segura a tabela events.
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '5min'");
    const tabelasVacuum = [];
    if (alvos.length > 0) {
      await apagarWorkspaces(client, alvos, seed);
      tabelasVacuum.push('events', 'review_queue');
    }
    if (vencidas > 0 && (await apagarVencidas(client)) > 0) tabelasVacuum.push('evidencias');

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
    if (opts.vacuum && tabelasVacuum.length > 0) {
      await client.query(`VACUUM (ANALYZE) ${tabelasVacuum.join(', ')}`);
      const depois = await tamanhos(client);
      console.log(`depois do VACUUM: banco ${mb(depois.banco)} · events ${mb(depois.events)} · evidencias ${mb(depois.evidencias)}`);
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
