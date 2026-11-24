import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  CamposObservados,
  EventoStreamMandato,
  Parte,
  ProjecaoPedido,
  ResultadoAgente,
  StatusExecucaoTool,
  ToolExecutada,
  TurnoConversa,
  ViewSpecV2,
} from '../../../shared/model.ts';
import { ErroMandatoApi, type PedidoResumo } from '../api.ts';
import {
  aplicarHipoteseComoPlanilha,
  garantirEstilosOps,
  transmitirMandatoStream,
  type ResultadoStreamMandato,
} from '../apiOps.ts';
import type { PaginaAssistenteIAProps } from '../assistenteContrato.ts';
import {
  chaveCurta,
  formatarDuracao,
  rotuloAcaoMandato,
  rotuloFonte,
  rotuloMotivoNotificacao,
  rotuloParte,
} from '../format.ts';
import {
  interpretarResultadoMandato,
  resumoParaAnuncio,
  type ResultadoMandatoInterpretado,
} from '../mandato.ts';
import { movimentoReduzidoAgora } from '../shaders/index.ts';
import { usePresencaAnimada } from '../usePresencaAnimada.ts';
import { useTextoFluido } from '../useTextoFluido.ts';
import { useVoz } from '../useVoz.ts';
import '../assistente.css';
import { EvidenciaLateralIA } from './EvidenciaLateralIA.tsx';
import {
  IconeCaixa,
  IconeCalendario,
  IconeCaminhao,
  IconeComando,
  IconeConfere,
  IconeErro,
  IconeFechar,
  IconeFiscal,
  IconeGalpao,
  IconeMais,
  IconeMic,
  IconeOk,
  IconePainelLateral,
  IconeParar,
  IconeRetorno,
  IconeRota,
  IconeSeta,
} from './icones.tsx';
import { PalcoGenUI, type EtapaStreamGenUI } from './PalcoGenUI.tsx';
import { SuperficieMineralIA, type EstadoSuperficieIA } from './SuperficieMineralIA.tsx';
import { VisualizadorVoz } from './VisualizadorVoz.tsx';

type TipoPartida = 'rota' | 'simular' | 'fiscal' | 'despacho' | 'carga' | 'cd';

interface PartidaSugerida {
  readonly icone: TipoPartida;
  readonly comando: string;
  readonly apoio: string;
}

function iconeDaPartida(tipo: TipoPartida) {
  switch (tipo) {
    case 'rota':
      return <IconeRota />;
    case 'simular':
      return <IconeCalendario />;
    case 'fiscal':
      return <IconeFiscal />;
    case 'despacho':
      return <IconeCaminhao />;
    case 'carga':
      return <IconeCaixa />;
    case 'cd':
      return <IconeGalpao />;
  }
}

interface PontoTela {
  readonly x: number;
  readonly y: number;
}

// Linha da trilha de ferramentas do agente: o evento 'tool' do SSE nao traz
// id de chamada, entao a identidade local combina nome e posicao de chegada.
interface ToolTurnoIA {
  id: string;
  nome: string;
  resumo: string;
  status: StatusExecucaoTool;
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
  textoAgente: string;
  tools: ToolTurnoIA[];
  agente: ResultadoAgente | null;
  projecaoSnapshot: ProjecaoPedido | null;
  autoForkAplicado: boolean;
  erro: { mensagem: string; status: number; motivo?: string } | null;
}

const PARTIDAS_DIVERGENTE: readonly PartidaSugerida[] = [
  {
    icone: 'rota',
    comando: 'Qual o atraso real e quem é impactado?',
    apoio: 'Resumo e mapa por setor',
  },
  {
    icone: 'simular',
    comando: 'Simule a entrega para 28/01/2026',
    apoio: 'Impacto sem gravar no registro',
  },
  {
    icone: 'fiscal',
    comando: 'Mostre a visão e as ações do Fiscal',
    apoio: 'Conflitos e fila do Fiscal',
  },
  {
    icone: 'despacho',
    comando: 'Avise a transportadora sobre a divergência',
    apoio: 'Rascunho revisável para envio',
  },
];

const PARTIDAS_CONSISTENTE: readonly PartidaSugerida[] = [
  {
    icone: 'rota',
    comando: 'Resuma o pedido e verifique pendências',
    apoio: 'Síntese dos campos vigiados',
  },
  {
    icone: 'simular',
    comando: 'Simule a entrega para 28/01/2026',
    apoio: 'Setores acionados em atraso',
  },
  {
    icone: 'carga',
    comando: 'Confira peso e volumes entre NF-e e CT-e',
    apoio: 'Valores declarados por fonte',
  },
  {
    icone: 'cd',
    comando: 'Mostre a visão e as ações do CD',
    apoio: 'Recebimento, volumes e janela',
  },
];

function codigoCurtoPedido(id: string): string {
  return /^\d{44}$/.test(id) ? id.slice(-6) : chaveCurta(id);
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
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    el.closest('[role="listbox"]') !== null
  );
}

function ehAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function centroElemento(el: HTMLElement | null): PontoTela | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
}

