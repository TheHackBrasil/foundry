// Protecoes da demo (spec 0008, T223): a janela fixa conta por chave e
// reseta depois do prazo; a guarda de espaco mede uma vez a cada validade,
// falha de medicao deixa gravar e banco cheio responde 507.

import { describe, expect, it, vi } from 'vitest';
import { ErroRequisicao, GuardaEspaco, JanelaFixa } from './protecao.js';
import type { Db } from './db.js';

describe('JanelaFixa', () => {
  it('consome ate o maximo e recusa a proxima', () => {
    const j = new JanelaFixa(3, 60_000);
    const t0 = 1_000_000;
    expect(j.consumir('ip', t0)).toBe(true);
    expect(j.consumir('ip', t0 + 1)).toBe(true);
    expect(j.consumir('ip', t0 + 2)).toBe(true);
    expect(j.consumir('ip', t0 + 3)).toBe(false);
    expect(j.consumir('ip', t0 + 4)).toBe(false);
  });

  it('chaves diferentes nao dividem a cota', () => {
    const j = new JanelaFixa(1, 60_000);
    const t0 = 1_000_000;
    expect(j.consumir('a', t0)).toBe(true);
    expect(j.consumir('a', t0 + 1)).toBe(false);
    expect(j.consumir('b', t0 + 1)).toBe(true);
  });

  it('a janela reseta depois do prazo e o contador volta a um', () => {
    const j = new JanelaFixa(2, 60_000);
    const t0 = 1_000_000;
    expect(j.consumir('ip', t0)).toBe(true);
    expect(j.consumir('ip', t0 + 1)).toBe(true);
    expect(j.consumir('ip', t0 + 2)).toBe(false);
    expect(j.consumir('ip', t0 + 60_000)).toBe(true); // borda: nova janela
    expect(j.consumir('ip', t0 + 60_001)).toBe(true);
    expect(j.consumir('ip', t0 + 60_002)).toBe(false);
  });
});

describe('GuardaEspaco', () => {
  const dbCom = (bytes: string, falha?: Error): Db => ({
    query: vi.fn(async (_sql: string) => {
      if (falha) throw falha;
      return [{ bytes }] as never;
    }),
    exec: async () => {},
    transaction: async (fn) => fn({ query: async () => [] } as never),
    close: async () => {},
  });

  it('medicao que falha deixa gravar e avisa o ouvinte', async () => {
    const erros: unknown[] = [];
    const g = new GuardaEspaco(dbCom('0', new Error('pg fora')), 1, (e) => erros.push(e));
    await g.exigirEspaco(); // nao lanca: a guarda e rede de seguranca
    expect(erros).toHaveLength(1);
  });

  it('banco acima do limite responde 507 com a mensagem de leitura', async () => {
    const g = new GuardaEspaco(dbCom('2000'), 1_000, () => {});
    await expect(g.exigirEspaco()).rejects.toBeInstanceOf(ErroRequisicao);
    await expect(g.exigirEspaco()).rejects.toMatchObject({ status: 507 });
  });

  it('reusa a medicao dentro da validade e mede de novo depois', async () => {
    const db = dbCom('10');
    const g = new GuardaEspaco(db, 1_000, () => {}, 1_000);
    const agora = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(agora);
    await g.exigirEspaco();
    await g.exigirEspaco();
    expect(db.query).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(agora + 1_001);
    await g.exigirEspaco();
    expect(db.query).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
