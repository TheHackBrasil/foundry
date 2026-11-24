import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  CamposObservados,
  Contato,
  EventoStreamMandato,
  Parte,
  ProjecaoPedido,
  RespostaMandato,
  RespostaSimulacao,
  ViewSpecV2,
} from '../../../shared/model.ts';
import { ErroMandatoApi } from '../api.ts';
import { aplicarHipoteseComoPlanilha, transmitirMandatoStream } from '../apiOps.ts';
import {
  chaveCurta,
  formatarDuracao,
  formatarValor,
  rotuloAcaoMandato,
  rotuloCampo,
  rotuloFonte,
  rotuloMotivoNotificacao,
  rotuloParte,
  variacao,
} from '../format.ts';
import {
  interpretarResultadoMandato,
  resumoParaAnuncio,
  type ItemNotificar,
  type ItemPropagar,
  type ItemResumir,
  type ItemSimular,
  type ResultadoMandatoInterpretado,
} from '../mandato.ts';
import {
  CamadaShader,
  SeloMonolitosShader,
  type ResolucaoShader,
} from '../shaders/index.ts';
import { useVoz } from '../useVoz.ts';
import {
  IconeComando,
  IconeErro,
  IconeFechar,
  IconeMic,
  IconeOk,
  IconeParar,
  IconeRetorno,
} from './icones.tsx';
import { PalcoGenUI, type EtapaStreamGenUI } from './PalcoGenUI.tsx';
import { VisualizadorVoz } from './VisualizadorVoz.tsx';

const SUGESTOES: ReadonlyArray<{ rotulo: string; comando: string }> = [
  { rotulo: 'Qual o atraso e por que diverge?', comando: 'Qual o atraso e por que os documentos divergem?' },
  { rotulo: 'Simule entrega 28/01/2026', comando: 'Simule a entrega para 28/01/2026' },
  { rotulo: 'Visão do Fiscal', comando: 'Resuma o que importa para o fiscal' },
  { rotulo: 'Propague tarefas', comando: 'Propague o atraso' },
];

const LIMITE_TURNOS = 6;

interface TurnoMandato {
  id: number;
  comando: string;
  interpretado: ResultadoMandatoInterpretado;
  spec: ViewSpecV2 | null;
  etapas: EtapaStreamGenUI[];
  blocos: BlocoGenUI[];
}

interface Props {
  pedidoId: string;
  daSessao: boolean;
  projecao: ProjecaoPedido;
  contatos: readonly Contato[];
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar: (alvo: AlvoFocoGenUI | null) => void;
  aoAnunciar: (texto: string) => void;
  aoSelecionar: (pedidoId: string) => void;
  aoAplicarPapel?: (papel: Parte) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoAbrirAssistente: (comando?: string) => void;
  aoGarantirSessao: (pedidoId?: string | null) => Promise<string | null>;
  aoRecarregarPedido: () => Promise<void>;
  aoSimulacaoAtiva?: (ativa: boolean) => void;
  aoPulsoDomino?: () => void;
}

