import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  CamposObservados,
  EventoStreamMandato,
  Parte,
  ProjecaoPedido,
  RespostaMandato,
  ViewSpecV2,
} from '../../../shared/model.ts';
import { ErroMandatoApi, type PedidoResumo } from '../api.ts';
import {
  aplicarHipoteseComoPlanilha,
  garantirEstilosOps,
  transmitirMandatoStream,
} from '../apiOps.ts';
import type { PaginaAssistenteIAProps } from '../assistenteContrato.ts';
import {
  chaveCurta,
  formatarDuracao,
  rotuloAcaoMandato,
  rotuloMotivoNotificacao,
  rotuloParte,
} from '../format.ts';
import {
  interpretarResultadoMandato,
  resumoParaAnuncio,
  type ResultadoMandatoInterpretado,
} from '../mandato.ts';
import {
  CamadaShader,
  SeloMonolitosShader,
  movimentoReduzidoAgora,
  type PonteiroShader,
  type ResolucaoShader,
} from '../shaders/index.ts';
import { useVoz } from '../useVoz.ts';
import '../assistente.css';
import { EvidenciaLateralIA } from './EvidenciaLateralIA.tsx';
import {
  IconeComando,
  IconeConfere,
  IconeDiverge,
  IconeErro,
  IconeExterno,
  IconeFechar,
  IconeMais,
  IconeMic,
  IconeOk,
  IconePainelLateral,
  IconeParar,
  IconeRetorno,
} from './icones.tsx';
import { PalcoGenUI, type EtapaStreamGenUI } from './PalcoGenUI.tsx';
import { VisualizadorVoz } from './VisualizadorVoz.tsx';

interface PartidaSugerida {
  readonly categoria: string;
  readonly comando: string;
  readonly apoio: string;
}

interface TurnoIA {
  id: string;
  comando: string;
  pedidoId: string;
  criadoEm: string;
  carregando: boolean;
  etapas: EtapaStreamGenUI[];
  blocosStream: BlocoGenUI[];
  viewSpec: ViewSpecV2 | null;
  interpretado: ResultadoMandatoInterpretado | null;
  projecaoSnapshot: ProjecaoPedido | null;
  autoForkAplicado: boolean;
  erro: { mensagem: string; status: number; motivo?: string } | null;
}

const PARTIDAS_DIVERGENTE: readonly PartidaSugerida[] = [
  {
    categoria: 'Diagnóstico',
    comando: 'Qual o atraso real e quais áreas são impactadas?',
    apoio: 'Resumo citado e mapa dominó das tarefas por setor',
  },
  {
    categoria: 'Simulação',
    comando: 'Simule a entrega para 28/01/2026',
    apoio: 'Abre simulador vivo e testa impacto sem gravar no registro',
  },
  {
    categoria: 'Visão por setor',
    comando: 'Mostre a visão e as ações do Fiscal',
    apoio: 'Comparador de conflitos e lista priorizada para o Fiscal',
  },
  {
    categoria: 'Despacho',
    comando: 'Avise a transportadora sobre a divergência',
    apoio: 'Rascunho revisável e envio pelo canal real da agenda',
  },
];

const PARTIDAS_CONSISTENTE: readonly PartidaSugerida[] = [
  {
    categoria: 'Auditoria',
    comando: 'Resuma o estado atual e confirme se há pendências',
    apoio: 'Síntese citada dos documentos e campos vigiados',
  },
  {
    categoria: 'Simulação',
    comando: 'Simule a entrega para 28/01/2026',
    apoio: 'Calcula quais setores seriam acionados em caso de atraso',
  },
  {
    categoria: 'Conferência',
    comando: 'Confira peso total e volumes entre NF-e e CT-e',
    apoio: 'Comparação direta dos valores declarados por fonte',
  },
  {
    categoria: 'Visão por setor',
    comando: 'Mostre a visão e as ações do CD',
    apoio: 'Conferência de recebimento, volumes e janela prevista',
  },
];

const DIA_MS = 86_400_000;
const ORIGEM_CENTRO: readonly [number, number] = [0.5, 0.5];

function codigoCurtoPedido(id: string): string {
  return /^\d{44}$/.test(id) ? id.slice(-6) : chaveCurta(id);
}

function rotuloOpcaoPedido(p: PedidoResumo): string {
  const codigo = codigoCurtoPedido(p.pedidoId);
  const nome = p.emitente?.trim();
  const base = nome ? `${nome} · ${codigo}` : codigo;
  return p.daSessao ? `${base} (sessão)` : base;
}

