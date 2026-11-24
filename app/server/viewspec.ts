// View-spec (spec 0007, RF9) e compositor GenUI v2: a LLM sugere ou refina a
// visao do pedido; o servidor valida contra o schema, enums e fatos do ledger
// antes de devolver. Sem LLM, envelope ruim ou spec fora do schema, o padrao
// deterministico responde: essa rota nunca devolve 500 por causa da LLM.

import { simularHipotese } from '../shared/divergence.js';
import { formatarData, formatarValor, rotuloFonte, rotuloStatus } from '../shared/formato.js';
import {
  CAMPOS_VIGIADOS,
  FONTES_DOCUMENTO,
  PARTES,
  type AcaoMandato,
  type BlocoGenUI,
  type CamposObservados,
  type CampoVigiado,
  type CitacaoFactual,
  type Divergencia,
  type FollowUpContextual,
  type FonteDocumento,
  type Parte,
  type ProjecaoPedido,
  type ViewSpec,
  type ViewSpecV2,
} from '../shared/model.js';
import { propagar, propagarTodas } from '../shared/rules.js';
import { chatJson, llmConfigDoEnv } from './llm.js';

const FONTES_SET = new Set<string>(FONTES_DOCUMENTO);
const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);
const PARTES_SET = new Set<string>(PARTES);

const ROTULO_CAMPO: Record<CampoVigiado, string> = {
  previsaoEntrega: 'Previsão de entrega',
  pesoTotal: 'Peso total',
  volumes: 'Volumes',
  status: 'Status',
};

const ROTULO_PARTE: Record<Parte, string> = {
  fornecedor: 'Fornecedor',
  transportadora: 'Transportadora',
  cd: 'CD',
  fiscal: 'Fiscal',
  financeiro: 'Financeiro',
};

const ARTIGO_PARTE: Record<Parte, string> = {
  fornecedor: 'o fornecedor',
  transportadora: 'a transportadora',
  cd: 'o CD',
  fiscal: 'o fiscal',
  financeiro: 'o financeiro',
};

const CAMPOS_POR_PAPEL: Record<Parte, readonly CampoVigiado[]> = {
  fornecedor: ['previsaoEntrega', 'status', 'pesoTotal', 'volumes'],
  transportadora: ['previsaoEntrega', 'pesoTotal', 'volumes', 'status'],
  cd: ['previsaoEntrega', 'volumes', 'status', 'pesoTotal'],
  fiscal: ['pesoTotal', 'status', 'previsaoEntrega', 'volumes'],
  financeiro: ['previsaoEntrega', 'pesoTotal', 'status', 'volumes'],
};

const FONTES_PREFERIDAS_PAPEL: Record<Parte, readonly FonteDocumento[]> = {
  fornecedor: ['nfe', 'planilha', 'cte', 'pdf', 'imap'],
  transportadora: ['nfe', 'cte', 'planilha', 'pdf'],
  cd: ['nfe', 'planilha', 'cte', 'pdf'],
  fiscal: ['nfe', 'cte', 'cce', 'planilha', 'pdf'],
  financeiro: ['nfe', 'cte', 'planilha', 'pdf'],
};

// Notas factuais alinhadas as regras deterministicas de rules.ts e divergence.ts.
const NOTA_REGRA_CAMPO: Record<CampoVigiado, string> = {
  previsaoEntrega:
    'Regra fiscal (R-006): a CC-e não corrige data de saída e o cancelamento da NF-e só cabe em até 24 h sem circulação da mercadoria; atraso entra pela planilha e propaga tarefas para as 5 partes.',
  pesoTotal:
    'Tolerância determinística de 0,01 kg entre fontes; diferenças acima desse limite disparam checagem de tara, conferência fiscal NF-e × CT-e e recálculo de frete.',
  volumes:
    'Divergência de volumes dispara conferência física no recebimento do CD e conferência de romaneio na transportadora.',
  status:
    'Divergência de status (como atraso ou cancelamento) exige validação na SEFAZ, revisão de provisão financeira e realinhamento de doca e rota.',
};

// Visao padrao v1: todas as fontes, todas as colunas, lente do papel pedido.
export function viewSpecPadrao(papel: Parte): ViewSpec {
  return {
    versao: 1,
    fontesVisiveis: [...FONTES_DOCUMENTO],
    colunas: [...CAMPOS_VIGIADOS],
    lente: papel,
    destacarDivergencias: true,
  };
}

// Aceita so o que o front sabe renderizar: enums conhecidos, sem componente
// inventado. Dedup de arrays; qualquer falha devolve null (padrao fora).
export function validarViewSpec(json: unknown): ViewSpec | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (r['versao'] !== 1) return null;
  if (!Array.isArray(r['fontesVisiveis']) || r['fontesVisiveis'].length === 0) return null;
  if (!Array.isArray(r['colunas']) || r['colunas'].length === 0) return null;
  if (typeof r['lente'] !== 'string' || !PARTES_SET.has(r['lente'])) return null;
  if (typeof r['destacarDivergencias'] !== 'boolean') return null;
  const fontes = [...new Set(r['fontesVisiveis'])];
  const colunas = [...new Set(r['colunas'])];
  if (fontes.some((f) => typeof f !== 'string' || !FONTES_SET.has(f))) return null;
  if (colunas.some((c) => typeof c !== 'string' || !CAMPOS_SET.has(c))) return null;
  return {
    versao: 1,
    fontesVisiveis: fontes as FonteDocumento[],
    colunas: colunas as CampoVigiado[],
    lente: r['lente'] as Parte,
    destacarDivergencias: r['destacarDivergencias'],
  };
}

const PROMPT = `Voce monta a especificacao de visao (GenUI) de um pedido logistico para um papel especifico.
Responda APENAS JSON:
{"versao": 1, "fontesVisiveis": FonteDocumento[], "colunas": CampoVigiado[], "lente": Parte, "destacarDivergencias": boolean}
Enums: FonteDocumento em nfe|cte|cce|planilha|pdf|imap|manual; CampoVigiado em previsaoEntrega|pesoTotal|volumes|status; Parte em fornecedor|transportadora|cd|fiscal|financeiro.
Filtre de verdade para reduzir ruido cognitivo — cada papel decide coisas diferentes (use apenas fontes presentes no pedido):
- fornecedor: foca na divergencia entre a NF-e emitida e o reportado (ex.: nfe + planilha ou cte; campos com divergencia relevante para o emissor).
- transportadora: foca em entrega, rota e carga (ex.: nfe, cte, planilha; colunas previsaoEntrega, pesoTotal, volumes, status — omita cce fiscal).
- cd: foca em doca e recebimento fisico (ex.: nfe, planilha; colunas previsaoEntrega, volumes, status — omita cce).
- fiscal: foca nos documentos fiscais (nfe, cte, cce; colunas pesoTotal, volumes, status — omita planilha e previsaoEntrega).
- financeiro: foca em faturamento, frete e multa/SLA (nfe, cte, planilha; colunas pesoTotal, previsaoEntrega, status — omita cce e volumes).
Mantenha pelo menos 1 fonte presente e 1 coluna. Destaque divergencias quando importam para o papel.
Pedido:
`;

