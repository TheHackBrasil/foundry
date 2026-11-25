import { describe, expect, it } from 'vitest';
import {
  CARD_IDS,
  CHAVE_TEMPLATES,
  CHAVE_VISTAS_META,
  LAYOUT_PADRAO,
  TEMPLATES_VISTA,
  TEMPLATE_LAYOUT_PADRAO,
  aplicarTemplate,
  assinaturaVista,
  chaveLayoutPedido,
  definirVistaGlobal,
  guardarLayoutPedido,
  guardarTemplatesCustom,
  guardarVistaMeta,
  inserirEm,
  lerLayoutPedido,
  lerTemplatesCustom,
  lerVistasMeta,
  mesclarMetaTemplate,
  moverPorPasso,
  normalizarLayout,
  normalizarOrdem,
  templateCorrespondente,
  templateDeLayout,
  templateParaLayout,
  type CardId,
  type LayoutTorre,
  type StorageMinimo,
  type VistaTemplate,
} from './layout.ts';

function storageFake() {
  const mapa = new Map<string, string>();
  const storage: StorageMinimo = {
    getItem: (k) => mapa.get(k) ?? null,
    setItem: (k, v) => void mapa.set(k, v),
    removeItem: (k) => void mapa.delete(k),
  };
  return { mapa, storage };
}

describe('normalizarOrdem', () => {
  it('deduplica, descarta ids desconhecidos e anexa os que faltam', () => {
    expect(normalizarOrdem(['tarefas', 'matriz', 'tarefas', 'fantasma'])).toEqual([
      'tarefas',
      'matriz',
      'domino',
      'sinais',
      'cadeia',
      'simulador',
      'versoes',
    ]);
  });

  it('vazio devolve a ordem padrão completa', () => {
    expect(normalizarOrdem([])).toEqual([...CARD_IDS]);
  });
});

describe('normalizarLayout', () => {
  it('entrada inválida cai no layout padrão', () => {
    expect(normalizarLayout(null)).toEqual(LAYOUT_PADRAO);
    expect(normalizarLayout('lixo')).toEqual(LAYOUT_PADRAO);
  });

  it('preserva recolhidos e ocultos válidos', () => {
    const l = normalizarLayout({ ordem: ['domino'], ocultos: ['versoes'], recolhidos: ['sinais'] });
    expect(l.ordem[0]).toBe('domino');
    expect(l.ocultos).toEqual(['versoes']);
    expect(l.recolhidos).toEqual(['sinais']);
  });
});

describe('inserirEm e moverPorPasso', () => {
  it('move o card para o índice pedido sem duplicar', () => {
    const ordem = normalizarOrdem([]);
    expect(inserirEm(ordem, 'matriz', 2).slice(0, 3)).toEqual(['tarefas', 'domino', 'matriz']);
  });

  it('passo positivo e negativo reordenam com limite nas pontas', () => {
    const ordem = normalizarOrdem([]);
    expect(moverPorPasso(ordem, 'matriz', 1)[1]).toBe('matriz');
    expect(moverPorPasso(ordem, 'matriz', -1)[0]).toBe('matriz');
    expect(moverPorPasso(ordem, 'versoes', 4).at(-1)).toBe('versoes');
  });
});

describe('aplicarTemplate', () => {
  it('template ordena os visíveis e manda o resto para ocultos', () => {
    const atrasos = TEMPLATES_VISTA.find((t) => t.id === 'atrasos');
    expect(atrasos).toBeDefined();
    const r = aplicarTemplate(atrasos!);
    expect(r.ordem.slice(0, 4)).toEqual(['matriz', 'domino', 'tarefas', 'sinais']);
    expect(r.ocultos.sort()).toEqual(['cadeia', 'simulador', 'versoes'].sort());
    expect(r.ordem).toHaveLength(CARD_IDS.length);
  });

  it('template com spans devolve larguras normalizadas; sem spans não toca', () => {
    const comSpans: VistaTemplate = {
      id: 'x',
      nome: 'X',
      ordem: ['matriz', 'tarefas'],
      spans: { matriz: 20, tarefas: 2, fantasma: 6 } as VistaTemplate['spans'],
    };
    const r = aplicarTemplate(comSpans);
    expect(r.spans).toEqual({ matriz: 4, tarefas: 2 });

    const sem = aplicarTemplate({ id: 'y', nome: 'Y', ordem: ['matriz'] });
    expect('spans' in sem).toBe(false);
  });
});

