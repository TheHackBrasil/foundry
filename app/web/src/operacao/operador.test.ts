// Spec 0017 (T752, T771, T772): painel de aprovação, linha do tempo do caso
// e agenda por canal, renderizados com renderToStaticMarkup, mais o contrato
// das chamadas do operador (credencial no cabeçalho, nunca no navegador).

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ItemLinhaTempo, PlanoContatoProjetado } from '../../../shared/casos.ts';
import type { Contato } from '../../../shared/model.ts';
import { ErroApi } from '../api.ts';
import { BotaoParte, DrawerAgenda, contatosPorParte, substituirContato } from '../components/DrawerAgenda.tsx';
import { acionarOperador, ajustarPlano, aprovarPlano, listarPlanos, obterLinhaTempo, recusarPlano } from './api.ts';
import { LinhaTempoCaso, lerFalas } from './LinhaTempoCaso.tsx';
import { PainelAprovacao, mensagemErroDecisao, type EstadoRoteiro } from './PainelAprovacao.tsx';
import {
  camposAlterados,
  lerRoteiro,
  mascararTelefone,
  motivoDoPlano,
  ordenarPlanos,
  rotuloCampoRoteiro,
} from './operador.ts';

const H = (c: string): string => c.repeat(64);

const plano = (over: Partial<PlanoContatoProjetado> = {}): PlanoContatoProjetado => ({
  planoId: 'pl1',
  pedidoId: 'P1',
  casoId: 'P1:3',
  versao: 2,
  canal: 'whatsapp',
  contatoId: 7,
  hashRoteiro: H('a'),
  prazo: '2026-11-26T15:00:00Z',
  custoEstimadoBrl: 0.42,
  estado: 'proposto',
  atualizadoEm: '2026-11-26T14:00:00Z',
  ...over,
});

const roteiroOk: EstadoRoteiro = {
  estado: 'ok',
  roteiro: {
    campos: { chaveNota: '35261100000000000000550010000000011000000019', pergunta: 'status_entrega', empresa: 'Acme' },
    perguntas: ['Qual é o status atual da entrega desta nota?'],
    destino: '+55 11 90000-0002',
    nomeContato: 'Transportadora Ficticia (seed)',
  },
};