function formatarListaFontes(dados: ProjecaoPedido | null): string {
  if (!dados || dados.versoes.length === 0) return 'as fontes';
  const unicas = Array.from(new Set(dados.versoes.map((v) => rotuloFonte(v.fonte))));
  if (unicas.length === 1) return unicas[0] ?? 'as fontes';
  if (unicas.length === 2) return `${unicas[0]} e ${unicas[1]}`;
  return `${unicas.slice(0, -1).join(', ')} e ${unicas[unicas.length - 1]}`;
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

// 'executando' abre uma linha nova; 'concluida'/'erro' fecha a execucao mais
// recente com o mesmo nome, ou anexa uma linha ja encerrada quando o evento
// de abertura nao chegou.
function acumularToolTurno(
  atuais: readonly ToolTurnoIA[],
  ev: { nome: string; resumo: string; status: StatusExecucaoTool },
): ToolTurnoIA[] {
  if (ev.status === 'executando') {
    return [
      ...atuais,
      { id: `${ev.nome}-${atuais.length}`, nome: ev.nome, resumo: ev.resumo, status: 'executando' },
    ];
  }
  for (let i = atuais.length - 1; i >= 0; i--) {
    const atual = atuais[i];
    if (atual && atual.nome === ev.nome && atual.status === 'executando') {
      return atuais.map((t, j) =>
        j === i ? { ...t, resumo: ev.resumo || t.resumo, status: ev.status } : t,
      );
    }
  }
  return [
    ...atuais,
    { id: `${ev.nome}-${atuais.length}`, nome: ev.nome, resumo: ev.resumo, status: ev.status },
  ];
}

// No 'fim', a trilha final do servidor (toolsExecutadas) reconcilia as linhas
// ainda abertas: cada 'executando' pega o desfecho com o mesmo nome, ou fecha
// como 'concluida' quando o servidor nao a reportou.
function reconciliarToolsTurno(
  atuais: readonly ToolTurnoIA[],
  finais: readonly ToolExecutada[] | undefined,
): ToolTurnoIA[] {
  const pendentes = [...(finais ?? [])];
  return atuais.map((t) => {
    if (t.status !== 'executando') return t;
    const idx = pendentes.findIndex((f) => f.nome === t.nome);
    const final = idx >= 0 ? pendentes.splice(idx, 1)[0] : undefined;
    return {
      ...t,
      resumo: final?.resumo ? final.resumo : t.resumo,
      status: final ? final.status : 'concluida',
    };
  });
}

const LIMITE_TURNOS_HISTORICO = 10;
const LIMITE_CARACTERES_TURNO = 1200;

function cortarTextoHistorico(texto: string): string {
  const limpo = texto.trim();
  return limpo.length > LIMITE_CARACTERES_TURNO
    ? `${limpo.slice(0, LIMITE_CARACTERES_TURNO).trimEnd()}…`
    : limpo;
}

// Fala do assistente registrada no turno: o texto natural do agente quando
// existe; nos turnos do fluxo classico, o resumo gerado para o anuncio.
function textoAssistenteDoTurno(turno: TurnoIA): string {
  if (turno.agente && turno.agente.textoFinal.trim()) return turno.agente.textoFinal;
  if (turno.textoAgente.trim()) return turno.textoAgente;
  if (turno.interpretado) return resumoParaAnuncio(turno.interpretado);
  return '';
}

// Historico multi-turn do corpo (spec 0009, RF20): pares usuario/assistente
// dos ultimos turnos finalizados, mais antigo primeiro, sem turno em voo nem
// turno que terminou em erro.
function montarHistoricoConversa(turnos: readonly TurnoIA[]): TurnoConversa[] {
  const historico: TurnoConversa[] = [];
  const elegiveis = turnos.filter((t) => !t.carregando && !t.erro).slice(-LIMITE_TURNOS_HISTORICO);
  for (const turno of elegiveis) {
    const usuario = cortarTextoHistorico(turno.comando);
    const assistente = cortarTextoHistorico(textoAssistenteDoTurno(turno));
    if (!usuario || !assistente) continue;
    historico.push({ papel: 'usuario', texto: usuario });
    historico.push({ papel: 'assistente', texto: assistente });
  }
  return historico;
}

// Anuncio acessivel do turno do agente: primeira frase do texto final,
// com teto curto para o leitor de tela.
function resumoAgenteParaAnuncio(textoFinal: string): string {
  const limpo = textoFinal.trim();
  if (!limpo) return 'Resposta concluída.';
  const primeiraLinha = limpo.split('\n', 1)[0] ?? limpo;
  const fimFrase = primeiraLinha.search(/[.!?](\s|$)/);
  const base = fimFrase >= 0 ? primeiraLinha.slice(0, fimFrase + 1) : primeiraLinha;
  return base.length > 140 ? `${base.slice(0, 139).trimEnd()}…` : base;
}

type SegmentoProsa =
  | { tipo: 'paragrafo'; linhas: string[] }
  | { tipo: 'lista'; itens: string[] };

// Markdown minimo do agente (RF21): blocos separados por linha em branco,
// linhas '- '/'• ' viram lista, '**negrito**' e '`codigo`' sao inline.
function dividirProsaAgente(texto: string): SegmentoProsa[] {
  const segmentos: SegmentoProsa[] = [];
  for (const bloco of texto.split(/\n{2,}/)) {
    if (!bloco.trim()) continue;
    let linhasParagrafo: string[] = [];
    const fecharParagrafo = () => {
      if (linhasParagrafo.length === 0) return;
      segmentos.push({ tipo: 'paragrafo', linhas: linhasParagrafo });
      linhasParagrafo = [];
    };
    for (const linha of bloco.split('\n')) {
      const aparada = linha.trimStart();
      const marcador = aparada.startsWith('- ') ? 2 : aparada.startsWith('•') ? 1 : 0;
      if (marcador > 0) {
        fecharParagrafo();
        const item = aparada.slice(marcador).trimStart();
        const ultimo = segmentos[segmentos.length - 1];
        if (ultimo && ultimo.tipo === 'lista') ultimo.itens.push(item);
        else segmentos.push({ tipo: 'lista', itens: [item] });
      } else if (aparada || linhasParagrafo.length > 0) {
        linhasParagrafo.push(linha);
      }
    }
    fecharParagrafo();
  }
  return segmentos;
}

const RE_INLINE_AGENTE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

// Formatacao inline do texto do agente em JSX puro: sem dangerouslySetInnerHTML.
function InlineAgente({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(RE_INLINE_AGENTE).map((parte, i) => {
        if (parte.length > 4 && parte.startsWith('**') && parte.endsWith('**')) {
          return <strong key={`b${i}`}>{parte.slice(2, -2)}</strong>;
        }
        if (parte.length > 2 && parte.startsWith('`') && parte.endsWith('`')) {
          return <code key={`c${i}`}>{parte.slice(1, -1)}</code>;
        }
        return <Fragment key={`t${i}`}>{parte}</Fragment>;
      })}
    </>
  );
}

