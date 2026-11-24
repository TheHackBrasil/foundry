import { useMemo, type CSSProperties } from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  Parte,
  ProjecaoPedido,
} from '../../../../shared/model.ts';
import {
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloParte,
} from '../../format.ts';
import { agruparTarefas, tarefasDaParte } from '../../matriz.ts';
import { alvoIgual, estiloEntradaBloco } from './helpers.ts';
import type { AoAlternarFoco } from './tipos.ts';

export interface BlocoChecklistPapelProps {
  bloco: Extract<BlocoGenUI, { tipo: 'checklist_papel' }>;
  indice: number;
  projecao: ProjecaoPedido;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
  aoSelecionarPapel: (papel: Parte) => void;
}

export function BlocoChecklistPapel({
  bloco,
  indice,
  projecao,
  focoAtivo,
  aoAlternarFoco,
  aoSelecionarPapel,
}: BlocoChecklistPapelProps) {
  const gruposOrdenados = useMemo(() => {
    const prioridade = new Map<CampoVigiado, number>(
      bloco.camposPrioritarios.map((c, idx) => [c, idx]),
    );
    const grupos = agruparTarefas(tarefasDaParte(projecao.tarefas, bloco.parte));
    return [...grupos].sort((a, b) => {
      const ca = a.ocorrencias[0]?.divergencia.campo;
      const cb = b.ocorrencias[0]?.divergencia.campo;
      const pa = ca !== undefined ? (prioridade.get(ca) ?? 99) : 99;
      const pb = cb !== undefined ? (prioridade.get(cb) ?? 99) : 99;
      return pa - pb;
    });
  }, [projecao.tarefas, bloco.parte, bloco.camposPrioritarios]);

  return (
    <article
      className="palco-bloco palco-bloco-largo"
      data-bloco-tipo={bloco.tipo}
      data-matriz-bloco={bloco.id}
      data-matriz-idx={indice}
      aria-label={bloco.titulo}
      style={estiloEntradaBloco(indice)}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
        <button
          type="button"
          className="botao-sutil"
          onClick={() => aoSelecionarPapel(bloco.parte)}
        >
          Lente: {rotuloParte(bloco.parte)}
        </button>
      </div>

      {gruposOrdenados.length === 0 ? (
        <p className="dica">
          Nenhuma tarefa aberta para {rotuloParte(bloco.parte)} neste pedido.
        </p>
      ) : (
        <ul className="checklist-lista">
          {gruposOrdenados.map((grupo, gIdx) => {
            const principal = grupo.ocorrencias[0];
            if (!principal) return null;
            const d = principal.divergencia;
            const alvo: AlvoFocoGenUI = {
              tipo: 'divergencia',
              campo: d.campo,
              fonteA: d.fonteA,
              fonteB: d.fonteB,
            };
            const prioritario = bloco.camposPrioritarios.includes(d.campo);
            return (
              <li
                key={`${grupo.parte}-${grupo.titulo}`}
                className="palco-item-cascata"
                style={{ '--item-i': Math.min(gIdx, 8) } as CSSProperties}
              >
                <button
                  type="button"
                  className="checklist-item"
                  aria-pressed={alvoIgual(focoAtivo, alvo)}
                  onClick={() =>
                    aoAlternarFoco(alvo, `${rotuloCampo(d.campo)}: ${grupo.titulo}`)
                  }
                >
                  <div className="domino-no-topo">
                    <strong className="checklist-titulo">{grupo.titulo}</strong>
                    <span className={prioritario ? 'pilula-coord' : 'pilula-sutil'}>
                      {rotuloCampo(d.campo)}
                    </span>
                  </div>
                  <span className="meta">{principal.detalhe}</span>
                  <span className="meta num">
                    {rotuloFonte(d.fonteA)} ({formatarValor(d.campo, d.valorA)}) ×{' '}
                    {rotuloFonte(d.fonteB)} ({formatarValor(d.campo, d.valorB)})
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
