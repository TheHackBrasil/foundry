// Compositor GenUI do agente (spec 0009, RF15): traduz o que as tools
// estruturaram na trilha para as OpcoesViewSpecV2 certas, compoe a visao
// deterministica e garante que todo bloco sinalizado exista na spec final —
// o que o layout nao produziu sozinho e sintetizado aqui com os mesmos
// fatos da projecao (rotulos e rascunhos vem do viewspec, nunca da LLM).
// A ordem de emissao segue a prioridade declarada pelas tools.

import {
  CAMPOS_VIGIADOS,
  PARTES,
  type BlocoGenUI,
  type CampoVigiado,
  type FonteDocumento,
  type Parte,
  type ProjecaoPedido,
  type TipoBlocoGenUI,
  type ViewSpecV2,
} from '../../shared/model.js';
import {
  NOTA_REGRA_CAMPO,
  ROTULO_CAMPO,
  ROTULO_PARTE,
  comporViewSpecV2Deterministico,
  construirRascunhosDespacho,
  type OpcoesViewSpecV2,
} from '../viewspec.js';

export interface EntradaGenUI {
  proj: ProjecaoPedido;
  pergunta: string;
  // Prioridade de exibicao, uniao ordenada dos blocosSugeridos do loop.
  sugestoes: readonly TipoBlocoGenUI[];
  // Dados estruturados da ultima execucao relevante de cada tool
  // (chaves: simulacao, notificacao, despacho, setores, comparacao,
  // consulta, propagacao, auditoria).
  resultado: Record<string, unknown>;
}

export interface SaidaGenUI {
  viewSpec: ViewSpecV2;
  blocos: BlocoGenUI[]; // emitidos como evento 'bloco' na ordem das sugestoes
}

type ResultadoComParte = { parte?: Parte } | undefined;

type ComparacaoTool =
  | {
      campo?: CampoVigiado;
      comparacoes?: Array<{ campo: CampoVigiado; porFonte: Array<{ fonte: FonteDocumento }> }>;
    }
  | undefined;

function campoDaComparacao(comp: ComparacaoTool): CampoVigiado | undefined {
  return comp?.campo ?? comp?.comparacoes?.[0]?.campo;
}

// Acao e lente saem da ultima tool relevante do loop: simulacao e despacho
// mudam o layout inteiro; setores so escolhem o papel da lente de decisao.
// A recusa seed_somente_leitura tambem carrega parte: os cartoes do exemplo
// continuam compondo a visao mesmo com a escrita bloqueada.
function opcoesDaTrilha(entrada: EntradaGenUI): OpcoesViewSpecV2 {
  const opcoes: OpcoesViewSpecV2 = { pergunta: entrada.pergunta.slice(0, 400) };
  const sim = entrada.resultado['simulacao'] as
    | { hipotese?: { campo?: CampoVigiado; valor?: string | number } }
    | undefined;
  const notif = entrada.resultado['notificacao'] as ResultadoComParte;
  const desp = entrada.resultado['despacho'] as ResultadoComParte;
  const setores = entrada.resultado['setores'] as ResultadoComParte;
  if (sim) {
    opcoes.acao = 'simular';
    if (sim.hipotese?.campo) opcoes.campoSimulado = sim.hipotese.campo;
    if (sim.hipotese?.valor !== undefined) opcoes.valorSimulado = sim.hipotese.valor;
  } else if (notif ?? desp) {
    opcoes.acao = 'notificar';
    const papel = notif?.parte ?? desp?.parte;
    if (papel) opcoes.papel = papel;
  } else if (setores?.parte) {
    opcoes.papel = setores.parte;
  }
  const comp = entrada.resultado['comparacao'] as ComparacaoTool;
  const campo = campoDaComparacao(comp);
  if (campo) opcoes.campoFoco = campo;
  return opcoes;
}