const render = (el: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(el);
const noop = (): void => undefined;

function painel(over: Partial<Parameters<typeof PainelAprovacao>[0]> = {}): string {
  return render(
    createElement(PainelAprovacao, {
      casoId: 'P1:3',
      plano: plano(),
      motivo: 'sem resposta ao e-mail',
      token: '',
      aoMudarToken: noop,
      aoRecarregar: noop,
      aoAnunciar: noop,
      roteiroInicial: roteiroOk,
      ...over,
    }),
  );
}

describe('PainelAprovacao (T752)', () => {
  it('mostra canal, contato mascarado, motivo, prazo e custo rotulado como estimativa', () => {
    const html = painel();
    expect(html).toContain('WhatsApp');
    expect(html).toContain('+55 11 •••••-0002');
    expect(html).not.toContain('90000-0002');
    expect(html).toContain('sem resposta ao e-mail');
    expect(html).toContain('Decidir até');
    expect(html).toContain('Custo estimado');
    expect(html).toContain('estimativa');
    expect(html).toMatch(/R\$\s*0,42/);
  });

  it('só pergunta e empresa são editáveis; chave da nota e texto das perguntas ficam fixos', () => {
    const html = painel();
    expect(html).toMatch(/<select[^>]*>.*Status atual da entrega.*Previsão de entrega.*Confirmar o valor informado/);
    expect(html).toMatch(/<input[^>]*type="text"[^>]*maxLength="80"[^>]*value="Acme"/);
    expect(html).toContain('Chave da nota');
    expect(html).not.toMatch(/<input[^>]*value="3526/);
    expect(html).toContain('Qual é o status atual da entrega desta nota?');
    expect(html).not.toMatch(/<input[^>]*value="Qual/);
  });

  it('credencial em campo de senha, com ajuda; sem token as decisões ficam travadas', () => {
    const html = painel();
    expect(html).toContain('type="password"');
    expect(html).toContain('Credencial de aprovador');
    expect(html).toContain('Fica só na memória desta aba');
    const botoes = html.match(/<button[^>]*>(Aprovar|Ajustar campos|Recusar)<\/button>/g) ?? [];
    expect(botoes).toHaveLength(3);
    for (const b of botoes) expect(b).toContain('disabled');
  });

  it('com token, aprovar libera; ajustar segue travado sem campo alterado', () => {
    const html = painel({ token: 'tok' });
    expect(html).toMatch(/<button type="button" class="botao">Aprovar<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Ajustar campos<\/button>/);
  });

  it('plano decidido ou caso de exemplo: só leitura, sem botões de decisão', () => {
    for (const html of [painel({ plano: plano({ estado: 'aprovado' }) }), painel({ somenteLeitura: true })]) {
      expect(html).not.toContain('>Aprovar<');
      expect(html).not.toContain('type="password"');
      expect(html).toContain('<dl class="op-roteiro-campos">');
    }
    expect(painel({ plano: plano({ estado: 'aprovado' }) })).toContain('pilula-ok');
  });

  it('roteiro indisponível não esconde contato nem custo', () => {
    const html = painel({ roteiroInicial: { estado: 'indisponivel', mensagem: 'Evidência não encontrada.' } });
    expect(html).toContain('Evidência não encontrada.');
    expect(html).toContain('contato nº 7');
  });

  it('409 e 401 viram mensagens claras', () => {
    expect(mensagemErroDecisao(new ErroApi('x', 409))).toMatch(/mudou antes da sua decisão/);
    expect(mensagemErroDecisao(new ErroApi('x', 401))).toMatch(/Credencial de aprovador ausente ou inválida/);
  });

  it('o token nunca vai para armazenamento do navegador', () => {
    for (const arq of ['./PainelAprovacao.tsx', './PaginaOperacao.tsx', './api.ts']) {
      const fonte = readFileSync(new URL(arq, import.meta.url), 'utf8');
      expect(fonte).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    }
  });
});

const itens: ItemLinhaTempo[] = [
  { seq: 3, ts: '2026-11-26T10:00:00Z', tipo: 'pendencia_aberta', categoria: 'caso' },
  {
    seq: 5,
    ts: '2026-11-26T11:00:00Z',
    tipo: 'contato_planejado',
    categoria: 'aprovacao',
    canal: 'ligacao',
    planoId: 'pl1',
    versao: 1,
    motivo: 'sem_resposta_email',
    custoEstimadoBrl: 1.5,
    hashes: [H('a')],
  },
  { seq: 6, ts: '2026-11-26T11:05:00Z', tipo: 'contato_aprovado', categoria: 'aprovacao', planoId: 'pl1', versao: 1, aprovador: 'ana' },
  {
    seq: 9,
    ts: '2026-11-26T11:20:00Z',
    tipo: 'ligacao_concluida',
    categoria: 'evidencia',
    resultado: 'atendida',
    custoBrl: 0.9,
    hashes: [H('b'), H('c')],
  },
  {
    seq: 10,
    ts: '2026-11-26T11:21:00Z',
    tipo: 'status_declarado',
    categoria: 'declaracao',
    fonte: 'ligacao_transportadora',
    campos: { status: 'em_transito', previsaoEntrega: '2026-11-30' },
    confianca: 0.82,
  },
];

describe('LinhaTempoCaso (T771)', () => {
  const html = render(createElement(LinhaTempoCaso, { casoId: 'P1:3', carga: { estado: 'ok', itens } }));

  it('lista ações com canal, horário, aprovação e custo', () => {
    expect(html).toContain('Plano de contato proposto');
    expect(html).toContain('Ligação');
    expect(html).toContain('sem resposta email');
    expect(html).toContain('Plano aprovado');
    expect(html).toContain('ana');
    expect(html).toMatch(/R\$\s*1,50/);
    expect(html).toContain('estimativa');
    expect(html).toContain('Custo informado pelo fornecedor');
    expect(html).toContain('dateTime="2026-11-26T11:20:00Z"');
  });

  it('evidência por hash: botões com rótulo do conteúdo e aria-expanded', () => {
    expect(html).toContain('Abrir roteiro');
    expect(html).toContain('Abrir áudio da ligação');
    expect(html).toContain('Abrir transcrição');
    expect(html).toContain('aria-expanded="false"');
  });

  it('declaração com fonte, campos e confiança', () => {
    expect(html).toContain('Declaração extraída');
    expect(html).toContain('82%');
    expect(html).toContain('Confiança da extração');
    expect(html).toContain('30/11/2026');
  });

  it('contagem em região de status e estados vazio, carregando e erro', () => {
    expect(html).toMatch(/role="status">5 registros/);
    const vazio = render(createElement(LinhaTempoCaso, { casoId: 'x:1', carga: { estado: 'ok', itens: [] } }));
    expect(vazio).toContain('O operador ainda não agiu neste caso.');
    expect(render(createElement(LinhaTempoCaso, { casoId: 'x:1', carga: { estado: 'carregando' } }))).toContain('Carregando');
    expect(
      render(createElement(LinhaTempoCaso, { casoId: 'x:1', carga: { estado: 'erro', mensagem: 'falhou' } })),
    ).toContain('falhou');
  });

  it('transcrição em JSON vira falas', () => {
    expect(lerFalas([{ quem: 'agente', texto: 'Oi' }, { papel: 'atendente', texto: 'Olá' }])).toEqual([
      { quem: 'agente', texto: 'Oi' },
      { quem: 'atendente', texto: 'Olá' },
    ]);
    expect(lerFalas({ falas: [{ role: 'user', text: 'a' }] })).toEqual([{ quem: 'user', texto: 'a' }]);
    expect(lerFalas('texto')).toBeNull();
  });
});

describe('domínio do operador', () => {
  it('máscara de telefone guarda só DDI, DDD e o fim', () => {
    expect(mascararTelefone('+55 11 99999-1234')).toBe('+55 11 •••••-1234');
    expect(mascararTelefone('11999991234')).toBe('(11) •••••-1234');
    expect(mascararTelefone('12')).toBe('••••');
  });

  it('roteiro: só campos primitivos entram, perguntas e contato saem do JSON', () => {
    const r = lerRoteiro({
      campos: { a: 'x', b: 2, c: true, d: { x: 1 }, e: null },
      perguntas: ['p1', { texto: 'p2' }, 3],
      motivo: 'sem resposta',
      contato: { nome: 'N', destino: '+5511900000002' },
    });
    expect(r).toEqual({
      campos: { a: 'x', b: 2, c: true },
      perguntas: ['p1', 'p2'],
      motivo: 'sem resposta',
      destino: '+5511900000002',
      nomeContato: 'N',
    });
    expect(lerRoteiro(null)).toBeNull();
    expect(lerRoteiro([1])).toBeNull();
  });

  it('ajuste manda só o que mudou e só campos que existem', () => {
    expect(camposAlterados({ a: 1, b: 'x' }, { a: 2, b: 'x', z: 'novo' })).toEqual({ a: 2 });
    expect(rotuloCampoRoteiro('dataPrevista')).toBe('Data prevista');
    expect(rotuloCampoRoteiro('chave_nota')).toBe('Chave nota');
  });

  it('motivo vem do contato_planejado do plano; planos abertos primeiro', () => {
    expect(motivoDoPlano(plano({ planoId: 'pl1' }), itens)).toBe('sem resposta email');
    expect(motivoDoPlano(plano({ planoId: 'outro' }), itens)).toBeUndefined();
    const ord = ordenarPlanos([
      plano({ planoId: 'a', estado: 'recusado', atualizadoEm: '2026-11-26T16:00:00Z' }),
      plano({ planoId: 'b', estado: 'proposto', atualizadoEm: '2026-11-26T10:00:00Z' }),
    ]);
    expect(ord.map((p) => p.planoId)).toEqual(['b', 'a']);
  });
});

describe('api do operador', () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status: number, corpo: unknown) {
    const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', f);
    return f;
  }

  it('aprovar, ajustar e recusar levam Bearer e o corpo do contrato', async () => {
    const f = stubFetch(200, { ok: true });
    await aprovarPlano('pl 1', 'tok', { versao: 2, hashRoteiro: H('a') });
    await ajustarPlano('pl1', 'tok', { versao: 2, campos: { volumes: 5 } });
    await recusarPlano('pl1', 'tok', { versao: 2, motivo: 'não' });
    const chamadas = f.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(chamadas.map((c) => c[0])).toEqual([
      '/api/planos/pl%201/aprovar',
      '/api/planos/pl1/ajustar',
      '/api/planos/pl1/recusar',
    ]);
    for (const [, init] of chamadas) {
      expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer tok');
      expect(init.method).toBe('POST');
    }
    expect(JSON.parse(String(chamadas[0]![1].body))).toEqual({ versao: 2, hashRoteiro: H('a') });
    expect(JSON.parse(String(chamadas[1]![1].body))).toEqual({ versao: 2, campos: { volumes: 5 } });
    expect(JSON.parse(String(chamadas[2]![1].body))).toEqual({ versao: 2, motivo: 'não' });
  });

  it('409 e 401 chegam como ErroApi com status', async () => {
    stubFetch(409, { erro: 'plano não está proposto' });
    await expect(aprovarPlano('pl1', 't', { versao: 1, hashRoteiro: '' })).rejects.toMatchObject({ status: 409 });
    stubFetch(401, {});
    await expect(recusarPlano('pl1', '', { versao: 1, motivo: 'x' })).rejects.toMatchObject({ status: 401 });
    stubFetch(409, {});
    await expect(acionarOperador('P1:3')).rejects.toMatchObject({ status: 409 });
  });

  it('planos e linha do tempo aceitam array puro ou embrulhado', async () => {
    stubFetch(200, [plano()]);
    expect(await listarPlanos('P1:3')).toHaveLength(1);
    stubFetch(200, { planos: [plano()] });
    expect(await listarPlanos('P1:3')).toHaveLength(1);
    const f = stubFetch(200, { itens });
    expect(await obterLinhaTempo('P1:3')).toHaveLength(5);
    expect((f.mock.calls as unknown as Array<[string]>)[0]![0]).toBe('/api/casos/P1%3A3/linha-tempo');
  });
});

describe('DrawerAgenda por canal (T772)', () => {
  const agenda: Contato[] = [
    { parte: 'transportadora', nome: 'Transp', canal: 'whatsapp', destino: '+55 11 90000-0002', fonte: 'documento' },
    {
      parte: 'transportadora',
      nome: 'Transp',
      canal: 'ligacao',
      destino: '+55 11 90000-0009',
      fonte: 'manual',
      naoContatarIa: true,
    },
    { parte: 'cd', nome: 'CD', canal: 'sms', destino: '+55 11 90000-0003', fonte: 'seed' },
  ];

  it('agrupa por parte e o upsert local troca só o mesmo canal', () => {
    const mapa = contatosPorParte(agenda);
    expect(mapa.get('transportadora')?.map((c) => c.canal)).toEqual(['whatsapp', 'ligacao']);
    const novo: Contato = { ...agenda[0]!, destino: '+55 11 1', fonte: 'manual' };
    const lista = substituirContato(agenda, novo);
    expect(lista).toHaveLength(3);
    expect(lista.filter((c) => c.parte === 'transportadora').map((c) => c.canal)).toEqual(['ligacao', 'whatsapp']);
  });

  it('cada canal mostra a fonte e a marca de não contatar pela IA', () => {
    const html = render(
      createElement(BotaoParte, {
        parte: 'transportadora',
        contatos: contatosPorParte(agenda).get('transportadora')!,
        selecionado: true,
        aoSelecionar: noop,
      }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('2 canais');
    expect(html).toContain('Fonte: NF-e/CT-e');
    expect(html).toContain('Fonte: Manual');
    expect(html).toContain('Não contatar pela IA');
    expect(html).toContain('WhatsApp');
  });

  it('parte sem contato avisa', () => {
    const html = render(createElement(BotaoParte, { parte: 'fiscal', contatos: [], selecionado: false, aoSelecionar: noop }));
    expect(html).toContain('Sem contato');
  });

  it('a gaveta aberta tem o controle de não contatar pela IA com rótulo e ajuda', () => {
    const html = render(createElement(DrawerAgenda, { aberto: true, aoFechar: noop }));
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="naoContatarIa"|name="naoContatarIa"[^>]*type="checkbox"/);
    expect(html).toContain('Não contatar pela IA');
    expect(html).toContain('Marcado, o operador não envia WhatsApp nem liga');
  });
});
