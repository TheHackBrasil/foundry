import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  PARTES,
  type AlvoFocoGenUI,
  type CampoVigiado,
  type Contato,
  type FonteDocumento,
  type Parte,
  type Tarefa,
} from '../../../shared/model.ts';
import { copiarTexto } from '../copiar.ts';
import { rotuloCampo, rotuloCanalContato, rotuloFonte, rotuloParte } from '../format.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  chaveTarefa,
  tarefasDaParte,
  type FiltroParte,
  type GrupoTarefa,
} from '../matriz.ts';
import {
  IconeAviso,
  IconeCaminhao,
  IconeChevron,
  IconeConfere,
  IconeCopiar,
  IconeErro,
  IconeFabrica,
  IconeFinanceiro,
  IconeFiscal,
  IconeGalpao,
} from './icones.tsx';

function movimentoReduzidoAtivo(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// Reset inline do botao de disclosure: as folhas de estilo da torre pertencem
// a outra frente, entao o toggle recebe so o minimo para parecer o titulo.
const ESTILO_TOGGLE_SETOR: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  minWidth: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

// O contato usa a classe original (cor/tamanho) com o truncamento desligado:
// telefone e canal nunca sao cortados por ellipsis (spec 0015, F6).
const ESTILO_CONTATO_SEM_CORTE: CSSProperties = {
  overflow: 'visible',
  textOverflow: 'clip',
  whiteSpace: 'normal',
};

function iconeDoSetor(parte: Parte) {
  switch (parte) {
    case 'fornecedor':
      return <IconeFabrica />;
    case 'transportadora':
      return <IconeCaminhao />;
    case 'cd':
      return <IconeGalpao />;
    case 'fiscal':
      return <IconeFiscal />;
    case 'financeiro':
      return <IconeFinanceiro />;
  }
}

interface Props {
  tarefas: readonly Tarefa[];
  contatos: readonly Contato[];
  filtro: FiltroParte;
  novas: ReadonlySet<string>;
  direcao: -1 | 0 | 1;
  painelId: string;
  rotuloAbaId: string;
  focoAtivo?: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
}

interface OrigemAgrupada {
  chave: string;
  campo: CampoVigiado;
  fonteA: FonteDocumento;
  fonteB: FonteDocumento;
  rotulo: string;
}

function extrairOrigens(ocorrencias: readonly Tarefa[]): OrigemAgrupada[] {
  const vistos = new Set<string>();
  const lista: OrigemAgrupada[] = [];
  for (const t of ocorrencias) {
    const { campo, fonteA, fonteB } = t.divergencia;
    const chave = `${campo}|${fonteA}|${fonteB}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push({
      chave,
      campo,
      fonteA,
      fonteB,
      rotulo: `${rotuloFonte(fonteA)} × ${rotuloFonte(fonteB)}`,
    });
  }
  return lista;
}

function origemCorrespondeFoco(origem: OrigemAgrupada, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'divergencia') {
    return (
      foco.campo === origem.campo &&
      ((foco.fonteA === origem.fonteA && foco.fonteB === origem.fonteB) ||
        (foco.fonteA === origem.fonteB && foco.fonteB === origem.fonteA))
    );
  }
  if (foco.tipo === 'celula') {
    return (
      foco.campo === origem.campo &&
      (foco.fonte === origem.fonteA || foco.fonte === origem.fonteB)
    );
  }
  return false;
}

function grupoCorrespondeFoco(grupo: GrupoTarefa, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'parte') return grupo.parte === foco.parte;
  if (foco.tipo === 'divergencia') {
    return grupo.ocorrencias.some(
      (t) =>
        t.divergencia.campo === foco.campo &&
        ((t.divergencia.fonteA === foco.fonteA && t.divergencia.fonteB === foco.fonteB) ||
          (t.divergencia.fonteA === foco.fonteB && t.divergencia.fonteB === foco.fonteA)),
    );
  }
  if (foco.tipo === 'celula') {
    return grupo.ocorrencias.some(
      (t) =>
        t.divergencia.campo === foco.campo &&
        (t.divergencia.fonteA === foco.fonte || t.divergencia.fonteB === foco.fonte),
    );
  }
  return false;
}

type EstadoEnvio =
  | { tipo: 'ocioso' }
  | { tipo: 'enviando' }
  | { tipo: 'enviado' }
  | { tipo: 'erro'; mensagem: string; abrirAgenda: boolean };

const ItemTarefa = memo(function ItemTarefa({
  grupo,
  novas,
  focoAtivo,
  aoFocar,
}: {
  grupo: GrupoTarefa;
  novas: ReadonlySet<string>;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
}) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  const focada = grupoCorrespondeFoco(grupo, focoAtivo);
  const origens = useMemo(() => extrairOrigens(grupo.ocorrencias), [grupo.ocorrencias]);

  // Roving tabindex nas origens (spec 0015, F7): um unico ponto de Tab por
  // tarefa; setas percorrem as origens do grupo.
  const [posOrigem, setPosOrigem] = useState(0);
  const posEfetiva = Math.min(posOrigem, Math.max(0, origens.length - 1));
  const origensRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const teclarOrigem = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
      const total = origens.length;
      let prox = -1;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') prox = (i + 1) % total;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prox = (i - 1 + total) % total;
      else if (e.key === 'Home') prox = 0;
      else if (e.key === 'End') prox = total - 1;
      if (prox < 0) return;
      e.preventDefault();
      setPosOrigem(prox);
      origensRefs.current[prox]?.focus();
    },
    [origens.length],
  );

  function alternarOrigem(origem: OrigemAgrupada) {
    if (!aoFocar) return;
    if (origemCorrespondeFoco(origem, focoAtivo) && focoAtivo?.tipo === 'divergencia') {
      aoFocar(null);
      return;
    }
    aoFocar({
      tipo: 'divergencia',
      campo: origem.campo,
      fonteA: origem.fonteA,
      fonteB: origem.fonteB,
    });
  }

  const classes = ['tarefa', nova ? 'tarefa-nova' : '', focada ? 'tarefa-focada' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes}>
      <div className="tarefa-cab">
        <p className="tarefa-titulo">{grupo.titulo}</p>
        {nova && (
          <div className="tarefa-badges">
            <span className="pilula-coord">Nova</span>
          </div>
        )}
      </div>

      {unica && <p className="tarefa-detalhe">{grupo.ocorrencias[0]?.detalhe}</p>}

      <div className="origens-lista" role="group" aria-label="Origens da divergência">
        {origens.map((origem, i) => {
          const ativa = origemCorrespondeFoco(origem, focoAtivo);
          if (!aoFocar) {
            return (
              <span key={origem.chave} className="origem-linha">
                <span className="origem-campo">{rotuloCampo(origem.campo)}:</span>{' '}
                <span className="meta">{origem.rotulo}</span>
              </span>
            );
          }
          return (
            <button
              key={origem.chave}
              ref={(el) => {
                origensRefs.current[i] = el;
              }}
              type="button"
              className="origem-btn"
              aria-pressed={ativa}
              tabIndex={i === posEfetiva ? 0 : -1}
              onKeyDown={(e) => teclarOrigem(e, i)}
              onFocus={() => setPosOrigem(i)}
              onClick={() => alternarOrigem(origem)}
            >
              <span className="origem-campo">{rotuloCampo(origem.campo)}:</span>{' '}
              <span>{origem.rotulo}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
});

function SetorTarefas({
  parte,
  indice,
  itens,
  contato,
  novas,
  focoAtivo,
  aoFocar,
  aoNotificar,
  aoAbrirAgenda,
  abertoInicial,
  corpoId,
}: {
  parte: Parte;
  indice: number;
  itens: readonly GrupoTarefa[];
  contato: Contato | undefined;
  novas: ReadonlySet<string>;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  abertoInicial: boolean;
  corpoId: string;
}) {
  const [envio, setEnvio] = useState<EstadoEnvio>({ tipo: 'ocioso' });
  // Disclosure por setor (spec 0015, F6): `aberto` e a intencao (aria-expanded),
  // `corpoMontado` segura o conteudo durante a animacao de fechamento — a
  // lista nao desmonta no mesmo commit em que a altura colapsa.
  const [aberto, setAberto] = useState(abertoInicial);
  const [corpoMontado, setCorpoMontado] = useState(abertoInicial);
  const [copiadoContato, setCopiadoContato] = useState(false);
  // Roving no cabecalho do setor (spec 0015, F7): toggle, copiar e acao
  // dividem um unico ponto de Tab; setas horizontais percorrem os tres.
  const [posCab, setPosCab] = useState(0);
  const cabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const resetTimerRef = useRef<number | null>(null);
  const copiaTimerRef = useRef<number | null>(null);
  const corpoRef = useRef<HTMLDivElement>(null);
  const abertoAntesRef = useRef(abertoInicial);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    },
    [],
  );

  const primeiroCampo = itens[0]?.ocorrencias[0]?.divergencia.campo;
  const canalIncompativel = contato?.canal === 'email';
  const semCanalDireto = !contato || canalIncompativel;
  const setorFocado = focoAtivo?.tipo === 'parte' && focoAtivo.parte === parte;

  // Sem contato o botao de copiar some: cabecalho fica com toggle + acao.
  const totalCab = contato ? 3 : 2;
  const posEfCab = Math.min(posCab, totalCab - 1);
  const idxAcao = contato ? 2 : 1;

  function teclarCab(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    let prox = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') prox = (i + 1) % totalCab;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prox = (i - 1 + totalCab) % totalCab;
    else if (e.key === 'Home') prox = 0;
    else if (e.key === 'End') prox = totalCab - 1;
    if (prox < 0) return;
    e.preventDefault();
    setPosCab(prox);
    cabRefs.current[prox]?.focus();
  }

  // Foco externo (domino/lente) abre o setor sozinho: destacar um grupo
  // fechado sem mostra-lo seria um destaque invisivel.
  useEffect(() => {
    if (!setorFocado) return;
    setCorpoMontado(true);
    setAberto(true);
  }, [setorFocado]);

  // Abertura animada via WAAPI: o corpo ja esta montado quando `aberto` vira
  // true; medir aqui ainda vale o frame novo (altura real).
  useLayoutEffect(() => {
    if (abertoAntesRef.current === aberto) return;
    abertoAntesRef.current = aberto;
    const el = corpoRef.current;
    if (!el || !aberto) return;
    if (movimentoReduzidoAtivo() || typeof el.animate !== 'function') return;
    const h = el.scrollHeight;
    if (h <= 0) return;
    el.style.overflow = 'hidden';
    const anim = el.animate(
      [{ height: '0px', opacity: 0.35 }, { height: `${h}px`, opacity: 1 }],
      { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
    const limpar = () => {
      el.style.overflow = '';
    };
    anim.onfinish = limpar;
    anim.oncancel = limpar;
  }, [aberto]);

  function alternarAberto() {
    if (!aberto) {
      setCorpoMontado(true);
      setAberto(true);
      return;
    }
    const el = corpoRef.current;
    const animavel = el !== null && !movimentoReduzidoAtivo() && typeof el.animate === 'function';
    if (animavel && el) {
      const h = el.getBoundingClientRect().height;
      el.style.overflow = 'hidden';
      const anim = el.animate([{ height: `${h}px` }, { height: '0px' }], {
        duration: 180,
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      });
      const fim = () => setCorpoMontado(false);
      anim.onfinish = fim;
      anim.oncancel = fim;
      setAberto(false);
      return;
    }
    setCorpoMontado(false);
    setAberto(false);
  }

  async function dispararAviso() {
    if (envio.tipo === 'enviando') return;
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setEnvio({ tipo: 'enviando' });
    try {
      await aoNotificar(parte, primeiroCampo);
      setEnvio({ tipo: 'enviado' });
      resetTimerRef.current = window.setTimeout(() => {
        setEnvio({ tipo: 'ocioso' });
        resetTimerRef.current = null;
      }, 4500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar aviso.';
      const envolveContato = /contato|canal/i.test(msg);
      setEnvio({ tipo: 'erro', mensagem: msg, abrirAgenda: envolveContato });
    }
  }

  async function copiarContato() {
    if (!contato) return;
    if (!(await copiarTexto(contato.destino))) return;
    setCopiadoContato(true);
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    copiaTimerRef.current = window.setTimeout(() => {
      setCopiadoContato(false);
      copiaTimerRef.current = null;
    }, 1800);
  }

  return (
    <section
      aria-label={rotuloParte(parte)}
      className={
        setorFocado
          ? 'tarefas-grupo slab-mineral tarefas-grupo-focado'
          : 'tarefas-grupo slab-mineral'
      }
      style={{ '--grp-i': Math.min(indice, 5) } as CSSProperties}
    >
      <div className="tarefas-grupo-cab">
        <div className="tarefas-grupo-info">
          <div className="tarefas-grupo-titulo-linha">
            <h3 className="tarefas-grupo-titulo">
              <button
                ref={(el) => {
                  cabRefs.current[0] = el;
                }}
                type="button"
                style={ESTILO_TOGGLE_SETOR}
                aria-expanded={aberto}
                aria-controls={corpoId}
                aria-label={`${aberto ? 'Recolher' : 'Expandir'} tarefas de ${rotuloParte(parte)}`}
                tabIndex={posEfCab === 0 ? 0 : -1}
                onKeyDown={(e) => teclarCab(e, 0)}
                onFocus={() => setPosCab(0)}
                onClick={alternarAberto}
              >
                <span className="tarefas-grupo-icone" aria-hidden="true">{iconeDoSetor(parte)}</span>
                <span>{rotuloParte(parte)}</span>
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-flex',
                    transform: aberto ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform 180ms var(--ease-out)',
                  }}
                >
                  <IconeChevron />
                </span>
              </button>
            </h3>
            <span className="tarefas-grupo-cont mono num">{itens.length}</span>
          </div>
          <span className="tarefas-grupo-contato" style={ESTILO_CONTATO_SEM_CORTE}>
            {contato ? (
              <>
                {rotuloCanalContato(contato.canal)} ·{' '}
                <span className="mono" style={{ overflowWrap: 'anywhere' }}>
                  {contato.destino}
                </span>
                <button
                  ref={(el) => {
                    cabRefs.current[1] = el;
                  }}
                  type="button"
                  className={copiadoContato ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'}
                  tabIndex={posEfCab === 1 ? 0 : -1}
                  onKeyDown={(e) => teclarCab(e, 1)}
                  onFocus={() => setPosCab(1)}
                  onClick={() => void copiarContato()}
                  aria-label={
                    copiadoContato
                      ? 'Contato copiado'
                      : `Copiar ${rotuloCanalContato(contato.canal)} ${contato.destino}`
                  }
                  title={copiadoContato ? 'Contato copiado' : 'Copiar contato'}
                  style={{ verticalAlign: 'baseline' }}
                >
                  <span className="icone-slot-sm" aria-hidden="true">
                    <span className={`icone-troca icone-troca-rapida ${copiadoContato ? '' : 'visivel'}`}>
                      <IconeCopiar />
                    </span>
                    <span className={`icone-troca icone-troca-rapida ${copiadoContato ? 'visivel' : ''}`}>
                      <IconeConfere />
                    </span>
                  </span>
                </button>
              </>
            ) : (
              'Sem contato cadastrado'
            )}
          </span>
        </div>

        <div className="tarefas-grupo-acao">
          {semCanalDireto ? (
            <button
              ref={(el) => {
                cabRefs.current[idxAcao] = el;
              }}
              type="button"
              className="botao-sutil tarefa-btn-acao"
              tabIndex={posEfCab === idxAcao ? 0 : -1}
              onKeyDown={(e) => teclarCab(e, idxAcao)}
              onFocus={() => setPosCab(idxAcao)}
              onClick={() => aoAbrirAgenda(parte)}
            >
              {contato ? 'Configurar canal' : 'Configurar'}
            </button>
          ) : (
            <button
              ref={(el) => {
                cabRefs.current[idxAcao] = el;
              }}
              type="button"
              className={
                envio.tipo === 'enviado'
                  ? 'botao-sutil tarefa-btn-acao tarefa-btn-ok'
                  : 'botao-sutil tarefa-btn-acao'
              }
              disabled={envio.tipo === 'enviando'}
              tabIndex={posEfCab === idxAcao ? 0 : -1}
              onKeyDown={(e) => teclarCab(e, idxAcao)}
              onFocus={() => setPosCab(idxAcao)}
              onClick={() => void dispararAviso()}
            >
              {envio.tipo === 'enviando' ? (
                <span>Enviando…</span>
              ) : envio.tipo === 'enviado' ? (
                <>
                  <IconeConfere />
                  <span>Enviado</span>
                </>
              ) : (
                <>
                  <IconeAviso />
                  <span>Avisar</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <div ref={corpoRef} id={corpoId} hidden={!corpoMontado}>
        {envio.tipo === 'erro' && (
          <div className="tarefa-envio-erro" role="alert">
            <span className="tarefa-envio-erro-texto">
              <IconeErro />
              <span>{envio.mensagem}</span>
            </span>
            {envio.abrirAgenda && (
              <button
                type="button"
                className="tarefa-link-config"
                onClick={() => aoAbrirAgenda(parte)}
              >
                Configurar
              </button>
            )}
          </div>
        )}

        <ul>
          {itens.map((g) => (
            <ItemTarefa
              key={g.titulo}
              grupo={g}
              novas={novas}
              focoAtivo={focoAtivo}
              {...(aoFocar ? { aoFocar } : {})}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

export const TarefasPorParte = memo(function TarefasPorParte({
  tarefas,
  contatos,
  filtro,
  novas,
  direcao,
  painelId,
  rotuloAbaId,
  focoAtivo = null,
  aoFocar,
  aoNotificar,
  aoAbrirAgenda,
}: Props) {
  const contatoPorParte = useMemo(
    () => new Map<Parte, Contato>(contatos.map((c) => [c.parte, c])),
    [contatos],
  );

  const grupos = useMemo(() => {
    const partes: Parte[] =
      filtro === FILTRO_TODAS
        ? PARTES.filter((p) => tarefasDaParte(tarefas, p).length > 0)
        : [filtro];
    return partes.map((parte) => ({
      parte,
      itens: agruparTarefas(tarefasDaParte(tarefas, parte)),
    }));
  }, [tarefas, filtro]);

  const gruposAtivos = useMemo(() => grupos.filter((g) => g.itens.length > 0), [grupos]);
  const visiveis = grupos.reduce((soma, g) => soma + g.itens.length, 0);
  // Default do disclosure (spec 0015, F6): ate 2 setores com tarefa tudo
  // aberto; com 3+, so o primeiro abre e o resto fica a um toque com
  // contagem e contato visiveis no cabecalho — densidade preservada sem
  // estourar a dobra. Setor focado via domino abre sozinho no SetorTarefas.
  const abertoPadrao = (indiceAtivo: number): boolean =>
    gruposAtivos.length <= 2 || indiceAtivo === 0;

  return (
    <div className="tarefas-bloco">
      <div
        id={painelId}
        key={filtro}
        role="tabpanel"
        aria-labelledby={rotuloAbaId}
        className="tarefas-lista"
        data-dir={direcao}
      >
        {tarefas.length === 0 && (
          <p className="dica tarefas-vazio">
            Nenhuma tarefa aberta. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.
          </p>
        )}
        {tarefas.length > 0 && visiveis === 0 && filtro !== FILTRO_TODAS && (
          <p className="dica tarefas-vazio">Nenhuma tarefa para {rotuloParte(filtro)} neste pedido.</p>
        )}
        {visiveis > 0 && (
          <div className="tarefas-superficie">
            {grupos.map(({ parte, itens }) =>
              itens.length === 0 ? null : (
                <SetorTarefas
                  key={parte}
                  parte={parte}
                  indice={gruposAtivos.findIndex((g) => g.parte === parte)}
                  itens={itens}
                  contato={contatoPorParte.get(parte)}
                  novas={novas}
                  focoAtivo={focoAtivo}
                  {...(aoFocar ? { aoFocar } : {})}
                  aoNotificar={aoNotificar}
                  aoAbrirAgenda={aoAbrirAgenda}
                  abertoInicial={abertoPadrao(gruposAtivos.findIndex((g) => g.parte === parte))}
                  corpoId={`${painelId}-${parte}-corpo`}
                />
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
});
