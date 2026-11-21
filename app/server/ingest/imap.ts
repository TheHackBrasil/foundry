// Ingestao por e-mail (spec 0004, T030): IMAP polling de anexos
// .xml/.csv/.xlsx/.pdf para o mesmo pipeline. So sobe se IMAP_HOST
// estiver configurado; ausente = funcionalidade desligada, nao quebrada.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  mailbox: string;
  intervaloMs: number;
}

export function imapConfigDoEnv(): ImapConfig | null {
  const host = process.env['IMAP_HOST'];
  const user = process.env['IMAP_USER'];
  const pass = process.env['IMAP_PASS'];
  if (!host || !user || !pass) return null;
  return {
    host,
    port: Number(process.env['IMAP_PORT'] ?? 993),
    user,
    pass,
    mailbox: process.env['IMAP_MAILBOX'] ?? 'INBOX',
    intervaloMs: Number(process.env['IMAP_POLL_MS'] ?? 30_000),
  };
}

const ANEXO_OK = /\.(xml|csv|xlsx|pdf)$/i;

// Um ciclo de coleta: ingere cada anexo elegivel e so marca a mensagem
// como lida depois do processamento. Erro de parser vai para revisao
// (doc nao se perde); erro de infra (banco fora) deixa a mensagem nao
// lida para o proximo ciclo tentar de novo.
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
  let processados = 0;
  await client.connect();
  try {
    const lock = await client.getMailboxLock(cfg.mailbox);
    try {
      for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        let falhaDeInfra = false;
        for (const att of parsed.attachments) {
          if (!att.filename || !ANEXO_OK.test(att.filename)) continue;
          try {
            await ingerir(att.filename, att.content);
            processados += 1;
          } catch (e) {
            const erro = (e as Error).message;
            if (/malformado|ausente|nao suportad|nao reconhecido|falha de parse|sem planilha|nenhuma linha/i.test(erro)) {
              await revisar(att.filename, erro); // doc ruim: revisao, mensagem lida
              processados += 1;
            } else {
              falhaDeInfra = true; // infra: nao marca lido, retenta
              log(`imap: ${att.filename} adiado (${erro})`);
            }
          }
        }
        if (!falhaDeInfra) {
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

// Loop de polling: chama ingerir(nome, conteudo) para cada anexo.
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