// Gera e valida v1; qualquer desvio cai no padrao deterministico.
export async function gerarViewSpec(proj: ProjecaoPedido, papel: Parte): Promise<ViewSpec> {
  if (!llmConfigDoEnv()) return viewSpecPadrao(papel);
  try {
    const contexto = {
      pedidoId: proj.pedido?.id ?? null,
      papel,
      fontesPresentes: [...new Set(proj.versoes.map((v) => v.fonte))],
      campos: proj.pedido?.campos ?? {},
      divergencias: proj.divergencias.map((d) => d.campo),
      tarefasPorParte: proj.tarefas.reduce<Record<string, number>>((acc, t) => {
        acc[t.parte] = (acc[t.parte] ?? 0) + 1;
        return acc;
      }, {}),
    };
    const json = await chatJson([{ role: 'user', content: PROMPT + JSON.stringify(contexto) }], { maxTokens: 300 });
    return validarViewSpec(json) ?? viewSpecPadrao(papel);
  } catch {
    return viewSpecPadrao(papel);
  }
}

export interface OpcoesViewSpecV2 {
  papel?: Parte;
  pergunta?: string;
  acao?: AcaoMandato;
  resumoTexto?: string;
  resumoVia?: 'llm' | 'deterministico';
  campoSimulado?: CampoVigiado;
  valorSimulado?: string | number;
}

function valorComUnidade(campo: CampoVigiado, valor: unknown): string {
  const texto = formatarValor(campo, valor);
  return campo === 'pesoTotal' && texto !== '?' ? `${texto} kg` : texto;
}

// Mescla campos declarados por fonte nas versoes: preserva campos de eventos
// anteriores da mesma fonte e identifica fontes realmente populadas.
function camposDeclaradosPorFonte(proj: ProjecaoPedido): Map<FonteDocumento, CamposObservados> {
  const mapa = new Map<FonteDocumento, CamposObservados>();
  for (const v of proj.versoes) {
    const anterior = mapa.get(v.fonte) ?? {};
    const mesclado: CamposObservados = { ...anterior };
    for (const [k, val] of Object.entries(v.campos)) {
      if (val !== undefined) (mesclado as Record<string, unknown>)[k] = val;
    }
    mapa.set(v.fonte, mesclado);
  }
  return mapa;
}

function fontesComValoresDeclarados(camposPorF: Map<FonteDocumento, CamposObservados>): FonteDocumento[] {
  const out: FonteDocumento[] = [];
  for (const [fonte, campos] of camposPorF.entries()) {
    if (Object.values(campos).some((v) => v !== undefined)) out.push(fonte);
  }
  return out;
}

function divergenciasUnicas(proj: ProjecaoPedido): Divergencia[] {
  const mapa = new Map<string, Divergencia>();
  for (const d of proj.divergencias) {
    mapa.set(`${d.campo}|${d.fonteA}|${d.fonteB}`, d);
  }
  return [...mapa.values()];
}

function campoMencionado(pergunta?: string): CampoVigiado | undefined {
  if (!pergunta) return undefined;
  const p = pergunta
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (/\b(peso|quilo|kg|tara|frete)\b/.test(p)) return 'pesoTotal';
  if (/\b(volume|volumes|caixa|caixas|romaneio)\b/.test(p)) return 'volumes';
  if (/\b(status|cancelad|cancelamento|transito|situacao)\b/.test(p)) return 'status';
  if (/\b(atras|entrega|previs|data|prazo|eta|doca)\b/.test(p)) return 'previsaoEntrega';
  return undefined;
}

function divergenciaAfetaPapel(d: Divergencia, proj: ProjecaoPedido, papel: Parte): boolean {
  if (
    proj.tarefas.some(
      (t) =>
        t.parte === papel &&
        t.divergencia.campo === d.campo &&
        t.divergencia.fonteA === d.fonteA &&
        t.divergencia.fonteB === d.fonteB,
    )
  ) {
    return true;
  }
  return propagar(d).some((t) => t.parte === papel);
}

function priorizarDivergencias(
  divs: Divergencia[],
  proj: ProjecaoPedido,
  papel: Parte | undefined,
  campoFoco: CampoVigiado | undefined,
): Divergencia[] {
  const ordemCampos = papel ? CAMPOS_POR_PAPEL[papel] : CAMPOS_VIGIADOS;
  return [...divs].sort((a, b) => {
    if (papel) {
      const aPapel = divergenciaAfetaPapel(a, proj, papel) ? 0 : 1;
      const bPapel = divergenciaAfetaPapel(b, proj, papel) ? 0 : 1;
      if (aPapel !== bPapel) return aPapel - bPapel;
    }
    if (campoFoco) {
      const aFoco = a.campo === campoFoco ? 0 : 1;
      const bFoco = b.campo === campoFoco ? 0 : 1;
      if (aFoco !== bFoco) return aFoco - bFoco;
    }
    return ordemCampos.indexOf(a.campo) - ordemCampos.indexOf(b.campo);
  });
}

// Validacao server-side anti-alucinacao: toda citacao precisa apontar para um
// fato realmente presente no ledger projetado.
function citacaoValidaNoLedger(
  cit: CitacaoFactual,
  proj: ProjecaoPedido,
  camposPorF: Map<FonteDocumento, CamposObservados>,
): boolean {
  const alvo = cit.alvo;
  switch (alvo.tipo) {
    case 'divergencia':
      return proj.divergencias.some(
        (d) => d.campo === alvo.campo && d.fonteA === alvo.fonteA && d.fonteB === alvo.fonteB,
      );
    case 'celula':
      return camposPorF.get(alvo.fonte)?.[alvo.campo] !== undefined;
    case 'parte':
      return PARTES_SET.has(alvo.parte);
    case 'versao':
      return proj.versoes.some((v) => v.versao === alvo.versao);
    case 'sinal':
      return Number.isInteger(alvo.indice) && alvo.indice >= 0 && alvo.indice < proj.sinais.length;
  }
}

function fonteAtualDoCampo(proj: ProjecaoPedido, campo: CampoVigiado): { fonte: FonteDocumento; valor: unknown } | null {
  let achado: { fonte: FonteDocumento; valor: unknown } | null = null;
  for (const v of proj.versoes) {
    const val = v.campos[campo];
    if (val !== undefined) achado = { fonte: v.fonte, valor: val };
  }
  return achado;
}

