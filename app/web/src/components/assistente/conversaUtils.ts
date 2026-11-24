import type {
  BlocoGenUI,
  ProjecaoPedido,
  StatusExecucaoTool,
  ToolExecutada,
  TurnoConversa,
} from '../../../../shared/model.ts';
import { chaveCurta, rotuloFonte } from '../../format.ts';
import { resumoParaAnuncio } from '../../mandato.ts';
import type { EtapaStreamGenUI } from '../PalcoGenUI.tsx';
import type { PontoTela, ToolTurnoIA, TurnoIA } from './tipos.ts';

const LIMITE_TURNOS_HISTORICO = 10;
const LIMITE_CARACTERES_TURNO = 1200;

export function codigoCurtoPedido(id: string): string {
  return /^\d{44}$/.test(id) ? id.slice(-6) : chaveCurta(id);
}

export function horarioAtualCurto(): string {
  return new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function elementoEditavel(el: Element | null): boolean {
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

export function ehAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function centroElemento(el: HTMLElement | null): PontoTela | null {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
}

export function formatarListaFontes(dados: ProjecaoPedido | null): string {
  if (!dados || dados.versoes.length === 0) return 'as fontes';
  const unicas = Array.from(new Set(dados.versoes.map((v) => rotuloFonte(v.fonte))));
  if (unicas.length === 1) return unicas[0] ?? 'as fontes';
  if (unicas.length === 2) return `${unicas[0]} e ${unicas[1]}`;
  return `${unicas.slice(0, -1).join(', ')} e ${unicas[unicas.length - 1]}`;
}

export function adicionarOuAtualizarEtapa(
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

export function acumularBlocoUnico(
  atuais: readonly BlocoGenUI[],
  bloco: BlocoGenUI,
): BlocoGenUI[] {
  const idx = atuais.findIndex((b) => b.id === bloco.id);
  if (idx === -1) return [...atuais, bloco];
  return atuais.map((b, i) => (i === idx ? bloco : b));
}

export function acumularToolTurno(
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

export function reconciliarToolsTurno(
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

function cortarTextoHistorico(texto: string): string {
  const limpo = texto.trim();
  return limpo.length > LIMITE_CARACTERES_TURNO
    ? `${limpo.slice(0, LIMITE_CARACTERES_TURNO).trimEnd()}…`
    : limpo;
}

function textoAssistenteDoTurno(turno: TurnoIA): string {
  if (turno.agente && turno.agente.textoFinal.trim()) return turno.agente.textoFinal;
  if (turno.textoAgente.trim()) return turno.textoAgente;
  if (turno.interpretado) return resumoParaAnuncio(turno.interpretado);
  return '';
}

export function montarHistoricoConversa(turnos: readonly TurnoIA[]): TurnoConversa[] {
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

export function resumoAgenteParaAnuncio(textoFinal: string): string {
  const limpo = textoFinal.trim();
  if (!limpo) return 'Resposta concluída.';
  const primeiraLinha = limpo.split('\n', 1)[0] ?? limpo;
  const fimFrase = primeiraLinha.search(/[.!?](\s|$)/);
  const base = fimFrase >= 0 ? primeiraLinha.slice(0, fimFrase + 1) : primeiraLinha;
  return base.length > 140 ? `${base.slice(0, 139).trimEnd()}…` : base;
}

export type SegmentoProsa =
  | { tipo: 'paragrafo'; linhas: string[] }
  | { tipo: 'lista'; itens: string[] };

export function dividirProsaAgente(texto: string): SegmentoProsa[] {
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

export function desktopSplitInicial(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(min-width: 1180px)').matches
  );
}
