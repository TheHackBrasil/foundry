// Monta a matriz fontes x campos a partir do que o servidor já devolve em
// ProjecaoPedido. Não recalcula divergência: usa as que estão no ledger e só
// as marca enquanto as duas fontes ainda declaram os valores em conflito.

import { CAMPOS_VIGIADOS } from '../../shared/model.ts';
import type {
  CampoVigiado,
  Divergencia,
  FonteDocumento,
  Parte,
  Tarefa,
  VersaoPedido,
  ViewSpec,
  ViewSpecV2,
} from '../../shared/model.ts';

export interface Celula {
  fonte: FonteDocumento;
  valor: unknown;
  emConflito: boolean;
  // Origem do valor mostrado: versão e momento do documento mais recente que declarou este campo.
  versao?: number;
  em?: string;
  // Valor que a mesma fonte declarava na declaração anterior deste campo, quando mudou.
  antes?: unknown;
  // Fonte de referência da linha: as outras células comparam com ela.
  referencia: boolean;
}

export interface LinhaMatriz {
  campo: CampoVigiado;
  celulas: Celula[];
  divergente: boolean;
  referencia?: Celula;
}

export interface Matriz {
  fontes: FonteDocumento[];
  fontesSemDeclaracao: FonteDocumento[];
  linhas: LinhaMatriz[];
}

const igual = (a: unknown, b: unknown): boolean => String(a) === String(b);

interface EstadoCampoFonte {
  valor: unknown;
  versao: number;
  em: string;
  antes?: unknown;
}

export function montarMatriz(
  versoes: readonly VersaoPedido[],
  divergencias: readonly Divergencia[],
): Matriz {
  const primeira = new Map<FonteDocumento, number>();
  const porFonte = new Map<FonteDocumento, VersaoPedido[]>();
  for (const v of versoes) {
    if (!primeira.has(v.fonte)) primeira.set(v.fonte, v.versao);
    porFonte.set(v.fonte, [...(porFonte.get(v.fonte) ?? []), v]);
  }

  // Mescla campo a campo por fonte (espelhando app/shared/projection.ts): um evento
  // subsequente sem campos (ex.: CC-e apenas textual) não apaga declarações anteriores.
  const estadoPorFonte = new Map<FonteDocumento, Map<CampoVigiado, EstadoCampoFonte>>();
  for (const [fonte, lista] of porFonte) {
    const ordenada = [...lista].sort((a, b) => a.versao - b.versao);
    const mapaCampos = new Map<CampoVigiado, EstadoCampoFonte>();
    for (const v of ordenada) {
      for (const campo of CAMPOS_VIGIADOS) {
        const valor = v.campos[campo];
        if (valor === undefined) continue;
        const previo = mapaCampos.get(campo);
        const mudou = previo !== undefined && !igual(previo.valor, valor);
        mapaCampos.set(campo, {
          valor,
          versao: v.versao,
          em: v.geradaEm,
          ...(mudou ? { antes: previo.valor } : {}),
        });
      }
    }
    estadoPorFonte.set(fonte, mapaCampos);
  }

  const fontes = [...primeira.entries()].sort((a, b) => a[1] - b[1]).map(([fonte]) => fonte);
  const fontesSemDeclaracao = fontes.filter((f) => (estadoPorFonte.get(f)?.size ?? 0) === 0);

  // Uma divergência do ledger só está ativa enquanto as duas fontes ainda
  // declaram os valores que ela registrou.
  const estadoAtual = (fonte: FonteDocumento, campo: CampoVigiado): EstadoCampoFonte | undefined =>
    estadoPorFonte.get(fonte)?.get(campo);
  const valorAtual = (fonte: FonteDocumento, campo: CampoVigiado): unknown =>
    estadoAtual(fonte, campo)?.valor;
  const ativas = divergencias.filter(
    (d) =>
      igual(valorAtual(d.fonteA, d.campo), d.valorA) && igual(valorAtual(d.fonteB, d.campo), d.valorB),
  );

  const linhas = CAMPOS_VIGIADOS.map((campo): LinhaMatriz => {
    const refFonte = fontes.find((f) => valorAtual(f, campo) !== undefined);
    const celulas = fontes.map((fonte): Celula => {
      const st = estadoAtual(fonte, campo);
      const valor = st?.valor;
      const emConflito = ativas.some(
        (d) => d.campo === campo && (d.fonteA === fonte || d.fonteB === fonte),
      );
      return {
        fonte,
        valor,
        emConflito,
        ...(st ? { versao: st.versao, em: st.em } : {}),
        ...(st?.antes !== undefined ? { antes: st.antes } : {}),
        referencia: fonte === refFonte,
      };
    });
    const referencia = celulas.find((c) => c.referencia && c.valor !== undefined);
    return { campo, celulas, divergente: celulas.some((c) => c.emConflito), ...(referencia ? { referencia } : {}) };
  });

  return { fontes, fontesSemDeclaracao, linhas };
}