function construirCitacoesFactuais(
  proj: ProjecaoPedido,
  camposPorF: Map<FonteDocumento, CamposObservados>,
  divsPrioritarias: Divergencia[],
  opcoes: OpcoesViewSpecV2,
): CitacaoFactual[] {
  const lista: CitacaoFactual[] = [];
  const chavesVistas = new Set<string>();

  const adicionar = (chave: string, rotulo: string, alvo: CitacaoFactual['alvo']): void => {
    if (chavesVistas.has(chave)) return;
    const candidata: CitacaoFactual = { id: `c${lista.length + 1}`, rotulo, alvo };
    if (!citacaoValidaNoLedger(candidata, proj, camposPorF)) return;
    chavesVistas.add(chave);
    lista.push(candidata);
  };

  // Na simulacao, a celula atual do campo simulado e a referencia principal.
  if (opcoes.acao === 'simular' && opcoes.campoSimulado) {
    const atual = fonteAtualDoCampo(proj, opcoes.campoSimulado);
    if (atual) {
      adicionar(
        `celula:${atual.fonte}:${opcoes.campoSimulado}`,
        `${rotuloFonte(atual.fonte)} · ${ROTULO_CAMPO[opcoes.campoSimulado]} ${valorComUnidade(opcoes.campoSimulado, atual.valor)}`,
        { tipo: 'celula', campo: opcoes.campoSimulado, fonte: atual.fonte },
      );
    }
  }

  // Divergencias reais priorizadas.
  for (const d of divsPrioritarias.slice(0, 3)) {
    adicionar(
      `div:${d.campo}:${d.fonteA}:${d.fonteB}`,
      `${ROTULO_CAMPO[d.campo]}: ${rotuloFonte(d.fonteA)} (${valorComUnidade(d.campo, d.valorA)}) × ${rotuloFonte(d.fonteB)} (${valorComUnidade(d.campo, d.valorB)})`,
      { tipo: 'divergencia', campo: d.campo, fonteA: d.fonteA, fonteB: d.fonteB },
    );
  }

  // Quando o pedido esta consistente (ou com poucas divergencias), ancora nas celulas reais.
  if (lista.length < 2) {
    const ordemCampos = opcoes.papel ? CAMPOS_POR_PAPEL[opcoes.papel] : CAMPOS_VIGIADOS;
    for (const campo of ordemCampos) {
      if (lista.length >= 3) break;
      const atual = fonteAtualDoCampo(proj, campo);
      if (!atual) continue;
      adicionar(
        `celula:${atual.fonte}:${campo}`,
        `${rotuloFonte(atual.fonte)} · ${ROTULO_CAMPO[campo]} ${valorComUnidade(campo, atual.valor)}`,
        { tipo: 'celula', campo, fonte: atual.fonte },
      );
    }
  }

  if (opcoes.papel) {
    const qtd = proj.tarefas.filter((t) => t.parte === opcoes.papel).length;
    adicionar(
      `parte:${opcoes.papel}`,
      `${ROTULO_PARTE[opcoes.papel]} · ${qtd} ${qtd === 1 ? 'tarefa' : 'tarefas'}`,
      { tipo: 'parte', parte: opcoes.papel },
    );
  }

  if (proj.sinais.length > 0) {
    const idx = proj.sinais.length - 1;
    const sinal = proj.sinais[idx]!;
    adicionar(
      `sinal:${idx}`,
      `Sinal (${rotuloFonte(sinal.fonte)}): ${sinal.resumo.slice(0, 56)}`,
      { tipo: 'sinal', indice: idx },
    );
  }

  if (lista.length === 0 && proj.versoes.length > 0) {
    const v = proj.versoes[0]!;
    adicionar(`versao:${v.versao}`, `v${v.versao} · ${rotuloFonte(v.fonte)}`, { tipo: 'versao', versao: v.versao });
  }

  return lista;
}

function sanitizarMarcadoresCorpo(corpo: string, citacoes: CitacaoFactual[]): string {
  const validos = new Set(citacoes.map((c) => c.id));
  const limpo = corpo.replace(/\[\[([^\]]+)\]\]/g, (match, id: string) => (validos.has(id) ? match : '')).replace(/\s{2,}/g, ' ').trim();
  const temValido = /\[\[c\d+\]\]/.test(limpo);
  if (temValido || citacoes.length === 0) return limpo;
  const refs = citacoes
    .slice(0, 3)
    .map((c) => `[[${c.id}]]`)
    .join(' ');
  return `${limpo} Evidências: ${refs}.`;
}

