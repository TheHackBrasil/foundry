import { describe, expect, it } from 'vitest';
import {
  CARD_IDS,
  CHAVE_TEMPLATES,
  LAYOUT_PADRAO,
  TEMPLATES_VISTA,
  aplicarTemplate,
  assinaturaVista,
  chaveLayoutPedido,
  guardarLayoutPedido,
  guardarTemplatesCustom,
  inserirEm,
  lerLayoutPedido,
  lerTemplatesCustom,
  moverPorPasso,
  normalizarLayout,
  normalizarOrdem,
  templateCorrespondente,
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
});
