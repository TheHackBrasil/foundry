import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { PARTES, type Parte, type Tarefa } from '../../../shared/model.ts';
import { rotuloCampo, rotuloFonte, rotuloParte } from '../format.ts';
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

function Item({ grupo, novas, indice }: { grupo: GrupoTarefa; novas: ReadonlySet<string>; indice: number }) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  return (
    <li
      className={nova ? 'tarefa tarefa-nova' : 'tarefa'}
      style={{ '--stagger': Math.min(indice, 5) } as CSSProperties}
    >
      <div className="tarefa-cab">
        <p className="tarefa-titulo">{grupo.titulo}</p>
        <div className="tarefa-badges">
          {!unica && <span className="pilula-sutil num">{grupo.ocorrencias.length} origens</span>}
          {nova && <span className="pilula-coord">Nova</span>}
        </div>
      </div>
      {unica && <p className="tarefa-detalhe">{grupo.ocorrencias[0]?.detalhe}</p>}
      <ul className="origens">
        {grupo.ocorrencias.map((t) => {
          const d = t.divergencia;
          return (
            <li key={chaveTarefa(t)} className="origem-tag">
              <span>{rotuloCampo(d.campo)}</span>
              <span className="meta" aria-hidden="true">·</span>
              <span className="meta">
                {rotuloFonte(d.fonteA)} × {rotuloFonte(d.fonteB)}
              </span>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

// Abas em linha unica com indicador deslizante medido do DOM (sem quebra orfa).
export function TarefasPorParte({ tarefas, filtro, aoFiltrar, novas }: Props) {
  const id = useId();
  const lista = useRef<HTMLDivElement>(null);
  const [trilho, setTrilho] = useState<{ x: number; w: number; pronto: boolean }>({ x: 0, w: 0, pronto: false });
  const contagem = (parte: Parte): number => agruparTarefas(tarefasDaParte(tarefas, parte)).length;
  const total = agruparTarefas(tarefas).length;
  const abas: ReadonlyArray<{ valor: FiltroParte; rotulo: string; n: number }> = [
    { valor: FILTRO_TODAS, rotulo: 'Todas', n: total },
    ...PARTES.map((p) => ({ valor: p as FiltroParte, rotulo: rotuloParte(p), n: contagem(p) })),
  ];

  const partes: Parte[] = filtro === FILTRO_TODAS ? PARTES.filter((p) => contagem(p) > 0) : [filtro];
  const grupos = partes.map((parte) => ({ parte, itens: agruparTarefas(tarefasDaParte(tarefas, parte)) }));
  const visiveis = grupos.reduce((soma, g) => soma + g.itens.length, 0);

  useLayoutEffect(() => {
    const container = lista.current;
    if (!container) return;
    const atualizar = () => {
      const ativa = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      if (!ativa) return;
      setTrilho({ x: ativa.offsetLeft, w: ativa.offsetWidth, pronto: true });
    };
    atualizar();
    const ativa = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    ativa?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(atualizar);
    ro.observe(container);
    return () => ro.disconnect();
  }, [filtro, total]);

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const proxima = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
    if (proxima === undefined) return;
    e.preventDefault();
    const alvo = abas[(proxima + abas.length) % abas.length];
    if (!alvo) return;
    aoFiltrar(alvo.valor);
    lista.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[(proxima + abas.length) % abas.length]?.focus();
  }

  let ordem = 0;

  return (
    <div className="tarefas-bloco">
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
            <span>{a.rotulo}</span>
            <span className="aba-n num">{a.n}</span>
          </button>
        ))}
        {trilho.pronto && (
          <span
            className="abas-indicador"
            aria-hidden="true"
            style={{ '--ix': `${trilho.x}px`, '--iw': `${trilho.w}px` } as CSSProperties}
          />
        )}
      </div>

      <div
        id={`${id}-painel`}
        key={filtro}
        role="tabpanel"
        aria-labelledby={`${id}-${filtro}`}
        className="tarefas-lista"
      >
        {tarefas.length === 0 && (
          <p className="dica tarefas-vazio">
            Nenhuma tarefa por enquanto. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.
          </p>
        )}
        {tarefas.length > 0 && visiveis === 0 && filtro !== FILTRO_TODAS && (
          <p className="dica tarefas-vazio">Nenhuma tarefa para {rotuloParte(filtro)} neste pedido.</p>
        )}
        {grupos.map(({ parte, itens }) =>
          itens.length === 0 ? null : (
            <section key={parte} aria-label={rotuloParte(parte)} className="tarefas-grupo">
              {filtro === FILTRO_TODAS && <h4 className="tarefas-grupo-cab">{rotuloParte(parte)}</h4>}
              <ul>
                {itens.map((g) => {
                  const idx = ordem++;
                  return <Item key={g.titulo} grupo={g} novas={novas} indice={idx} />;
                })}
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