function construirResumoCorpoDeterministico(
  proj: ProjecaoPedido,
  fontesAtivas: FonteDocumento[],
  divsPrioritarias: Divergencia[],
  citacoes: CitacaoFactual[],
  opcoes: OpcoesViewSpecV2,
  simResultado?: { divs: Divergencia[]; partes: Parte[]; tarefas: number },
): string {
  if (opcoes.resumoTexto && opcoes.resumoTexto.trim()) {
    return sanitizarMarcadoresCorpo(opcoes.resumoTexto.trim(), citacoes);
  }

  const emitente =
    proj.pedido && proj.pedido.emitente.nome !== '?' ? proj.pedido.emitente.nome : 'o fornecedor';
  const citParte = citacoes.find((c) => c.alvo.tipo === 'parte');
  const citSinal = citacoes.find((c) => c.alvo.tipo === 'sinal');
  const citsDiv = citacoes.filter((c) => c.alvo.tipo === 'divergencia');
  const citsCel = citacoes.filter((c) => c.alvo.tipo === 'celula');

  if (opcoes.acao === 'simular' && opcoes.campoSimulado) {
    const valorTxt =
      opcoes.valorSimulado !== undefined ? valorComUnidade(opcoes.campoSimulado, opcoes.valorSimulado) : 'hipotético';
    const refBase = citsCel[0] ? ` frente ao valor atual [[${citsCel[0].id}]]` : '';
    const qtdDivs = simResultado?.divs.length ?? 0;
    const qtdTarefas = simResultado?.tarefas ?? 0;
    const partesTxt =
      simResultado && simResultado.partes.length > 0
        ? simResultado.partes.map((p) => ROTULO_PARTE[p]).join(', ')
        : 'nenhuma parte adicional';
    return (
      `Simulação sem gravação no ledger: ${ROTULO_CAMPO[opcoes.campoSimulado]} em ${valorTxt}${refBase} ` +
      `gera ${qtdDivs} divergência(s) e ${qtdTarefas} tarefa(s) para ${partesTxt}.`
    );
  }

  if (opcoes.papel) {
    const tarefasPapel = proj.tarefas.filter((t) => t.parte === opcoes.papel);
    const divsPapel = divsPrioritarias.filter((d) => divergenciaAfetaPapel(d, proj, opcoes.papel!));
    const refParte = citParte ? ` [[${citParte.id}]]` : '';
    const refSinal = citSinal ? ` Há também sinal consultivo registrado [[${citSinal.id}]].` : '';

    if (divsPapel.length > 0) {
      const refs = citsDiv
        .slice(0, 2)
        .map((c) => `[[${c.id}]]`)
        .join(' e ');
      return (
        `Lente ${ROTULO_PARTE[opcoes.papel]} para ${emitente}: ${tarefasPapel.length} tarefa(s) aberta(s)${refParte} ` +
        `originada(s) por ${divsPapel.length} divergência(s) relevante(s) (${refs}).${refSinal}`
      );
    }

    if (divsPrioritarias.length > 0) {
      const refDiv = citsDiv[0] ? ` [[${citsDiv[0].id}]]` : '';
      return (
        `Lente ${ROTULO_PARTE[opcoes.papel]} para ${emitente}: nenhuma tarefa pendente para esta parte${refParte}, ` +
        `embora existam ${divsPrioritarias.length} divergência(s) em outras frentes${refDiv}.${refSinal}`
      );
    }

    const refsCel = citsCel
      .slice(0, 2)
      .map((c) => `[[${c.id}]]`)
      .join(' e ');
    return (
      `Lente ${ROTULO_PARTE[opcoes.papel]} para ${emitente}: pedido consistente sem divergências entre ` +
      `${fontesAtivas.map(rotuloFonte).join(' e ') || 'as fontes'}${refsCel ? ` (${refsCel})` : ''}${refParte}.`
    );
  }

  const statusAtual = proj.pedido?.campos.status ? rotuloStatus(proj.pedido.campos.status) : 'em acompanhamento';
  const refSinal = citSinal ? ` Sinal consultivo ativo [[${citSinal.id}]].` : '';
  if (divsPrioritarias.length > 0) {
    const refs = citsDiv
      .slice(0, 2)
      .map((c) => `[[${c.id}]]`)
      .join(' e ');
    return (
      `Pedido de ${emitente} (${statusAtual}) registra ${divsPrioritarias.length} divergência(s) entre ` +
      `${fontesAtivas.map(rotuloFonte).join(', ')} e ${proj.tarefas.length} tarefa(s) propagada(s), com foco em ${refs}.${refSinal}`
    );
  }

  const refsCel = citsCel
    .slice(0, 2)
    .map((c) => `[[${c.id}]]`)
    .join(' e ');
  return (
    `Pedido de ${emitente} (${statusAtual}) está consistente entre ${fontesAtivas.map(rotuloFonte).join(' e ') || 'as fontes'}` +
    `${refsCel ? ` (${refsCel})` : ''}, com 0 divergências e 0 tarefas pendentes.${refSinal}`
  );
}

