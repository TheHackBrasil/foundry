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

export interface ConfigServidor {
  seedWs: string;
  // Vazio = só a mesma origem (nenhum cabeçalho CORS é emitido).
  corsOrigens: string[];
  // Cabeçalho com o IP real do visitante, posto pelo proxy da hospedagem
  // (x-real-ip na Railway). Vazio = endereço do socket.
  ipHeader: string | null;
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
