// Configuração do servidor lida do ambiente (deploy público, P-010). Todo campo
// tem padrão seguro para a URL pública; valor inválido derruba o boot com
// mensagem clara em vez de virar comportamento surpresa em produção.

export interface OpcoesSSE {
  heartbeatMs: number;
  // A Railway corta stream público em 15 min. Fechar antes, pelo servidor, deixa
  // o EventSource reconectar limpo e a tela reidratar no "hello".
  maxConexaoMs: number;
  // Relato não confirmado de stream caindo perto de 1 MB na Railway: o servidor
  // recicla a conexão antes disso.
  maxBytes: number;
  maxClientes: number;
  maxPorIp: number;
  retryMs: number;
}

// Limites por sessão e do banco. Ninguém apaga dado do ledger (trigger
// append-only), então o crescimento só para aqui; a conta está em
// app/deploy/README.md.
export interface Limites {
  bytesPorArquivo: number;
  eventosPorWorkspace: number;
  // Documento = evento de NF-e, CT-e, CC-e, cancelamento, planilha ou PDF, mais
  // item da fila de revisão. Uma linha de planilha é um documento.
  documentosPorWorkspace: number;
  documentosPorEnvio: number;
  // Acima disto o servidor recusa escrita (507). 0 desliga.
  bytesBanco: number;
  // Teto de workspaces que já gravaram (sessões de visitante; a seed não conta).
  // Sem ele, trocar de cookie resetaria a cota por sessão sem custo nenhum.
  workspacesComEscrita: number;
}

// Por IP. Âncora e PDF gastam carteira de testnet e cota de LLM do time.
export interface ConfigRateLimit {
  escritasPorMinuto: number;
  ancorasPor10Min: number;
  pdfsPor10Min: number;
  // Workspaces novos que um IP pode fazer gravar em 10 min: a primeira escrita
  // de uma sessão conta aqui, senão trocar de cookie renovaria a cota sempre.
  sessoesNovasPor10Min: number;
}

export interface ConfigServidor {
  seedWs: string;
  // Vazio = só a mesma origem (nenhum cabeçalho CORS é emitido).
  corsOrigens: string[];
  // Cabeçalho com o IP real do visitante, posto pelo proxy da hospedagem
  // (x-real-ip na Railway). Vazio = endereço do socket.
  ipHeader: string | null;
  // Build da web servido pelo Fastify; null = app/web/dist.
  webDist: string | null;
  limites: Limites;
  rateLimit: ConfigRateLimit;
  sse: OpcoesSSE;
}

type Ambiente = Record<string, string | undefined>;

function texto(env: Ambiente, nome: string): string | undefined {
  const v = env[nome]?.trim();
  return v ? v : undefined;
}

export function inteiroDoEnv(env: Ambiente, nome: string, padrao: number, minimo = 0): number {
  const bruto = texto(env, nome);
  if (bruto === undefined) return padrao;
  const n = Number(bruto);
  if (!Number.isSafeInteger(n) || n < minimo) {
    throw new Error(`${nome}="${bruto}" inválido: use um inteiro maior ou igual a ${minimo}`);
  }
  return n;
}

function origensCors(env: Ambiente): string[] {
  const bruto = texto(env, 'CORS_ORIGIN');
  if (!bruto) return [];
  const origens = bruto.split(',').map((o) => o.trim()).filter(Boolean);
  for (const o of origens) {
    // O cookie da sessão exige credenciais, e o navegador recusa "*" com credenciais.
    if (o === '*') throw new Error('CORS_ORIGIN="*" não é aceito: liste as origens permitidas, separadas por vírgula');
    let origem: string;
    try {
      origem = new URL(o).origin;
    } catch {
      throw new Error(`CORS_ORIGIN contém "${o}", que não é uma origem (esperado algo como https://exemplo.com)`);
    }
    if (origem !== o) {
      throw new Error(`CORS_ORIGIN contém "${o}": use só esquema, host e porta, sem barra nem caminho (${origem})`);
    }
  }
  return origens;
}

function workspaceSeed(env: Ambiente): string {
  const ws = texto(env, 'WORKSPACE_SEED') ?? 'seed';
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(ws)) {
    throw new Error(`WORKSPACE_SEED="${ws}" inválido: use de 1 a 64 letras, dígitos, _ ou -`);
  }
  return ws;
}

export function configDoEnv(env: Ambiente = process.env): ConfigServidor {
  const ipHeader = texto(env, 'CLIENT_IP_HEADER')?.toLowerCase() ?? null;
  if (ipHeader !== null && !/^[a-z0-9-]+$/.test(ipHeader)) {
    throw new Error(`CLIENT_IP_HEADER="${ipHeader}" não é um nome de cabeçalho HTTP`);
  }
  return {
    seedWs: workspaceSeed(env),
    corsOrigens: origensCors(env),
    ipHeader,
    webDist: texto(env, 'WEB_DIST_DIR') ?? null,
    limites: {
      bytesPorArquivo: inteiroDoEnv(env, 'MAX_UPLOAD_BYTES', 2 * 1024 * 1024, 1024),
      eventosPorWorkspace: inteiroDoEnv(env, 'MAX_EVENTS_PER_WORKSPACE', 2_000, 1),
      documentosPorWorkspace: inteiroDoEnv(env, 'MAX_DOCS_PER_WORKSPACE', 100, 1),
      documentosPorEnvio: inteiroDoEnv(env, 'MAX_DOCS_PER_UPLOAD', 50, 1),
      bytesBanco: inteiroDoEnv(env, 'MAX_DB_BYTES', 3 * 1024 ** 3, 0),
      workspacesComEscrita: inteiroDoEnv(env, 'MAX_WRITING_WORKSPACES', 500, 0),
    },
    rateLimit: {
      escritasPorMinuto: inteiroDoEnv(env, 'RATE_LIMIT_WRITES_PER_MIN', 20, 1),
      ancorasPor10Min: inteiroDoEnv(env, 'RATE_LIMIT_ANCHORS_PER_10MIN', 3, 1),
      pdfsPor10Min: inteiroDoEnv(env, 'RATE_LIMIT_PDFS_PER_10MIN', 5, 1),
      sessoesNovasPor10Min: inteiroDoEnv(env, 'RATE_LIMIT_NEW_SESSIONS_PER_10MIN', 10, 1),
    },
    sse: {
      heartbeatMs: inteiroDoEnv(env, 'SSE_HEARTBEAT_MS', 20_000, 1_000),
      maxConexaoMs: inteiroDoEnv(env, 'SSE_MAX_CONNECTION_MS', 10 * 60_000, 0),
      maxBytes: inteiroDoEnv(env, 'SSE_MAX_BYTES', 512 * 1024, 0),
      maxClientes: inteiroDoEnv(env, 'SSE_MAX_CLIENTS', 500, 1),
      maxPorIp: inteiroDoEnv(env, 'SSE_MAX_CLIENTS_PER_IP', 20, 1),
      retryMs: 3_000,
    },
  };
}
