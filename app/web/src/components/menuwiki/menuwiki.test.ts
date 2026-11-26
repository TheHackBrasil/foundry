import { describe, expect, it } from 'vitest';
import type { Contato, ItemRevisao, VersaoPedido } from '../../../../shared/model.ts';
import type { PedidoResumo } from '../../api.ts';
import {
  CHAVE_COLAPSO,
  CHAVE_MODO,
  colapsoInicial,
  dicaItem,
  filtrarSecoes,
  hrefPedido,
  itemPedido,
  itensContatos,
  itensDocumentos,
  itensRegras,
  lerColapso,
  lerModo,
  nomeAcessivelItem,
  normalizarConsulta,
  serializarColapso,
  serializarModo,
  type ItemWiki,
} from './dados.ts';

const pedido = (extra: Partial<PedidoResumo>): PedidoResumo => ({
  pedidoId: '35260211222333000181550010000048211000004821',
  totalEventos: 5,
  criadoEm: '2026-11-20T10:00:00Z',
  ultimoEm: '2026-11-21T01:29:59+00:00',
  emitente: 'Krona Eletrônicos',
  ...extra,
});

describe('itemPedido', () => {
  it('prioriza cancelada, depois atraso, depois desvios, senão Confere', () => {
    expect(itemPedido(pedido({ status: 'cancelada', atrasoDias: 3, divergencias: 2 }), 'torre').selo)
      .toMatchObject({ texto: 'Cancelada', tom: 'erro' });
    expect(itemPedido(pedido({ atrasoDias: 3, divergencias: 2 }), 'torre').selo)
      .toMatchObject({ texto: '+3d', tom: 'coord' });
    expect(itemPedido(pedido({ divergencias: 2 }), 'torre').selo)
      .toMatchObject({ texto: '2 desvios', tom: 'coord' });
    expect(itemPedido(pedido({ divergencias: 1 }), 'torre').selo?.texto).toBe('1 desvio');
    expect(itemPedido(pedido({}), 'torre').selo).toMatchObject({ texto: 'Confere', tom: 'ok' });
  });

  it('resume com o destinatario ou com o momento do ultimo evento', () => {
    expect(itemPedido(pedido({ destinatario: 'Packsul' }), 'torre').resumo).toBe('→ Packsul');
    const sem = itemPedido(pedido({ destinatario: null }), 'torre').resumo;
    expect(sem).toBeTruthy();
    expect(sem).not.toContain('→');
  });

  it('cai na chave curta quando o emitente falta', () => {
    const item = itemPedido(pedido({ emitente: null }), 'torre');
    expect(item.titulo).toBe(item.titulo);
    expect(item.titulo).not.toBe('');
  });
});

describe('hrefPedido', () => {
  it('aponta para a rota da torre ou do assistente conforme a rota ativa', () => {
    expect(hrefPedido('torre', 'abc')).toBe('#/pedido/abc');
    expect(hrefPedido('ia', 'abc')).toBe('#/ia/abc');
    expect(hrefPedido('torre', 'a b')).toBe(`#/pedido/${encodeURIComponent('a b')}`);
  });
});

const versao = (n: number, fonte: VersaoPedido['fonte'], geradaEm: string, pedidoId = 'p1'): VersaoPedido => ({
  pedidoId,
  versao: n,
  fonte,
  campos: {},
  geradaEm,
});

describe('itensDocumentos', () => {
  it('ordena do mais recente e liga o documento ao pedido', () => {
    const itens = itensDocumentos(
      [
        {
          pedido: pedido({}),
          versoes: [
            versao(1, 'nfe', '2026-11-20T10:00:00Z', 'p1'),
            versao(2, 'cte', '2026-11-21T10:00:00Z', 'p1'),
          ],
        },
      ],
      'torre',
    );
    expect(itens.map((i) => i.titulo)).toEqual(['CT-e · Krona Eletrônicos', 'NF-e · Krona Eletrônicos']);
    expect(itens[0]?.href).toBe('#/pedido/p1');
    expect(itens[0]?.pedidoId).toBe('p1');
  });

  it('respeita o limite de itens', () => {
    const versoes = Array.from({ length: 30 }, (_, i) =>
      versao(i + 1, 'nfe', `2026-11-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`),
    );
    expect(itensDocumentos([{ pedido: pedido({}), versoes }], 'torre', 10)).toHaveLength(10);
  });
});

describe('itensContatos', () => {
  const contato = (parte: Contato['parte'], fonte: Contato['fonte'] = 'manual'): Contato => ({
    parte,
    nome: `Contato ${parte}`,
    canal: 'whatsapp',
    destino: '+55 51 90000-0000',
    fonte,
  });

  it('ordena pela ordem canonica das partes e marca o de exemplo', () => {
    const itens = itensContatos([contato('fiscal'), contato('fornecedor', 'seed')]);
    expect(itens.map((i) => i.titulo)).toEqual(['Contato fornecedor', 'Contato fiscal']);
    expect(itens[0]?.selo?.texto).toBe('Exemplo');
    expect(itens[1]?.selo).toBeUndefined();
    expect(itens[0]?.resumo).toBe('Fornecedor · WhatsApp');
  });
});

