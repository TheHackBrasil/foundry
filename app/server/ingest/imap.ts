// IMAP polling de anexos (spec 0004, T030): so sobe com IMAP_HOST
// configurado; ausente = desligado, nao quebrado.

import { basename } from 'node:path';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { ErroParser } from './nfe.js';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  mailbox: string;
  intervaloMs: number;
  desde: Date;
}

export function imapConfigDoEnv(): ImapConfig | null {
  const host = process.env['IMAP_HOST'];
  const user = process.env['IMAP_USER'];
  const pass = process.env['IMAP_PASS'];
  if (!host || !user || !pass) return null;
  const agora = new Date();
  return {
    host,
    port: Number(process.env['IMAP_PORT'] ?? 993),
    user,
    pass,
    mailbox: process.env['IMAP_MAILBOX'] ?? 'INBOX',
    intervaloMs: Number(process.env['IMAP_POLL_MS'] ?? 30_000),
    // So mensagens de hoje em diante: caixa pessoal tem historico
    // grande e mail antigo nao e canal do sistema.
    desde: process.env['IMAP_DESDE']
      ? new Date(process.env['IMAP_DESDE'])
      : new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()),
  };
}

const ANEXO_OK = /\.(xml|csv|xlsx|pdf)$/i;
const NOME_MAX = 120;

// Nome de anexo chega de fora: antes de log ou fila, tira caminho (basename),
// caracteres de controle e o excesso (o fim fica, a extensao se preserva).
export function nomeAnexoSeguro(nome: string): string {
  const base = basename(nome.replaceAll('\\', '/')).replace(/[\x00-\x1f\x7f-\x9f]/g, '');
  return base.length > NOME_MAX ? `...${base.slice(-(NOME_MAX - 3))}` : base;
}

// Marca a mensagem como lida so depois de processar: erro de parser vai
// para revisao; erro de infra deixa nao lida para o proximo ciclo.
async function coletarEIngerir(
  cfg: ImapConfig,
  ingerir: (nome: string, conteudo: Buffer) => Promise<unknown>,
  revisar: (nome: string, erro: string) => Promise<unknown>,
  log: (msg: string) => void,
): Promise<number> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
  // EventEmitter sem ouvinte de 'error' derruba o processo num corte de socket.
  client.on('error', (e: Error) => log(`imap: erro no cliente (${e.message})`));
  let processados = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.mailbox);
    try {
      for await (const msg of client.fetch({ seen: false, since: cfg.desde }, { source: true, uid: true })) {
        if (!msg.source) continue;
        let parsed: Awaited<ReturnType<typeof simpleParser>>;
        try {
          parsed = await simpleParser(msg.source);
        } catch (e) {
          // Mensagem ilegivel nao melhora sozinha: vai para revisao e sai da caixa.
          await revisar('(mensagem)', `mensagem malformada (${(e as Error).message})`);
          processados += 1;
          try {
            await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
          } catch (e2) {
            log(`imap: mensagem malformada ficou nao lida (${(e2 as Error).message})`);
          }
          continue;
        }
        let falhaDeInfra = false;
        let elegivel = false;
        for (const att of parsed.attachments) {
          if (!att.filename || !ANEXO_OK.test(att.filename)) continue;
          const nome = nomeAnexoSeguro(att.filename);
          try {
            await ingerir(nome, att.content);
            elegivel = true;
            processados += 1;
          } catch (e) {
            if (e instanceof ErroParser) {
              await revisar(nome, e.message); // doc ruim: revisao, mensagem lida
              elegivel = true;
              processados += 1;
            } else {
              falhaDeInfra = true; // infra: nao marca lido, retenta
              log(`imap: ${nome} adiado (${(e as Error).message})`);
            }
          }
        }
        // Sem anexo elegivel nao e nosso: deixa nao lida (caixa pessoal).
        if (elegivel && !falhaDeInfra) {
          await client.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return processados;
}

// Loop de polling.
export function iniciarPolling(
  cfg: ImapConfig,
  ingerir: (nome: string, conteudo: Buffer) => Promise<unknown>,
  revisar: (nome: string, erro: string) => Promise<unknown>,
  log: (msg: string) => void,
): () => void {
  let vivo = true;
  let rodando = false;
  const tick = async (): Promise<void> => {
    if (!vivo || rodando) return;
    rodando = true;
    try {
      const n = await coletarEIngerir(cfg, ingerir, revisar, log);
      if (n > 0) log(`imap: ${n} anexo(s) processados`);
    } catch (e) {
      log(`imap: falha no ciclo (${(e as Error).message})`);
    } finally {
      rodando = false;
      if (vivo) setTimeout(tick, cfg.intervaloMs);
    }
  };
  void tick();
  return () => {
    vivo = false;
  };
}
