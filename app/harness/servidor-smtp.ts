// Servidor SMTP de captura (frente harness-transp): sink minimo com
// node:net que recebe a cobranca enviada pelo nodemailer do sistema. Sem
// STARTTLS e sem AUTH de proposito: smtp.ts so exige TLS na porta 465 e so
// autentica com SMTP_USER; em SMTP_PORT=2525 local o fluxo vai em texto.
// Protocolo coberto: EHLO/HELO, MAIL FROM, RCPT TO, DATA, RSET, NOOP, QUIT.

import { createServer, type Socket } from 'node:net';

export interface EnvelopeSmtp {
  de: string; // MAIL FROM
  para: string[]; // RCPT TO
  raw: Buffer; // bloco DATA com dots desescapados, pronto para o parser .eml
  recebidaEm: Date;
}

export interface OpcoesSmtp {
  porta: number;
  host?: string;
  aoReceber?: (env: EnvelopeSmtp) => void | Promise<void>;
  log?: (msg: string) => void;
}

export interface ServidorSmtp {
  porta(): number;
  recebidas: EnvelopeSmtp[];
  encerrar(): Promise<void>;
}

const CRLF = '\r\n';
const TAMANHO_MAX = 4 * 1024 * 1024;

function extrairEndereco(param: string): string {
  const m = /<([^>]*)>/.exec(param);
  return (m ? m[1]! : param).trim();
}

// Sessao por conexao: comandos em linha ate DATA; dentro de DATA, tudo e
// conteudo ate a linha ".". Linha "..x" no meio vira ".x" (dot-stuffing).
function atenderConexao(socket: Socket, opcoes: OpcoesSmtp, recebidas: EnvelopeSmtp[]): void {
  socket.setEncoding('utf8');
  socket.setTimeout(120_000, () => socket.destroy());
  const env: EnvelopeSmtp = { de: '', para: [], raw: Buffer.alloc(0), recebidaEm: new Date() };
  let buf = '';
  let emDados = false;
  const dados: string[] = [];

  const escrever = (linha: string): void => {
    socket.write(`${linha}${CRLF}`);
  };

  const comando = (linha: string): void => {
    const [verbo = '', ...resto] = linha.trim().split(' ');
    const arg = resto.join(' ');
    switch (verbo.toUpperCase()) {
      case 'EHLO':
      case 'HELO':
        // Sem STARTTLS e sem AUTH na lista: o nodemailer segue em texto.
        escrever('250-harness.local');
        escrever('250-8BITMIME');
        escrever(`250-SIZE ${TAMANHO_MAX}`);
        escrever('250 HELP');
        break;
      case 'MAIL': {
        const m = /^FROM\s*:\s*(.*)$/i.exec(arg);
        if (!m) return escrever('501 Syntax: MAIL FROM:<endereco>');
        env.de = extrairEndereco(m[1]!);
        escrever('250 2.1.0 Ok');
        break;
      }
      case 'RCPT': {
        const m = /^TO\s*:\s*(.*)$/i.exec(arg);
        if (!m) return escrever('501 Syntax: RCPT TO:<endereco>');
        env.para.push(extrairEndereco(m[1]!));
        escrever('250 2.1.5 Ok');
        break;
      }
      case 'DATA':
        if (!env.de || env.para.length === 0) return escrever('503 MAIL/RCPT primeiro');
        emDados = true;
        dados.length = 0;
        escrever('354 End data with <CR><LF>.<CR><LF>');
        break;
      case 'RSET':
        env.de = '';
        env.para = [];
        escrever('250 2.0.0 Ok');
        break;
      case 'NOOP':
        escrever('250 2.0.0 Ok');
        break;
      case 'VRFY':
      case 'EXPN':
        escrever('252 2.5.2 Nao verifico destinatario');
        break;
      case 'QUIT':
        escrever('221 2.0.0 Bye');
        socket.end();
        break;
      default:
        escrever('502 5.5.2 Comando nao implementado');
    }
  };

  const terminarDados = (): void => {
    emDados = false;
    // Desescapa pontos: linha "..x" chega como ".x"; linha "." termina.
    env.raw = Buffer.from(dados.map((l) => (l.startsWith('.') ? l.slice(1) : l)).join(CRLF), 'utf8');
    env.recebidaEm = new Date();
    const capturado = { ...env, para: [...env.para] };
    recebidas.push(capturado);
    escrever('250 2.0.0 Ok: queued');
    void Promise.resolve(opcoes.aoReceber?.(capturado)).catch((e) =>
      opcoes.log?.(`smtp: aoReceber falhou (${(e as Error).message})`),
    );
  };

  socket.on('data', (pedaco: string) => {
    buf += pedaco;
    if (buf.length > TAMANHO_MAX) {
      socket.destroy();
      return;
    }
    for (;;) {
      const fim = buf.indexOf(CRLF);
      if (fim < 0) return;
      const linha = buf.slice(0, fim);
      buf = buf.slice(fim + 2);
      if (emDados) {
        if (linha === '.') terminarDados();
        else dados.push(linha);
        continue;
      }
      comando(linha);
    }
  });

  socket.on('error', () => undefined);
  escrever('220 harness.local ESMTP transportadora simulada');
}

export async function criarServidorSmtp(opcoes: OpcoesSmtp): Promise<ServidorSmtp> {
  const recebidas: EnvelopeSmtp[] = [];
  const server = createServer((socket) => atenderConexao(socket, opcoes, recebidas));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opcoes.porta, opcoes.host ?? '127.0.0.1', () => resolve());
  });
  const endereco = server.address();
  const portaReal = typeof endereco === 'object' && endereco ? endereco.port : opcoes.porta;
  return {
    porta: () => portaReal,
    recebidas,
    encerrar: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