describe('spans no layout', () => {
  it('normalizarLayout valida e clampa spans (1..4 colunas) por card conhecido', () => {
    const l = normalizarLayout({
      ordem: [],
      spans: { matriz: 4.6, domino: 99, nada: 5, sinais: 'largo' },
    });
    expect(l.spans).toEqual({ matriz: 4, domino: 4 });
  });

  it('spans e densidade sobrevivem ao round-trip no storage do pedido', () => {
    const { storage } = storageFake();
    const layout: LayoutTorre = {
      ...LAYOUT_PADRAO,
      spans: { matriz: 3, tarefas: 2 },
      densidade: 2,
    };
    guardarLayoutPedido('ped-s', layout, storage);
    expect(lerLayoutPedido('ped-s', storage)).toEqual(layout);
  });

  it('densidade inválida é descartada na normalização', () => {
    const l = normalizarLayout({ ordem: [], densidade: 7 });
    expect(l.densidade).toBeUndefined();
  });

  it('assinatura muda quando o span muda (template custom com largura)', () => {
    const base = assinaturaVista(normalizarOrdem([]), [], { matriz: 3 });
    const outro = assinaturaVista(normalizarOrdem([]), [], { matriz: 2 });
    expect(base).not.toBe(outro);
  });
});

describe('templateCorrespondente', () => {
  const todos = [...TEMPLATES_VISTA];

  it('reconhece a vista logo depois de aplicar um preset', () => {
    const fiscal = TEMPLATES_VISTA.find((t) => t.id === 'fiscal')!;
    const { ordem, ocultos } = aplicarTemplate(fiscal);
    expect(templateCorrespondente(ordem, ocultos, todos)).toBe('fiscal');
  });

  it('devolve null quando a pessoa mexe na ordem depois de aplicar', () => {
    const { ordem, ocultos } = aplicarTemplate(TEMPLATES_VISTA.find((t) => t.id === 'operacao')!);
    const mexida = moverPorPasso(ordem, 'matriz', 1);
    expect(templateCorrespondente(mexida, ocultos, todos)).toBeNull();
  });

  it('reconhece template custom salvo', () => {
    const custom: VistaTemplate = { id: 'v1', nome: 'Minha vista', ordem: ['cadeia', 'tarefas'], custom: true };
    const { ordem, ocultos } = aplicarTemplate(custom);
    expect(templateCorrespondente(ordem, ocultos, [custom])).toBe('v1');
  });
});

describe('assinaturaVista', () => {
  it('ignora posição de cards ocultos na comparação', () => {
    const a = assinaturaVista(['matriz', 'tarefas', 'cadeia'], ['cadeia']);
    const b = assinaturaVista(['cadeia', 'matriz', 'tarefas'], ['cadeia']);
    expect(a).toBe(b);
  });
});

describe('persistência por pedido', () => {
  it('guarda e lê o layout na chave versionada do pedido', () => {
    const { mapa, storage } = storageFake();
    const layout: LayoutTorre = {
      ordem: moverPorPasso(normalizarOrdem([]), 'domino', -2),
      ocultos: ['versoes'],
      recolhidos: ['simulador'],
    };
    guardarLayoutPedido('ped-1', layout, storage);
    expect(mapa.has(chaveLayoutPedido('ped-1'))).toBe(true);
    expect(lerLayoutPedido('ped-1', storage)).toEqual(layout);
    expect(lerLayoutPedido('ped-2', storage)).toBeNull();
  });

  it('json corrompido devolve null em vez de quebrar', () => {
    const { mapa, storage } = storageFake();
    mapa.set(chaveLayoutPedido('p'), '{invalido');
    expect(lerLayoutPedido('p', storage)).toBeNull();
  });

  it('sem storage (modo privado) leitura e escrita são no-op', () => {
    expect(lerLayoutPedido('p', null)).toBeNull();
    expect(() => guardarLayoutPedido('p', LAYOUT_PADRAO, null)).not.toThrow();
  });
});