describe('itensRegras', () => {
  const revisao = (id: number, status: ItemRevisao['status'], comProposta = true): ItemRevisao => ({
    id,
    origem: 'planilha',
    motivo: 'xlsx_layout_desconhecido',
    payload: { arquivo: `planilha-${id}.csv` },
    status,
    ts: '2026-11-21T10:00:00Z',
    ...(comProposta
      ? { proposta: { mapeamento: { col_a: 'pedidoId', col_b: 'peso_kg' }, confianca: 0.9, motivo: 'layout proximo' } }
      : {}),
  });

  it('lista so propostas de mapeamento, pendente primeiro', () => {
    const itens = itensRegras([
      revisao(1, 'aprovado'),
      revisao(2, 'pendente'),
      revisao(3, 'pendente', false),
    ]);
    expect(itens.map((i) => i.id)).toEqual(['regra:2', 'regra:1']);
    expect(itens[0]?.selo).toMatchObject({ texto: 'Pendente', tom: 'warn' });
    expect(itens[1]?.selo).toMatchObject({ texto: 'Aprovado', tom: 'ok' });
    expect(itens[0]?.titulo).toBe('planilha-2.csv');
    expect(itens[0]?.resumo).toContain('2 colunas');
  });
});

describe('filtrarSecoes', () => {
  const secoes = [
    {
      id: 'pedidos' as const,
      titulo: 'Pedidos',
      itens: [
        itemPedido(pedido({ divergencias: 2 }), 'torre'),
        itemPedido(pedido({ pedidoId: 'p2', emitente: 'Packsul Embalagens' }), 'torre'),
      ],
    },
    {
      id: 'parceiros' as const,
      titulo: 'Parceiros',
      itens: itensContatos([
        { parte: 'fiscal', nome: 'Escritório Central', canal: 'email', destino: 'f@x.com', fonte: 'manual' },
      ]),
    },
  ];

  it('sem consulta devolve todas as secoes', () => {
    expect(filtrarSecoes(secoes, '  ')).toHaveLength(2);
  });

  it('casa por titulo, resumo e texto do selo em qualquer secao', () => {
    expect(filtrarSecoes(secoes, 'krona')[0]?.itens).toHaveLength(1);
    expect(filtrarSecoes(secoes, 'fiscal').map((s) => s.id)).toEqual(['parceiros']);
    // Recorte de conflitos do botao antigo agora vem do texto do selo.
    const desvios = filtrarSecoes(secoes, 'desvios');
    expect(desvios).toHaveLength(1);
    expect(desvios[0]?.itens[0]?.selo?.texto).toBe('2 desvios');
  });

  it('ignora acento e caixa na consulta', () => {
    expect(normalizarConsulta('  Eletrônicos ')).toBe('eletronicos');
    expect(filtrarSecoes(secoes, 'ELETRONICOS')[0]?.itens).toHaveLength(1);
  });

  it('secao sem resultado some do indice filtrado', () => {
    expect(filtrarSecoes(secoes, 'packsul').map((s) => s.id)).toEqual(['pedidos']);
    expect(filtrarSecoes(secoes, 'xyz')).toHaveLength(0);
  });
});

describe('colapso das secoes', () => {
  it('abre tudo quando a chave nao existe ou o valor e invalido', () => {
    expect(lerColapso(null)).toEqual(colapsoInicial());
    expect(lerColapso('{"outro":1}')).toEqual(colapsoInicial());
    expect(lerColapso('nao-json')).toEqual(colapsoInicial());
  });

  it('preserva secoes gravadas e completa as novas com aberto', () => {
    const lido = lerColapso(JSON.stringify({ v: 1, abertas: { regras: false, fantasma: true } }));
    expect(lido.regras).toBe(false);
    expect(lido.pedidos).toBe(true);
    expect('fantasma' in lido).toBe(false);
  });

  it('serializa na chave versionada e le de volta', () => {
    const abertas = { ...colapsoInicial(), documentos: false };
    expect(lerColapso(serializarColapso(abertas))).toEqual(abertas);
    expect(CHAVE_COLAPSO).toBe('forseti:menuwiki:v1');
  });

  it('Pedidos nunca nasce fechada mesmo se o gravado diz isso', () => {
    const lido = lerColapso(JSON.stringify({ v: 1, abertas: { pedidos: false, regras: false } }));
    expect(lido.pedidos).toBe(true);
    expect(lido.regras).toBe(false);
  });
});

describe('modo do indice', () => {
  it('nasce compacto sem chave ou com valor invalido', () => {
    expect(lerModo(null)).toBe('compacto');
    expect(lerModo('')).toBe('compacto');
    expect(lerModo('nao-json')).toBe('compacto');
    expect(lerModo('{"modo":"ampliado"}')).toBe('compacto');
    expect(lerModo('42')).toBe('compacto');
  });

  it('le o modo gravado e serializa na chave versionada', () => {
    expect(lerModo(serializarModo('expandido'))).toBe('expandido');
    expect(lerModo(serializarModo('compacto'))).toBe('compacto');
    expect(CHAVE_MODO).toBe('forseti:menuwiki:modo:v1');
  });
});

describe('rotulos do modo compacto', () => {
  const item = itemPedido(pedido({ destinatario: 'Packsul', divergencias: 2 }), 'torre');

  it('no expandido o title e o titulo completo e nao ha aria-label', () => {
    expect(dicaItem(item, false)).toBe(item.tituloCompleto);
    expect(nomeAcessivelItem(item, false)).toBeUndefined();
  });

  it('no compacto o resumo vai para o title e para o nome acessivel', () => {
    expect(dicaItem(item, true)).toContain(item.tituloCompleto);
    expect(dicaItem(item, true)).toContain('→ Packsul');
    const nome = nomeAcessivelItem(item, true);
    expect(nome).toContain('Krona Eletrônicos');
    expect(nome).toContain('2 desvios');
    expect(nome).toContain('→ Packsul');
  });

  it('cai no titulo quando o titulo completo falta', () => {
    const item: ItemWiki = { id: 'x', titulo: 'Só título' };
    expect(dicaItem(item, true)).toBe('Só título');
    expect(nomeAcessivelItem(item, true)).toBe('Só título');
  });
});