function somarDiasIso(iso: string, dias: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const base = Date.UTC(ano, mes - 1, dia);
  const check = new Date(base);
  if (check.getUTCFullYear() !== ano || check.getUTCMonth() !== mes - 1 || check.getUTCDate() !== dia) {
    return null;
  }
  const d = new Date(base + dias * 86_400_000);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function construirRascunhosDespacho(
  proj: ProjecaoPedido,
  papel?: Parte,
): Extract<BlocoGenUI, { tipo: 'cartoes_despacho' }>['rascunhos'] {
  const ultimasPorParte = new Map<Parte, { parte: Parte; campo: CampoVigiado; mensagemSugerida: string; via: 'deterministico' }>();
  for (const t of proj.tarefas) {
    ultimasPorParte.set(t.parte, {
      parte: t.parte,
      campo: t.divergencia.campo,
      mensagemSugerida: `${t.titulo}: ${t.detalhe}`.slice(0, 220),
      via: 'deterministico',
    });
  }
  const lista = [...ultimasPorParte.values()];
  if (papel) {
    lista.sort((a, b) => (a.parte === papel ? -1 : b.parte === papel ? 1 : 0));
  }
  return lista.slice(0, 3);
}

function gerarFollowUps(
  proj: ProjecaoPedido,
  divsPrioritarias: Divergencia[],
  opcoes: OpcoesViewSpecV2,
): FollowUpContextual[] {
  const sugestoes: FollowUpContextual[] = [];
  const comandosVistos = new Set<string>();
  const adicionar = (f: FollowUpContextual): void => {
    if (sugestoes.length >= 4 || comandosVistos.has(f.comando)) return;
    comandosVistos.add(f.comando);
    sugestoes.push(f);
  };

  const previsaoAtual = proj.pedido?.campos.previsaoEntrega;
  const pesoAtual = proj.pedido?.campos.pesoTotal;
  const volumesAtual = proj.pedido?.campos.volumes;

  // 1. Sugestoes derivadas das divergencias reais do pedido.
  const divData = divsPrioritarias.find((d) => d.campo === 'previsaoEntrega');
  const divPeso = divsPrioritarias.find((d) => d.campo === 'pesoTotal');
  const divVol = divsPrioritarias.find((d) => d.campo === 'volumes');
  const divStatus = divsPrioritarias.find((d) => d.campo === 'status');

  if (divData) {
    const novaData = previsaoAtual ? somarDiasIso(previsaoAtual, 3) : null;
    if (novaData && opcoes.acao !== 'simular') {
      const dataBr = formatarData(novaData);
      adicionar({
        rotulo: `Simular entrega em ${dataBr}`,
        comando: `Simule a entrega para ${dataBr}`,
        intencao: 'simular',
      });
    }
    if (opcoes.papel !== 'fiscal') {
      adicionar({
        rotulo: 'Checar regra fiscal do atraso (R-006)',
        comando: 'O que o fiscal precisa fazer com esse atraso?',
        intencao: 'mudar_lente',
      });
    }
  }

  if (divPeso) {
    adicionar({
      rotulo: `Investigar peso (${valorComUnidade('pesoTotal', divPeso.valorA)} × ${valorComUnidade('pesoTotal', divPeso.valorB)})`,
      comando: 'Por que o peso total diverge entre os documentos?',
      intencao: 'investigar',
    });
    if (opcoes.papel !== 'financeiro') {
      adicionar({
        rotulo: 'Recalcular frete no Financeiro',
        comando: 'Mostre a visão do financeiro para recalcular o frete',
        intencao: 'mudar_lente',
      });
    }
  }

  if (divVol && opcoes.papel !== 'cd') {
    adicionar({
      rotulo: `Conferir ${String(divVol.valorB)} volumes no CD`,
      comando: 'O que o CD precisa conferir nos volumes?',
      intencao: 'mudar_lente',
    });
  }

  if (divStatus) {
    adicionar({
      rotulo: `Avaliar status ${rotuloStatus(String(divStatus.valorB))}`,
      comando: 'Quais partes são impactadas pela mudança de status?',
      intencao: 'investigar',
    });
  }

  // 2. Acao de notificacao baseada em tarefas reais abertas.
  const parteComTarefa =
    (opcoes.papel && proj.tarefas.some((t) => t.parte === opcoes.papel) ? opcoes.papel : undefined) ??
    proj.tarefas[proj.tarefas.length - 1]?.parte;
  if (parteComTarefa && opcoes.acao !== 'notificar') {
    adicionar({
      rotulo: `Avisar ${ROTULO_PARTE[parteComTarefa]}`,
      comando: `Avise ${ARTIGO_PARTE[parteComTarefa]} sobre a divergência`,
      intencao: 'agir',
    });
  }

  // 3. Simulacoes e lentes derivadas dos valores reais (essencial para pedidos consistentes).
  if (previsaoAtual) {
    const novaData = somarDiasIso(previsaoAtual, 4);
    if (novaData) {
      const dataBr = formatarData(novaData);
      adicionar({
        rotulo: `Simular atraso para ${dataBr}`,
        comando: `Simule a entrega para ${dataBr}`,
        intencao: 'simular',
      });
    }
  }

  if (typeof pesoAtual === 'number' && Number.isFinite(pesoAtual)) {
    const pesoHipotese = Math.round(pesoAtual + 15);
    adicionar({
      rotulo: `Simular peso em ${pesoHipotese} kg`,
      comando: `E se o peso total for ${pesoHipotese} kg?`,
      intencao: 'simular',
    });
  }

  if (typeof volumesAtual === 'number' && Number.isFinite(volumesAtual)) {
    const volHipotese = volumesAtual + 2;
    adicionar({
      rotulo: `Simular ${volHipotese} volumes`,
      comando: `E se os volumes forem ${volHipotese}?`,
      intencao: 'simular',
    });
  }

  for (const parte of ['cd', 'fiscal', 'transportadora', 'financeiro'] as const) {
    if (sugestoes.length >= 3) break;
    if (parte === opcoes.papel) continue;
    adicionar({
      rotulo: `Abrir visão ${ROTULO_PARTE[parte]}`,
      comando: `Mostre a visão do ${parte} para este pedido`,
      intencao: 'mudar_lente',
    });
  }

  return sugestoes.slice(0, 4);
}

// Coleta toda fonte e campo citados nos blocos para garantir coerencia
// narrativa <-> matriz (nunca esconder coluna/linha discutida nos cards).
function coletarReferenciasDosBlocos(blocos: BlocoGenUI[]): {
  fontes: Set<FonteDocumento>;
  campos: Set<CampoVigiado>;
} {
  const fontes = new Set<FonteDocumento>();
  const campos = new Set<CampoVigiado>();

  for (const bloco of blocos) {
    switch (bloco.tipo) {
      case 'resumo_citado':
        for (const c of bloco.citacoes) {
          if (c.alvo.tipo === 'celula') {
            fontes.add(c.alvo.fonte);
            campos.add(c.alvo.campo);
          } else if (c.alvo.tipo === 'divergencia') {
            fontes.add(c.alvo.fonteA);
            fontes.add(c.alvo.fonteB);
            campos.add(c.alvo.campo);
          }
        }
        break;
      case 'domino_impacto':
        for (const c of bloco.camposFoco) campos.add(c);
        break;
      case 'comparador_conflito':
        fontes.add(bloco.fonteA);
        fontes.add(bloco.fonteB);
        campos.add(bloco.campo);
        break;
      case 'linha_tempo_causal':
        if (bloco.campoFoco) campos.add(bloco.campoFoco);
        break;
      case 'simulador_interativo':
        campos.add(bloco.campoInicial);
        break;
      case 'cartoes_despacho':
        for (const r of bloco.rascunhos) campos.add(r.campo);
        break;
      case 'matriz_focada':
        for (const f of bloco.fontesVisiveis) fontes.add(f);
        for (const c of bloco.colunas) campos.add(c);
        break;
      case 'checklist_papel':
        for (const c of bloco.camposPrioritarios) campos.add(c);
        break;
    }
  }
  return { fontes, campos };
}

function montarFiltroMatriz(
  camposPorF: Map<FonteDocumento, CamposObservados>,
  blocos: BlocoGenUI[],
  papel: Parte | undefined,
  divsRelevantes: Divergencia[],
  campoFoco?: CampoVigiado,
  override?: { fontesVisiveis?: FonteDocumento[]; colunas?: CampoVigiado[]; destacarDivergencias?: boolean },
): ViewSpecV2['filtroMatriz'] {
  const fontesComDados = fontesComValoresDeclarados(camposPorF);
  const fontesComDadosSet = new Set<FonteDocumento>(fontesComDados);
  const refs = coletarReferenciasDosBlocos(blocos);

  // Fontes candidatas: preferencia do papel (ou override da LLM) + divergencias + citacoes.
  const fontesBase = new Set<FonteDocumento>();
  if (override?.fontesVisiveis && override.fontesVisiveis.length > 0) {
    for (const f of override.fontesVisiveis) {
      if (fontesComDadosSet.has(f)) fontesBase.add(f);
    }
  } else if (papel) {
    for (const f of FONTES_PREFERIDAS_PAPEL[papel]) {
      if (fontesComDadosSet.has(f)) fontesBase.add(f);
    }
    for (const d of divsRelevantes) {
      if (fontesComDadosSet.has(d.fonteA)) fontesBase.add(d.fonteA);
      if (fontesComDadosSet.has(d.fonteB)) fontesBase.add(d.fonteB);
    }
  } else {
    for (const f of fontesComDados) fontesBase.add(f);
  }

  // Coerencia narrativa <-> matriz: toda fonte citada nos blocos (com dados) entra.
  for (const f of refs.fontes) {
    if (fontesComDadosSet.has(f)) fontesBase.add(f);
  }

  // Poda fontes sem nenhum campo declarado (ex.: CC-e vazia) para nao gerar coluna morta.
  let fontesVisiveis = fontesComDados.filter((f) => fontesBase.has(f));
  if (fontesVisiveis.length === 0) {
    fontesVisiveis = fontesComDados.length > 0 ? fontesComDados : ['nfe'];
  }

  const camposDeclaradosNasVisiveis = new Set<CampoVigiado>();
  for (const f of fontesVisiveis) {
    const campos = camposPorF.get(f);
    if (!campos) continue;
    for (const c of CAMPOS_VIGIADOS) {
      if (campos[c] !== undefined) camposDeclaradosNasVisiveis.add(c);
    }
  }

  const colunasBase = new Set<CampoVigiado>();
  if (override?.colunas && override.colunas.length > 0) {
    for (const c of override.colunas) colunasBase.add(c);
  } else if (papel) {
    for (const c of CAMPOS_POR_PAPEL[papel].slice(0, 3)) {
      if (camposDeclaradosNasVisiveis.has(c)) colunasBase.add(c);
    }
    for (const d of divsRelevantes) colunasBase.add(d.campo);
  } else {
    for (const c of camposDeclaradosNasVisiveis) colunasBase.add(c);
  }
  if (campoFoco) colunasBase.add(campoFoco);
  for (const c of refs.campos) colunasBase.add(c);

  const colunas = CAMPOS_VIGIADOS.filter((c) => colunasBase.has(c));
  return {
    fontesVisiveis,
    colunas: colunas.length > 0 ? colunas : [...CAMPOS_VIGIADOS],
    destacarDivergencias: override?.destacarDivergencias ?? true,
  };
}

function severidadeResumo(
  proj: ProjecaoPedido,
  divs: Divergencia[],
  opcoes: OpcoesViewSpecV2,
  divsSim?: Divergencia[],
): 'info' | 'atencao' | 'critico' {
  if (opcoes.acao === 'simular') {
    if ((divsSim?.length ?? 0) > 0) return 'atencao';
    return 'info';
  }
  const status = proj.pedido?.campos.status;
  if (status === 'cancelada' || status === 'atrasada' || divs.length >= 2) return 'critico';
  if (divs.length === 1 || proj.sinais.length > 0) return 'atencao';
  return 'info';
}

export function comporViewSpecV2Deterministico(
  proj: ProjecaoPedido,
  opcoes: OpcoesViewSpecV2 = {},
): ViewSpecV2 {
  const camposPorF = camposDeclaradosPorFonte(proj);
  const fontesAtivas = fontesComValoresDeclarados(camposPorF);
  const campoFoco = opcoes.campoSimulado ?? campoMencionado(opcoes.pergunta);
  const divs = priorizarDivergencias(divergenciasUnicas(proj), proj, opcoes.papel, campoFoco);
  const divsPapel = opcoes.papel ? divs.filter((d) => divergenciaAfetaPapel(d, proj, opcoes.papel!)) : divs;

  const citacoes = construirCitacoesFactuais(proj, camposPorF, divs, opcoes);
  const lente: Parte | 'operacao' = opcoes.papel ?? 'operacao';
  const emitente = proj.pedido && proj.pedido.emitente.nome !== '?' ? proj.pedido.emitente.nome : 'Pedido';

  let layout: ViewSpecV2['layout'];
  let tituloVisao: string;
  let justificativa: string;
  const blocos: BlocoGenUI[] = [];

  if (opcoes.acao === 'simular') {
    layout = 'simulacao';
    const campoInicial: CampoVigiado = opcoes.campoSimulado ?? campoFoco ?? 'previsaoEntrega';
    const valorInicial = opcoes.valorSimulado;
    const divsSim =
      valorInicial !== undefined
        ? simularHipotese(proj.versoes, { [campoInicial]: valorInicial } as CamposObservados)
        : [];
    const tarefasSim = propagarTodas(divsSim);
    const partesSim = [...new Set(tarefasSim.map((t) => t.parte))];

    tituloVisao = `Simulação "E se?" · ${ROTULO_CAMPO[campoInicial]}`;
    justificativa =
      valorInicial !== undefined
        ? `Cenário hipotético para ${ROTULO_CAMPO[campoInicial]} (${valorComUnidade(campoInicial, valorInicial)}) sem alterar o ledger.`
        : `Simulador determinístico aberto em ${ROTULO_CAMPO[campoInicial]} sem alterar o ledger.`;

    blocos.push(
      {
        id: 'simulador',
        tipo: 'simulador_interativo',
        titulo: `Simulador de ${ROTULO_CAMPO[campoInicial]}`,
        campoInicial,
        ...(valorInicial !== undefined ? { valorInicial } : {}),
      },
      {
        id: 'domino',
        tipo: 'domino_impacto',
        titulo: 'Cascata simulada por parte',
        camposFoco: [campoInicial],
        partesFoco: partesSim,
        modo: 'simulacao',
      },
      {
        id: 'resumo',
        tipo: 'resumo_citado',
        titulo: 'Leitura do cenário simulado',
        corpo: construirResumoCorpoDeterministico(proj, fontesAtivas, divs, citacoes, opcoes, {
          divs: divsSim,
          partes: partesSim,
          tarefas: tarefasSim.length,
        }),
        citacoes,
        severidade: severidadeResumo(proj, divs, opcoes, divsSim),
        via: opcoes.resumoVia ?? 'deterministico',
      },
    );
  } else if (opcoes.acao === 'notificar') {
    layout = 'despacho';
    const rascunhos = construirRascunhosDespacho(proj, opcoes.papel);
    const partesDespacho: Parte[] =
      rascunhos.length > 0
        ? rascunhos.map((r) => r.parte)
        : opcoes.papel
          ? [opcoes.papel]
          : [...PARTES];

    tituloVisao = opcoes.papel ? `Despacho para ${ROTULO_PARTE[opcoes.papel]}` : 'Despacho de avisos operacionais';
    justificativa = 'Consolida os rascunhos determinísticos e o impacto ativo antes do envio pela agenda de contatos.';

    blocos.push(
      {
        id: 'resumo',
        tipo: 'resumo_citado',
        titulo: 'Resumo para despacho',
        corpo: construirResumoCorpoDeterministico(proj, fontesAtivas, divs, citacoes, opcoes),
        citacoes,
        severidade: severidadeResumo(proj, divs, opcoes),
        via: opcoes.resumoVia ?? 'deterministico',
      },
      {
        id: 'despacho',
        tipo: 'cartoes_despacho',
        titulo: 'Cartões de despacho',
        partes: partesDespacho,
        rascunhos,
      },
      opcoes.papel
        ? {
            id: `checklist-${opcoes.papel}`,
            tipo: 'checklist_papel',
            titulo: `Checklist — ${ROTULO_PARTE[opcoes.papel]}`,
            parte: opcoes.papel,
            camposPrioritarios:
              divsPapel.length > 0
                ? [...new Set(divsPapel.map((d) => d.campo))]
                : [...CAMPOS_POR_PAPEL[opcoes.papel].slice(0, 3)],
          }
        : {
            id: 'domino',
            tipo: 'domino_impacto',
            titulo: 'Cascata de impacto atual',
            camposFoco: divs.length > 0 ? [...new Set(divs.map((d) => d.campo))] : [...CAMPOS_VIGIADOS],
            partesFoco: [...new Set(proj.tarefas.map((t) => t.parte))],
            modo: 'atual',
          },
    );
  } else if (opcoes.papel) {
    layout = 'decisao_papel';
    const papel = opcoes.papel;
    const conflitoPrincipal = divsPapel[0] ?? divs[0];
    const rascunhos = construirRascunhosDespacho(proj, papel);
    const pedeAviso = /\b(avis|notif|comunic|mensag|despach)\b/i.test(opcoes.pergunta ?? '');
    const usarDespacho =
      rascunhos.length > 0 && (pedeAviso || papel === 'fornecedor' || papel === 'transportadora');

    tituloVisao = `Decisão ${ROTULO_PARTE[papel]} · ${emitente}`;
    justificativa =
      divsPapel.length > 0
        ? `Prioriza ${divsPapel.length} conflito(s) que geram ação para ${ROTULO_PARTE[papel]} e oculta fontes vazias.`
        : `Foca os campos de acompanhamento de ${ROTULO_PARTE[papel]} sem ruído de outras áreas.`;

    blocos.push({
      id: 'resumo',
      tipo: 'resumo_citado',
      titulo: `Resumo executivo — ${ROTULO_PARTE[papel]}`,
      corpo: construirResumoCorpoDeterministico(proj, fontesAtivas, divs, citacoes, opcoes),
      citacoes,
      severidade: severidadeResumo(proj, divs, opcoes),
      via: opcoes.resumoVia ?? 'deterministico',
    });

    if (conflitoPrincipal) {
      blocos.push({
        id: `conflito-${conflitoPrincipal.campo}-${conflitoPrincipal.fonteA}-${conflitoPrincipal.fonteB}`,
        tipo: 'comparador_conflito',
        titulo: `Conflito principal: ${ROTULO_CAMPO[conflitoPrincipal.campo]}`,
        campo: conflitoPrincipal.campo,
        fonteA: conflitoPrincipal.fonteA,
        fonteB: conflitoPrincipal.fonteB,
        notaRegra: NOTA_REGRA_CAMPO[conflitoPrincipal.campo],
      });

      if (usarDespacho) {
        blocos.push({
          id: 'despacho',
          tipo: 'cartoes_despacho',
          titulo: 'Rascunhos de aviso operacional',
          partes: rascunhos.map((r) => r.parte),
          rascunhos,
        });
      } else {
        blocos.push({
          id: 'domino',
          tipo: 'domino_impacto',
          titulo: 'Cascata de impacto por parte',
          camposFoco: [...new Set((divsPapel.length > 0 ? divsPapel : divs).map((d) => d.campo))],
          partesFoco: [...new Set(proj.tarefas.map((t) => t.parte))],
          modo: 'atual',
        });
      }
    } else {
      const celulas: Array<{ campo: CampoVigiado; fonte: FonteDocumento }> = [];
      for (const f of fontesAtivas) {
        const c = camposPorF.get(f);
        if (!c) continue;
        for (const campo of CAMPOS_POR_PAPEL[papel]) {
          if (c[campo] !== undefined && celulas.length < 4) celulas.push({ campo, fonte: f });
        }
      }
      blocos.push({
        id: 'matriz-focada',
        tipo: 'matriz_focada',
        titulo: `Campos confirmados para ${ROTULO_PARTE[papel]}`,
        fontesVisiveis: fontesAtivas.length > 0 ? fontesAtivas : ['nfe'],
        colunas: CAMPOS_POR_PAPEL[papel].filter((c) => fontesAtivas.some((f) => camposPorF.get(f)?.[c] !== undefined)),
        celulasDestacadas: celulas,
        destacarDivergencias: true,
      });
    }

    blocos.push({
      id: `checklist-${papel}`,
      tipo: 'checklist_papel',
      titulo: `Checklist — ${ROTULO_PARTE[papel]}`,
      parte: papel,
      camposPrioritarios:
        divsPapel.length > 0
          ? [...new Set(divsPapel.map((d) => d.campo))]
          : [...CAMPOS_POR_PAPEL[papel].slice(0, 3)],
    });
  } else {
    layout = 'investigacao';
    const pedeComparacaoMultipla = /\b(diverg|conflit|diferen|compar)\b/i.test(opcoes.pergunta ?? '');

    tituloVisao = divs.length > 0 ? `Investigação de divergências · ${emitente}` : `Panorama operacional · ${emitente}`;
    justificativa =
      divs.length > 0
        ? `Cruza ${divs.length} divergência(s) ativa(s) entre ${fontesAtivas.map(rotuloFonte).join(', ')} com linha do tempo causal.`
        : `Pedido consistente entre ${fontesAtivas.map(rotuloFonte).join(' e ') || 'as fontes registradas'}.`;

    blocos.push({
      id: 'resumo',
      tipo: 'resumo_citado',
      titulo: 'Diagnóstico do pedido',
      corpo: construirResumoCorpoDeterministico(proj, fontesAtivas, divs, citacoes, opcoes),
      citacoes,
      severidade: severidadeResumo(proj, divs, opcoes),
      via: opcoes.resumoVia ?? 'deterministico',
    });

    if (divs.length >= 2 && pedeComparacaoMultipla) {
      for (const d of divs.slice(0, 2)) {
        blocos.push({
          id: `conflito-${d.campo}-${d.fonteA}-${d.fonteB}`,
          tipo: 'comparador_conflito',
          titulo: `Conflito de ${ROTULO_CAMPO[d.campo]}`,
          campo: d.campo,
          fonteA: d.fonteA,
          fonteB: d.fonteB,
          notaRegra: NOTA_REGRA_CAMPO[d.campo],
        });
      }
    } else {
      blocos.push({
        id: 'domino',
        tipo: 'domino_impacto',
        titulo: 'Cascata de impacto por parte',
        camposFoco: divs.length > 0 ? [...new Set(divs.map((d) => d.campo))] : [...CAMPOS_VIGIADOS],
        partesFoco: [...new Set(proj.tarefas.map((t) => t.parte))],
        modo: 'atual',
      });
      if (divs[0]) {
        const d = divs[0];
        blocos.push({
          id: `conflito-${d.campo}-${d.fonteA}-${d.fonteB}`,
          tipo: 'comparador_conflito',
          titulo: `Conflito principal: ${ROTULO_CAMPO[d.campo]}`,
          campo: d.campo,
          fonteA: d.fonteA,
          fonteB: d.fonteB,
          notaRegra: NOTA_REGRA_CAMPO[d.campo],
        });
      }
    }

    blocos.push({
      id: 'linha-tempo',
      tipo: 'linha_tempo_causal',
      titulo: 'Linha do tempo causal',
      ...(campoFoco ?? divs[0]?.campo ? { campoFoco: campoFoco ?? divs[0]!.campo } : {}),
      incluirSinais: proj.sinais.length > 0,
    });
  }

  const filtroMatriz = montarFiltroMatriz(camposPorF, blocos, opcoes.papel, divsPapel, campoFoco);

  // Alinha eventual matriz_focada com o filtro podado final.
  for (const bloco of blocos) {
    if (bloco.tipo === 'matriz_focada') {
      bloco.fontesVisiveis = filtroMatriz.fontesVisiveis;
      bloco.colunas = filtroMatriz.colunas;
    }
  }

  return {
    versao: 2,
    origem: 'deterministico',
    lente,
    layout,
    tituloVisao,
    justificativa,
    blocos,
    followUps: gerarFollowUps(proj, divs, opcoes),
    filtroMatriz,
  };
}

const PROMPT_V2 = `Voce refina a camada editorial de uma visao GenUI v2 de um pedido logistico.
Responda APENAS JSON neste formato exato:
{
  "tituloVisao": "string curta (ate 80 chars)",
  "justificativa": "string curta (ate 180 chars)",
  "resumoCorpo": "ate 3 frases claras em portugues usando APENAS os marcadores [[c1]], [[c2]]... listados em citacoesDisponiveis",
  "filtroMatriz": {
    "fontesVisiveis": FonteDocumento[],
    "colunas": CampoVigiado[],
    "destacarDivergencias": boolean
  }
}
Regras rigidas:
- Nunca invente datas, numeros, fontes ou marcadores [[...]] fora de citacoesDisponiveis.
- Use em fontesVisiveis apenas fontes presentes em fontesComDados.
- Enums validos: FonteDocumento em nfe|cte|cce|planilha|pdf|imap|manual; CampoVigiado em previsaoEntrega|pesoTotal|volumes|status.
Contexto factual:
`;

function aplicarRefinamentoLlmV2(
  base: ViewSpecV2,
  json: unknown,
  proj: ProjecaoPedido,
  opcoes: OpcoesViewSpecV2,
): ViewSpecV2 | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  const tituloVisao = typeof r['tituloVisao'] === 'string' ? r['tituloVisao'].trim() : '';
  const justificativa = typeof r['justificativa'] === 'string' ? r['justificativa'].trim() : '';
  const resumoCorpo = typeof r['resumoCorpo'] === 'string' ? r['resumoCorpo'].trim() : '';
  if (!tituloVisao || !justificativa || !resumoCorpo) return null;

  const blocoResumo = base.blocos.find((b): b is Extract<BlocoGenUI, { tipo: 'resumo_citado' }> => b.tipo === 'resumo_citado');
  if (!blocoResumo) return null;

  // Anti-alucinacao: qualquer marcador [[...]] desconhecido invalida o refinamento.
  const idsValidos = new Set(blocoResumo.citacoes.map((c) => c.id));
  for (const m of resumoCorpo.matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (!idsValidos.has(m[1]!)) return null;
  }

  let filtroOverride: { fontesVisiveis?: FonteDocumento[]; colunas?: CampoVigiado[]; destacarDivergencias?: boolean } | undefined;
  const fm = r['filtroMatriz'];
  if (fm !== undefined) {
    if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) return null;
    const fmo = fm as Record<string, unknown>;
    if (!Array.isArray(fmo['fontesVisiveis']) || fmo['fontesVisiveis'].length === 0) return null;
    if (!Array.isArray(fmo['colunas']) || fmo['colunas'].length === 0) return null;
    if (typeof fmo['destacarDivergencias'] !== 'boolean') return null;
    const fontes = [...new Set(fmo['fontesVisiveis'])];
    const colunas = [...new Set(fmo['colunas'])];
    if (fontes.some((f) => typeof f !== 'string' || !FONTES_SET.has(f))) return null;
    if (colunas.some((c) => typeof c !== 'string' || !CAMPOS_SET.has(c))) return null;
    filtroOverride = {
      fontesVisiveis: fontes as FonteDocumento[],
      colunas: colunas as CampoVigiado[],
      destacarDivergencias: fmo['destacarDivergencias'],
    };
  }

  const camposPorF = camposDeclaradosPorFonte(proj);
  const campoFoco = opcoes.campoSimulado ?? campoMencionado(opcoes.pergunta);
  const divs = priorizarDivergencias(divergenciasUnicas(proj), proj, opcoes.papel, campoFoco);
  const divsPapel = opcoes.papel ? divs.filter((d) => divergenciaAfetaPapel(d, proj, opcoes.papel!)) : divs;

  const corpoFinal = sanitizarMarcadoresCorpo(resumoCorpo.slice(0, 900), blocoResumo.citacoes);
  const blocosAtualizados: BlocoGenUI[] = base.blocos.map((b) =>
    b.tipo === 'resumo_citado' ? { ...b, corpo: corpoFinal, via: 'llm' } : b,
  );
  const filtroMatriz = montarFiltroMatriz(
    camposPorF,
    blocosAtualizados,
    opcoes.papel,
    divsPapel,
    campoFoco,
    filtroOverride,
  );

  return {
    ...base,
    origem: 'llm',
    tituloVisao: tituloVisao.slice(0, 100),
    justificativa: justificativa.slice(0, 220),
    blocos: blocosAtualizados.map((b) =>
      b.tipo === 'matriz_focada'
        ? { ...b, fontesVisiveis: filtroMatriz.fontesVisiveis, colunas: filtroMatriz.colunas }
        : b,
    ),
    filtroMatriz,
  };
}