describe('templates custom', () => {
  it('persiste só os marcados como custom e normaliza na leitura', () => {
    const { storage } = storageFake();
    const lista: VistaTemplate[] = [
      { id: 'v1', nome: 'Fechamento', ordem: ['cadeia', 'matriz'], custom: true },
      { id: 'preset-x', nome: 'Não salva', ordem: ['matriz'] },
    ];
    guardarTemplatesCustom(lista, storage);
    const lidas = lerTemplatesCustom(storage);
    expect(lidas).toHaveLength(1);
    expect(lidas[0]?.nome).toBe('Fechamento');
    expect(lidas[0]?.ordem[0]).toBe('cadeia');
  });

  it('ignora entradas malformadas no storage', () => {
    const { mapa, storage } = storageFake();
    mapa.set(CHAVE_TEMPLATES, JSON.stringify([{ nome: 3 }, null, { id: 'ok', nome: 'Boa', ordem: ['sinais'] }]));
    const lidas = lerTemplatesCustom(storage);
    expect(lidas.map((t) => t.nome)).toEqual(['Boa']);
  });

  it('ordem parcial lida do storage preserva os ocultos ao reaplicar', () => {
    const { storage } = storageFake();
    guardarTemplatesCustom([{ id: 'vp', nome: 'Parcial', ordem: ['matriz', 'sinais'], custom: true }], storage);
    const lida = lerTemplatesCustom(storage)[0]!;
    // A ordem do template é a lista de visíveis: reaplicar deve esconder o
    // resto (antes, normalizarOrdem anexava tudo e a vista não ocultava nada).
    expect(lida.ordem).toEqual(['matriz', 'sinais']);
    expect(aplicarTemplate(lida).ocultos).toHaveLength(CARD_IDS.length - 2);
  });
});

// ---------- V1: chip ativo ignora spans do usuário (spec 0015, bug D-T5) ----------

describe('templateCorrespondente com spans (V1)', () => {
  const todos = [...TEMPLATES_VISTA];

  it('preset continua ativo depois de um clique na pill de largura', () => {
    // Cenário do aceite: aplicar Operação, mexer na largura de um card e o
    // chip precisa continuar correspondendo (antes nunca mais ativava).
    const { ordem, ocultos } = aplicarTemplate(TEMPLATES_VISTA.find((t) => t.id === 'operacao')!);
    expect(templateCorrespondente(ordem, ocultos, todos, { matriz: 3, domino: 1 })).toBe('operacao');
  });

  it('ordem alterada continua desativando o chip mesmo com spans', () => {
    const { ordem, ocultos } = aplicarTemplate(TEMPLATES_VISTA.find((t) => t.id === 'fiscal')!);
    const mexida = moverPorPasso(ordem, 'cadeia', 1);
    expect(templateCorrespondente(mexida, ocultos, todos, { matriz: 2 })).toBeNull();
  });

  it('custom com spans declarados confere largura: desvio desativa, igualdade ativa', () => {
    const custom: VistaTemplate = {
      id: 'v-larg',
      nome: 'Largas',
      ordem: ['matriz', 'tarefas'],
      spans: { matriz: 3, tarefas: 2 },
      custom: true,
    };
    const { ordem, ocultos } = aplicarTemplate(custom);
    // Span fora da declaração (domino) é ajuste livre: não quebra a vista.
    expect(
      templateCorrespondente(ordem, ocultos, [custom], { matriz: 3, tarefas: 2, domino: 4 }),
    ).toBe('v-larg');
    // Span declarado divergente desativa.
    expect(
      templateCorrespondente(ordem, ocultos, [custom], { matriz: 2, tarefas: 2 }),
    ).toBeNull();
    // Sem spans no layout, a vista com largura não corresponde.
    expect(templateCorrespondente(ordem, ocultos, [custom], undefined)).toBeNull();
  });

  it('round-trip: layout persistido com spans ainda corresponde ao preset', () => {
    const { storage } = storageFake();
    const { ordem, ocultos } = aplicarTemplate(TEMPLATES_VISTA.find((t) => t.id === 'atrasos')!);
    const layout: LayoutTorre = { ordem, ocultos, recolhidos: [], spans: { sinais: 2 } };
    guardarLayoutPedido('p-v1', layout, storage);
    const lido = lerLayoutPedido('p-v1', storage);
    expect(lido).not.toBeNull();
    expect(templateCorrespondente(lido!.ordem, lido!.ocultos, todos, lido!.spans)).toBe('atrasos');
  });

  it('recolhidos do template não entram na identidade da vista (ordem+ocultos)', () => {
    const custom: VistaTemplate = {
      id: 'v-rec',
      nome: 'Recolhida',
      ordem: ['matriz', 'sinais'],
      recolhidos: ['sinais'],
      custom: true,
    };
    const { ordem, ocultos } = aplicarTemplate(custom);
    expect(templateCorrespondente(ordem, ocultos, [custom])).toBe('v-rec');
  });
});

