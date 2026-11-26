// Projecao do operador (spec 0017, T722): plano de contato, tentativas e
// linha do tempo do caso a partir de eventos sinteticos, sem banco. Chave,
// hashes e ids sao ficticios (A7).

import { describe, expect, it } from 'vitest';
import { linhaDoTempoCaso, projetarPlanosContato, projetarTentativas } from './casos.js';
import type { Evento } from './model.js';

const PEDIDO = '35261112345678000190550010000012341000012345';
const CASO = `${PEDIDO}:2`;
const H = (c: string): string => c.repeat(64);

let seq = 0;
function ev(tipo: Evento['tipo'], payload: Record<string, unknown>, pedidoId = PEDIDO): Evento {
  seq += 1;
  return { pedidoId, seq, tipo, payload, ts: new Date(Date.UTC(2026, 10, 26, 12, seq)).toISOString(), prevHash: '', hash: '' };
}

function trilhaBase(): Evento[] {
  seq = 0;
  return [
    ev('nfe', { campos: { status: 'emitida' } }),
    ev('pendencia_aberta', { motivo: 'sem_atualizacao' }),
    ev('operador_assumiu', { casoId: CASO, fluxoId: 'f1', gatilho: 'pendencia_aberta' }),
  ];
}

const planejado = (versao: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  planoId: 'p1',
  versao,
  canal: 'whatsapp',
  contatoId: 7,
  hashRoteiro: H(String(versao)),
  prazo: '2026-11-26T14:00:00.000Z',
  custoEstimadoBrl: 0.35,
  casoId: CASO,
  ...extra,
});

describe('plano de contato (RF7, RF11)', () => {
  it('percorre proposto, aprovado, iniciado e aceito', () => {
    const es = trilhaBase();
    es.push(ev('contato_planejado', planejado(1)));
    expect(projetarPlanosContato(es)[0]!.estado).toBe('proposto');
    es.push(ev('contato_aprovado', { planoId: 'p1', versao: 1, hashRoteiro: H('1'), aprovador: 'analista-1' }));
    expect(projetarPlanosContato(es)[0]).toMatchObject({ estado: 'aprovado', aprovador: 'analista-1' });
    es.push(ev('contato_iniciado', { planoId: 'p1', chave: H('a'), canal: 'whatsapp', fornecedor: 'nvoip' }));
    es.push(ev('contato_aceito', { chave: H('a'), idExterno: 'msg-1' }));
    const [p] = projetarPlanosContato(es);
    expect(p).toMatchObject({ planoId: 'p1', versao: 1, estado: 'aceito', chave: H('a'), casoId: CASO, custoEstimadoBrl: 0.35 });
  });

  it('a ultima versao vale e a aprovacao de versao antiga nao libera a nova', () => {
    const es = trilhaBase();
    es.push(ev('contato_planejado', planejado(1)));
    es.push(ev('contato_planejado', planejado(2, { custoEstimadoBrl: 0.5 })));
    es.push(ev('contato_planejado', planejado(1))); // versao velha chegando depois: ignorada
    es.push(ev('contato_aprovado', { planoId: 'p1', versao: 1, aprovador: 'a' }));
    const [p] = projetarPlanosContato(es);
    expect(p).toMatchObject({ versao: 2, estado: 'proposto', hashRoteiro: H('2'), custoEstimadoBrl: 0.5 });
    expect(p!.aprovador).toBeUndefined();
    es.push(ev('contato_aprovado', { planoId: 'p1', versao: 2, aprovador: 'a' }));
    expect(projetarPlanosContato(es)[0]!.estado).toBe('aprovado');
  });

  it('o primeiro evento terminal vale; nada depois muda o plano', () => {
    const es = trilhaBase();
    es.push(ev('contato_planejado', planejado(1)));
    es.push(ev('contato_recusado', { planoId: 'p1', versao: 1, aprovador: 'a' }));
    es.push(ev('contato_aprovado', { planoId: 'p1', versao: 1, aprovador: 'b' }));
    es.push(ev('contato_expirado', { planoId: 'p1' }));
    es.push(ev('contato_planejado', planejado(2)));
    expect(projetarPlanosContato(es)[0]).toMatchObject({ estado: 'recusado', versao: 1, aprovador: 'a' });

    const outra = trilhaBase();
    outra.push(ev('contato_planejado', planejado(1)));
    outra.push(ev('contato_aprovado', { planoId: 'p1', versao: 1 }));
    outra.push(ev('contato_iniciado', { planoId: 'p1', chave: H('b') }));
    outra.push(ev('contato_incerto', { chave: H('b'), motivo: 'timeout' }));
    outra.push(ev('contato_aceito', { chave: H('b'), idExterno: 'x' }));
    expect(projetarPlanosContato(outra)[0]!.estado).toBe('incerto');
  });

  it('iniciado sem aprovacao nao avanca o plano e expirado fecha o proposto', () => {
    const es = trilhaBase();
    es.push(ev('contato_planejado', planejado(1)));
    es.push(ev('contato_iniciado', { planoId: 'p1', chave: H('c') }));
    expect(projetarPlanosContato(es)[0]!.estado).toBe('proposto');
    es.push(ev('contato_expirado', { planoId: 'p1' }));
    expect(projetarPlanosContato(es)[0]!.estado).toBe('expirado');
  });

  it('falha antes do efeito fecha o aprovado sem chave; planos de pedidos diferentes nao se misturam', () => {
    const es = trilhaBase();
    es.push(ev('contato_planejado', planejado(1)));
    es.push(ev('contato_aprovado', { planoId: 'p1', versao: 1 }));
    es.push(ev('contato_falhou', { planoId: 'p1', motivo: 'canal_sem_credencial' }));
    es.push(ev('contato_planejado', planejado(1), '9'.repeat(44)));
    const planos = projetarPlanosContato(es);
    expect(planos).toHaveLength(2);
    expect(planos.find((p) => p.pedidoId === PEDIDO)!.estado).toBe('falhou');
    expect(planos.find((p) => p.pedidoId !== PEDIDO)!.estado).toBe('proposto');
  });
});