// Resposta em linguagem natural do agente: suaviza a cadencia do SSE em 60fps
// com useTextoFluido, revela cada novo bloco de prosa sem saltos e mantem um
// cursor mineral fino que se dissolve ao concluir.
function TextoAgente({ texto, aoVivo }: { texto: string; aoVivo: boolean }) {
  const { visivel, compondo } = useTextoFluido(texto, aoVivo);
  const segmentos = useMemo(() => dividirProsaAgente(visivel), [visivel]);
  const cursor = (
    <span
      className="agente-cursor"
      data-ativo={compondo ? 'true' : 'false'}
      aria-hidden="true"
    />
  );
  const ultimo = segmentos.length - 1;
  const ultimoSeg = ultimo >= 0 ? segmentos[ultimo] : undefined;
  const ultimoEhParagrafo = ultimoSeg?.tipo === 'paragrafo';
  const ultimoEhLista = ultimoSeg?.tipo === 'lista';

  return (
    <div className="agente-texto" data-compondo={compondo ? 'true' : 'false'}>
      {segmentos.map((seg, i) => {
        const ehUltimoSeg = i === ultimo;
        if (seg.tipo === 'lista') {
          const ultimoItem = seg.itens.length - 1;
          return (
            <ul
              key={`lista-${i}`}
              className="agente-seg"
              style={{ '--seg-i': Math.min(i, 6) } as CSSProperties}
            >
              {seg.itens.map((item, j) => (
                <li
                  key={`item-${i}-${j}`}
                  className="agente-item"
                  style={{ '--item-i': Math.min(j, 8) } as CSSProperties}
                >
                  <InlineAgente texto={item} />
                  {ehUltimoSeg && j === ultimoItem ? cursor : null}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={`p-${i}`}
            className="agente-seg"
            style={{ '--seg-i': Math.min(i, 6) } as CSSProperties}
          >
            {seg.linhas.map((linha, j) => (
              <Fragment key={`l-${i}-${j}`}>
                {j > 0 && <br />}
                <InlineAgente texto={linha} />
              </Fragment>
            ))}
            {ehUltimoSeg ? cursor : null}
          </p>
        );
      })}
      {compondo && !ultimoEhParagrafo && !ultimoEhLista && (
        <p className="agente-cursor-linha">{cursor}</p>
      )}
    </div>
  );
}

const TOOLS_VISUAIS = new Set([
  'simular_cenario',
  'comparar_fontes',
  'preparar_notificacao',
  'enviar_notificacao',
  'propagar_divergencias',
]);

function iconeDaTool(nome: string) {
  switch (nome) {
    case 'simular_cenario':
      return <IconeCalendario />;
    case 'comparar_fontes':
      return <IconeCaixa />;
    case 'listar_tarefas_setor':
      return <IconeGalpao />;
    case 'consultar_auditoria':
      return <IconeFiscal />;
    case 'preparar_notificacao':
    case 'enviar_notificacao':
      return <IconeCaminhao />;
    case 'propagar_divergencias':
      return <IconeComando />;
    default:
      return <IconeRota />;
  }
}

function rotuloBlueprintGenUI(tools: readonly ToolTurnoIA[]): string {
  if (tools.some((t) => t.nome === 'simular_cenario')) {
    return 'Compondo simulador interativo e mapa causal…';
  }
  if (tools.some((t) => t.nome === 'preparar_notificacao' || t.nome === 'enviar_notificacao')) {
    return 'Preparando cartões de despacho por setor…';
  }
  if (tools.some((t) => t.nome === 'comparar_fontes')) {
    return 'Montando comparador documental…';
  }
  return 'Compondo visão operacional…';
}

function IconeCheckAnimado() {
  return (
    <svg
      className="ia-check-anim"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3.2 8.4 6.5 11.7 12.8 4.8"
        pathLength={1}
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Trilha viva unificada de raciocinio e ferramentas: aberta com pulso mineral
// enquanto o agente consulta o ledger, e recolhe suavemente via grid-template-rows
// para uma linha discreta e expansivel assim que a resposta em prosa chega.
function TrilhaVivaAgente({
  etapas,
  tools,
  carregando,
  temTexto,
}: {
  etapas: readonly EtapaStreamGenUI[];
  tools: readonly ToolTurnoIA[];
  carregando: boolean;
  temTexto: boolean;
}) {
  const [expandidoManual, setExpandidoManual] = useState<boolean | null>(null);
  const ativa = carregando && !temTexto;
  const expandido = expandidoManual !== null ? expandidoManual : ativa;

  const etapaAtual = etapas.at(-1);
  const concluidas = tools.filter((t) => t.status === 'concluida').length;
  const comErro = tools.filter((t) => t.status === 'erro').length;
  const executando = tools.some((t) => t.status === 'executando');

  const tituloResumo = useMemo(() => {
    if (ativa) {
      if (executando) {
        const emCurso = tools.filter((t) => t.status === 'executando');
        if (emCurso.length === 1) return emCurso[0]?.resumo || 'Consultando registro…';
        return `Consultando ${emCurso.length} fontes em paralelo…`;
      }
      return etapaAtual?.rotulo ?? 'Interpretando e consultando o registro…';
    }
    if (tools.length === 0) {
      return etapaAtual?.rotulo ?? 'Consulta concluída';
    }
    const base =
      concluidas === 1 ? '1 consulta concluída' : `${concluidas} consultas concluídas`;
    const ultimaConcluida = [...tools].reverse().find((t) => t.status === 'concluida');
    if (comErro > 0) {
      return `${base} · ${comErro} aviso${comErro === 1 ? '' : 's'}`;
    }
    return ultimaConcluida?.resumo ? `${base} · ${ultimaConcluida.resumo}` : base;
  }, [ativa, executando, tools, etapaAtual, concluidas, comErro]);

  if (!carregando && tools.length === 0) return null;

  return (
    <div
      className="ia-trilha-viva"
      data-ativa={ativa ? 'true' : 'false'}
      data-expandido={expandido ? 'true' : 'false'}
      aria-live="polite"
    >
      <span className="ia-trilha-feixe" aria-hidden="true" />
      <button
        type="button"
        className="ia-trilha-cab"
        aria-expanded={expandido}
        disabled={tools.length === 0 && etapas.length === 0}
        onClick={() => setExpandidoManual((atual) => !(atual ?? ativa))}
      >
        <span className="ia-trilha-indicador" aria-hidden="true">
          {ativa ? (
            <EmblemaMonolitos tamanho={17} />
          ) : comErro > 0 && concluidas === 0 ? (
            <IconeErro />
          ) : (
            <IconeCheckAnimado />
          )}
        </span>
        <span key={etapaAtual?.id ?? (ativa ? 'ativa' : 'fim')} className="ia-trilha-titulo">
          {tituloResumo}
        </span>
        {(tools.length > 0 || etapas.length > 0) && <ChevronSeletor />}
      </button>

      {(tools.length > 0 || (ativa && etapas.length > 0)) && (
        <div className="ia-trilha-gaveta" data-aberta={expandido ? 'true' : 'false'}>
          <div className="ia-trilha-gaveta-inner">
            <ol className="ia-trilha-lista" aria-label="Ferramentas consultadas pelo agente">
              {tools.length > 0
                ? tools.map((tool, i) => (
                    <li
                      key={tool.id}
                      className="ia-tool-linha"
                      data-status={tool.status}
                      style={{ '--tool-i': Math.min(i, 8) } as CSSProperties}
                    >
                      <span className="ia-tool-estado" aria-hidden="true">
                        {tool.status === 'executando' ? (
                          <span className="ia-tool-pulso" />
                        ) : tool.status === 'concluida' ? (
                          <IconeCheckAnimado />
                        ) : (
                          <IconeErro />
                        )}
                      </span>
                      <span className="ia-tool-icone" aria-hidden="true">
                        {iconeDaTool(tool.nome)}
                      </span>
                      <span className="ia-tool-texto">{tool.resumo || tool.nome}</span>
                    </li>
                  ))
                : etapas.map((et, i) => (
                    <li
                      key={et.id}
                      className="ia-tool-linha"
                      data-status={et.concluida ? 'concluida' : 'executando'}
                      style={{ '--tool-i': Math.min(i, 6) } as CSSProperties}
                    >
                      <span className="ia-tool-estado" aria-hidden="true">
                        {et.concluida ? <IconeCheckAnimado /> : <span className="ia-tool-pulso" />}
                      </span>
                      <span className="ia-tool-texto">
                        {et.rotulo}
                        {et.detalhe ? ` · ${et.detalhe}` : ''}
                      </span>
                    </li>
                  ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// Blueprint arquitetonico exibido enquanto uma tool visual prepara os blocos
// GenUI: evita que os paineis interativos surjam do nada na tela.
function EsqueletoGenUI({ rotulo }: { rotulo: string }) {
  return (
    <div className="ia-genui-blueprint" role="status" aria-live="polite" aria-label={rotulo}>
      <div className="ia-blueprint-cab">
        <span className="ia-blueprint-linha-curta" />
        <span className="ia-blueprint-rotulo">{rotulo}</span>
      </div>
      <div className="ia-blueprint-grade">
        <div className="ia-blueprint-laje" style={{ '--bp-i': 0 } as CSSProperties}>
          <span className="ia-blueprint-barra w-40" />
          <span className="ia-blueprint-barra w-85" />
          <span className="ia-blueprint-barra w-65" />
        </div>
        <div className="ia-blueprint-laje" style={{ '--bp-i': 1 } as CSSProperties}>
          <span className="ia-blueprint-barra w-55" />
          <span className="ia-blueprint-barra w-75" />
          <span className="ia-blueprint-barra w-50" />
        </div>
      </div>
    </div>
  );
}

function desktopSplitInicial(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 1180px)').matches
  );
}

// Emblema geométrico estático dos 3 monólitos (evita criar um segundo contexto WebGL na rota #/ia).
function EmblemaMonolitos({ tamanho = 20 }: { tamanho?: number }) {
  return (
    <svg
      className="ia-selo-monolitos"
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
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

function ChevronSeletor() {
  return (
    <svg
      className="ia-pedido-chevron"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="m4 6.25 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SeletorPedidoPopoverProps {
  pedidos: readonly PedidoResumo[];
  pedidoId: string | null;
  divergenteAtual: boolean;
  aoSelecionar: (id: string) => void;
}

function SeletorPedidoPopover({
  pedidos,
  pedidoId,
  divergenteAtual,
  aoSelecionar,
}: SeletorPedidoPopoverProps) {
  const listboxId = useId();
  const raizRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const presenca = usePresencaAnimada(aberto, 170);

  const indiceSelecionado = useMemo(
    () => Math.max(0, pedidos.findIndex((p) => p.pedidoId === pedidoId)),
    [pedidos, pedidoId],
  );
  const pedidoAtual = pedidoId ? (pedidos.find((p) => p.pedidoId === pedidoId) ?? null) : null;

  const abrir = useCallback(
    (indiceInicial?: number) => {
      if (pedidos.length === 0) return;
      setIndiceAtivo(indiceInicial ?? indiceSelecionado);
      setAberto(true);
    },
    [pedidos.length, indiceSelecionado],
  );

  const fechar = useCallback((restaurarFoco = false) => {
    setAberto(false);
    if (restaurarFoco) {
      window.requestAnimationFrame(() => {
        gatilhoRef.current?.focus();
      });
    }
  }, []);

  const selecionarPorIndice = useCallback(
    (idx: number) => {
      const alvo = pedidos[idx];
      if (!alvo) return;
      if (alvo.pedidoId !== pedidoId) {
        aoSelecionar(alvo.pedidoId);
      }
      fechar(true);
    },
    [pedidos, pedidoId, aoSelecionar, fechar],
  );

  useEffect(() => {
    if (!aberto) return;
    window.requestAnimationFrame(() => {
      listaRef.current?.focus();
    });
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: PointerEvent) => {
      if (raizRef.current && e.target instanceof Node && !raizRef.current.contains(e.target)) {
        fechar(false);
      }
    };
    document.addEventListener('pointerdown', aoClicarFora);
    return () => document.removeEventListener('pointerdown', aoClicarFora);
  }, [aberto, fechar]);

  function aoTeclarGatilho(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (pedidos.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      abrir((indiceSelecionado + 1) % pedidos.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      abrir((indiceSelecionado - 1 + pedidos.length) % pedidos.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (aberto) {
        fechar(false);
      } else {
        abrir(indiceSelecionado);
      }
    }
  }

  function aoTeclarLista(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (pedidos.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceAtivo((atual) => (atual + 1) % pedidos.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceAtivo((atual) => (atual - 1 + pedidos.length) % pedidos.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setIndiceAtivo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setIndiceAtivo(pedidos.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selecionarPorIndice(indiceAtivo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar(true);
    } else if (e.key === 'Tab') {
      fechar(false);
    }
  }

  const nomeAtual = pedidoAtual?.emitente?.trim() || 'Pedido';
  const codigoAtual = pedidoAtual ? codigoCurtoPedido(pedidoAtual.pedidoId) : null;

  return (
    <div ref={raizRef} className="ia-pedido-seletor">
      <button
        ref={gatilhoRef}
        type="button"
        className="ia-pedido-gatilho"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={listboxId}
        aria-label="Pedido ativo para consulta"
        disabled={pedidos.length === 0}
        onClick={() => (aberto ? fechar(false) : abrir(indiceSelecionado))}
        onKeyDown={aoTeclarGatilho}
      >
        {pedidoAtual ? (
          <>
            <span
              className="ia-pedido-ponto"
              data-status={divergenteAtual ? 'divergente' : 'ok'}
              aria-hidden="true"
            />
            <span className="ia-pedido-texto">
              <span className="ia-pedido-nome">{nomeAtual}</span>
              <span className="ia-pedido-sep" aria-hidden="true">
                ·
              </span>
              <span className="ia-pedido-cod mono num">{codigoAtual}</span>
            </span>
          </>
        ) : (
          <span className="ia-pedido-vazio">Nenhum pedido disponível</span>
        )}
        <ChevronSeletor />
      </button>

      {presenca.montado && (
        <div
          ref={listaRef}
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          aria-label="Pedidos disponíveis"
          aria-activedescendant={`${listboxId}-opt-${indiceAtivo}`}
          className="ia-pedido-menu"
          data-fase={presenca.fase}
          onKeyDown={aoTeclarLista}
        >
          {pedidos.map((p, idx) => {
            const selecionado = p.pedidoId === pedidoId;
            const ativo = idx === indiceAtivo;
            const qtdDiv = p.divergencias ?? 0;
            const divergente = qtdDiv > 0;
            const codigo = codigoCurtoPedido(p.pedidoId);
            const emitente = p.emitente?.trim() || `Pedido ${codigo}`;

            return (
              <div
                key={p.pedidoId}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={selecionado}
                className="ia-pedido-opcao"
                data-ativo={ativo ? 'true' : undefined}
                onMouseEnter={() => setIndiceAtivo(idx)}
                onClick={() => selecionarPorIndice(idx)}
              >
                <span
                  className="ia-pedido-ponto"
                  data-status={divergente ? 'divergente' : 'ok'}
                  aria-hidden="true"
                />
                <span className="ia-pedido-opcao-corpo">
                  <span className="ia-pedido-opcao-topo">
                    <span className="ia-pedido-opcao-nome">{emitente}</span>
                    <span className="ia-pedido-opcao-cod mono num">{codigo}</span>
                  </span>
                  <span className="ia-pedido-opcao-sub">
                    <span
                      className="ia-pedido-opcao-status"
                      data-status={divergente ? 'divergente' : 'ok'}
                    >
                      {divergente
                        ? `${qtdDiv} ${qtdDiv === 1 ? 'conflito' : 'conflitos'}`
                        : 'Consistente'}
                    </span>
                    {p.daSessao && <span className="ia-pedido-opcao-sessao">Sua sessão</span>}
                  </span>
                </span>
                {selecionado && (
                  <span className="ia-pedido-opcao-check" aria-hidden="true">
                    <IconeConfere />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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

  const inputId = useId();
  const erroInputId = useId();
  const evidenciaId = useId();

  const palcoPrincipalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const enviarBtnRef = useRef<HTMLButtonElement>(null);
  const vozBtnRef = useRef<HTMLButtonElement>(null);
  const pararBtnRef = useRef<HTMLButtonElement>(null);
  const evidenciaBtnRef = useRef<HTMLButtonElement>(null);
  const ultimoTurnoRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sairSantuarioTimerRef = useRef<number | null>(null);
  const turnoSeqRef = useRef(0);
  const turnosCountRef = useRef(0);
  const turnosRef = useRef<TurnoIA[]>([]);
  const comandoInicialConsumidoRef = useRef<string | null>(null);

  // Refs de gestão de foco WCAG 2.2 AA para voz.
  const textoPreVozRef = useRef('');
  const focouPararRef = useRef(false);
  const eraOuvindoRef = useRef(false);
  const concluiuComFocoRef = useRef(false);

  const [turnos, setTurnos] = useState<TurnoIA[]>([]);
  const [saindoSantuario, setSaindoSantuario] = useState(false);
  const [pulsoSeq, setPulsoSeq] = useState(0);
  const [pulsoOrigem, setPulsoOrigem] = useState<PontoTela | null>(null);
  const [texto, setTexto] = useState('');
  const [provisorio, setProvisorio] = useState(false);
  const [erroInput, setErroInput] = useState<string | null>(null);
  const [focoAtivo, setFocoAtivo] = useState<AlvoFocoGenUI | null>(null);
  const [desktopLargo, setDesktopLargo] = useState<boolean>(desktopSplitInicial);
  const [preferenciaEvidencia, setPreferenciaEvidencia] = useState<boolean | null>(null);

  turnosCountRef.current = turnos.length;
  turnosRef.current = turnos;

  const pedidoAtual = useMemo(
    () => (pedidoId ? (pedidos.find((p) => p.pedidoId === pedidoId) ?? null) : null),
    [pedidos, pedidoId],
  );

  const dadosProjecao = projecao.estado === 'ok' ? projecao.dados : null;
  const algumTurnoStreaming = turnos.some((t) => t.carregando);
  const temConversa = turnos.length > 0;
  const emSantuario = !temConversa || saindoSantuario;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 1180px)');
    const aoMudar = () => setDesktopLargo(mq.matches);
    aoMudar();
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  // No Santuário o painel de evidências começa oculto para manter o palco limpo;
  // na conversa abre ancorado à direita no desktop >= 1180px salvo escolha explícita.
  const painelEvidenciaAberto =
    preferenciaEvidencia !== null
      ? preferenciaEvidencia
      : !emSantuario && desktopLargo && dadosProjecao !== null;

  const evidenciaComoGaveta = painelEvidenciaAberto && (!desktopLargo || emSantuario);
  const presencaGaveta = usePresencaAnimada(evidenciaComoGaveta, 200);

  // Marca o palco principal como inert enquanto a gaveta sobreposta de evidências está aberta.
  useEffect(() => {
    const el = palcoPrincipalRef.current as (HTMLDivElement & { inert: boolean }) | null;
    if (!el) return;
    el.inert = evidenciaComoGaveta;
    return () => {
      el.inert = false;
    };
  }, [evidenciaComoGaveta]);

  const fecharGavetaEvidencia = useCallback(() => {
    setPreferenciaEvidencia(false);
    window.requestAnimationFrame(() => {
      evidenciaBtnRef.current?.focus();
    });
  }, []);

  // Fecha gaveta sobreposta com Escape (sem competir com Escape de cancelamento da voz).
  useEffect(() => {
    if (!evidenciaComoGaveta) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      fecharGavetaEvidencia();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [evidenciaComoGaveta, fecharGavetaEvidencia]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (sairSantuarioTimerRef.current !== null) {
        window.clearTimeout(sairSantuarioTimerRef.current);
        sairSantuarioTimerRef.current = null;
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
      if (evidenciaComoGaveta || elementoEditavel(document.activeElement)) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', aoTeclarGlobal);
    return () => window.removeEventListener('keydown', aoTeclarGlobal);
  }, [evidenciaComoGaveta]);

  // Rola suavemente para o início do turno recém-adicionado assim que a conversa fica visível.
  const totalTurnos = turnos.length;
  useEffect(() => {
    if (totalTurnos === 0 || emSantuario) return;
    const alvo = ultimoTurnoRef.current;
    if (!alvo || typeof alvo.scrollIntoView !== 'function') return;
    alvo.scrollIntoView({
      behavior: movimentoReduzidoAgora() ? 'auto' : 'smooth',
      block: 'start',
    });
  }, [totalTurnos, emSantuario]);

  const atualizarTurno = useCallback(
    (turnoId: string, fn: (atual: TurnoIA) => TurnoIA) => {
      setTurnos((prev) => prev.map((t) => (t.id === turnoId ? fn(t) : t)));
    },
    [],
  );

  const emitirPulsoSuperficie = useCallback((origem: PontoTela | null = null) => {
    setPulsoOrigem(origem);
    setPulsoSeq((s) => s + 1);
  }, []);

  const cancelarSaidaSantuario = useCallback(() => {
    if (sairSantuarioTimerRef.current !== null) {
      window.clearTimeout(sairSantuarioTimerRef.current);
      sairSantuarioTimerRef.current = null;
    }
    setSaindoSantuario(false);
  }, []);

  const executarComando = useCallback(
    async (comandoBruto: string, limparCampo = true, origem: PontoTela | null = null) => {
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

      emitirPulsoSuperficie(origem);

      // Coreografia de saída do Santuário enquanto o stream SSE já dispara sem latência.
      if (turnosCountRef.current === 0 && !movimentoReduzidoAgora()) {
        cancelarSaidaSantuario();
        setSaindoSantuario(true);
        sairSantuarioTimerRef.current = window.setTimeout(() => {
          sairSantuarioTimerRef.current = null;
          setSaindoSantuario(false);
        }, 170);
      }

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
        textoAgente: '',
        tools: [],
        agente: null,
        projecaoSnapshot: dadosProjecao,
        autoForkAplicado: false,
        erro: null,
      };
      // O historico sai dos turnos ja finalizados, antes deste entrar na lista.
      const historicoConversa = montarHistoricoConversa(turnosRef.current);
      setTurnos((prev) => [...prev, novoTurno]);

      const lidarEvento = (ev: EventoStreamMandato) => {
        if (controller.signal.aborted) return;
        if (ev.tipo === 'etapa') {
          atualizarTurno(turnoId, (t) => ({
            ...t,
            etapas: adicionarOuAtualizarEtapa(t.etapas, ev),
          }));
        } else if (ev.tipo === 'tool') {
          if (ev.status === 'concluida') {
            emitirPulsoSuperficie(null);
          }
          atualizarTurno(turnoId, (t) => ({
            ...t,
            tools: acumularToolTurno(t.tools, ev),
          }));
        } else if (ev.tipo === 'texto_delta') {
          atualizarTurno(turnoId, (t) => ({
            ...t,
            textoAgente: t.textoAgente + ev.delta,
          }));
        } else if (ev.tipo === 'bloco') {
          emitirPulsoSuperficie(null);
          atualizarTurno(turnoId, (t) => ({
            ...t,
            blocosStream: acumularBlocoUnico(t.blocosStream, ev.bloco),
          }));
        } else if (ev.tipo === 'fim') {
          const resultado = ev.resultado;
          atualizarTurno(turnoId, (t) => ({
            ...t,
            pedidoId: resultado.pedidoIdResolvido || t.pedidoId,
            textoAgente: resultado.textoFinal || t.textoAgente,
            tools: reconciliarToolsTurno(t.tools, resultado.toolsExecutadas),
            viewSpec: resultado.viewSpec ?? t.viewSpec,
            agente: resultado,
            etapas: t.etapas.map((et) => ({ ...et, concluida: true })),
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
      ): Promise<ResultadoStreamMandato | null> => {
        try {
          return await transmitirMandatoStream(limpo, {
            ...(alvoId ? { pedidoId: alvoId } : {}),
            historico: historicoConversa,
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
        const saida = await rodarStream(pedidoId, false);
        if (!saida || controller.signal.aborted) return;

        const resposta = saida.resposta ?? null;
        const agente = saida.agente ?? null;
        const interpretado = resposta ? interpretarResultadoMandato(resposta) : null;
        const alvosResposta =
          resposta && Array.isArray(resposta.alvos) ? resposta.alvos : [];
        const alvoResolvido = agente?.pedidoIdResolvido ?? alvosResposta[0] ?? idInicial;
        const specFinal = agente?.viewSpec ?? resposta?.viewSpec ?? null;

        atualizarTurno(turnoId, (t) => ({
          ...t,
          pedidoId: alvoResolvido || t.pedidoId,
          carregando: false,
          etapas: t.etapas.map((et) => ({ ...et, concluida: true })),
          viewSpec: t.viewSpec ?? specFinal,
          interpretado: interpretado ?? t.interpretado,
          agente: t.agente ?? agente,
          textoAgente: t.textoAgente || (agente?.textoFinal ?? ''),
          erro: null,
        }));

        emitirPulsoSuperficie(null);

        if (agente && agente.textoFinal.trim()) {
          aoAnunciar(resumoAgenteParaAnuncio(agente.textoFinal));
        } else if (interpretado) {
          aoAnunciar(resumoParaAnuncio(interpretado));
        }

        const houveEscrita =
          resposta?.acao === 'propagar' ||
          resposta?.acao === 'notificar' ||
          (Array.isArray(agente?.toolsExecutadas) &&
            agente.toolsExecutadas.some(
              (tool) =>
                (tool.nome === 'propagar_divergencias' ||
                  tool.nome === 'enviar_notificacao') &&
                tool.status === 'concluida',
            ));
        if (houveEscrita) {
          void aoRecarregarPedido();
        }

        // Pedido resolvido pelo agente vira o foco da tela quando difere do
        // atual: projecao, evidencias e palco acompanham (mesma regra do fork).
        if (agente?.pedidoIdResolvido && agente.pedidoIdResolvido !== pedidoId) {
          aoSelecionarPedido(agente.pedidoIdResolvido);
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
      emitirPulsoSuperficie,
      cancelarSaidaSantuario,
      aoGarantirSessao,
      aoSelecionarPedido,
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
    void executarComando(limpo, false, null);
  }, [
    comandoInicial,
    pedidoId,
    projecao.estado,
    algumTurnoStreaming,
    aoConsumirComandoInicial,
    executarComando,
  ]);

  function iniciarNovaConversa() {
    abortRef.current?.abort();
    abortRef.current = null;
    cancelarSaidaSantuario();
    setTurnos([]);
    setFocoAtivo(null);
    setErroInput(null);
    voz.limparErro();
    emitirPulsoSuperficie(null);
    aoAnunciar('Nova conversa iniciada.');
    inputRef.current?.focus();
  }

  function alternarVoz() {
    if (voz.fase === 'finalizando') return;
    if (!voz.ouvindo) {
      textoPreVozRef.current = texto.trim();
      setErroInput(null);
      emitirPulsoSuperficie(centroElemento(vozBtnRef.current));
    }
    voz.alternar();
  }

  function aoSubmeter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (algumTurnoStreaming) return;
    void executarComando(texto, true, centroElemento(enviarBtnRef.current));
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

  // Telemetria real do pedido ativo para o ponto de status e subtítulo do Santuário.
  const qtdDivergencias = dadosProjecao
    ? new Set(dadosProjecao.divergencias.map((d) => d.campo)).size
    : (pedidoAtual?.divergencias ?? 0);
  const qtdTarefas = dadosProjecao
    ? new Set(dadosProjecao.tarefas.map((t) => `${t.parte}|${t.titulo}`)).size
    : (pedidoAtual?.tarefas ?? 0);
  const partidasAtivas = qtdDivergencias > 0 ? PARTIDAS_DIVERGENTE : PARTIDAS_CONSISTENTE;

  const estadoSuperficie: EstadoSuperficieIA = voz.ouvindo
    ? 'ouvindo'
    : algumTurnoStreaming
      ? 'processando'
      : 'ocioso';

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

  const codigoPedido = pedidoId ? codigoCurtoPedido(pedidoId) : null;

  const statusAtivoSantuario = voz.ouvindo
    ? voz.fase === 'iniciando'
      ? 'Ativando microfone'
      : 'Ouvindo comando'
    : algumTurnoStreaming
      ? 'Consultando registro'
      : null;

  const tituloSantuario = voz.ouvindo
    ? texto.trim() || 'Fale o que deseja investigar ou simular.'
    : 'O que deseja investigar ou simular neste pedido?';

  const subtituloSantuario = useMemo(() => {
    if (!pedidoId) {
      return 'Selecione um pedido acima para investigar divergências ou simular prazos.';
    }
    if (projecao.estado === 'carregando' && !dadosProjecao) {
      return `Carregando registro do pedido ${codigoCurtoPedido(pedidoId)}…`;
    }
    if (qtdDivergencias > 0) {
      const fontes = formatarListaFontes(dadosProjecao);
      const campoTxt = qtdDivergencias === 1 ? 'campo diverge' : 'campos divergem';
      const tarefaTxt = qtdTarefas === 1 ? 'tarefa aberta' : 'tarefas abertas';
      return `${qtdDivergencias} ${campoTxt} entre ${fontes} · ${qtdTarefas} ${tarefaTxt}`;
    }
    if (dadosProjecao?.pedido) {
      return `Fontes em acordo · ${dadosProjecao.pedido.emitente.nome} → ${dadosProjecao.pedido.destinatario.nome}`;
    }
    return 'Fontes em acordo · sem divergências abertas';
  }, [pedidoId, projecao.estado, dadosProjecao, qtdDivergencias, qtdTarefas]);

  return (
    <div
      className="ia-estudio"
      data-modo={emSantuario ? 'santuario' : 'conversa'}
      data-evidencia={painelEvidenciaAberto && !evidenciaComoGaveta ? 'ancorada' : 'oculta'}
    >
      <div className="ia-fundo-glsl" aria-hidden="true">
        <div className="ia-fundo-sticky">
          <SuperficieMineralIA
            estado={estadoSuperficie}
            modoFundo={temConversa ? 'conversa' : 'santuario'}
            analyserRef={voz.analyserRef}
            energiaRef={voz.energiaRef}
            pulsoExternoSeq={pulsoSeq}
            pulsoOrigem={pulsoOrigem}
          />
          <div className="ia-veu-conversa" data-ativo={temConversa ? 'true' : 'false'} />
        </div>
      </div>

      <div ref={palcoPrincipalRef} className="ia-palco-principal">
        <header className="ia-topo">
          <div className="ia-topo-identidade">
            <SeletorPedidoPopover
              pedidos={pedidos}
              pedidoId={pedidoId}
              divergenteAtual={qtdDivergencias > 0}
              aoSelecionar={aoSelecionarPedido}
            />
          </div>

          <div className="ia-topo-acoes">
            {temConversa && (
              <button
                type="button"
                className="ia-btn-topo"
                onClick={iniciarNovaConversa}
              >
                <IconeMais />
                <span>Nova conversa</span>
              </button>
            )}

            <button
              ref={evidenciaBtnRef}
              type="button"
              className="ia-btn-topo"
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
          </div>
        </header>

        <div className="ia-corpo">
          <section className="ia-conversa" aria-label="Estúdio de consulta operacional">
            {emSantuario ? (
              <div
                className="ia-santuario"
                data-saindo={saindoSantuario ? 'true' : undefined}
              >
                <div className="ia-santuario-cab">
                  {statusAtivoSantuario && (
                    <p className="ia-santuario-status" role="status" aria-live="polite">
                      <span className="ia-status-ponto" aria-hidden="true" />
                      <span>{statusAtivoSantuario}</span>
                    </p>
                  )}
                  <h1 className="ia-santuario-titulo">{tituloSantuario}</h1>
                  <p className="ia-santuario-subtitulo">{subtituloSantuario}</p>
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
                  {partidasAtivas.map((item, idx) => (
                    <button
                      key={item.comando}
                      type="button"
                      className="ia-partida-pilula"
                      data-pulso-proprio="true"
                      style={{ '--i': idx } as CSSProperties}
                      disabled={algumTurnoStreaming || !pedidoId}
                      onClick={(e) => {
                        const origem =
                          e.clientX > 0 || e.clientY > 0
                            ? { x: e.clientX, y: e.clientY }
                            : centroElemento(e.currentTarget);
                        void executarComando(item.comando, false, origem);
                      }}
                    >
                      <span className="ia-partida-icone" aria-hidden="true">
                        {iconeDaPartida(item.icone)}
                      </span>
                      <span className="ia-partida-corpo">
                        <span className="ia-partida-cmd">{item.comando}</span>
                        <span className="ia-partida-apoio">{item.apoio}</span>
                      </span>
                      <span className="ia-partida-seta" aria-hidden="true">
                        <IconeSeta />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="ia-thread-wrap">
                <h1 className="so-leitor">
                  Conversa operacional{codigoPedido ? ` do pedido ${codigoPedido}` : ''}
                </h1>

                <ol className="ia-thread" aria-label="Turnos da consulta">
                  {turnos.map((turno, idx) => {
                    const ehUltimo = idx === turnos.length - 1;
                    // O snapshot so serve quando retrata o mesmo pedido do
                    // turno: pedidoIdResolvido (ou fork) pode muda-lo no meio.
                    const snapshotServe =
                      turno.projecaoSnapshot !== null &&
                      (turno.projecaoSnapshot.pedido === null ||
                        turno.projecaoSnapshot.pedido.id === turno.pedidoId);
                    const projecaoTurno =
                      turno.pedidoId === pedidoId && dadosProjecao
                        ? dadosProjecao
                        : snapshotServe
                          ? turno.projecaoSnapshot
                          : null;
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
                            <div className="ia-turno-titulo-linha">
                              <h2 className="ia-turno-comando">{turno.comando}</h2>
                              <time className="ia-turno-hora mono num">{turno.criadoEm}</time>
                            </div>
                            {turno.autoForkAplicado && (
                              <span className="ia-turno-nota-sessao">
                                Cópia criada na sua sessão para gravar
                              </span>
                            )}
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
                                      void executarComando(turno.comando, false, null);
                                    }}
                                  >
                                    Tentar novamente
                                  </button>
                                </div>
                                <p className="ia-turno-erro-msg">{turno.erro.mensagem}</p>
                              </div>
                            ) : (
                              <>
                                <TrilhaVivaAgente
                                  etapas={turno.etapas}
                                  tools={turno.tools}
                                  carregando={turno.carregando}
                                  temTexto={turno.textoAgente.length > 0}
                                />
                                {turno.textoAgente ? (
                                  <TextoAgente
                                    texto={turno.textoAgente}
                                    aoVivo={turno.carregando}
                                  />
                                ) : null}
                                {projecaoTurno &&
                                (turno.viewSpec !== null ||
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
                                      void executarComando(cmd, false, null);
                                    }}
                                    aoSelecionarPapel={lidarSelecionarPapel}
                                    aoNotificar={(parte, campo) =>
                                      lidarNotificarDoPalco(
                                        turno.pedidoId || (pedidoId ?? ''),
                                        parte,
                                        campo,
                                      )
                                    }
                                    aoAbrirAgenda={aoAbrirAgenda}
                                    aoAplicarHipotese={(hipotese) =>
                                      lidarAplicarHipotese(
                                        turno.pedidoId || (pedidoId ?? ''),
                                        hipotese,
                                      )
                                    }
                                    aoAnunciar={aoAnunciar}
                                    slotLoader={<EmblemaMonolitos tamanho={20} />}
                                    ocultarTrilha={true}
                                  />
                                ) : turno.carregando &&
                                  turno.tools.some((t) => TOOLS_VISUAIS.has(t.nome)) ? (
                                  <EsqueletoGenUI rotulo={rotuloBlueprintGenUI(turno.tools)} />
                                ) : !turno.carregando &&
                                  !turno.textoAgente &&
                                  turno.interpretado ? (
                                  <RespostaFallbackTurno dados={turno.interpretado} />
                                ) : null}
                              </>
                            )}
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </section>

          {painelEvidenciaAberto && !evidenciaComoGaveta && (
            <div className="ia-evidencia-col">
              <EvidenciaLateralIA
                id={evidenciaId}
                pedidoId={pedidoId}
                projecao={projecao}
                daSessao={Boolean(pedidoAtual?.daSessao)}
                focoAtivo={focoAtivo}
                aoFocar={setFocoAtivo}
                aoAbrirNaTorre={aoAbrirNaTorre}
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
              <span className="ia-composer-progresso-trilha" aria-hidden="true">
                <span className="ia-composer-linha-progresso" />
              </span>

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
                  className={
                    provisorio ? 'ia-composer-input ia-composer-provisorio' : 'ia-composer-input'
                  }
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
                        data-pulso-proprio="true"
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
                    data-pulso-proprio="true"
                    disabled={algumTurnoStreaming}
                  >
                    <span className="ia-btn-conteudo">
                      {algumTurnoStreaming ? (
                        <>
                          <span className="ia-orbita" aria-hidden="true">
                            <span />
                            <span />
                            <span />
                          </span>
                          <span>Compondo</span>
                        </>
                      ) : (
                        <>
                          <span>Executar</span>
                          <IconeRetorno />
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </footer>
      </div>

      {presencaGaveta.montado && (
        <div className="ia-gaveta-camada" data-fase={presencaGaveta.fase}>
          <div
            className="ia-gaveta-fundo"
            aria-hidden="true"
            onClick={fecharGavetaEvidencia}
          />
          <EvidenciaLateralIA
            id={evidenciaId}
            pedidoId={pedidoId}
            projecao={projecao}
            daSessao={Boolean(pedidoAtual?.daSessao)}
            focoAtivo={focoAtivo}
            aoFocar={setFocoAtivo}
            aoAbrirNaTorre={aoAbrirNaTorre}
            aoFechar={fecharGavetaEvidencia}
            ehGaveta={true}
            faseGaveta={presencaGaveta.fase}
          />
        </div>
      )}
    </div>
  );
}