// ---------- V4: vista padrão global entre pedidos ----------

describe('vista global (V4)', () => {
  const vista: VistaTemplate = {
    id: 'vg',
    nome: 'Minha global',
    ordem: ['domino', 'matriz'],
    custom: true,
  };

  it('pedido sem layout próprio carrega a vista marcada como global', () => {
    const { storage } = storageFake();
    guardarTemplatesCustom([vista], storage);
    definirVistaGlobal('vg', storage);
    const lido = lerLayoutPedido('ped-novo', storage);
    expect(lido).not.toBeNull();
    expect(lido!.ordem.slice(0, 2)).toEqual(['domino', 'matriz']);
    expect(lido!.ocultos.sort()).toEqual(
      CARD_IDS.filter((c) => c !== 'domino' && c !== 'matriz').sort(),
    );
  });

  it('layout específico do pedido sempre vence a vista global', () => {
    const { storage } = storageFake();
    guardarTemplatesCustom([vista], storage);
    definirVistaGlobal('vg', storage);
    const proprio: LayoutTorre = { ...LAYOUT_PADRAO, ocultos: ['versoes'] };
    guardarLayoutPedido('ped-proprio', proprio, storage);
    expect(lerLayoutPedido('ped-proprio', storage)).toEqual(proprio);
  });

  it('uma única vista global por vez: marcar a segunda desmarca a primeira', () => {
    const { storage } = storageFake();
    const outra: VistaTemplate = { ...vista, id: 'vg2', nome: 'Outra' };
    guardarTemplatesCustom([vista, outra], storage);
    definirVistaGlobal('vg', storage);
    definirVistaGlobal('vg2', storage);
    const metas = lerVistasMeta(storage);
    expect(metas['vg']?.global).toBe(false);
    expect(metas['vg2']?.global).toBe(true);
    const lidas = lerTemplatesCustom(storage);
    expect(lidas.find((t) => t.id === 'vg')?.global).toBe(false);
    expect(lidas.find((t) => t.id === 'vg2')?.global).toBe(true);
  });

  it('sem vista global o pedido novo continua devolvendo null', () => {
    const { storage } = storageFake();
    guardarTemplatesCustom([vista], storage);
    expect(lerLayoutPedido('ped-sem', storage)).toBeNull();
  });

  it('desmarcar (id null) devolve o pedido novo ao padrão', () => {
    const { storage } = storageFake();
    guardarTemplatesCustom([vista], storage);
    definirVistaGlobal('vg', storage);
    definirVistaGlobal(null, storage);
    expect(lerLayoutPedido('ped-sem', storage)).toBeNull();
  });
});

// ---------- V5: vista salva completa (recolhidos + densidade) ----------

describe('vista salva completa (V5)', () => {
  it('aplicarTemplate devolve recolhidos e densidade quando o template declara', () => {
    const t: VistaTemplate = {
      id: 'vc',
      nome: 'Completa',
      ordem: ['matriz', 'sinais'],
      recolhidos: ['sinais', 'fantasma' as CardId],
      densidade: 0,
    };
    const r = aplicarTemplate(t);
    expect(r.recolhidos).toEqual(['sinais']);
    expect(r.densidade).toBe(0);
  });

  it('template que não declara os campos não os devolve (preserva o estado)', () => {
    const r = aplicarTemplate({ id: 'p', nome: 'Parcial', ordem: ['matriz'] });
    expect('recolhidos' in r).toBe(false);
    expect('densidade' in r).toBe(false);
  });

  it('spans {} declarado limpa as larguras (reset do layout padrão)', () => {
    const r = aplicarTemplate(TEMPLATE_LAYOUT_PADRAO);
    expect(r.spans).toEqual({});
    expect(r.recolhidos).toEqual([]);
    expect(r.densidade).toBe(1);
    expect(r.ocultos).toEqual([]);
    expect(r.ordem).toEqual([...CARD_IDS]);
  });

  it('vista antiga sem campos novos continua lendo e aplicando', () => {
    const { mapa, storage } = storageFake();
    mapa.set(CHAVE_TEMPLATES, JSON.stringify([{ id: 'antiga', nome: 'Antiga', ordem: ['cadeia'] }]));
    const lidas = lerTemplatesCustom(storage);
    expect(lidas[0]?.recolhidos).toBeUndefined();
    expect(lidas[0]?.densidade).toBeUndefined();
    const r = aplicarTemplate(lidas[0]!);
    expect(r.ordem[0]).toBe('cadeia');
  });

  it('templates com recolhidos/densidade/global sobrevivem ao round-trip', () => {
    const { storage } = storageFake();
    const completa: VistaTemplate = {
      id: 'v-full',
      nome: 'Completa',
      ordem: ['matriz', 'sinais'],
      spans: { matriz: 2 },
      recolhidos: ['sinais'],
      densidade: 0,
      custom: true,
    };
    guardarTemplatesCustom([completa], storage);
    const lida = lerTemplatesCustom(storage)[0]!;
    expect(lida.recolhidos).toEqual(['sinais']);
    expect(lida.densidade).toBe(0);
    expect(lida.spans).toEqual({ matriz: 2 });
  });
});