// Papel do checklist quando a tool nao carrega o seu (propagacao): o setor
// com mais tarefas abertas e o que mais precisa de checklist.
function parteMaisCobrada(proj: ProjecaoPedido): Parte | undefined {
  const contagem = new Map<Parte, number>();
  for (const t of proj.tarefas) contagem.set(t.parte, (contagem.get(t.parte) ?? 0) + 1);
  let melhor: Parte | undefined;
  let topo = 0;
  for (const parte of PARTES) {
    const n = contagem.get(parte) ?? 0;
    if (n > topo) {
      topo = n;
      melhor = parte;
    }
  }
  return melhor;
}

function sintetizarConflito(proj: ProjecaoPedido, comp: ComparacaoTool): BlocoGenUI | null {
  const campoAlvo = campoDaComparacao(comp);
  const d = campoAlvo ? proj.divergencias.find((x) => x.campo === campoAlvo) : proj.divergencias[0];
  if (d) {
    return {
      id: `conflito-${d.campo}-${d.fonteA}-${d.fonteB}`,
      tipo: 'comparador_conflito',
      titulo: `Conflito de ${ROTULO_CAMPO[d.campo]}`,
      campo: d.campo,
      fonteA: d.fonteA,
      fonteB: d.fonteB,
      notaRegra: NOTA_REGRA_CAMPO[d.campo],
    };
  }
  // Sem divergencia formal: o comparador mostra as duas primeiras fontes
  // que declararam o campo, lado a lado com os valores reais.
  const fontesDeclaradas = campoAlvo
    ? [...new Set(proj.versoes.filter((v) => v.campos[campoAlvo] !== undefined).map((v) => v.fonte))]
    : [];
  const [fonteA, fonteB] = fontesDeclaradas;
  if (campoAlvo && fonteA && fonteB) {
    return {
      id: `conflito-${campoAlvo}-${fonteA}-${fonteB}`,
      tipo: 'comparador_conflito',
      titulo: `Comparativo de ${ROTULO_CAMPO[campoAlvo]}`,
      campo: campoAlvo,
      fonteA,
      fonteB,
    };
  }
  return null;
}

function sintetizarMatriz(proj: ProjecaoPedido, campoFoco: CampoVigiado | undefined): BlocoGenUI | null {
  const fontesDeclaradas = campoFoco
    ? [...new Set(proj.versoes.filter((v) => v.campos[campoFoco] !== undefined).map((v) => v.fonte))]
    : [...new Set(proj.versoes.map((v) => v.fonte))];
  if (fontesDeclaradas.length === 0) return null;
  const camposDivergentes = [...new Set(proj.divergencias.map((d) => d.campo))];
  const colunas = campoFoco
    ? [campoFoco, ...camposDivergentes.filter((c) => c !== campoFoco)].slice(0, 3)
    : camposDivergentes.length > 0
      ? camposDivergentes
      : [...CAMPOS_VIGIADOS];
  const celulasDestacadas: Array<{ campo: CampoVigiado; fonte: FonteDocumento }> = [];
  for (const fonte of fontesDeclaradas) {
    if (campoFoco && celulasDestacadas.length < 4) celulasDestacadas.push({ campo: campoFoco, fonte });
  }
  return {
    id: `matriz-${campoFoco ?? 'geral'}`,
    tipo: 'matriz_focada',
    titulo: campoFoco ? `Matriz de ${ROTULO_CAMPO[campoFoco]} entre fontes` : 'Matriz entre fontes',
    fontesVisiveis: fontesDeclaradas,
    colunas,
    celulasDestacadas,
    destacarDivergencias: true,
  };
}

function sintetizarChecklist(proj: ProjecaoPedido, parte: Parte | undefined): BlocoGenUI | null {
  if (!parte) return null;
  const camposDivergentes = [...new Set(proj.divergencias.map((d) => d.campo))];
  return {
    id: `checklist-${parte}`,
    tipo: 'checklist_papel',
    titulo: `Checklist — ${ROTULO_PARTE[parte]}`,
    parte,
    camposPrioritarios: camposDivergentes.length > 0 ? camposDivergentes : [...CAMPOS_VIGIADOS],
  };
}