describe('tentativas (RF12)', () => {
  it('uma por chave, primeiro desfecho vale, ligacao_concluida pelo id externo', () => {
    const es = trilhaBase();
    es.push(ev('contato_iniciado', { chave: H('d'), canal: 'ligacao', fornecedor: 'telnyx' }));
    es.push(ev('contato_iniciado', { chave: H('d'), canal: 'ligacao', fornecedor: 'outro' }));
    es.push(ev('contato_aceito', { chave: H('d'), idExterno: 'call-9' }));
    es.push(ev('contato_falhou', { chave: H('d'), motivo: 'tarde' }));
    es.push(ev('ligacao_concluida', { idExterno: 'call-9', resultado: 'atendida', duracaoS: 95, custoBrl: 0.42, hashAudio: H('e'), hashTranscricao: H('f') }));
    const ts = projetarTentativas(es);
    expect(ts).toHaveLength(1);
    expect(ts[0]).toMatchObject({
      chave: H('d'),
      casoId: CASO, // do operador_assumiu, sem casoId no payload
      fornecedor: 'telnyx',
      idExterno: 'call-9',
      estado: 'concluida',
      resultado: 'atendida',
      duracaoS: 95,
      custoBrl: 0.42,
      hashAudio: H('e'),
      hashTranscricao: H('f'),
    });
  });

  it('motivo em texto livre nao entra na projecao', () => {
    const es = trilhaBase();
    es.push(ev('contato_iniciado', { chave: H('g') }));
    es.push(ev('contato_falhou', { chave: H('g'), motivo: 'Erro ao ligar para 11 98765-4321' }));
    const [t] = projetarTentativas(es);
    expect(t!.estado).toBe('falhou');
    expect(t!.motivo).toBeUndefined();
  });
});

describe('linha do tempo do caso (RF26)', () => {
  it('junta origem, operador, aprovacao, tentativa, evidencia e declaracao, com hashes e custo', () => {
    const es = trilhaBase();
    es.push(ev('contato_planejado', planejado(1)));
    es.push(ev('contato_aprovado', { planoId: 'p1', versao: 1, aprovador: 'analista-1' }));
    es.push(ev('contato_iniciado', { planoId: 'p1', chave: H('a'), canal: 'ligacao', fornecedor: 'telnyx' }));
    es.push(ev('contato_aceito', { chave: H('a'), idExterno: 'call-1' }));
    es.push(ev('ligacao_concluida', { idExterno: 'call-1', resultado: 'atendida', custoBrl: 0.4, hashAudio: H('b'), hashTranscricao: H('c') }));
    es.push(
      ev('status_declarado', {
        fonte: 'ligacao_transportadora',
        campos: { status: 'em_transito', previsaoEntrega: '2026-11-28' },
        dados: { canal: 'ligacao', evidenciaHash: H('c'), telefone: '+5511987654321' },
        confianca: 0.6,
      }),
    );
    es.push(ev('caso_resolvido', { casoId: CASO, resolvidoPor: 'motor' }));
    // ruido: outro caso do mesmo pedido e evento de outro pedido
    es.push(ev('caso_atribuido', { casoId: `${PEDIDO}:99` }));
    es.push(ev('contato_planejado', { ...planejado(1), planoId: 'px', casoId: `${PEDIDO}:99` }));

    const linha = linhaDoTempoCaso(es, CASO);
    expect(linha.map((i) => [i.tipo, i.categoria])).toEqual([
      ['pendencia_aberta', 'caso'],
      ['operador_assumiu', 'operador'],
      ['contato_planejado', 'aprovacao'],
      ['contato_aprovado', 'aprovacao'],
      ['contato_iniciado', 'tentativa'],
      ['contato_aceito', 'tentativa'],
      ['ligacao_concluida', 'evidencia'],
      ['status_declarado', 'declaracao'],
      ['caso_resolvido', 'caso'],
    ]);
    expect(linha.find((i) => i.tipo === 'contato_planejado')).toMatchObject({ canal: 'whatsapp', custoEstimadoBrl: 0.35, hashes: [H('1')] });
    expect(linha.find((i) => i.tipo === 'contato_aprovado')!.aprovador).toBe('analista-1');
    expect(linha.find((i) => i.tipo === 'ligacao_concluida')).toMatchObject({ custoBrl: 0.4, hashes: [H('b'), H('c')] });
    const decl = linha.find((i) => i.categoria === 'declaracao')!;
    expect(decl).toMatchObject({ fonte: 'ligacao_transportadora', confianca: 0.6, hashes: [H('c')] });
    expect(JSON.stringify(linha)).not.toContain('98765');
  });

  it('caso inexistente devolve lista vazia; declaracao anterior ao caso fica fora', () => {
    const es = trilhaBase();
    expect(linhaDoTempoCaso(es, `${PEDIDO}:77`)).toEqual([]);
    expect(linhaDoTempoCaso(es, 'sem-separador')).toEqual([]);
    seq = 0;
    const antes = [
      ev('status_declarado', { fonte: 'email_transportadora', campos: { status: 'em_transito' }, dados: {} }),
      ev('pendencia_aberta', { motivo: 'sem_atualizacao' }),
    ];
    expect(linhaDoTempoCaso(antes, CASO).map((i) => i.tipo)).toEqual(['pendencia_aberta']);
  });
});