export async function comporViewSpecV2(
  proj: ProjecaoPedido,
  opcoes: OpcoesViewSpecV2 = {},
): Promise<ViewSpecV2> {
  const base = comporViewSpecV2Deterministico(proj, opcoes);
  if (!llmConfigDoEnv() || !proj.pedido) return base;
  try {
    const camposPorF = camposDeclaradosPorFonte(proj);
    const blocoResumo = base.blocos.find((b): b is Extract<BlocoGenUI, { tipo: 'resumo_citado' }> => b.tipo === 'resumo_citado');
    const contexto = {
      lente: base.lente,
      layout: base.layout,
      pergunta: opcoes.pergunta?.slice(0, 300) ?? null,
      emitente: proj.pedido.emitente.nome,
      destinatario: proj.pedido.destinatario.nome,
      fontesComDados: fontesComValoresDeclarados(camposPorF),
      camposConsolidados: proj.pedido.campos,
      divergencias: divergenciasUnicas(proj).map((d) => ({
        campo: d.campo,
        fonteA: d.fonteA,
        valorA: valorComUnidade(d.campo, d.valorA),
        fonteB: d.fonteB,
        valorB: valorComUnidade(d.campo, d.valorB),
      })),
      tarefasPorParte: proj.tarefas.reduce<Record<string, number>>((acc, t) => {
        acc[t.parte] = (acc[t.parte] ?? 0) + 1;
        return acc;
      }, {}),
      citacoesDisponiveis: (blocoResumo?.citacoes ?? []).map((c) => ({ id: c.id, rotulo: c.rotulo })),
    };
    const json = await chatJson(
      [{ role: 'user', content: PROMPT_V2 + JSON.stringify(contexto) }],
      { maxTokens: 550 },
    );
    return aplicarRefinamentoLlmV2(base, json, proj, opcoes) ?? base;
  } catch {
    return base;
  }
}