function sintetizarDespacho(proj: ProjecaoPedido, papel: Parte | undefined): BlocoGenUI | null {
  const rascunhos = construirRascunhosDespacho(proj, papel);
  // Mesmo sem tarefa, o cartao da parte pedida abre editavel com a mensagem
  // generica do front: e a orientacao util em pedido consistente ou seed.
  if (rascunhos.length === 0 && !papel) return null;
  return {
    id: 'despacho',
    tipo: 'cartoes_despacho',
    titulo: 'Cartões de despacho',
    partes: rascunhos.length > 0 ? rascunhos.map((r) => r.parte) : [papel!],
    rascunhos,
  };
}

function sintetizarDomino(proj: ProjecaoPedido): BlocoGenUI {
  const campos: CampoVigiado[] =
    proj.divergencias.length > 0 ? [...new Set(proj.divergencias.map((d) => d.campo))] : [...CAMPOS_VIGIADOS];
  return {
    id: 'domino',
    tipo: 'domino_impacto',
    titulo: 'Cascata de impacto por parte',
    camposFoco: campos,
    partesFoco: [...new Set(proj.tarefas.map((t) => t.parte))],
    modo: 'atual',
  };
}

function sintetizarLinhaTempo(proj: ProjecaoPedido, campoFoco: CampoVigiado | undefined): BlocoGenUI {
  const foco = campoFoco ?? proj.divergencias[0]?.campo;
  return {
    id: 'linha-tempo',
    tipo: 'linha_tempo_causal',
    titulo: 'Linha do tempo causal',
    ...(foco ? { campoFoco: foco } : {}),
    incluirSinais: proj.sinais.length > 0,
  };
}

export function comporGenUIAgente(entrada: EntradaGenUI): SaidaGenUI {
  const { proj } = entrada;
  const opcoes = opcoesDaTrilha(entrada);
  const viewSpec = comporViewSpecV2Deterministico(proj, opcoes);
  const comp = entrada.resultado['comparacao'] as ComparacaoTool;
  const campoFoco = opcoes.campoSimulado ?? campoDaComparacao(comp);
  const papel = opcoes.papel ?? parteMaisCobrada(proj);

  // Fabrica preguicosa por tipo sugerido: so sintetiza o que o layout nao
  // produziu, sempre a partir de fatos da projecao.
  const sintetizar: Partial<Record<TipoBlocoGenUI, () => BlocoGenUI | null>> = {
    comparador_conflito: () => sintetizarConflito(proj, comp),
    matriz_focada: () => sintetizarMatriz(proj, campoFoco),
    checklist_papel: () => sintetizarChecklist(proj, papel),
    cartoes_despacho: () => sintetizarDespacho(proj, opcoes.papel),
    domino_impacto: () => sintetizarDomino(proj),
    linha_tempo_causal: () => sintetizarLinhaTempo(proj, campoFoco),
  };

  const emitidos: BlocoGenUI[] = [];
  const vistos = new Set<string>();
  for (const tipo of entrada.sugestoes) {
    const prontos = viewSpec.blocos.filter((b) => b.tipo === tipo && !vistos.has(b.id));
    for (const b of prontos) {
      emitidos.push(b);
      vistos.add(b.id);
    }
    if (prontos.length === 0) {
      const novo = sintetizar[tipo]?.();
      if (novo && !vistos.has(novo.id)) {
        emitidos.push(novo);
        vistos.add(novo.id);
      }
    }
  }

  // Sem sugestao atendida, mantem o primeiro bloco composto (comportamento
  // do fluxo anterior). Quando ha sugestao, a spec final carrega exatamente
  // os blocos emitidos: o front privilegia spec.blocos sobre o stream, entao
  // guardar bloco extra aqui desfaz a curadoria das tools.
  const blocosFinais = emitidos.length > 0 ? emitidos : viewSpec.blocos.slice(0, 1);
  return { viewSpec: { ...viewSpec, blocos: blocosFinais }, blocos: blocosFinais };
}
