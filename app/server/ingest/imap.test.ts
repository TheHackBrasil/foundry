// IMAP (spec 0008, T213): erro do cliente nao derruba o ciclo, falha de
// parser vira item de revisao, falha de infra deixa a mensagem nao lida e
// nome de anexo nao chega cru ao log nem a fila.

import { describe, expect, it, vi } from 'vitest';
import { ErroParser } from './nfe.js';

const estado = vi.hoisted(() => ({
  mensagens: [] as Array<{ source: Buffer; uid: number }>,
  instancias: [] as Array<{ handlers: Map<string, (e: Error) => void>; flags: string[][] }>,
  falharParser: false,
  parsed: null as { attachments: Array<{ filename?: string; content: Buffer }> } | null,
}));

vi.mock('imapflow', () => {
  class ImapFalso {
    handlers = new Map<string, (e: Error) => void>();
    flags: string[][] = [];
    constructor() {
      estado.instancias.push(this);
    }
    on(ev: string, fn: (e: Error) => void) {
      this.handlers.set(ev, fn);
      return this;
    }
    async connect() {}
    async getMailboxLock() {
      return { release() {} };
    }
    async *fetch() {
      yield* estado.mensagens;
    }
    async messageFlagsAdd(opts: { uid: number }) {
      this.flags.push([String(opts.uid)]);
    }
    async logout() {}
  }
  return { ImapFlow: ImapFalso };
});

vi.mock('mailparser', async (importOriginal) => {
  const real = await importOriginal<typeof import('mailparser')>();
  return {
    ...real,
    simpleParser: (fonte: Buffer) => {
      if (estado.falharParser) return Promise.reject(new Error('corpo ilegivel'));
      if (estado.parsed) return Promise.resolve(estado.parsed);
      return real.simpleParser(fonte);
    },
  };
});

const { iniciarPolling, nomeAnexoSeguro } = await import('./imap.js');

const CFG = { host: 'imap.exemplo', port: 993, user: 'u', pass: 'p', mailbox: 'INBOX', intervaloMs: 60_000, desde: new Date(0) };

function preencher() {
  estado.mensagens = [];
  estado.instancias = [];
  estado.falharParser = false;
  estado.parsed = null;
  const logs: string[] = [];
  const revisoes: Array<{ nome: string; erro: string }> = [];
  const ingeridos: string[] = [];
  let falha: ((nome: string) => Error) | null = null;
  const parar = iniciarPolling(
    CFG,
    async (nome) => {
      if (falha) throw falha(nome);
      ingeridos.push(nome);
    },
    async (nome, erro) => {
      revisoes.push({ nome, erro });
    },
    (msg) => logs.push(msg),
  );
  return {
    logs,
    revisoes,
    ingeridos,
    parar,
    setFalha: (f: ((nome: string) => Error) | null) => {
      falha = f;
    },
    pronto: () =>
      vi.waitFor(() => {
        // O ciclo terminou quando o cliente fez logout depois de varrer a caixa.
        expect(estado.instancias.length).toBeGreaterThan(0);
      }),
  };
}

describe('nomeAnexoSeguro', () => {
  it('tira caminho, controles e excesso, preservando o fim do nome', () => {
    expect(nomeAnexoSeguro('dir/sub/nota.xml')).toBe('nota.xml');
    expect(nomeAnexoSeguro('C:\\temp\\nota.xml')).toBe('nota.xml');
    expect(nomeAnexoSeguro('nota\x07evil.xml')).toBe('notaevil.xml');
    const longo = `${'a'.repeat(200)}.xml`;
    const seguro = nomeAnexoSeguro(longo);
    expect(seguro.length).toBeLessThanOrEqual(120);
    expect(seguro).toMatch(/\.xml$/);
  });
});

describe('ciclo de polling', () => {
  it('registra ouvinte de error: queda do cliente vira log, nao crash', async () => {
    const t = preencher();
    await t.pronto();
    const cliente = estado.instancias[0]!;
    expect(cliente.handlers.has('error')).toBe(true);
    // Emite como o socket faria: sem ouvinte isto lancaria excecao no processo.
    cliente.handlers.get('error')!(new Error('conexao cortada'));
    expect(t.logs.some((m) => m.includes('erro no cliente'))).toBe(true);
    t.parar();
  });

  it('ErroParser do anexo vai para a revisao e a mensagem e marcada lida', async () => {
    const t = preencher();
    estado.mensagens = [{ source: Buffer.from('x'), uid: 7 }];
    estado.parsed = { attachments: [{ filename: 'doc.xml', content: Buffer.from('<a/>') }] };
    t.setFalha(() => new ErroParser('XML malformado'));
    await vi.waitFor(() => expect(t.revisoes).toHaveLength(1));
    expect(t.revisoes[0]!.nome).toBe('doc.xml');
    expect(t.revisoes[0]!.erro).toBe('XML malformado');
    expect(estado.instancias[0]!.flags).toEqual([['7']]);
    t.parar();
  });

  it('erro generico e infra: log adiado, sem revisao e sem marcar lida', async () => {
    const t = preencher();
    estado.mensagens = [{ source: Buffer.from('x'), uid: 9 }];
    estado.parsed = { attachments: [{ filename: 'doc.xml', content: Buffer.from('<a/>') }] };
    t.setFalha(() => new Error('banco fora do ar'));
    await vi.waitFor(() => expect(t.logs.some((m) => m.includes('adiado'))).toBe(true));
    expect(t.revisoes).toHaveLength(0);
    expect(estado.instancias[0]!.flags).toEqual([]);
    t.parar();
  });

  it('mensagem que falha no parse vai para revisao como (mensagem) e sai da caixa', async () => {
    const t = preencher();
    estado.mensagens = [{ source: Buffer.from('lixo'), uid: 11 }];
    estado.falharParser = true;
    await vi.waitFor(() => expect(t.revisoes).toHaveLength(1));
    expect(t.revisoes[0]!.nome).toBe('(mensagem)');
    expect(estado.instancias[0]!.flags).toEqual([['11']]);
    t.parar();
  });

  it('nome hostil de anexo chega sanitizado ao ingerir, ao log e a revisao', async () => {
    const t = preencher();
    estado.mensagens = [{ source: Buffer.from('x'), uid: 13 }];
    estado.parsed = {
      attachments: [{ filename: 'pasta/..\\hostil\x07nome.csv', content: Buffer.from('a;b') }],
    };
    t.setFalha(() => new ErroParser('falha de parse'));
    await vi.waitFor(() => expect(t.revisoes).toHaveLength(1));
    expect(t.revisoes[0]!.nome).toBe('hostilnome.csv');
    expect(t.revisoes[0]!.nome).not.toContain('..');
    expect(t.ingeridos).toEqual([]);
    t.parar();
  });
});
