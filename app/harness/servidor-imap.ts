// Caixa IMAP minima (frente harness-transp): o polling do sistema conecta
// com ImapFlow e secure:true fixo (server/ingest/imap.ts), entao este
// servidor sobe em TLS com o certificado de tls-dev.ts. Cobre so o que o
// ciclo de coleta usa (coletarEIngerir): CAPABILITY, LOGIN, NAMESPACE,
// ENABLE, SELECT, SEARCH/UID SEARCH (UNSEEN/SINCE), FETCH/UID FETCH
// (BODY.PEEK[], FLAGS, INTERNALDATE, RFC822.SIZE, ENVELOPE, BODYSTRUCTURE),
// STORE/UID STORE (\Seen), NOOP, IDLE, CLOSE, LOGOUT. O resto responde BAD.

import { readFileSync } from 'node:fs';
import { createServer, type TLSSocket } from 'node:tls';

export interface MensagemCaixa {
  uid: number;
  raw: Buffer;
  visto: boolean;
  internalDate: Date;
}

export interface OpcoesImap {
  porta: number;
  host?: string;
  cert: string; // caminho do cert.pem
  key: string; // caminho do key.pem
  log?: (msg: string) => void;
}

export interface ServidorImap {
  porta(): number;
  caixa: MensagemCaixa[];
  depositar(raw: Buffer): MensagemCaixa;
  encerrar(): Promise<void>;
}

const CRLF = '\r\n';
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// dd-Mmm-yyyy usado por INTERNALDATE e pela clausula SINCE do SEARCH.
function dataImap(d: Date): string {
  return `${d.getUTCDate()}-${MESES[d.getUTCMonth()]}-${d.getUTCFullYear()}`;
}

function internalDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${dataImap(d)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} +0000`;
}

// Aspa de string IMAP: escapa \ e ".
const q = (s: string): string => `"${s.replace(/["\\]/g, '\\$&')}"`;

// Cabecalho basico do .eml para o ENVELOPE (so quando o cliente pede).
function cabecalho(raw: Buffer): Record<string, string> {
  const texto = raw.toString('latin1');
  const fim = texto.indexOf(`${CRLF}${CRLF}`);
  const bloco = (fim < 0 ? texto : texto.slice(0, fim)).replace(/\r\n[ \t]+/g, ' ');
  const out: Record<string, string> = {};
  for (const linha of bloco.split(CRLF)) {
    const i = linha.indexOf(':');
    if (i > 0) out[linha.slice(0, i).trim().toLowerCase()] = linha.slice(i + 1).trim();
  }
  return out;
}