export interface ResultadoLente {
  matriz: Matriz;
  ajustada: boolean;
  fontesOcultas: FonteDocumento[];
  camposOcultos: CampoVigiado[];
  destacarDivergencias: boolean;
  lente: Parte;
}

// Aplica o ViewSpec (v1 ou v2) sobre a matriz sem inventar coluna ou esconder
// divergencia real: fontes/campos ausentes sao ignorados, e intersecao vazia
// cai na visao completa para nao simular pedido sem documentos.
export function aplicarViewSpec(
  matriz: Matriz,
  spec: ViewSpec | ViewSpecV2,
  fontesForcadasVisiveis?: ReadonlySet<FonteDocumento>,
): ResultadoLente {
  const filtro = 'filtroMatriz' in spec ? spec.filtroMatriz : spec;
  const lenteBase: Parte = 'filtroMatriz' in spec
    ? (spec.lente === 'operacao' ? 'fornecedor' : spec.lente)
    : spec.lente;

  const completo: ResultadoLente = {
    matriz,
    ajustada: false,
    fontesOcultas: [],
    camposOcultos: [],
    destacarDivergencias: true,
    lente: lenteBase,
  };
  if (matriz.fontes.length === 0 || matriz.linhas.length === 0) return completo;

  const fontesPermitidas = new Set<FonteDocumento>(filtro.fontesVisiveis);
  if (fontesForcadasVisiveis) {
    for (const f of fontesForcadasVisiveis) fontesPermitidas.add(f);
  }
  const colunasPermitidas = new Set<CampoVigiado>(filtro.colunas);

  const fontes = matriz.fontes.filter((f) => fontesPermitidas.has(f));
  const linhasBase = matriz.linhas.filter((l) => colunasPermitidas.has(l.campo));

  if (fontes.length === 0 || linhasBase.length === 0) return completo;

  const fontesOcultas = matriz.fontes.filter((f) => !fontesPermitidas.has(f));
  const camposOcultos = matriz.linhas
    .filter((l) => !colunasPermitidas.has(l.campo))
    .map((l) => l.campo);

  const linhas: LinhaMatriz[] = linhasBase.map((linha) => ({
    ...linha,
    celulas: linha.celulas.filter((c) => fontesPermitidas.has(c.fonte)),
  }));

  const ajustada =
    fontesOcultas.length > 0 || camposOcultos.length > 0 || !filtro.destacarDivergencias;

  return {
    matriz: {
      fontes,
      fontesSemDeclaracao: matriz.fontesSemDeclaracao.filter((f) => fontesPermitidas.has(f)),
      linhas,
    },
    ajustada,
    fontesOcultas,
    camposOcultos,
    destacarDivergencias: filtro.destacarDivergencias,
    lente: lenteBase,
  };
}

export const FILTRO_TODAS = 'todas';
export type FiltroParte = Parte | typeof FILTRO_TODAS;

export function tarefasDaParte(tarefas: readonly Tarefa[], filtro: FiltroParte): Tarefa[] {
  return filtro === FILTRO_TODAS ? [...tarefas] : tarefas.filter((t) => t.parte === filtro);
}

// O servidor gera uma tarefa por par de fontes em conflito, então a mesma ação
// aparece várias vezes. Na tela vira uma tarefa com a lista das origens.
export interface GrupoTarefa {
  parte: Parte;
  titulo: string;
  ocorrencias: Tarefa[];
}

export function agruparTarefas(tarefas: readonly Tarefa[]): GrupoTarefa[] {
  const grupos = new Map<string, GrupoTarefa>();
  for (const t of tarefas) {
    const chave = `${t.parte}|${t.titulo}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.ocorrencias.push(t);
    else grupos.set(chave, { parte: t.parte, titulo: t.titulo, ocorrencias: [t] });
  }
  return [...grupos.values()];
}

// A mesma divergência de campo e valor entre pares de fontes diferentes gera
// tarefas diferentes: sem fonteA/fonteB elas colapsavam numa chave só.
export const chaveTarefa = (t: Tarefa): string =>
  `${t.parte}|${t.titulo}|${t.divergencia.fonteA}|${t.divergencia.fonteB}|${t.divergencia.campo}|${String(t.divergencia.valorB)}`;
