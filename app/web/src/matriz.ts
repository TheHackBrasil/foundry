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
  valor: unknown;
  emConflito: boolean;
}

export interface LinhaMatriz {
  campo: CampoVigiado;
  celulas: Celula[];
  divergente: boolean;
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
  const ultima = new Map<FonteDocumento, VersaoPedido>();
  for (const v of versoes) {
    if (!primeira.has(v.fonte)) primeira.set(v.fonte, v.versao);
    const atual = ultima.get(v.fonte);
    if (!atual || v.versao > atual.versao) ultima.set(v.fonte, v);
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
    const celulas = fontes.map((fonte): Celula => {
      const valor = valorAtual(fonte, campo);
      const emConflito = ativas.some(
        (d) => d.campo === campo && (d.fonteA === fonte || d.fonteB === fonte),
      );
      return { valor, emConflito };
    });
    return { campo, celulas, divergente: celulas.some((c) => c.emConflito) };
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
