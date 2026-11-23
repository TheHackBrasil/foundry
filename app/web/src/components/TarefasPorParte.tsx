import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { PARTES, type CampoVigiado, type Parte, type Tarefa } from '../../../shared/model.ts';
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
  aoFiltrar: (filtro: FiltroParte, direcao?: -1 | 0 | 1) => void;
  novas: ReadonlySet<string>;
}

function agruparOrigensPorCampo(
  ocorrencias: readonly Tarefa[],
): Array<{ campo: CampoVigiado; pares: string[] }> {
  const mapa = new Map<CampoVigiado, string[]>();
  for (const t of ocorrencias) {
    const { campo, fonteA, fonteB } = t.divergencia;
    const par = `${rotuloFonte(fonteA)} × ${rotuloFonte(fonteB)}`;
    const lista = mapa.get(campo);
    if (lista) {
      if (!lista.includes(par)) lista.push(par);
    } else {
      mapa.set(campo, [par]);
    }
  }
  return [...mapa.entries()].map(([campo, pares]) => ({ campo, pares }));
}

function Item({ grupo, novas }: { grupo: GrupoTarefa; novas: ReadonlySet<string> }) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  const origensPorCampo = agruparOrigensPorCampo(grupo.ocorrencias);
  return (
    <li className={nova ? 'tarefa tarefa-nova' : 'tarefa'}>
      <div className="tarefa-cab">
        <p className="tarefa-titulo">{grupo.titulo}</p>
        <div className="tarefa-badges">
          {!unica && <span className="pilula-sutil num">{grupo.ocorrencias.length} origens</span>}
          {nova && <span className="pilula-coord">Nova</span>}
        </div>
      </div>
      {unica && <p className="tarefa-detalhe">{grupo.ocorrencias[0]?.detalhe}</p>}
      <ul className="origens-lista">
        {origensPorCampo.map(({ campo, pares }) => (
          <li key={campo} className="origem-linha">
            <span className="origem-campo">{rotuloCampo(campo)}:</span>{' '}
            <span className="meta">{pares.join(' · ')}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

// Abas em linha única com indicador GPU (translate3d + scaleX) e máscaras de transbordo.
export function TarefasPorParte({ tarefas, filtro, aoFiltrar, novas }: Props) {
  const id = useId();
  const lista = useRef<HTMLDivElement>(null);
  const [trilho, setTrilho] = useState<{ x: number; w: number; pronto: boolean }>({ x: 0, w: 0, pronto: false });
  const [fadeEsq, setFadeEsq] = useState(false);
  const [fadeDir, setFadeDir] = useState(false);
  const [direcao, setDirecao] = useState<-1 | 0 | 1>(0);

  const contagem = (parte: Parte): number => agruparTarefas(tarefasDaParte(tarefas, parte)).length;
  const total = agruparTarefas(tarefas).length;
  const abas: ReadonlyArray<{ valor: FiltroParte; rotulo: string; n: number }> = [
    { valor: FILTRO_TODAS, rotulo: 'Todas', n: total },
    ...PARTES.map((p) => ({ valor: p as FiltroParte, rotulo: rotuloParte(p), n: contagem(p) })),
  ];
  const assinaturaContagens = abas.map((a) => a.n).join(',');
  const indiceAtual = abas.findIndex((a) => a.valor === filtro);

  const partes: Parte[] = filtro === FILTRO_TODAS ? PARTES.filter((p) => contagem(p) > 0) : [filtro];
  const grupos = partes.map((parte) => ({ parte, itens: agruparTarefas(tarefasDaParte(tarefas, parte)) }));
  const visiveis = grupos.reduce((soma, g) => soma + g.itens.length, 0);

  useLayoutEffect(() => {
    const container = lista.current;
    if (!container) return;
    let ativo = true;

    const atualizarFades = () => {
      if (!ativo) return;
      const esq = container.scrollLeft > 2;
      const dir = container.scrollLeft + container.clientWidth < container.scrollWidth - 2;
      setFadeEsq(esq);
      setFadeDir(dir);
    };

    const atualizar = () => {
      if (!ativo) return;
      const ativa = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      if (ativa) {
        setTrilho({ x: ativa.offsetLeft, w: ativa.offsetWidth, pronto: true });
      }
      atualizarFades();
    };

    atualizar();
    const ativa = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
    const reduzido =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    ativa?.scrollIntoView({ behavior: reduzido ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' });

    container.addEventListener('scroll', atualizarFades, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(atualizar);
      ro.observe(container);
    }
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(atualizar);
    }

    return () => {
      ativo = false;
      container.removeEventListener('scroll', atualizarFades);
      ro?.disconnect();
    };
  }, [filtro, assinaturaContagens]);

  function trocarAba(valor: FiltroParte, indiceDestino: number) {
    if (valor === filtro) return;
    const dir: -1 | 0 | 1 =
      indiceAtual === -1 || indiceDestino === indiceAtual
        ? 0
        : indiceDestino > indiceAtual
          ? 1
          : -1;
    setDirecao(dir);
    aoFiltrar(valor, dir);
  }

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const proxima = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
    if (proxima === undefined) return;
    e.preventDefault();
    const destino = (proxima + abas.length) % abas.length;
    const alvo = abas[destino];
    if (!alvo) return;
    trocarAba(alvo.valor, destino);
    lista.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus();
  }

  return (
    <div className="tarefas-bloco">
      <div
        className="abas-wrap"
        data-fade-esq={fadeEsq ? 'true' : 'false'}
        data-fade-dir={fadeDir ? 'true' : 'false'}
      >
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
              onClick={() => trocarAba(a.valor, i)}
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
              style={{ '--ix': `${trilho.x}px`, '--iw-escala': trilho.w } as CSSProperties}
            />
          )}
        </div>
      </div>

      <div
        id={`${id}-painel`}
        key={filtro}
        role="tabpanel"
        aria-labelledby={`${id}-${filtro}`}
        className="tarefas-lista"
        data-dir={direcao}
      >
        {tarefas.length === 0 && (
          <p className="dica tarefas-vazio">
            Nenhuma tarefa por enquanto. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.
          </p>
        )}
        {tarefas.length > 0 && visiveis === 0 && filtro !== FILTRO_TODAS && (
          <p className="dica tarefas-vazio">Nenhuma tarefa para {rotuloParte(filtro)} neste pedido.</p>
        )}
        {visiveis > 0 && (
          <div className="tarefas-superficie">
            {grupos.map(({ parte, itens }) =>
              itens.length === 0 ? null : (
                <section key={parte} aria-label={rotuloParte(parte)} className="tarefas-grupo">
                  {filtro === FILTRO_TODAS && <h3 className="tarefas-grupo-cab">{rotuloParte(parte)}</h3>}
                  <ul>
                    {itens.map((g) => (
                      <Item key={g.titulo} grupo={g} novas={novas} />
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </div>
      <p className="so-leitor" role="status">
        {visiveis} {visiveis === 1 ? 'tarefa' : 'tarefas'}.
      </p>
    </div>
  );
}