// ---------- sidecar de campos de vista (V4/V5) ----------

describe('sidecar de metas de vista', () => {
  it('guarda e lê meta por id; null remove a entrada', () => {
    const { mapa, storage } = storageFake();
    guardarVistaMeta('v1', { recolhidos: ['sinais'], densidade: 2 }, storage);
    expect(JSON.parse(mapa.get(CHAVE_VISTAS_META)!)).toEqual({
      v1: { recolhidos: ['sinais'], densidade: 2 },
    });
    guardarVistaMeta('v1', null, storage);
    expect(lerVistasMeta(storage)).toEqual({});
  });

  it('lerTemplatesCustom mescla o sidecar nos templates', () => {
    const { storage } = storageFake();
    guardarTemplatesCustom([{ id: 'vm', nome: 'Meta', ordem: ['matriz'], custom: true }], storage);
    guardarVistaMeta('vm', { recolhidos: ['cadeia'], densidade: 0, global: true }, storage);
    const lida = lerTemplatesCustom(storage)[0]!;
    expect(lida.recolhidos).toEqual(['cadeia']);
    expect(lida.densidade).toBe(0);
    expect(lida.global).toBe(true);
  });

  it('mesclarMetaTemplate: campo declarado no template vence o sidecar', () => {
    const t: VistaTemplate = { id: 'x', nome: 'X', ordem: ['matriz'], densidade: 2, custom: true };
    const m = mesclarMetaTemplate(t, { densidade: 0, recolhidos: ['sinais'], global: true });
    expect(m.densidade).toBe(2);
    expect(m.recolhidos).toEqual(['sinais']);
    expect(m.global).toBe(true);
  });

  it('json corrompido do sidecar devolve {} em vez de quebrar', () => {
    const { mapa, storage } = storageFake();
    mapa.set(CHAVE_VISTAS_META, '{lixo');
    expect(lerVistasMeta(storage)).toEqual({});
  });
});

// ---------- snapshot para Desfazer (V3) ----------

describe('templateDeLayout (snapshot de Desfazer)', () => {
  it('reaplicar o snapshot restaura o layout inteiro pelo merge', () => {
    const original: LayoutTorre = {
      ordem: ['domino', 'matriz', 'tarefas', 'sinais', 'cadeia', 'simulador', 'versoes'],
      ocultos: ['versoes', 'simulador'],
      recolhidos: ['sinais'],
      spans: { matriz: 3 },
      densidade: 0,
    };
    const snap = aplicarTemplate(templateDeLayout(original));
    expect(snap.ordem.slice(0, 5)).toEqual(['domino', 'matriz', 'tarefas', 'sinais', 'cadeia']);
    expect(snap.ocultos.sort()).toEqual(['simulador', 'versoes']);
    expect(snap.recolhidos).toEqual(['sinais']);
    expect(snap.spans).toEqual({ matriz: 3 });
    expect(snap.densidade).toBe(0);
  });

  it('layout sem spans gera snapshot que limpa larguras ao reaplicar', () => {
    const snap = aplicarTemplate(templateDeLayout({ ...LAYOUT_PADRAO }));
    expect(snap.spans).toEqual({});
    expect(snap.recolhidos).toEqual([]);
  });

  it('templateParaLayout materializa uma vista como layout completo', () => {
    const l = templateParaLayout({
      id: 't',
      nome: 'T',
      ordem: ['domino'],
      recolhidos: ['domino'],
      densidade: 2,
    });
    expect(l.ordem[0]).toBe('domino');
    expect(l.recolhidos).toEqual(['domino']);
    expect(l.densidade).toBe(2);
    expect(l.ocultos).toHaveLength(CARD_IDS.length - 1);
  });
});
