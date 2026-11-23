import { useId, useRef, type KeyboardEvent } from 'react';
import { PARTES, type Parte, type Tarefa } from '../../../shared/model.ts';
import { ROTULO_CAMPO, ROTULO_FONTE, ROTULO_PARTE } from '../format.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  chaveTarefa,
  tarefasDaParte,
  type FiltroParte,
  type GrupoTarefa,
} from '../matriz.ts';

interface Props {
  tarefas: readonly Tarefa[];
  filtro: FiltroParte;
  aoFiltrar: (filtro: FiltroParte) => void;
  novas: ReadonlySet<string>;
}

function Item({ grupo, novas }: { grupo: GrupoTarefa; novas: ReadonlySet<string> }) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  return (
    <li className={nova ? 'tarefa tarefa-nova' : 'tarefa'}>
      <p className="tarefa-titulo">
        {grupo.titulo}
        {!unica && <span className="meta"> · {grupo.ocorrencias.length} divergências</span>}
        {nova && <span className="etiqueta etiqueta-nova">Nova</span>}
      </p>
      {unica && <p>{grupo.ocorrencias[0]?.detalhe}</p>}
      <ul className="origens">
        {grupo.ocorrencias.map((t) => {
          const d = t.divergencia;
          return (
            <li key={chaveTarefa(t)} className="meta">
              {ROTULO_CAMPO[d.campo]} · {ROTULO_FONTE[d.fonteA]} × {ROTULO_FONTE[d.fonteB]}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

// Abas, uma parte por vez: a lista longa era a queixa da primeira versão da tela.
export function TarefasPorParte({ tarefas, filtro, aoFiltrar, novas }: Props) {
  const id = useId();
  const lista = useRef<HTMLDivElement>(null);
  const contagem = (parte: Parte): number => agruparTarefas(tarefasDaParte(tarefas, parte)).length;
  const total = agruparTarefas(tarefas).length;
  const abas: ReadonlyArray<{ valor: FiltroParte; rotulo: string; n: number }> = [
    { valor: FILTRO_TODAS, rotulo: 'Todas', n: total },
    ...PARTES.map((p) => ({ valor: p as FiltroParte, rotulo: ROTULO_PARTE[p], n: contagem(p) })),
  ];

  const partes: Parte[] = filtro === FILTRO_TODAS ? PARTES.filter((p) => contagem(p) > 0) : [filtro];
  const grupos = partes.map((parte) => ({ parte, itens: agruparTarefas(tarefasDaParte(tarefas, parte)) }));
  const visiveis = grupos.reduce((soma, g) => soma + g.itens.length, 0);

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const proxima = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
    if (proxima === undefined) return;
    e.preventDefault();
    const alvo = abas[(proxima + abas.length) % abas.length];
    if (!alvo) return;
    aoFiltrar(alvo.valor);
    lista.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[(proxima + abas.length) % abas.length]?.focus();
  }

  return (
    <div>
      <div className="abas" role="tablist" aria-label="Parte" ref={lista}>
        {abas.map((a, i) => (
          <button
            key={a.valor}
            type="button"
            role="tab"
            id={`${id}-${a.valor}`}
            className="aba"
            aria-selected={filtro === a.valor}
            aria-controls={`${id}-painel`}
            tabIndex={filtro === a.valor ? 0 : -1}
            onClick={() => aoFiltrar(a.valor)}
            onKeyDown={(e) => aoTeclar(e, i)}
          >
            {a.rotulo} <span className="n">({a.n})</span>
          </button>
        ))}
      </div>
      <div id={`${id}-painel`} role="tabpanel" aria-labelledby={`${id}-${filtro}`} className="tarefas-lista">
        {tarefas.length === 0 && (
          <p className="dica">Nenhuma tarefa por enquanto. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.</p>
        )}
        {tarefas.length > 0 && visiveis === 0 && filtro !== FILTRO_TODAS && (
          <p className="dica">Nenhuma tarefa para {ROTULO_PARTE[filtro]} neste pedido.</p>
        )}
        {grupos.map(({ parte, itens }) =>
          itens.length === 0 ? null : (
            <section key={parte} aria-label={ROTULO_PARTE[parte]}>
              {filtro === FILTRO_TODAS && <h4 className="meta" style={{ marginTop: '1rem' }}>{ROTULO_PARTE[parte]}</h4>}
              <ul>
                {itens.map((g) => (
                  <Item key={g.titulo} grupo={g} novas={novas} />
                ))}
              </ul>
            </section>
          ),
        )}
      </div>
      <p className="so-leitor" role="status">
        {visiveis} {visiveis === 1 ? 'tarefa' : 'tarefas'}.
      </p>
    </div>
  );
}
