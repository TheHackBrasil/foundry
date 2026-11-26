// Envio SMTP da cobranca de status (spec 0010, RF4): so existe com SMTP_*
// configuradas; ausentes, o chamador recebe null e marca pendente_envio.
// Message-Id gerado no nosso dominio (SMTP_DOMAIN ou host) fica gravado na
// cobranca e e a ponte para o In-Reply-To da resposta.

import { randomUUID } from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';

export interface SmtpConfig {
  host: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  dominio: string;
  timeoutMs: number;
}

export function smtpConfigDoEnv(): SmtpConfig | null {
  const host = process.env['SMTP_HOST'];
  const from = process.env['SMTP_FROM'];
  if (!host || !from) return null;
  return {
    host,
    port: Number(process.env['SMTP_PORT'] ?? 587),
    user: process.env['SMTP_USER'] || undefined,
    pass: process.env['SMTP_PASS'] || undefined,
    from,
    dominio: process.env['SMTP_DOMAIN'] ?? host,
    timeoutMs: Number(process.env['SMTP_TIMEOUT_MS'] ?? 15_000),
  };
}

// Interface minima para poder injetar transporte falso no teste.
export interface Remetente {
  enviar(mensagem: {
    para: string;
    assunto: string;
    corpo: string;
    messageId: string;
    de: string;
  }): Promise<void>;
}

export function criarRemetente(cfg: SmtpConfig): Remetente {
  const transporter: Transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: cfg.timeoutMs,
    socketTimeout: cfg.timeoutMs,
  });
  return {
    async enviar(m) {
      await transporter.sendMail({
        from: cfg.from,
        to: m.para,
        subject: m.assunto,
        text: m.corpo,
        messageId: m.messageId,
      });
    },
  };
}

export function novoMessageId(dominio: string): string {
  return `<${randomUUID()}@${dominio}>`;
}
