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
} from '../../shared/model.ts';

export interface Celula {
  fonte: FonteDocumento;
  valor: unknown;
  emConflito: boolean;
  // Origem do valor mostrado: versão e momento do documento mais recente da fonte.
  versao?: number;
  em?: string;
  // Valor que a mesma fonte declarava na versão anterior, quando mudou.
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
  linhas: LinhaMatriz[];
}

const igual = (a: unknown, b: unknown): boolean => String(a) === String(b);

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
  const ultima = new Map<FonteDocumento, VersaoPedido>();
  const anterior = new Map<FonteDocumento, VersaoPedido>();
  for (const [fonte, lista] of porFonte) {
    const ordenada = [...lista].sort((a, b) => a.versao - b.versao);
    const u = ordenada.at(-1);
    const a = ordenada.at(-2);
    if (u) ultima.set(fonte, u);
    if (a) anterior.set(fonte, a);
  }
  const fontes = [...primeira.entries()].sort((a, b) => a[1] - b[1]).map(([fonte]) => fonte);

  // Uma divergência do ledger só está ativa enquanto as duas fontes ainda
  // declaram os valores que ela registrou.
  const valorAtual = (fonte: FonteDocumento, campo: CampoVigiado): unknown =>
    ultima.get(fonte)?.campos[campo];
  const ativas = divergencias.filter(
    (d) =>
      igual(valorAtual(d.fonteA, d.campo), d.valorA) && igual(valorAtual(d.fonteB, d.campo), d.valorB),
  );

  const linhas = CAMPOS_VIGIADOS.map((campo): LinhaMatriz => {
    const refFonte = fontes.find((f) => valorAtual(f, campo) !== undefined);
    const celulas = fontes.map((fonte): Celula => {
      const valor = valorAtual(fonte, campo);
      const emConflito = ativas.some(
        (d) => d.campo === campo && (d.fonteA === fonte || d.fonteB === fonte),
      );
      const v = ultima.get(fonte);
      const antes = anterior.get(fonte)?.campos[campo];
      const mudou = valor !== undefined && antes !== undefined && !igual(antes, valor);
      return {
        fonte,
        valor,
        emConflito,
        ...(v && valor !== undefined ? { versao: v.versao, em: v.geradaEm } : {}),
        ...(mudou ? { antes } : {}),
        referencia: fonte === refFonte,
      };
    });
    const referencia = celulas.find((c) => c.referencia && c.valor !== undefined);
    return { campo, celulas, divergente: celulas.some((c) => c.emConflito), ...(referencia ? { referencia } : {}) };
  });

  return { fontes, linhas };
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

export const chaveTarefa = (t: Tarefa): string =>
  `${t.parte}|${t.titulo}|${t.divergencia.campo}|${String(t.divergencia.valorB)}`;