function elementoEditavel(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function resumirComandoCurto(texto: string): string {
  return texto.length > 34 ? `${texto.slice(0, 33).trimEnd()}…` : texto;
}

function CartaoPropagar({ itens, novosEventos }: { itens: readonly ItemPropagar[]; novosEventos: number }) {
  return (
    <div className="cmd-corpo">
      {itens.map((item) => (
        <div key={item.pedidoId} className="cmd-bloco">
          <div className="kpi-faixa">
            <div className="kpi-item" style={{ '--stagger': 0 } as CSSProperties}>
              <span className="kpi-valor num">{item.divergencias.length}</span>
              <span className="kpi-rotulo">
                {item.divergencias.length === 1 ? 'Divergência' : 'Divergências'}
              </span>
            </div>
            <div className="kpi-item" style={{ '--stagger': 1 } as CSSProperties}>
              <span className="kpi-valor num">{item.tarefas.length}</span>
              <span className="kpi-rotulo">
                {item.tarefas.length === 1 ? 'Tarefa propagada' : 'Tarefas propagadas'}
              </span>
            </div>
            <div className="kpi-item" style={{ '--stagger': 2 } as CSSProperties}>
              <span className={item.eventosNovos > 0 ? 'kpi-valor kpi-destaque num' : 'kpi-valor num'}>
                {item.eventosNovos}
              </span>
              <span className="kpi-rotulo">
                {item.eventosNovos === 1 ? 'Novo evento' : 'Novos eventos'}
              </span>
            </div>
          </div>
          {item.eventosNovos === 0 && (
            <p className="meta">
              {novosEventos === 0
                ? 'Registro já estava sincronizado: nenhuma duplicata gravada na cadeia.'
                : 'Nenhuma novidade gravada neste pedido.'}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CartaoSimular({ itens }: { itens: readonly ItemSimular[] }) {
  return (
    <div className="cmd-corpo">
      {itens.map((item) => (
        <div key={item.pedidoId} className="cmd-bloco">
          {item.divergencias.length === 0 ? (
            <p className="dica">Nenhuma divergência prevista para esta hipótese.</p>
          ) : (
            <div className="sim-tabela" role="table" aria-label="Divergências previstas na simulação">
              <div role="row" className="sim-row sim-h">
                <div role="columnheader">Campo</div>
                <div role="columnheader">Atual</div>
                <div role="columnheader">Hipótese</div>
                <div role="columnheader">Impacto</div>
              </div>
              <div role="rowgroup">
                {item.divergencias.map((d, i) => {
                  const delta = variacao(d.campo, d.valorB, d.valorA);
                  return (
                    <div
                      role="row"
                      key={`${d.campo}-${d.fonteA}-${i}`}
                      className="sim-row sim-b"
                      style={{ '--stagger': i } as CSSProperties}
                    >
                      <div role="rowheader" className="campo">
                        {rotuloCampo(d.campo)}
                      </div>
                      <div role="cell" data-col="Atual">
                        <span className="num">{formatarValor(d.campo, d.valorA)}</span>
                        <span className="meta"> · {rotuloFonte(d.fonteA)}</span>
                      </div>
                      <div role="cell" data-col="Hipótese" className="sim-hip">
                        <span className="num">{formatarValor(d.campo, d.valorB)}</span>
                      </div>
                      <div role="cell" data-col="Impacto">
                        {delta ? (
                          <span className="delta-pilula mono">{delta}</span>
                        ) : (
                          <span className="meta">Mudança de estado</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {item.tarefasPorParte.length > 0 && (
            <div className="sim-partes-lista">
              <span className="meta">Partes acionadas ({item.tarefas.length}):</span>
              {item.tarefasPorParte.map((p) => (
                <span key={p.parte} className="pilula-sutil num">
                  {rotuloParte(p.parte)} · {p.quantidade}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CartaoResumir({ itens }: { itens: readonly ItemResumir[] }) {
  return (
    <div className="cmd-corpo">
      {itens.map((item) => (
        <div key={item.pedidoId} className="cmd-bloco">
          <p className="cmd-resumo">{item.resumo}</p>
        </div>
      ))}
    </div>
  );
}

function CartaoNotificar({ itens }: { itens: readonly ItemNotificar[] }) {
  return (
    <div className="cmd-corpo">
      {itens.map((item, i) => {
        const entregue = item.status === 'entregue';
        const classePilula = entregue
          ? 'pilula-ok'
          : item.motivo === 'falha_envio'
            ? 'pilula-erro'
            : 'pilula-warn';
        return (
          <div key={`${item.pedidoId}-${i}`} className="cmd-recibo">
            <span className={classePilula}>
              {entregue ? <IconeOk /> : <IconeErro />}
              {entregue ? 'Entregue' : 'Não entregue'}
            </span>
            <span className="registro-parte">
              {item.parte ? rotuloParte(item.parte) : 'Parte não identificada'}
            </span>
            {item.motivo && <span className="meta">{rotuloMotivoNotificacao(item.motivo)}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function BarraMandatos({
  pedidoId,
  daSessao,
  projecao,
  contatos,
  focoAtivo,
  aoFocar,
  aoAnunciar,
  aoSelecionar,
  aoAplicarPapel,
  aoNotificar,
  aoAbrirAgenda,
  aoGarantirSessao,
  aoRecarregarPedido,
  aoSimulacaoAtiva,
  aoPulsoDomino,
}: Props) {
  const inputId = useId();
  const erroId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const enviarBtnRef = useRef<HTMLButtonElement>(null);
  const vozBtnRef = useRef<HTMLButtonElement>(null);
  const pararBtnRef = useRef<HTMLButtonElement>(null);
  const anuncioTimerRef = useRef<number | null>(null);
  const resolucaoTimerRef = useRef<number | null>(null);
  const tremorTimerRef = useRef<number | null>(null);
  const tremorRafRef = useRef<number | null>(null);
  const abortStreamRef = useRef<AbortController | null>(null);
  const textoPreVozRef = useRef('');
  const focouPararRef = useRef(false);
  const eraOuvindoRef = useRef(false);
  const concluiuComFocoRef = useRef(false);
  const turnoSeqRef = useRef(0);

  const [texto, setTexto] = useState('');
  const [provisorio, setProvisorio] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [etapasLive, setEtapasLive] = useState<EtapaStreamGenUI[]>([]);
  const [blocosLive, setBlocosLive] = useState<BlocoGenUI[]>([]);
  const [erroCmd, setErroCmd] = useState<string | null>(null);
  const [turnos, setTurnos] = useState<TurnoMandato[]>([]);
  const [turnoAtivoId, setTurnoAtivoId] = useState<number | null>(null);
  const [palcoAberto, setPalcoAberto] = useState(false);
  const [tremendo, setTremendo] = useState(false);
  const [sugestaoAtiva, setSugestaoAtiva] = useState(-1);
  const [origemClique, setOrigemClique] = useState<readonly [number, number]>([0.5, 0.5]);
  const [resolucaoBotao, setResolucaoBotao] = useState<ResolucaoShader>(null);

  const limparTimerAnuncio = useCallback(() => {
    if (anuncioTimerRef.current !== null) {
      window.clearTimeout(anuncioTimerRef.current);
      anuncioTimerRef.current = null;
    }
  }, []);

  const marcarResolucao = useCallback((res: 'ok' | 'erro') => {
    if (resolucaoTimerRef.current !== null) {
      window.clearTimeout(resolucaoTimerRef.current);
      resolucaoTimerRef.current = null;
    }
    setResolucaoBotao(res);
    resolucaoTimerRef.current = window.setTimeout(() => {
      setResolucaoBotao(null);
      resolucaoTimerRef.current = null;
    }, 450);
  }, []);

  const acionarTremor = useCallback(() => {
    if (tremorTimerRef.current !== null) {
      window.clearTimeout(tremorTimerRef.current);
      tremorTimerRef.current = null;
    }
    if (tremorRafRef.current !== null) {
      window.cancelAnimationFrame(tremorRafRef.current);
      tremorRafRef.current = null;
    }
    setTremendo(false);
    tremorRafRef.current = window.requestAnimationFrame(() => {
      tremorRafRef.current = null;
      setTremendo(true);
      tremorTimerRef.current = window.setTimeout(() => {
        setTremendo(false);
        tremorTimerRef.current = null;
      }, 240);
    });
  }, []);

  useEffect(
    () => () => {
      abortStreamRef.current?.abort();
      limparTimerAnuncio();
      if (resolucaoTimerRef.current !== null) window.clearTimeout(resolucaoTimerRef.current);
      if (tremorTimerRef.current !== null) window.clearTimeout(tremorTimerRef.current);
      if (tremorRafRef.current !== null) window.cancelAnimationFrame(tremorRafRef.current);
    },
    [limparTimerAnuncio],
  );

  const voz = useVoz({
    aoTranscrever: (trecho, ehProvisorio) => {
      const base = textoPreVozRef.current;
      setTexto(base ? `${base} ${trecho}` : trecho);
      setProvisorio(ehProvisorio);
      setErroCmd(null);
    },
    aoConcluir: (textoFinal) => {
      const base = textoPreVozRef.current;
      setTexto(base ? `${base} ${textoFinal}` : textoFinal);
      setProvisorio(false);
      concluiuComFocoRef.current = true;
      enviarBtnRef.current?.focus();
    },
  });

  const cancelarReconhecimento = voz.cancelar;
  const cancelarVoz = useCallback(() => {
    concluiuComFocoRef.current = true;
    cancelarReconhecimento();
    setTexto(textoPreVozRef.current);
    setProvisorio(false);
    inputRef.current?.focus();
  }, [cancelarReconhecimento]);

  useEffect(() => {
    const eraOuvindo = eraOuvindoRef.current;
    eraOuvindoRef.current = voz.ouvindo;

    if (!voz.ouvindo) {
      focouPararRef.current = false;
      if (eraOuvindo && !concluiuComFocoRef.current) {
        (vozBtnRef.current ?? inputRef.current)?.focus();
      }
      concluiuComFocoRef.current = false;
      return;
    }

    concluiuComFocoRef.current = false;
    if (!focouPararRef.current) {
      focouPararRef.current = true;
      pararBtnRef.current?.focus();
    }
    const aoEscapeGlobal = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      cancelarVoz();
    };
    window.addEventListener('keydown', aoEscapeGlobal);
    return () => window.removeEventListener('keydown', aoEscapeGlobal);
  }, [voz.ouvindo, cancelarVoz]);

  useEffect(() => {
    const aoTeclarGlobal = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (elementoEditavel(document.activeElement)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', aoTeclarGlobal);
    return () => window.removeEventListener('keydown', aoTeclarGlobal);
  }, []);

  function alternarVoz() {
    if (voz.fase === 'finalizando') return;
    if (!voz.ouvindo) {
      textoPreVozRef.current = texto.trim();
      setSugestaoAtiva(-1);
    }
    voz.alternar();
  }

  function capturarOrigemClique(e: ReactMouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setOrigemClique([x, y]);
  }

  const executar = useCallback(
    async (comando: string) => {
      const limpo = comando.trim();
      setSugestaoAtiva(-1);
      if (!limpo) {
        setErroCmd('Digite um comando em português para continuar.');
        acionarTremor();
        inputRef.current?.focus();
        return;
      }

      if (voz.ouvindo) {
        concluiuComFocoRef.current = true;
        voz.cancelar();
      }
      voz.limparErro();
      limparTimerAnuncio();
      setProvisorio(false);
      setErroCmd(null);
      setResolucaoBotao(null);
      setEnviando(true);
      setEtapasLive([]);
      setBlocosLive([]);
      setPalcoAberto(true);

      abortStreamRef.current?.abort();
      const ctrl = new AbortController();
      abortStreamRef.current = ctrl;

      let etapasColetadas: EtapaStreamGenUI[] = [];
      let blocosColetados: BlocoGenUI[] = [];

      const lidarEvento = (ev: EventoStreamMandato) => {
        if (ev.tipo === 'etapa') {
          etapasColetadas = [
            ...etapasColetadas.map((et) => ({ ...et, concluida: true })),
            {
              id: ev.id,
              rotulo: ev.rotulo,
              ...(ev.detalhe ? { detalhe: ev.detalhe } : {}),
              concluida: false,
            },
          ];
          setEtapasLive(etapasColetadas);
        } else if (ev.tipo === 'bloco') {
          blocosColetados = [...blocosColetados, ev.bloco];
          setBlocosLive(blocosColetados);
        }
      };

      async function rodarStream(alvoPedidoId: string): Promise<RespostaMandato> {
        return transmitirMandatoStream(limpo, {
          pedidoId: alvoPedidoId,
          signal: ctrl.signal,
          aoEvento: lidarEvento,
        });
      }

      try {
        let resposta: RespostaMandato;
        try {
          resposta = await rodarStream(pedidoId);
        } catch (errInicial) {
          const precisaSessao =
            errInicial instanceof ErroMandatoApi &&
            (errInicial.status === 403 || errInicial.motivo === 'sem_alvo');
          if (!precisaSessao) throw errInicial;

          etapasColetadas = [
            {
              id: 'sessao',
              rotulo: 'Preparando cópia isolada da sessão',
              concluida: false,
            },
          ];
          setEtapasLive(etapasColetadas);
          const idSessao = await aoGarantirSessao(pedidoId);
          if (!idSessao) throw errInicial;
          etapasColetadas = [{ id: 'sessao', rotulo: 'Sessão isolada pronta', concluida: true }];
          blocosColetados = [];
          setEtapasLive(etapasColetadas);
          setBlocosLive([]);
          resposta = await rodarStream(idSessao);
        }

        if (ctrl.signal.aborted) return;

        const interpretado = interpretarResultadoMandato(resposta);
        const etapasFinal = etapasColetadas.map((et) => ({ ...et, concluida: true }));
        const novoId = ++turnoSeqRef.current;
        const novoTurno: TurnoMandato = {
          id: novoId,
          comando: limpo,
          interpretado,
          spec: resposta.viewSpec ?? null,
          etapas: etapasFinal,
          blocos: blocosColetados,
        };

        setTurnos((anteriores) => [novoTurno, ...anteriores].slice(0, LIMITE_TURNOS));
        setTurnoAtivoId(novoId);
        setPalcoAberto(true);
        marcarResolucao('ok');

        const ehSimulacao =
          resposta.acao === 'simular' || resposta.viewSpec?.layout === 'simulacao';
        aoSimulacaoAtiva?.(ehSimulacao);

        if (resposta.acao === 'propagar' || resposta.acao === 'notificar') {
          aoPulsoDomino?.();
          void aoRecarregarPedido();
        }
        if (interpretado.parteSugerida) {
          aoAplicarPapel?.(interpretado.parteSugerida);
        }

        const frase = resumoParaAnuncio(interpretado);
        anuncioTimerRef.current = window.setTimeout(() => {
          aoAnunciar(frase);
          anuncioTimerRef.current = null;
        }, 420);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        const mensagem =
          e instanceof ErroMandatoApi
            ? e.message
            : e instanceof Error
              ? e.message
              : 'Não foi possível executar o comando agora.';
        setErroCmd(mensagem);
        marcarResolucao('erro');
        acionarTremor();
      } finally {
        if (!ctrl.signal.aborted) {
          setEnviando(false);
        }
      }
    },
    [
      acionarTremor,
      aoAnunciar,
      aoAplicarPapel,
      aoGarantirSessao,
      aoPulsoDomino,
      aoRecarregarPedido,
      aoSimulacaoAtiva,
      limparTimerAnuncio,
      marcarResolucao,
      pedidoId,
      voz,
    ],
  );

  function aoSubmeter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    void executar(texto);
  }

  function aoTeclarInput(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (voz.ouvindo) {
      concluiuComFocoRef.current = true;
      voz.cancelar();
    }
    voz.limparErro();
    const proximo =
      e.key === 'ArrowDown'
        ? sugestaoAtiva < SUGESTOES.length - 1
          ? sugestaoAtiva + 1
          : 0
        : sugestaoAtiva > 0
          ? sugestaoAtiva - 1
          : SUGESTOES.length - 1;
    const escolhida = SUGESTOES[proximo];
    if (!escolhida) return;
    setSugestaoAtiva(proximo);
    setTexto(escolhida.comando);
    setProvisorio(false);
    setErroCmd(null);
  }

  function selecionarTurno(turno: TurnoMandato) {
    setTurnoAtivoId(turno.id);
    setPalcoAberto(true);
    setErroCmd(null);
    const ehSim = turno.interpretado.acao === 'simular' || turno.spec?.layout === 'simulacao';
    aoSimulacaoAtiva?.(ehSim);
  }

  function fecharPalco() {
    setPalcoAberto(false);
    setErroCmd(null);
    voz.limparErro();
    aoSimulacaoAtiva?.(false);
    inputRef.current?.focus();
  }

  async function aplicarHipotese(hipotese: CamposObservados) {
    let alvo = pedidoId;
    if (!daSessao) {
      const novoId = await aoGarantirSessao(pedidoId);
      if (!novoId) {
        throw new Error('Não foi possível preparar a sessão isolada para gravar a atualização.');
      }
      alvo = novoId;
    }
    const r = await aplicarHipoteseComoPlanilha(alvo, hipotese);
    aoPulsoDomino?.();
    if (r.pedidoId) aoSelecionar(r.pedidoId);
    await aoRecarregarPedido();
    aoSimulacaoAtiva?.(false);
    aoAnunciar('Atualização aplicada como planilha na sua sessão.');
  }

  const turnoAtivo = turnos.find((t) => t.id === turnoAtivoId) ?? turnos[0] ?? null;
  const mostrarPalcoGenUI =
    palcoAberto &&
    (enviando ||
      Boolean(turnoAtivo?.spec) ||
      (turnoAtivo !== null && turnoAtivo.blocos.length > 0));
  const mostrarFallbackCard =
    palcoAberto && !enviando && turnoAtivo !== null && !turnoAtivo.spec && turnoAtivo.blocos.length === 0;
  const temErroVisivel = Boolean(erroCmd || voz.erro);

  const classeSuperficie = [
    'cmd',
    'slab-mineral',
    enviando ? 'cmd-enviando' : '',
    temErroVisivel ? 'cmd-erro' : '',
    tremendo ? 'cmd-tremor' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const textoTempoVoz =
    voz.fase === 'iniciando'
      ? '…'
      : voz.fase === 'finalizando'
        ? 'Fim…'
        : formatarDuracao(voz.segundos);

  const textoLeitorVoz =
    voz.fase === 'iniciando'
      ? 'Ativando microfone'
      : voz.fase === 'finalizando'
        ? 'Finalizando ditado por voz'
        : 'Ouvindo comando por voz';

  return (
    <section
      className="mandato-secao"
      aria-label="Barra de comandos operacionais"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (voz.ouvindo) {
          e.preventDefault();
          cancelarVoz();
        } else if (sugestaoAtiva !== -1) {
          e.preventDefault();
          setSugestaoAtiva(-1);
        } else if (palcoAberto || temErroVisivel) {
          e.preventDefault();
          fecharPalco();
        }
      }}
    >
      <div className={classeSuperficie}>
        <span className="cmd-feixe-topo" aria-hidden="true">
          <CamadaShader shader="liraVoz" ativo={enviando} modo={1} className="cmd-feixe-shader" />
        </span>

        <form className={voz.ouvindo ? 'cmd-form cmd-form-ouvindo' : 'cmd-form'} onSubmit={aoSubmeter} noValidate>
          <label htmlFor={inputId} className="so-leitor">
            Pergunte, simule ou comande sobre este pedido
          </label>

          <span className="cmd-prefixo" aria-hidden="true">
            {enviando ? (
              <SeloMonolitosShader ativo={true} tamanho={18} />
            ) : (
              <IconeComando />
            )}
          </span>

          <input
            ref={inputRef}
            id={inputId}
            name="mandato"
            type="text"
            autoComplete="off"
            value={texto}
            onChange={(e) => {
              setTexto(e.target.value);
              setProvisorio(false);
              setSugestaoAtiva(-1);
              if (erroCmd) setErroCmd(null);
            }}
            onKeyDown={aoTeclarInput}
            placeholder={
              voz.fase === 'iniciando'
                ? 'Ativando microfone…'
                : voz.fase === 'finalizando'
                  ? 'Finalizando transcrição…'
                  : voz.ouvindo
                    ? 'Ouvindo em português… fale seu comando'
                    : 'Pergunte, simule ou comande sobre este pedido…'
            }
            disabled={enviando}
            aria-invalid={erroCmd ? 'true' : undefined}
            aria-describedby={erroCmd ? erroId : undefined}
            className={provisorio ? 'cmd-input cmd-input-provisorio' : 'cmd-input'}
          />

          <div className="cmd-acoes">
            {voz.ouvindo ? (
              <div className="voz-ativo">
                <span className="so-leitor">{textoLeitorVoz}</span>
                <VisualizadorVoz
                  analyserRef={voz.analyserRef}
                  energiaRef={voz.energiaRef}
                  ativo={voz.ouvindo}
                  fase={voz.fase}
                  movimentoReduzido={voz.movimentoReduzido}
                />
                <span className="voz-tempo mono num">{textoTempoVoz}</span>
                <button
                  ref={pararBtnRef}
                  type="button"
                  className="voz-ativo-parar"
                  aria-pressed="true"
                  aria-label="Parar ditado por voz"
                  aria-disabled={voz.fase === 'finalizando' || undefined}
                  onClick={alternarVoz}
                  disabled={enviando}
                >
                  <IconeParar />
                  <span>Parar</span>
                </button>
              </div>
            ) : (
              voz.suportado && (
                <button
                  ref={vozBtnRef}
                  type="button"
                  className="cmd-btn-voz"
                  aria-pressed="false"
                  aria-label="Ditar comando por voz"
                  onClick={alternarVoz}
                  disabled={enviando}
                >
                  <IconeMic />
                  <span className="cmd-voz-label">Voz</span>
                </button>
              )
            )}

            <button
              ref={enviarBtnRef}
              type="submit"
              className="cmd-btn-enviar"
              disabled={enviando}
              onMouseDown={capturarOrigemClique}
            >
              <CamadaShader
                shader="ignicaoBotao"
                ativo={enviando}
                origem={origemClique}
                resolverEm={resolucaoBotao}
                raioPx={999}
                className="cmd-btn-shader"
              />
              <span className="cmd-btn-conteudo">
                {enviando && (
                  <span className="cmd-orbita" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
                <span>{enviando ? 'Executando…' : 'Executar'}</span>
                {!enviando && <IconeRetorno />}
              </span>
            </button>
          </div>
        </form>
      </div>

      {turnos.length > 0 && (
        <nav className="cmd-turnos" aria-label="Histórico de respostas da sessão">
          <span className="meta">Turnos:</span>
          {turnos.map((t) => {
            const ativo = palcoAberto && turnoAtivo?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className="cmd-turno-btn"
                aria-pressed={ativo}
                onClick={() => selecionarTurno(t)}
              >
                <span className="cmd-turno-acao mono">{rotuloAcaoMandato(t.interpretado.acao)}</span>
                <span>{resumirComandoCurto(t.comando)}</span>
              </button>
            );
          })}
        </nav>
      )}

      {temErroVisivel && (
        <div className="cmd-erro-faixa" role="alert">
          <span className="cmd-erro-texto" id={erroId}>
            <IconeErro />
            <span>{voz.erro ?? erroCmd}</span>
          </span>
          <button
            type="button"
            className="botao-fechar"
            aria-label="Fechar aviso"
            onClick={() => {
              setErroCmd(null);
              voz.limparErro();
              inputRef.current?.focus();
            }}
          >
            <IconeFechar />
          </button>
        </div>
      )}

      {mostrarPalcoGenUI && (
        <div className="cmd-palco-wrap">
          <PalcoGenUI
            spec={enviando ? null : (turnoAtivo?.spec ?? null)}
            etapas={enviando ? etapasLive : (turnoAtivo?.etapas ?? [])}
            blocosStream={enviando ? blocosLive : (turnoAtivo?.blocos ?? [])}
            carregando={enviando}
            projecao={projecao}
            pedidoId={pedidoId}
            daSessao={daSessao}
            contatos={contatos}
            focoAtivo={focoAtivo}
            aoFocar={aoFocar}
            aoExecutarComando={(cmd) => {
              setTexto(cmd);
              void executar(cmd);
            }}
            aoSelecionarPapel={(p) => aoAplicarPapel?.(p)}
            aoNotificar={aoNotificar}
            aoAbrirAgenda={aoAbrirAgenda}
            aoSimularResultado={(res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null) =>
              aoSimulacaoAtiva?.(res !== null)
            }
            aoAplicarHipotese={aplicarHipotese}
            aoFechar={fecharPalco}
            aoAnunciar={aoAnunciar}
            slotLoader={<SeloMonolitosShader ativo={true} tamanho={24} />}
          />
        </div>
      )}

      {mostrarFallbackCard && turnoAtivo && (
        <div className="cmd-painel cmd-painel-isolado">
          <div className="cmd-painel-cab">
            <div className="cmd-painel-meta">
              <span className="pilula-coord mono">{rotuloAcaoMandato(turnoAtivo.interpretado.acao)}</span>
              {turnoAtivo.interpretado.acao === 'simular' && (
                <span className="pilula-sutil">Nenhum campo gravado</span>
              )}
              {turnoAtivo.interpretado.alvos.length > 0 && (
                <span className="cmd-alvos meta">
                  {turnoAtivo.interpretado.alvos.length === 1 ? 'Pedido ' : 'Pedidos '}
                  {turnoAtivo.interpretado.alvos.map((alvo, idx) => (
                    <span key={alvo}>
                      {idx > 0 && ', '}
                      <a href={`#/pedido/${encodeURIComponent(alvo)}`} className="mono">
                        {chaveCurta(alvo)}
                      </a>
                    </span>
                  ))}
                </span>
              )}
            </div>
            <button
              type="button"
              className="botao-fechar"
              aria-label="Fechar resultado do comando"
              onClick={fecharPalco}
            >
              <IconeFechar />
            </button>
          </div>

          {turnoAtivo.interpretado.acao === 'propagar' && (
            <CartaoPropagar
              itens={turnoAtivo.interpretado.itens}
              novosEventos={turnoAtivo.interpretado.novosEventos}
            />
          )}
          {turnoAtivo.interpretado.acao === 'simular' && (
            <CartaoSimular itens={turnoAtivo.interpretado.itens} />
          )}
          {turnoAtivo.interpretado.acao === 'resumir' && (
            <CartaoResumir itens={turnoAtivo.interpretado.itens} />
          )}
          {turnoAtivo.interpretado.acao === 'notificar' && (
            <CartaoNotificar itens={turnoAtivo.interpretado.itens} />
          )}
        </div>
      )}
    </section>
  );
}