function horarioAtualCurto(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function elementoEditavel(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function ehAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function calcularAtrasoProjecao(dados: ProjecaoPedido | null): number | null {
  if (!dados) return null;
  for (const d of dados.divergencias) {
    if (d.campo !== 'previsaoEntrega') continue;
    const a = Date.parse(`${String(d.valorA).slice(0, 10)}T00:00:00Z`);
    const b = Date.parse(`${String(d.valorB).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) continue;
    const dias = Math.round((b - a) / DIA_MS);
    if (dias !== 0) return dias;
  }
  return null;
}

function formatarDeltaDiasCurto(dias: number): string {
  const sinal = dias > 0 ? '+' : '\u2212';
  return `${sinal}${Math.abs(dias)}d`;
}

function adicionarOuAtualizarEtapa(
  atuais: readonly EtapaStreamGenUI[],
  nova: { id: string; rotulo: string; detalhe?: string },
): EtapaStreamGenUI[] {
  const concluidas = atuais.map((et) =>
    et.id === nova.id ? et : { ...et, concluida: true },
  );
  const idx = concluidas.findIndex((et) => et.id === nova.id);
  const entrada: EtapaStreamGenUI = {
    id: nova.id,
    rotulo: nova.rotulo,
    ...(nova.detalhe ? { detalhe: nova.detalhe } : {}),
    concluida: false,
  };
  if (idx === -1) return [...concluidas, entrada];
  return concluidas.map((et, i) => (i === idx ? entrada : et));
}

function acumularBlocoUnico(
  atuais: readonly BlocoGenUI[],
  bloco: BlocoGenUI,
): BlocoGenUI[] {
  const idx = atuais.findIndex((b) => b.id === bloco.id);
  if (idx === -1) return [...atuais, bloco];
  return atuais.map((b, i) => (i === idx ? bloco : b));
}

function desktopSplitInicial(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 1180px)').matches
  );
}

// Em repouso exibe a geometria estática dos 3 monólitos (zero loop desnecessário);
// quando há atividade real (streaming ou voz) ativa o micro-shader SDF WebGL.
function SeloEstudio({ ativo, tamanho = 36 }: { ativo: boolean; tamanho?: number }) {
  if (ativo) {
    return <SeloMonolitosShader ativo={true} tamanho={tamanho} className="ia-selo-monolitos" />;
  }
  return (
    <svg
      className="ia-selo-monolitos"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3.2 10.6L7.4 8.4V18.8L3.2 21V10.6ZM9.8 6.4L14.2 4.1V17.9L9.8 20.2V6.4ZM16.6 5.2L20.8 3V13.4L16.6 15.6V5.2Z"
        fill="var(--primary)"
      />
      <path
        d="M2.6 14.8C7.8 12.2 14.8 11.4 21.4 8.2M2.6 16.5C7.8 13.9 14.8 13.1 21.4 9.9M2.6 18.2C7.8 15.6 14.8 14.8 21.4 11.6M2.6 19.9C7.8 17.3 14.8 16.5 21.4 13.3"
        stroke="var(--change)"
        strokeWidth="1.05"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Fallback editorial quando o servidor concluir um mandato sem anexar ViewSpecV2.
function RespostaFallbackTurno({ dados }: { dados: ResultadoMandatoInterpretado }) {
  return (
    <div className="ia-fallback-card">
      <div className="ia-fallback-cab">
        <span className="pilula-coord mono">{rotuloAcaoMandato(dados.acao)}</span>
        {dados.acao === 'simular' && (
          <span className="pilula-sutil">Simulação · nenhum campo alterado</span>
        )}
      </div>
      {dados.acao === 'resumir' &&
        dados.itens.map((item) => (
          <p key={item.pedidoId} className="ia-fallback-texto">
            {item.resumo}
          </p>
        ))}
      {dados.acao === 'propagar' && (
        <p className="ia-fallback-texto">{resumoParaAnuncio(dados)}</p>
      )}
      {dados.acao === 'simular' && (
        <p className="ia-fallback-texto">{resumoParaAnuncio(dados)}</p>
      )}
      {dados.acao === 'notificar' && (
        <ul className="ia-fallback-recibos">
          {dados.itens.map((item, idx) => (
            <li key={`${item.pedidoId}-${idx}`} className="ia-fallback-recibo">
              <span className={item.status === 'entregue' ? 'pilula-ok' : 'pilula-warn'}>
                {item.status === 'entregue' ? <IconeOk /> : <IconeErro />}
                {item.status === 'entregue' ? 'Entregue' : 'Não entregue'}
              </span>
              <strong>{item.parte ? rotuloParte(item.parte) : 'Parte não identificada'}</strong>
              {item.motivo && <span className="meta">{rotuloMotivoNotificacao(item.motivo)}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PaginaAssistenteIA({
  pedidos,
  pedidoId,
  projecao,
  contatos,
  comandoInicial,
  aoConsumirComandoInicial,
  aoSelecionarPedido,
  aoAbrirNaTorre,
  aoAbrirAgenda,
  aoGarantirSessao,
  aoNotificar,
  aoRecarregarPedido,
  aoAnunciar,
}: PaginaAssistenteIAProps) {
  useEffect(() => {
    garantirEstilosOps();
  }, []);

  const seletorId = useId();
  const inputId = useId();
  const erroInputId = useId();
  const evidenciaId = useId();

  const fundoPalcoRef = useRef<HTMLDivElement | null>(null);
  const ponteiroRef = useRef<PonteiroShader | null>({ x: 0.5, y: 0.5, ativo: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const enviarBtnRef = useRef<HTMLButtonElement>(null);
  const vozBtnRef = useRef<HTMLButtonElement>(null);
  const pararBtnRef = useRef<HTMLButtonElement>(null);
  const ultimoTurnoRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const turnoSeqRef = useRef(0);
  const comandoInicialConsumidoRef = useRef<string | null>(null);
  const resolucaoTimerRef = useRef<number | null>(null);
  const clicouBotaoRef = useRef(false);

  // Refs de gestão de foco WCAG 2.2 AA para voz.
  const textoPreVozRef = useRef('');
  const focouPararRef = useRef(false);
  const eraOuvindoRef = useRef(false);
  const concluiuComFocoRef = useRef(false);

  const [turnos, setTurnos] = useState<TurnoIA[]>([]);
  const [texto, setTexto] = useState('');
  const [provisorio, setProvisorio] = useState(false);
  const [erroInput, setErroInput] = useState<string | null>(null);
  const [focoAtivo, setFocoAtivo] = useState<AlvoFocoGenUI | null>(null);
  const [desktopLargo, setDesktopLargo] = useState<boolean>(desktopSplitInicial);
  const [preferenciaEvidencia, setPreferenciaEvidencia] = useState<boolean | null>(null);
  const [origemClique, setOrigemClique] = useState<readonly [number, number]>(ORIGEM_CENTRO);
  const [resolucaoBotao, setResolucaoBotao] = useState<ResolucaoShader>(null);

  const pedidoAtual = useMemo(
    () => (pedidoId ? (pedidos.find((p) => p.pedidoId === pedidoId) ?? null) : null),
    [pedidos, pedidoId],
  );

  const dadosProjecao = projecao.estado === 'ok' ? projecao.dados : null;
  const algumTurnoStreaming = turnos.some((t) => t.carregando);

  // Acompanha largura da viewport para abrir evidências por padrão no desktop >= 1180px.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1180px)');
    const aoMudar = () => setDesktopLargo(mq.matches);
    aoMudar();
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  const painelEvidenciaAberto =
    preferenciaEvidencia !== null
      ? preferenciaEvidencia
      : desktopLargo && dadosProjecao !== null;

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (resolucaoTimerRef.current !== null) {
        window.clearTimeout(resolucaoTimerRef.current);
      }
    },
    [],
  );

  // Limpa foco transversal ao trocar de pedido para não apontar para dados do pedido anterior.
  const pedidoAnteriorRef = useRef<string | null>(pedidoId);
  useEffect(() => {
    if (pedidoAnteriorRef.current !== pedidoId) {
      pedidoAnteriorRef.current = pedidoId;
      setFocoAtivo(null);
    }
  }, [pedidoId]);

  const voz = useVoz({
    aoTranscrever: (trecho, ehProvisorio) => {
      const base = textoPreVozRef.current;
      setTexto(base ? `${base} ${trecho}` : trecho);
      setProvisorio(ehProvisorio);
      setErroInput(null);
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

  // Transfere foco para "Parar" ao iniciar ditado, restaura ao encerrar sem conclusão
  // e garante Escape global para cancelar o microfone.
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

  // Atalho global "/" para focar o composer fora de campos editáveis.
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

  // Rola suavemente para o início do turno recém-adicionado.
  const totalTurnos = turnos.length;
  useEffect(() => {
    if (totalTurnos === 0) return;
    const alvo = ultimoTurnoRef.current;
    if (!alvo || typeof alvo.scrollIntoView !== 'function') return;
    alvo.scrollIntoView({
      behavior: movimentoReduzidoAgora() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [totalTurnos]);

  const aoMoverPonteiro = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Evita rastro preso após tap em telas sensíveis ao toque.
    if (e.pointerType === 'touch') return;
    const palco = fundoPalcoRef.current ?? e.currentTarget;
    const rect = palco.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    ponteiroRef.current = { x, y, ativo: true };
  }, []);

  const aoSairPonteiro = useCallback(() => {
    const atual = ponteiroRef.current;
    ponteiroRef.current = atual
      ? { x: atual.x, y: atual.y, ativo: false }
      : { x: 0.5, y: 0.5, ativo: false };
  }, []);

  const atualizarTurno = useCallback(
    (turnoId: string, fn: (atual: TurnoIA) => TurnoIA) => {
      setTurnos((prev) => prev.map((t) => (t.id === turnoId ? fn(t) : t)));
    },
    [],
  );

  const agendarLimpezaResolucao = useCallback(() => {
    if (resolucaoTimerRef.current !== null) {
      window.clearTimeout(resolucaoTimerRef.current);
    }
    resolucaoTimerRef.current = window.setTimeout(() => {
      setResolucaoBotao(null);
      resolucaoTimerRef.current = null;
    }, 600);
  }, []);

  const executarComando = useCallback(
    async (comandoBruto: string, limparCampo = true) => {
      const limpo = comandoBruto.trim();
      if (algumTurnoStreaming) return;

      if (!limpo) {
        setErroInput('Digite uma pergunta ou comando em português para continuar.');
        inputRef.current?.focus();
        aoAnunciar('Digite uma pergunta ou comando em português para continuar.');
        return;
      }

      if (voz.ouvindo) {
        concluiuComFocoRef.current = true;
        voz.cancelar();
      }
      voz.limparErro();
      setErroInput(null);
      setProvisorio(false);
      if (limparCampo) setTexto('');

      if (resolucaoTimerRef.current !== null) {
        window.clearTimeout(resolucaoTimerRef.current);
        resolucaoTimerRef.current = null;
      }
      setResolucaoBotao(null);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const turnoId = `turno-${++turnoSeqRef.current}`;
      const idInicial = pedidoId ?? '';
      const novoTurno: TurnoIA = {
        id: turnoId,
        comando: limpo,
        pedidoId: idInicial,
        criadoEm: horarioAtualCurto(),
        carregando: true,
        etapas: [],
        blocosStream: [],
        viewSpec: null,
        interpretado: null,
        projecaoSnapshot: dadosProjecao,
        autoForkAplicado: false,
        erro: null,
      };
      setTurnos((prev) => [...prev, novoTurno]);

      const lidarEvento = (ev: EventoStreamMandato) => {
        if (controller.signal.aborted) return;
        if (ev.tipo === 'etapa') {
          atualizarTurno(turnoId, (t) => ({
            ...t,
            etapas: adicionarOuAtualizarEtapa(t.etapas, ev),
          }));
        } else if (ev.tipo === 'bloco') {
          atualizarTurno(turnoId, (t) => ({
            ...t,
            blocosStream: acumularBlocoUnico(t.blocosStream, ev.bloco),
          }));
        } else if (ev.tipo === 'concluido') {
          atualizarTurno(turnoId, (t) => ({
            ...t,
            etapas: t.etapas.map((et) => ({ ...et, concluida: true })),
          }));
        }
      };

      const rodarStream = async (
        alvoId: string | null,
        jaTentouFork: boolean,
      ): Promise<RespostaMandato | null> => {
        try {
          return await transmitirMandatoStream(limpo, {
            ...(alvoId ? { pedidoId: alvoId } : {}),
            signal: controller.signal,
            aoEvento: lidarEvento,
          });
        } catch (err) {
          if (ehAbortError(err) || controller.signal.aborted) return null;

          const precisaFork =
            !jaTentouFork &&
            err instanceof ErroMandatoApi &&
            (err.status === 403 || err.motivo === 'sem_alvo');

          if (precisaFork) {
            atualizarTurno(turnoId, (t) => ({
              ...t,
              etapas: adicionarOuAtualizarEtapa(t.etapas, {
                id: 'autofork',
                rotulo: 'Copiando pedido para sua sessão…',
              }),
            }));

            const novoId = await aoGarantirSessao(alvoId);
            if (controller.signal.aborted) return null;

            if (novoId) {
              atualizarTurno(turnoId, (t) => ({
                ...t,
                pedidoId: novoId,
                autoForkAplicado: true,
                etapas: t.etapas.map((et) =>
                  et.id === 'autofork' ? { ...et, concluida: true } : et,
                ),
              }));
              if (novoId !== pedidoId) {
                aoSelecionarPedido(novoId);
              }
              return await rodarStream(novoId, true);
            }
          }
          throw err;
        }
      };

      try {
        const resposta = await rodarStream(pedidoId, false);
        if (!resposta || controller.signal.aborted) return;

        const interpretado = interpretarResultadoMandato(resposta);
        const alvoResolvido = resposta.alvos[0] ?? idInicial;

        atualizarTurno(turnoId, (t) => ({
          ...t,
          pedidoId: alvoResolvido || t.pedidoId,
          carregando: false,
          etapas: t.etapas.map((et) => ({ ...et, concluida: true })),
          viewSpec: resposta.viewSpec ?? null,
          interpretado,
          erro: null,
        }));

        setResolucaoBotao('ok');
        agendarLimpezaResolucao();
        aoAnunciar(resumoParaAnuncio(interpretado));

        if (resposta.acao === 'propagar' || resposta.acao === 'notificar') {
          void aoRecarregarPedido();
        }
      } catch (err) {
        if (ehAbortError(err) || controller.signal.aborted) return;

        const mensagem =
          err instanceof ErroMandatoApi
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Não foi possível concluir o comando agora.';
        const status = err instanceof ErroMandatoApi ? err.status : 0;
        const motivo = err instanceof ErroMandatoApi ? err.motivo : undefined;

        atualizarTurno(turnoId, (t) => ({
          ...t,
          carregando: false,
          erro: { mensagem, status, ...(motivo ? { motivo } : {}) },
        }));

        setResolucaoBotao('erro');
        agendarLimpezaResolucao();
        aoAnunciar(`Erro ao executar comando: ${mensagem}`);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [
      algumTurnoStreaming,
      voz,
      pedidoId,
      dadosProjecao,
      atualizarTurno,
      aoGarantirSessao,
      aoSelecionarPedido,
      agendarLimpezaResolucao,
      aoAnunciar,
      aoRecarregarPedido,
    ],
  );

  // Consome comandoInicial vindo da Torre assim que a projeção estiver carregada.
  useEffect(() => {
    const limpo = comandoInicial?.trim() ?? '';
    if (!limpo) {
      comandoInicialConsumidoRef.current = null;
      return;
    }
    if (!pedidoId || projecao.estado !== 'ok' || algumTurnoStreaming) return;
    const chave = `${pedidoId}|${limpo}`;
    if (comandoInicialConsumidoRef.current === chave) return;
    comandoInicialConsumidoRef.current = chave;
    aoConsumirComandoInicial?.();
    setOrigemClique(ORIGEM_CENTRO);
    void executarComando(limpo, false);
  }, [
    comandoInicial,
    pedidoId,
    projecao.estado,
    algumTurnoStreaming,
    aoConsumirComandoInicial,
    executarComando,
  ]);

  function aoTrocarPedido(e: ChangeEvent<HTMLSelectElement>) {
    const novoId = e.target.value;
    if (!novoId || novoId === pedidoId) return;
    aoSelecionarPedido(novoId);
  }

  function iniciarNovaConversa() {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurnos([]);
    setFocoAtivo(null);
    setErroInput(null);
    setResolucaoBotao(null);
    voz.limparErro();
    aoAnunciar('Nova conversa iniciada.');
    inputRef.current?.focus();
  }

  function alternarVoz() {
    if (voz.fase === 'finalizando') return;
    if (!voz.ouvindo) {
      textoPreVozRef.current = texto.trim();
      setErroInput(null);
    }
    voz.alternar();
  }

  function capturarOrigemBotao(e: ReactPointerEvent<HTMLButtonElement>) {
    clicouBotaoRef.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setOrigemClique(ORIGEM_CENTRO);
      return;
    }
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setOrigemClique([x, y]);
  }

  function aoSubmeter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (algumTurnoStreaming) return;
    if (!clicouBotaoRef.current) {
      setOrigemClique(ORIGEM_CENTRO);
    }
    clicouBotaoRef.current = false;
    void executarComando(texto, true);
  }

  const lidarFocarDoPalco = useCallback((alvo: AlvoFocoGenUI | null) => {
    setFocoAtivo(alvo);
  }, []);

  const lidarSelecionarPapel = useCallback(
    (papel: Parte) => {
      setFocoAtivo({ tipo: 'parte', parte: papel });
      aoAnunciar(`Setor ${rotuloParte(papel)} destacado nas evidências.`);
    },
    [aoAnunciar],
  );

  const lidarNotificarDoPalco = useCallback(
    async (idAlvo: string, parte: Parte, campo?: CampoVigiado) => {
      await aoNotificar(idAlvo, parte, campo);
    },
    [aoNotificar],
  );

  const lidarAplicarHipotese = useCallback(
    async (idAlvo: string, hipotese: CamposObservados) => {
      const idSessao = await aoGarantirSessao(idAlvo);
      if (!idSessao) {
        throw new Error('Não foi possível copiar o pedido para a sua sessão.');
      }
      await aplicarHipoteseComoPlanilha(idSessao, hipotese);
      await aoRecarregarPedido();
    },
    [aoGarantirSessao, aoRecarregarPedido],
  );

  // Telemetria real do pedido ativo para o cabeçalho da sala (mesma contagem da Torre:
  // campos divergentes distintos + tarefas agrupadas por parte/título).
  const qtdDivergencias = dadosProjecao
    ? new Set(dadosProjecao.divergencias.map((d) => d.campo)).size
    : (pedidoAtual?.divergencias ?? 0);
  const qtdTarefas = dadosProjecao
    ? new Set(dadosProjecao.tarefas.map((t) => `${t.parte}|${t.titulo}`)).size
    : (pedidoAtual?.tarefas ?? 0);
  const atrasoDias = pedidoAtual?.atrasoDias ?? calcularAtrasoProjecao(dadosProjecao);
  const partidasAtivas = qtdDivergencias > 0 ? PARTIDAS_DIVERGENTE : PARTIDAS_CONSISTENTE;

  const modoCampo = voz.ouvindo ? 2 : algumTurnoStreaming ? 1 : 0;

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
    <div
      className="ia-estudio"
      data-evidencia={painelEvidenciaAberto ? 'aberta' : 'oculta'}
      onPointerMove={aoMoverPonteiro}
      onPointerLeave={aoSairPonteiro}
    >
      <div className="ia-fundo-glsl" aria-hidden="true">
        <div ref={fundoPalcoRef} className="ia-fundo-sticky">
          <CamadaShader
            shader="campoMineral"
            ativo={true}
            modo={modoCampo}
            ponteiroRef={ponteiroRef}
            rmsRef={voz.energiaRef}
          />
          <div className="ia-fundo-scrim" />
        </div>
      </div>

      <header className="ia-topo">
        <div className="ia-topo-identidade">
          <h1 className="ia-titulo">Assistente operacional</h1>

          <div className="ia-contexto-pedido">
            <label htmlFor={seletorId} className="so-leitor">
              Pedido ativo para consulta
            </label>
            <select
              id={seletorId}
              className="ia-select"
              value={pedidoId ?? ''}
              disabled={pedidos.length === 0}
              onChange={aoTrocarPedido}
            >
              {pedidos.length === 0 ? (
                <option value="">Nenhum pedido disponível</option>
              ) : (
                pedidos.map((p) => (
                  <option key={p.pedidoId} value={p.pedidoId}>
                    {rotuloOpcaoPedido(p)}
                  </option>
                ))
              )}
            </select>

            {pedidoId && (
              <div className="ia-telemetria" aria-label="Resumo operacional do pedido ativo">
                {qtdDivergencias > 0 ? (
                  <span className="ia-telemetria-divergente mono num">
                    <IconeDiverge />
                    <span>
                      {qtdDivergencias} {qtdDivergencias === 1 ? 'conflito' : 'conflitos'}
                      {atrasoDias !== null && atrasoDias !== 0
                        ? ` · ${formatarDeltaDiasCurto(atrasoDias)}`
                        : ''}
                      {` · ${qtdTarefas} ${qtdTarefas === 1 ? 'tarefa' : 'tarefas'}`}
                    </span>
                  </span>
                ) : (
                  <span className="pilula-ok">
                    <IconeConfere />
                    <span>Consistente</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="ia-topo-acoes">
          {turnos.length > 0 && (
            <button
              type="button"
              className="botao-sutil ia-btn-topo"
              onClick={iniciarNovaConversa}
            >
              <IconeMais />
              <span>Nova conversa</span>
            </button>
          )}

          <button
            type="button"
            className="botao-sutil ia-btn-topo"
            aria-pressed={painelEvidenciaAberto}
            aria-controls={evidenciaId}
            data-tem-foco={!painelEvidenciaAberto && focoAtivo !== null ? 'true' : undefined}
            onClick={() => setPreferenciaEvidencia(!painelEvidenciaAberto)}
          >
            <IconePainelLateral />
            <span>
              {!painelEvidenciaAberto && focoAtivo !== null
                ? 'Evidências · 1 destaque'
                : 'Evidências'}
            </span>
          </button>

          <button
            type="button"
            className="botao ia-btn-topo"
            disabled={!pedidoId}
            onClick={() => {
              if (pedidoId) aoAbrirNaTorre(pedidoId, focoAtivo);
            }}
          >
            <IconeExterno />
            <span>Abrir na Torre</span>
          </button>
        </div>
      </header>

      <div className="ia-corpo">
        <section className="ia-conversa" aria-label="Conversa operacional">
          {turnos.length === 0 ? (
            <div className="ia-vazio">
              <div className="ia-vazio-cab">
                <SeloEstudio ativo={algumTurnoStreaming || voz.ouvindo} tamanho={36} />
                <h2 className="ia-vazio-titulo">
                  Investigue divergências, simule prazos ou acione áreas pelo registro real.
                </h2>
                {pedidoId && dadosProjecao?.pedido ? (
                  <p className="ia-vazio-contexto">
                    <span className="mono num">{codigoCurtoPedido(pedidoId)}</span>
                    {' · '}
                    {dadosProjecao.pedido.emitente.nome} → {dadosProjecao.pedido.destinatario.nome}
                  </p>
                ) : pedidoId && projecao.estado === 'carregando' ? (
                  <p className="ia-vazio-contexto" role="status">
                    Carregando estado do pedido {codigoCurtoPedido(pedidoId)}…
                  </p>
                ) : !pedidoId ? (
                  <p className="ia-vazio-contexto">
                    Nenhum pedido carregado ainda. Selecione um pedido acima ou abra a Torre para enviar documentos.
                  </p>
                ) : null}
              </div>

              {projecao.estado === 'erro' && (
                <div className="ia-estado-erro" role="alert">
                  <div className="ia-estado-erro-msg">
                    <IconeErro />
                    <span>{projecao.mensagem}</span>
                  </div>
                  <button
                    type="button"
                    className="botao-sutil"
                    onClick={() => void aoRecarregarPedido()}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              <div className="ia-partidas-grid" role="group" aria-label="Sugestões para começar">
                {partidasAtivas.map((item) => (
                  <button
                    key={item.comando}
                    type="button"
                    className="ia-partida-card"
                    disabled={algumTurnoStreaming || !pedidoId}
                    onClick={() => {
                      setOrigemClique(ORIGEM_CENTRO);
                      void executarComando(item.comando, false);
                    }}
                  >
                    <span className="ia-partida-cat">{item.categoria}</span>
                    <span className="ia-partida-cmd">{item.comando}</span>
                    <span className="ia-partida-apoio">{item.apoio}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <ol className="ia-thread" aria-label="Turnos da consulta">
              {turnos.map((turno, idx) => {
                const ehUltimo = idx === turnos.length - 1;
                const projecaoTurno =
                  turno.pedidoId === pedidoId && dadosProjecao
                    ? dadosProjecao
                    : turno.projecaoSnapshot;
                const turnoDaSessao =
                  turno.autoForkAplicado ||
                  Boolean(pedidos.find((p) => p.pedidoId === turno.pedidoId)?.daSessao);

                return (
                  <li key={turno.id}>
                    <article
                      ref={ehUltimo ? ultimoTurnoRef : undefined}
                      className="ia-turno"
                      aria-busy={turno.carregando || undefined}
                    >
                      <header className="ia-turno-entrada">
                        <div className="ia-turno-meta">
                          <span className="ia-turno-papel">Operador</span>
                          {turno.pedidoId && (
                            <span className="pilula-neutra mono num">
                              {codigoCurtoPedido(turno.pedidoId)}
                            </span>
                          )}
                          <time className="meta mono num">{turno.criadoEm}</time>
                          {turno.autoForkAplicado && (
                            <span className="ia-turno-nota-sessao">
                              Cópia criada na sua sessão para gravar
                            </span>
                          )}
                        </div>
                        <p className="ia-turno-comando">{turno.comando}</p>
                      </header>

                      <div className="ia-turno-resposta">
                        {turno.erro ? (
                          <div className="ia-turno-erro" role="alert">
                            <div className="ia-turno-erro-cab">
                              <span className="pilula-erro">
                                <IconeErro />
                                Não foi possível concluir
                              </span>
                              <button
                                type="button"
                                className="botao-sutil"
                                disabled={algumTurnoStreaming}
                                onClick={() => {
                                  setOrigemClique(ORIGEM_CENTRO);
                                  void executarComando(turno.comando, false);
                                }}
                              >
                                Tentar novamente
                              </button>
                            </div>
                            <p className="ia-turno-erro-msg">{turno.erro.mensagem}</p>
                          </div>
                        ) : projecaoTurno &&
                          (turno.carregando ||
                            turno.viewSpec !== null ||
                            turno.blocosStream.length > 0) ? (
                          <PalcoGenUI
                            spec={turno.viewSpec}
                            etapas={turno.etapas}
                            blocosStream={turno.blocosStream}
                            carregando={turno.carregando}
                            projecao={projecaoTurno}
                            pedidoId={turno.pedidoId || (pedidoId ?? '')}
                            daSessao={turnoDaSessao}
                            contatos={contatos}
                            focoAtivo={turno.pedidoId === pedidoId ? focoAtivo : null}
                            aoFocar={lidarFocarDoPalco}
                            aoExecutarComando={(cmd) => {
                              setOrigemClique(ORIGEM_CENTRO);
                              void executarComando(cmd, false);
                            }}
                            aoSelecionarPapel={lidarSelecionarPapel}
                            aoNotificar={(parte, campo) =>
                              lidarNotificarDoPalco(turno.pedidoId || (pedidoId ?? ''), parte, campo)
                            }
                            aoAbrirAgenda={aoAbrirAgenda}
                            aoAplicarHipotese={(hipotese) =>
                              lidarAplicarHipotese(turno.pedidoId || (pedidoId ?? ''), hipotese)
                            }
                            aoAnunciar={aoAnunciar}
                            slotLoader={<SeloMonolitosShader ativo={true} tamanho={24} />}
                          />
                        ) : turno.carregando ? (
                          <div className="ia-turno-carregando" role="status" aria-live="polite">
                            <SeloMonolitosShader ativo={true} tamanho={24} />
                            <span>
                              {turno.etapas.at(-1)?.rotulo ?? 'Consultando estado do pedido…'}
                            </span>
                          </div>
                        ) : turno.interpretado ? (
                          <RespostaFallbackTurno dados={turno.interpretado} />
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {painelEvidenciaAberto && (
          <div className="ia-evidencia-col">
            <EvidenciaLateralIA
              id={evidenciaId}
              pedidoId={pedidoId}
              projecao={projecao}
              daSessao={Boolean(pedidoAtual?.daSessao)}
              focoAtivo={focoAtivo}
              aoFocar={setFocoAtivo}
              aoAbrirNaTorre={aoAbrirNaTorre}
              aoFechar={desktopLargo ? undefined : () => setPreferenciaEvidencia(false)}
            />
          </div>
        )}
      </div>

      <footer
        className="ia-composer-dock"
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || voz.ouvindo) return;
          if (erroInput || voz.erro) {
            e.preventDefault();
            setErroInput(null);
            voz.limparErro();
            inputRef.current?.focus();
          }
        }}
      >
        <div className="ia-composer-shell">
          {(voz.erro || erroInput) && (
            <div className="ia-composer-alertas">
              {voz.erro && (
                <div className="ia-composer-alerta" role="alert">
                  <span className="ia-composer-alerta-texto">
                    <IconeErro />
                    <span>{voz.erro}</span>
                  </span>
                  <button
                    type="button"
                    className="botao-fechar"
                    aria-label="Fechar aviso de microfone"
                    onClick={() => {
                      voz.limparErro();
                      inputRef.current?.focus();
                    }}
                  >
                    <IconeFechar />
                  </button>
                </div>
              )}
              {erroInput && (
                <div id={erroInputId} className="ia-composer-alerta" role="alert">
                  <span className="ia-composer-alerta-texto">
                    <IconeErro />
                    <span>{erroInput}</span>
                  </span>
                  <button
                    type="button"
                    className="botao-fechar"
                    aria-label="Fechar aviso de validação"
                    onClick={() => {
                      setErroInput(null);
                      inputRef.current?.focus();
                    }}
                  >
                    <IconeFechar />
                  </button>
                </div>
              )}
            </div>
          )}

          <div
            className="ia-composer"
            data-enviando={algumTurnoStreaming ? 'true' : undefined}
            data-ouvindo={voz.ouvindo ? 'true' : undefined}
            data-erro={erroInput || voz.erro ? 'true' : undefined}
          >
            <div className="ia-composer-feixe" aria-hidden="true">
              <CamadaShader shader="liraVoz" ativo={algumTurnoStreaming} modo={1} />
            </div>

            <form className="ia-composer-form" onSubmit={aoSubmeter} noValidate>
              <label htmlFor={inputId} className="so-leitor">
                Pergunte ou comande em português sobre o pedido ativo
              </label>

              <span className="cmd-prefixo" aria-hidden="true">
                <span
                  className={`icone-troca ${!algumTurnoStreaming && !voz.ouvindo ? 'visivel' : ''}`}
                >
                  <IconeComando />
                </span>
                <span className={`icone-troca ${voz.ouvindo ? 'visivel' : ''}`}>
                  <span className="cmd-pulso" />
                </span>
                <span className={`icone-troca ${algumTurnoStreaming ? 'visivel' : ''}`}>
                  <span className="cmd-spinner" />
                </span>
              </span>

              <input
                ref={inputRef}
                id={inputId}
                name="comando-assistente"
                type="text"
                autoComplete="off"
                value={texto}
                onChange={(e) => {
                  setTexto(e.target.value);
                  setProvisorio(false);
                  if (erroInput) setErroInput(null);
                }}
                placeholder={
                  voz.fase === 'iniciando'
                    ? 'Ativando microfone…'
                    : voz.fase === 'finalizando'
                      ? 'Finalizando transcrição…'
                      : voz.ouvindo
                        ? 'Ouvindo em português… fale seu comando'
                        : 'Pergunte sobre divergências, simule outra data ou acione um setor…'
                }
                disabled={algumTurnoStreaming}
                aria-invalid={erroInput ? 'true' : undefined}
                aria-describedby={erroInput ? erroInputId : undefined}
                className={provisorio ? 'ia-composer-input ia-composer-provisorio' : 'ia-composer-input'}
              />

              <div className="ia-composer-acoes">
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
                      disabled={algumTurnoStreaming}
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
                      className="cmd-btn-voz ia-btn-voz"
                      aria-pressed="false"
                      aria-label="Ditar comando por voz"
                      onClick={alternarVoz}
                      disabled={algumTurnoStreaming}
                    >
                      <IconeMic />
                      <span>Voz</span>
                    </button>
                  )
                )}

                <button
                  ref={enviarBtnRef}
                  type="submit"
                  className="ia-btn-executar"
                  disabled={algumTurnoStreaming}
                  onPointerDown={capturarOrigemBotao}
                >
                  <CamadaShader
                    shader="ignicaoBotao"
                    ativo={algumTurnoStreaming}
                    origem={origemClique}
                    resolverEm={resolucaoBotao}
                    raioPx={4}
                    className="ia-btn-shader"
                  />
                  <span className="ia-btn-conteudo">
                    <span>{algumTurnoStreaming ? 'Compondo…' : 'Executar'}</span>
                    {!algumTurnoStreaming && <IconeRetorno />}
                  </span>
                </button>
              </div>
            </form>
          </div>

          <div className="ia-composer-dica">
            <span className="meta">
              Respostas ancoradas no registro do pedido
              {pedidoId ? ` · ${codigoCurtoPedido(pedidoId)}` : ''}
            </span>
            <span className="ia-atalho-hint meta">
              Atalho <kbd className="tecla mono">/</kbd> · <kbd className="tecla mono">Enter</kbd>{' '}
              para enviar
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