// Lista de enderecos IMAP: ((nome NIL caixa dominio) ...).
function listaEnderecos(valor: string | undefined): string {
  if (!valor) return 'NIL';
  const partes = valor.split(',').map((v) => {
    const nome = /^(.*?)\s*</.exec(v.trim())?.[1]?.replace(/"/g, '') ?? '';
    const email = (/<([^>]*)>/.exec(v)?.[1] ?? v).trim();
    const [caixa = '', dominio = ''] = email.split('@');
    return `(${nome ? q(nome) : 'NIL'} NIL ${q(caixa)} ${q(dominio)})`;
  });
  return `(${partes.join(' ')})`;
}

function envelope(raw: Buffer): string {
  const c = cabecalho(raw);
  return (
    `(${c['date'] ? q(c['date']) : 'NIL'} ${c['subject'] ? q(c['subject']) : 'NIL'} ` +
    `${listaEnderecos(c['from'])} ${listaEnderecos(c['from'])} ${listaEnderecos(c['from'])} ` +
    `${listaEnderecos(c['to'])} NIL NIL ${c['in-reply-to'] ? q(c['in-reply-to']) : 'NIL'} ` +
    `${c['message-id'] ? q(c['message-id']) : 'NIL'})`
  );
}

// bodystructure minimo de texto plano.
function bodystructure(raw: Buffer): string {
  const texto = raw.toString('latin1');
  const corpo = texto.split(`${CRLF}${CRLF}`).slice(1).join(CRLF);
  const linhas = corpo === '' ? 0 : corpo.split(CRLF).length;
  return `("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "QUOTED-PRINTABLE" ${raw.length} ${linhas})`;
}

// Conjunto "1,3:5" de uids ou numeros de sequencia.
function conjunto(set: string, caixa: MensagemCaixa[], uid: boolean): MensagemCaixa[] {
  const valor = (m: MensagemCaixa): number => (uid ? m.uid : caixa.indexOf(m) + 1);
  const out = new Set<MensagemCaixa>();
  for (const parte of set.split(',')) {
    const [a, b] = parte.split(':');
    const ini = Number(a);
    const fim = b === undefined || b === '*' ? Number.MAX_SAFE_INTEGER : Number(b);
    for (const m of caixa) {
      const v = valor(m);
      if (Number.isFinite(ini) && v >= ini && v <= fim) out.add(m);
    }
  }
  return [...out].sort((x, y) => valor(x) - valor(y));
}

// SEARCH simplificado: UNSEEN, SEEN, ALL, SINCE <data>, UID <set> e seqs.
function buscar(args: string, caixa: MensagemCaixa[]): MensagemCaixa[] {
  let candidatas = [...caixa];
  const upper = args.toUpperCase();
  if (/\bUNSEEN\b/.test(upper)) candidatas = candidatas.filter((m) => !m.visto);
  else if (/\bSEEN\b/.test(upper)) candidatas = candidatas.filter((m) => m.visto);
  const since = /\bSINCE\s+(\d{1,2}-[A-Za-z]{3}-\d{4})/i.exec(args);
  if (since) {
    const limite = new Date(since[1]!).getTime();
    if (Number.isFinite(limite)) candidatas = candidatas.filter((m) => m.internalDate.getTime() >= limite);
  }
  const uidSet = /\bUID\s+([\d,:.*]+)/.exec(args);
  if (uidSet) {
    const dentro = new Set(conjunto(uidSet[1]!, caixa, true));
    candidatas = candidatas.filter((m) => dentro.has(m));
  }
  const seqSet = /^([\d,:.*]+)\s*$/.exec(args.trim());
  if (seqSet) {
    const dentro = new Set(conjunto(seqSet[1]!, caixa, false));
    candidatas = candidatas.filter((m) => dentro.has(m));
  }
  return candidatas;
}

function flags(m: MensagemCaixa): string {
  return `(${m.visto ? '\\Seen' : ''})`;
}

// Item FETCH pedido -> pedaco de resposta. BODY.PEEK[...] e BINARY[...]
// sempre devolvem a mensagem inteira como BODY[]: o sistema consome so o
// source completo (imap.ts: fetch com {source: true}).
function itensFetch(m: MensagemCaixa, pedidos: string[]): string {
  const out: string[] = [`UID ${m.uid}`];
  for (const item of pedidos) {
    const i = item.trim().toUpperCase();
    if (i === 'FLAGS') out.push(`FLAGS ${flags(m)}`);
    else if (i === 'INTERNALDATE') out.push(`INTERNALDATE ${q(internalDate(m.internalDate))}`);
    else if (i === 'RFC822.SIZE') out.push(`RFC822.SIZE ${m.raw.length}`);
    else if (i === 'ENVELOPE') out.push(`ENVELOPE ${envelope(m.raw)}`);
    else if (i === 'BODYSTRUCTURE') out.push(`BODYSTRUCTURE ${bodystructure(m.raw)}`);
    else if (/^(?:BODY\.PEEK|BODY|BINARY\.PEEK|BINARY)\s*\[/.test(i))
      out.push(`BODY[] {${m.raw.length}}${CRLF}${m.raw.toString('latin1')}`);
    else if (i === 'MODSEQ') out.push('MODSEQ (1)');
  }
  return out.join(' ');
}

// Tokens do FETCH respeitando colchetes e parenteses internos.
function tokensFetch(lista: string): string[] {
  const out: string[] = [];
  let atual = '';
  let nivel = 0;
  for (const ch of lista) {
    if (ch === '[' || ch === '(') nivel += 1;
    if (ch === ']' || ch === ')') nivel = Math.max(0, nivel - 1);
    if (/\s/.test(ch) && nivel === 0) {
      if (atual) out.push(atual);
      atual = '';
      continue;
    }
    atual += ch;
  }
  if (atual) out.push(atual);
  return out;
}

function atender(socket: TLSSocket, caixa: MensagemCaixa[]): void {
  socket.setTimeout(300_000, () => socket.destroy());
  let buf = Buffer.alloc(0);
  // Comando multi-linha: acumula entre literais {n} ate o CRLF final.
  let parcial = '';
  let faltaLiteral = 0;
  // IDLE ativo: o DONE nao tem tag, a resposta usa a tag do IDLE.
  let idleTag: string | null = null;

  const escrever = (texto: string): void => {
    socket.write(texto);
  };
  const ok = (tag: string, texto: string): void => escrever(`${tag} OK ${texto}${CRLF}`);

  const comando = (linha: string): void => {
    const m = /^(\S+)\s+(\S+)\s*(.*)$/.exec(linha.trim());
    if (!m) return;
    const [, tag, verboBruto, argsBruto] = m as unknown as [string, string, string, string];
    const args = argsBruto.replace(/\{\d+\}/g, '').replace(/\s+/g, ' ').trim();
    const verbo = verboBruto.toUpperCase();
    switch (verbo) {
      case 'CAPABILITY':
        escrever(`* CAPABILITY IMAP4rev1 ENABLE${CRLF}`);
        return ok(tag, 'CAPABILITY completed');
      case 'LOGIN':
      case 'AUTHENTICATE':
      case 'ID':
        return ok(tag, `${verbo} completed`);
      case 'NAMESPACE':
        escrever(`* NAMESPACE (("" "/")) NIL NIL${CRLF}`);
        return ok(tag, 'NAMESPACE completed');
      case 'ENABLE':
        // Lista vazia de proposito: sem CONDSTORE o cliente nao pede MODSEQ.
        escrever(`* ENABLED${CRLF}`);
        return ok(tag, 'ENABLE completed');
      case 'SELECT':
      case 'EXAMINE':
        escrever(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)${CRLF}`);
        escrever(`* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)]${CRLF}`);
        escrever(`* ${caixa.length} EXISTS${CRLF}`);
        escrever(`* ${caixa.filter((x) => !x.visto).length} RECENT${CRLF}`);
        escrever(`* OK [UIDVALIDITY 1]${CRLF}`);
        escrever(`* OK [UIDNEXT ${(caixa.at(-1)?.uid ?? 0) + 1}]${CRLF}`);
        return ok(tag, '[READ-WRITE] SELECT completed');
      case 'LIST':
      case 'LSUB':
        escrever(`* ${verbo} (\\HasNoChildren) "/" "INBOX"${CRLF}`);
        return ok(tag, `${verbo} completed`);
      case 'STATUS':
        escrever(
          `* STATUS "INBOX" (MESSAGES ${caixa.length} RECENT ${caixa.length} ` +
            `UIDNEXT ${(caixa.at(-1)?.uid ?? 0) + 1} UNSEEN ${caixa.filter((x) => !x.visto).length})${CRLF}`,
        );
        return ok(tag, 'STATUS completed');
      case 'NOOP':
      case 'CHECK':
        return ok(tag, `${verbo} completed`);
      case 'SEARCH':
      case 'UID': {
        const sub = verbo === 'UID' ? /^(SEARCH|FETCH|STORE|COPY|MOVE|EXPUNGE)\s*(.*)$/i.exec(args) : null;
        if (verbo === 'UID' && !sub) return escrever(`${tag} BAD UID sem subcomando${CRLF}`);
        const subVerbo = verbo === 'UID' ? sub![1]!.toUpperCase() : verbo;
        const subArgs = verbo === 'UID' ? sub![2]!.trim() : args;
        const uid = verbo === 'UID';
        if (subVerbo === 'SEARCH') {
          const achadas = buscar(subArgs, caixa);
          const ids = achadas.map((x) => (uid ? x.uid : caixa.indexOf(x) + 1)).join(' ');
          escrever(`* SEARCH${ids ? ` ${ids}` : ''}${CRLF}`);
          return ok(tag, 'SEARCH completed');
        }
        if (subVerbo === 'FETCH') {
          const fm = /^(\S+)\s*\(?([^)]*)\)?\s*$/.exec(subArgs);
          if (!fm) return escrever(`${tag} BAD FETCH sem conjunto${CRLF}`);
          for (const msg of conjunto(fm[1]!, caixa, uid)) {
            escrever(`* ${caixa.indexOf(msg) + 1} FETCH (${itensFetch(msg, tokensFetch(fm[2] ?? ''))})${CRLF}`);
          }
          return ok(tag, 'FETCH completed');
        }
        if (subVerbo === 'STORE') {
          const sm = /^(\S+)\s+([+-]?FLAGS(?:\.SILENT)?)\s*\(([^)]*)\)/i.exec(subArgs);
          if (!sm) return escrever(`${tag} BAD STORE nao reconhecido${CRLF}`);
          const [, set, op, lista] = sm;
          const silent = /\.SILENT$/i.test(op!);
          const remover = op!.startsWith('-');
          const substituir = !op!.startsWith('+') && !remover;
          const querVista = (lista ?? '').toUpperCase().split(/\s+/).includes('\\SEEN');
          for (const msg of conjunto(set!, caixa, uid)) {
            msg.visto = substituir ? querVista : remover ? (querVista ? false : msg.visto) : querVista || msg.visto;
            if (!silent) escrever(`* ${caixa.indexOf(msg) + 1} FETCH (UID ${msg.uid} FLAGS ${flags(msg)})${CRLF}`);
          }
          return ok(tag, 'STORE completed');
        }
        return escrever(`${tag} NO ${subVerbo} nao implementado${CRLF}`);
      }
      case 'IDLE':
        idleTag = tag;
        escrever(`+ idling${CRLF}`);
        return;
      case 'EXPUNGE':
      case 'CLOSE':
      case 'UNSELECT':
        return ok(tag, `${verbo} completed`);
      case 'LOGOUT':
        escrever(`* BYE IMAP4rev1 server encerrando${CRLF}`);
        ok(tag, 'LOGOUT completed');
        socket.end();
        return;
      case 'COMPRESS':
        return escrever(`${tag} NO COMPRESS=DEFLATE nao implementado${CRLF}`);
      default:
        return escrever(`${tag} BAD ${verbo} nao implementado${CRLF}`);
    }
  };

  escrever(`* OK [CAPABILITY IMAP4rev1 ENABLE] harness IMAP4rev1 pronto${CRLF}`);

  socket.on('data', (pedaco: Buffer) => {
    buf = Buffer.concat([buf, pedaco]);
    for (;;) {
      // Literal {n} sincrono: acumula os n bytes na linha do comando.
      if (faltaLiteral > 0) {
        if (buf.length < faltaLiteral) return;
        parcial += buf.subarray(0, faltaLiteral).toString('utf8');
        buf = buf.subarray(faltaLiteral);
        faltaLiteral = 0;
        continue;
      }
      const fim = buf.indexOf(CRLF);
      if (fim < 0) return;
      parcial += buf.subarray(0, fim).toString('utf8');
      buf = buf.subarray(fim + 2);
      const lit = /\{(\d+)\}$/.exec(parcial);
      if (lit) {
        parcial += ' ';
        faltaLiteral = Number(lit[1]);
        escrever(`+${CRLF}`);
        continue;
      }
      const linha = parcial;
      parcial = '';
      if (idleTag !== null) {
        if (/^DONE$/i.test(linha.trim())) {
          escrever(`${idleTag} OK IDLE terminated${CRLF}`);
          idleTag = null;
        }
        continue;
      }
      comando(linha);
    }
  });

  socket.on('error', () => undefined);
}

export async function criarServidorImap(opcoes: OpcoesImap): Promise<ServidorImap> {
  const caixa: MensagemCaixa[] = [];
  let proximoUid = 1;
  const server = createServer(
    { key: readFileSync(opcoes.key), cert: readFileSync(opcoes.cert) },
    (socket) => atender(socket, caixa),
  );
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opcoes.porta, opcoes.host ?? '127.0.0.1', () => resolve());
  });
  const endereco = server.address();
  const portaReal = typeof endereco === 'object' && endereco ? endereco.port : opcoes.porta;
  return {
    porta: () => portaReal,
    caixa,
    depositar: (raw) => {
      const m: MensagemCaixa = { uid: proximoUid++, raw, visto: false, internalDate: new Date() };
      caixa.push(m);
      return m;
    },
    encerrar: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
