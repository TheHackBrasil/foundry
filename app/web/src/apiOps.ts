import type {
  CampoVigiado,
  CamposObservados,
  CanalContato,
  Contato,
  EventoStreamMandato,
  ItemRevisao,
  Notificacao,
  Parte,
  RespostaMandato,
  RespostaSimulacao,
  ResultadoAgente,
  ResultadoAncora,
  ResultadoIngest,
  TurnoConversa,
  ViewSpecV2,
} from '../../shared/model.ts';
import {
  ErroApi,
  ErroMandatoApi,
  enviarArquivo,
  enviarMandato,
  extrairMensagemErroMandato,
} from './api.ts';

export interface ResultadoNotificarDireto {
  pedidoId: string;
  parte: Parte;
  status: 'entregue' | 'nao_entregue';
  motivo?: Notificacao['motivo'];
  canal?: CanalContato | null;
  destino?: string | null;
  mensagem?: string;
}

export interface OpcoesStreamMandato {
  pedidoId?: string;
  historico?: TurnoConversa[];
  signal?: AbortSignal;
  aoEvento: (ev: EventoStreamMandato) => void;
}

// Saida do fluxo SSE: 'resposta' cobre o contrato classico (evento 'concluido')
// e 'agente' o contrato conversacional (evento 'fim', spec 0009). Os dois
// chegam juntos quando o servidor emite o 'concluido' sintetico de compat.
export interface ResultadoStreamMandato {
  resposta?: RespostaMandato;
  agente?: ResultadoAgente;
}

function ehAbortError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof DOMException && err.name === 'AbortError';
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Reproduz o contrato de erro de api.ts preservando AbortError quando o caller
// cancela uma requisicao em voo (ex.: troca rapida de lente ou simulacao).
async function pedirJsonOps<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, init);
  } catch (err) {
    if (ehAbortError(err, init?.signal ?? undefined)) throw err;
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }
  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    const obj = ehObjeto(corpo) ? corpo : null;
    const msg =
      (typeof obj?.['mensagem'] === 'string' && obj['mensagem'].trim()) ||
      (typeof obj?.['erro'] === 'string' && obj['erro'].trim()) ||
      (typeof obj?.['motivo'] === 'string' && obj['motivo'].trim()) ||
      `O servidor respondeu ${resposta.status}.`;
    throw new ErroApi(msg, resposta.status);
  }
  return (await resposta.json()) as T;
}

export function obterViewSpecV2(
  pedidoId: string,
  papel: Parte | 'operacao',
  signal?: AbortSignal,
): Promise<ViewSpecV2> {
  const url = `/api/pedidos/${encodeURIComponent(pedidoId)}/view-spec?papel=${encodeURIComponent(papel)}&v=2`;
  return pedirJsonOps<ViewSpecV2>(url, signal ? { signal } : undefined);
}

const STATUS_TOOL_STREAM = new Set(['executando', 'concluida', 'erro']);

// Aceita os eventos do fluxo classico e os do agente (spec 0009). Evento
// desconhecido ou malformado e descartado em silencio, como ja ocorria.
function parseEventoStream(bruto: string): EventoStreamMandato | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!ehObjeto(parsed) || typeof parsed['tipo'] !== 'string') return null;
  const tipo = parsed['tipo'];
  if (tipo === 'bloco') {
    // O bloco vai direto para o render do Palco: shape minimo exigido
    // (tipo conhecido + partes em lista) para um evento malformado nao
    // derrubar a trilha inteira.
    const bloco = parsed['bloco'];
    if (!ehObjeto(bloco) || typeof bloco['tipo'] !== 'string' || !Array.isArray(bloco['partes'])) return null;
    return parsed as unknown as EventoStreamMandato;
  }
  if (tipo === 'etapa' || tipo === 'concluido' || tipo === 'erro') {
    return parsed as unknown as EventoStreamMandato;
  }
  if (tipo === 'tool') {
    if (typeof parsed['nome'] !== 'string' || typeof parsed['resumo'] !== 'string') return null;
    const status = parsed['status'];
    if (typeof status !== 'string' || !STATUS_TOOL_STREAM.has(status)) return null;
    return parsed as unknown as EventoStreamMandato;
  }
  if (tipo === 'texto_delta') {
    return typeof parsed['delta'] === 'string'
      ? (parsed as unknown as EventoStreamMandato)
      : null;
  }
  if (tipo === 'fim') {
    const resultado = parsed['resultado'];
    if (!ehObjeto(resultado) || typeof resultado['textoFinal'] !== 'string') return null;
    return parsed as unknown as EventoStreamMandato;
  }
  return null;
}

function extrairPayloadSse(quadro: string): string | null {
  const linhas = quadro.split('\n');
  const dados: string[] = [];
  for (const linha of linhas) {
    if (linha.startsWith(':') || !linha.startsWith('data:')) continue;
    const valor = linha.slice(5);
    dados.push(valor.startsWith(' ') ? valor.slice(1) : valor);
  }
  return dados.length > 0 ? dados.join('\n').trim() : null;
}

function ehRespostaMandato(v: unknown): v is RespostaMandato {
  return ehObjeto(v) && typeof v['acao'] === 'string' && Array.isArray(v['alvos']);
}

export async function transmitirMandatoStream(
  texto: string,
  opcoes: OpcoesStreamMandato,
): Promise<ResultadoStreamMandato> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/mandatos/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        comando: texto,
        ...(opcoes.pedidoId ? { pedidoId: opcoes.pedidoId } : {}),
        ...(opcoes.historico && opcoes.historico.length > 0
          ? { historico: opcoes.historico }
          : {}),
      }),
      ...(opcoes.signal ? { signal: opcoes.signal } : {}),
    });
  } catch (err) {
    if (ehAbortError(err, opcoes.signal)) throw err;
    throw new ErroMandatoApi('Sem conexão com o servidor.', 0);
  }

  // Fallback transparente quando o servidor ainda nao expoe a rota SSE.
  if (resposta.status === 404) {
    const direta = await enviarMandato(texto);
    opcoes.aoEvento({ tipo: 'concluido', resposta: direta });
    return { resposta: direta };
  }

  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    const { mensagem, motivo } = extrairMensagemErroMandato(resposta.status, corpo);
    throw new ErroMandatoApi(mensagem, resposta.status, motivo);
  }

  const contentType = resposta.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('text/event-stream') || !resposta.body) {
    if (contentType.includes('application/json')) {
      const json: unknown = await resposta.json().catch(() => null);
      if (ehRespostaMandato(json)) {
        opcoes.aoEvento({ tipo: 'concluido', resposta: json });
        return { resposta: json };
      }
    }
    const direta = await enviarMandato(texto);
    opcoes.aoEvento({ tipo: 'concluido', resposta: direta });
    return { resposta: direta };
  }

  const reader = resposta.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let respostaFinal: RespostaMandato | null = null;
  let agenteFinal: ResultadoAgente | null = null;
  let erroStream: ErroMandatoApi | null = null;

  const processarQuadro = (quadro: string) => {
    const payload = extrairPayloadSse(quadro);
    if (!payload) return;
    const ev = parseEventoStream(payload);
    if (!ev) return;
    opcoes.aoEvento(ev);
    if (ev.tipo === 'concluido') {
      respostaFinal = ev.resposta;
    } else if (ev.tipo === 'fim') {
      agenteFinal = ev.resultado;
    } else if (ev.tipo === 'erro') {
      erroStream = new ErroMandatoApi(ev.mensagem, ev.status, ev.motivo);
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      let corte = buffer.indexOf('\n\n');
      while (corte !== -1) {
        const quadro = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);
        processarQuadro(quadro);
        corte = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode().replaceAll('\r\n', '\n');
    if (buffer.trim()) {
      for (const quadro of buffer.split('\n\n')) {
        if (quadro.trim()) processarQuadro(quadro);
      }
    }
  } catch (err) {
    if (ehAbortError(err, opcoes.signal)) throw err;
    throw new ErroMandatoApi('A conexão do comando ao vivo foi interrompida.', 0);
  } finally {
    reader.releaseLock();
  }

  if (erroStream) throw erroStream;
  if (respostaFinal || agenteFinal) {
    return {
      ...(respostaFinal ? { resposta: respostaFinal } : {}),
      ...(agenteFinal ? { agente: agenteFinal } : {}),
    };
  }
  throw new ErroMandatoApi('O servidor encerrou o fluxo sem concluir o comando.', 0);
}

export function simularHipoteseDireta(
  pedidoId: string,
  hipotese: CamposObservados,
  signal?: AbortSignal,
): Promise<RespostaSimulacao> {
  return pedirJsonOps<RespostaSimulacao>('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pedidoId, campos: hipotese }),
    ...(signal ? { signal } : {}),
  });
}

function escaparCelulaCsv(valor: string): string {
  if (/[",;\n\r]/.test(valor)) {
    return `"${valor.replaceAll('"', '""')}"`;
  }
  return valor;
}

// Gera um CSV de 1 linha com os nomes de coluna canonicos aceitos por csv.ts
// e envia pela mesma rota /api/ingest de qualquer planilha operacional.
export function aplicarHipoteseComoPlanilha(
  pedidoId: string,
  hipotese: CamposObservados,
): Promise<ResultadoIngest> {
  const colunas: string[] = ['chave_nf'];
  const valores: string[] = [pedidoId];

  if (hipotese.previsaoEntrega !== undefined && hipotese.previsaoEntrega.trim() !== '') {
    colunas.push('data_prevista');
    valores.push(hipotese.previsaoEntrega.trim());
  }
  if (hipotese.pesoTotal !== undefined && Number.isFinite(hipotese.pesoTotal)) {
    colunas.push('peso_kg');
    valores.push(String(hipotese.pesoTotal));
  }
  if (hipotese.volumes !== undefined && Number.isFinite(hipotese.volumes)) {
    colunas.push('volumes');
    valores.push(String(hipotese.volumes));
  }
  if (hipotese.status !== undefined && hipotese.status.trim() !== '') {
    colunas.push('status');
    valores.push(hipotese.status.trim());
  }

  if (colunas.length <= 1) {
    return Promise.reject(
      new ErroApi('Altere ao menos um campo antes de aplicar como planilha.', 400),
    );
  }

  const csv = `${colunas.map(escaparCelulaCsv).join(',')}\n${valores.map(escaparCelulaCsv).join(',')}\n`;
  const sufixo = pedidoId.slice(-6) || 'pedido';
  const arquivo = new File([csv], `atualizacao-${sufixo}.csv`, {
    type: 'text/csv;charset=utf-8',
  });
  return enviarArquivo(arquivo);
}

export function listarRevisao(): Promise<{ itens: ItemRevisao[] }> {
  return pedirJsonOps<{ itens: ItemRevisao[] }>('/api/revisao');
}

export function decidirRevisao(
  id: number,
  status: 'aprovado' | 'descartado',
): Promise<Record<string, unknown>> {
  return pedirJsonOps<Record<string, unknown>>(
    `/api/revisao/${encodeURIComponent(String(id))}/decisao`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    },
  );
}

export function listarContatos(): Promise<Contato[]> {
  return pedirJsonOps<Contato[]>('/api/contatos');
}

export function salvarContato(contato: Omit<Contato, 'fonte'>): Promise<Contato> {
  return pedirJsonOps<Contato>('/api/contatos', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contato),
  });
}

export function notificarDireto(
  pedidoId: string,
  parte: Parte,
  campo?: CampoVigiado,
): Promise<ResultadoNotificarDireto> {
  return pedirJsonOps<ResultadoNotificarDireto>('/api/notificar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pedidoId,
      parte,
      ...(campo ? { campo } : {}),
    }),
  });
}

export async function ancorarPedido(pedidoId: string): Promise<ResultadoAncora> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/anchor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pedidoId }),
    });
  } catch {
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }
  const corpo: unknown = await resposta.json().catch(() => null);
  // /api/anchor devolve 503 com ResultadoAncora ({ ok: false, motivo, root })
  // quando a rede/contrato nao esta configurada ou a tx falhou.
  if (
    resposta.status === 503 &&
    ehObjeto(corpo) &&
    corpo['ok'] === false &&
    typeof corpo['motivo'] === 'string'
  ) {
    return corpo as unknown as ResultadoAncora;
  }
  if (!resposta.ok) {
    const obj = ehObjeto(corpo) ? corpo : null;
    const msg =
      (typeof obj?.['erro'] === 'string' && obj['erro'].trim()) ||
      (typeof obj?.['motivo'] === 'string' && obj['motivo'].trim()) ||
      `O servidor respondeu ${resposta.status}.`;
    throw new ErroApi(msg, resposta.status);
  }
  return corpo as ResultadoAncora;
}

function inferirMimeExemplo(arquivo: string, fallback: string): string {
  const lower = arquivo.toLowerCase();
  if (lower.endsWith('.xml')) return 'application/xml';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.xlsx')) {
    return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.eml')) return 'message/rfc822';
  return fallback || 'application/octet-stream';
}

export async function enviarExemploPorNome(
  arquivo: string,
  mime?: string,
): Promise<ResultadoIngest> {
  let resposta: Response;
  try {
    resposta = await fetch(`/exemplos/${encodeURIComponent(arquivo)}`);
  } catch {
    throw new ErroApi('Sem conexão com o servidor para baixar o arquivo de exemplo.', 0);
  }
  if (!resposta.ok) {
    throw new ErroApi(`Arquivo de exemplo "${arquivo}" indisponível (${resposta.status}).`, resposta.status);
  }
  const blob = await resposta.blob();
  const tipo = mime ?? inferirMimeExemplo(arquivo, blob.type);
  const file = new File([blob], arquivo, { type: tipo });
  return enviarArquivo(file);
}

const OPS_STYLE_ID = 'forseti-ops-layer-styles';

// Estilos base dentro de @layer para garantir layout responsivo, contraste e
// acessibilidade fora da caixa; qualquer regra em styles.css sobrescreve sem !important.
const OPS_BASE_CSS = `@layer forseti-ops {
  .palco-genui {
    display: grid;
    gap: 1rem;
    padding: 1.125rem 1.25rem;
    border-radius: var(--r-lg, 12px);
    background: var(--surface);
    box-shadow: var(--elev-2);
    min-width: 0;
  }
  .palco-cab {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem 1rem;
  }
  .palco-cab-texto {
    display: grid;
    gap: 0.3125rem;
    min-width: 0;
  }
  .palco-cab-linha {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4375rem 0.625rem;
  }
  .palco-cab h2 {
    font: 650 1.125rem/1.25 var(--font-title);
    letter-spacing: -0.015em;
  }
  .palco-cab-acoes {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex: none;
  }
  .palco-trilha-viva {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.625rem 1rem;
    padding: 0.75rem 0.875rem;
    border-radius: var(--r-md, 8px);
    background: var(--surface2);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .palco-etapas {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4375rem 0.875rem;
    min-width: 0;
  }
  .palco-etapa {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    color: var(--text2);
  }
  .palco-etapa[data-concluida='true'] { color: var(--text); font-weight: 500; }
  .palco-etapa[data-concluida='true'] svg { width: 0.875rem; height: 0.875rem; color: var(--ok); flex: none; }
  .palco-etapa-ativa { color: var(--change); font-weight: 600; }
  .palco-trilha-detalhes {
    border-radius: var(--r-md, 8px);
    background: var(--tint-soft);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .palco-trilha-sumario {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 2.25rem;
    padding: 0.375rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--text2);
    cursor: pointer;
    list-style: none;
  }
  .palco-trilha-sumario::-webkit-details-marker { display: none; }
  .palco-trilha-corpo {
    padding: 0.5rem 0.75rem 0.625rem;
    border-top: 1px solid var(--hairline);
  }
  .palco-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    align-items: start;
  }
  .palco-bloco {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: var(--r-md, 8px);
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
    min-width: 0;
  }
  .palco-bloco-largo { grid-column: 1 / -1; }
  .palco-bloco-cab {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem 0.75rem;
    flex-wrap: wrap;
  }
  .palco-bloco-cab h3 {
    font-size: 0.9375rem;
    font-weight: 650;
    letter-spacing: -0.01em;
  }
  .palco-resumo-texto {
    font-size: 0.9375rem;
    line-height: 1.65;
    max-width: 72ch;
    color: var(--text);
  }
  .citacao-btn {
    display: inline;
    vertical-align: baseline;
    margin: 0 0.125rem;
    padding: 0 0.125rem 0.0625rem;
    border: 0;
    border-bottom: 1.5px solid color-mix(in srgb, var(--change) 52%, transparent);
    border-radius: 0;
    background: transparent;
    color: var(--text);
    box-shadow: none;
    font-size: 0.92em;
    font-weight: 550;
    line-height: inherit;
    cursor: pointer;
    transition: background-color 140ms ease, color 140ms ease, border-color 140ms ease;
  }
  .citacao-btn[aria-pressed='true'] {
    background: color-mix(in srgb, var(--change-bg) 82%, transparent);
    color: var(--change);
    border-bottom-color: var(--change);
    border-radius: 3px;
    box-shadow: none;
  }
  .palco-citacoes-rodape {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--hairline);
  }
  .comparador-duelo {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    gap: 0.625rem;
    align-items: stretch;
  }
  .comparador-lado {
    display: grid;
    gap: 0.25rem;
    align-content: start;
    padding: 0.75rem;
    text-align: start;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--hairline);
    cursor: pointer;
    transition: box-shadow 140ms ease, background-color 140ms ease;
  }
  .comparador-lado[aria-pressed='true'] {
    background: color-mix(in srgb, var(--change-bg) 55%, var(--surface));
    box-shadow: inset 0 0 0 1.5px var(--change);
  }
  .comparador-lado-valor { font: 650 1.0625rem/1.25 var(--font-title); }
  .comparador-vs {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0 0.25rem;
    color: var(--text2);
    font-size: 0.75rem;
    font-weight: 600;
  }
  .comparador-barra-wrap {
    display: grid;
    gap: 0.3125rem;
  }
  .comparador-barra-trilha {
    display: flex;
    height: 6px;
    border-radius: 999px;
    background: var(--surface2);
    overflow: hidden;
  }
  .comparador-barra-a { background: var(--text2); height: 100%; }
  .comparador-barra-b { background: var(--change); height: 100%; }
  .comparador-nota {
    font-size: 0.8125rem;
    color: var(--text2);
    padding: 0.5rem 0.6875rem;
    border-radius: var(--r-sm, 6px);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .despacho-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16.5rem, 1fr));
    gap: 0.75rem;
  }
  .despacho-card {
    display: grid;
    gap: 0.625rem;
    align-content: start;
    padding: 0.875rem;
    border-radius: var(--r-md, 8px);
    background: var(--surface);
    box-shadow: var(--elev-1);
  }
  .despacho-textarea {
    width: 100%;
    min-height: 4.75rem;
    padding: 0.5rem 0.625rem;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: var(--bg);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--control-border);
    font: 400 0.84375rem/1.45 var(--font-ui);
    resize: vertical;
  }
  .despacho-acoes {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .checklist-lista {
    display: grid;
    gap: 0.5rem;
  }
  .checklist-item {
    width: 100%;
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem;
    text-align: start;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--hairline);
    cursor: pointer;
    transition: box-shadow 140ms ease, background-color 140ms ease;
  }
  .checklist-item[aria-pressed='true'] {
    background: color-mix(in srgb, var(--change-bg) 52%, var(--surface));
    box-shadow: inset 0 0 0 1.5px var(--change);
  }
  .palco-followups {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4375rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--hairline);
  }

  /* GrafoDomino */
  .domino-wrap {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  .domino-cab {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .domino-palco {
    display: grid;
    grid-template-columns: minmax(10.5rem, 1fr) minmax(10rem, 1.3fr) minmax(10.5rem, 1fr);
    align-items: stretch;
    gap: 0;
    position: relative;
    min-width: 0;
  }
  .domino-col {
    display: flex;
    flex-direction: column;
    justify-content: space-evenly;
    gap: 0.5rem;
    z-index: 1;
    min-width: 0;
  }
  .domino-centro {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 14rem;
    min-width: 0;
  }
  .domino-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .domino-motor {
    position: relative;
    z-index: 1;
    display: grid;
    justify-items: center;
    gap: 0.125rem;
    padding: 0.625rem 0.875rem;
    border-radius: var(--r-md, 8px);
    background: var(--surface);
    box-shadow: var(--elev-2), inset 0 0 0 1.5px var(--primary);
    text-align: center;
  }
  .domino-no {
    width: 100%;
    display: grid;
    gap: 0.1875rem;
    padding: 0.5625rem 0.75rem;
    text-align: start;
    border: 0;
    border-radius: var(--r-md, 8px);
    background: var(--surface);
    box-shadow: var(--elev-ctrl);
    cursor: pointer;
    min-height: 2.75rem;
    transition: opacity 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
  }
  .domino-no[aria-pressed='true'] {
    background: color-mix(in srgb, var(--change-bg) 60%, var(--surface));
    box-shadow: inset 0 0 0 1.5px var(--change);
  }
  .domino-no[data-esmaecido='true'] { opacity: 0.48; }
  .domino-no-topo {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.375rem;
  }

  /* SimuladorVivo */
  .sim-vivo {
    display: grid;
    gap: 0.875rem;
    min-width: 0;
  }
  .sim-vivo-grade {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .sim-vivo-campo {
    display: grid;
    gap: 0.4375rem;
    align-content: start;
    padding: 0.75rem;
    border-radius: var(--r-md, 8px);
    background: var(--surface);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .sim-vivo-label {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .sim-vivo-input {
    width: 100%;
    min-height: 2.375rem;
    padding: 0.375rem 0.625rem;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: var(--bg);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--control-border);
    font: 500 0.90625rem/1.35 var(--font-ui);
  }
  .sim-vivo-atalhos {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3125rem;
  }
  .sim-vivo-rodape {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.625rem 0.875rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--hairline);
  }

  /* Drawers modais */
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    justify-content: flex-end;
    background: color-mix(in srgb, #0b1917 52%, transparent);
  }
  .drawer-panel {
    width: min(36rem, 100vw);
    height: 100dvh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    background: var(--bg);
    color: var(--text);
    box-shadow: var(--elev-2);
    overscroll-behavior: contain;
  }
  .drawer-cab {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1rem 1.25rem;
    background: var(--surface);
    box-shadow: inset 0 -1px 0 var(--hairline);
  }
  .drawer-cab h2 {
    font: 650 1.125rem/1.25 var(--font-title);
    letter-spacing: -0.015em;
  }
  .drawer-corpo {
    overflow-y: auto;
    padding: 1.125rem 1.25rem 2rem;
    display: grid;
    gap: 1rem;
    align-content: start;
    overscroll-behavior: contain;
  }
  .drawer-card {
    display: grid;
    gap: 0.625rem;
    padding: 0.9375rem 1rem;
    border-radius: var(--r-md, 8px);
    background: var(--surface);
    box-shadow: var(--elev-1);
    min-width: 0;
  }
  .drawer-tabela {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }
  .drawer-tabela th, .drawer-tabela td {
    text-align: start;
    padding: 0.4375rem 0.5625rem;
    border-bottom: 1px solid var(--hairline);
    vertical-align: top;
  }
  .drawer-tabela th {
    background: var(--surface2);
    color: var(--text2);
    font-weight: 600;
  }
  .drawer-pre {
    margin: 0;
    padding: 0.625rem 0.75rem;
    border-radius: var(--r-sm, 6px);
    background: var(--surface2);
    font: 400 0.75rem/1.5 var(--font-mono);
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 11rem;
  }
  .drawer-form {
    display: grid;
    gap: 0.75rem;
  }
  .drawer-field {
    display: grid;
    gap: 0.3125rem;
  }
  .drawer-field label {
    font-size: 0.8125rem;
    font-weight: 600;
  }
  .drawer-input, .drawer-select {
    width: 100%;
    min-height: 2.5rem;
    padding: 0.4375rem 0.6875rem;
    border: 0;
    border-radius: var(--r-sm, 6px);
    background: var(--bg);
    color: var(--text);
    box-shadow: inset 0 0 0 1px var(--control-border);
    font: 450 0.90625rem/1.4 var(--font-ui);
  }
  .drawer-input[aria-invalid='true'], .drawer-select[aria-invalid='true'] {
    box-shadow: inset 0 0 0 1.5px var(--error);
  }
  .drawer-hash {
    font: 400 0.78125rem/1.5 var(--font-mono);
    overflow-wrap: anywhere;
    padding: 0.5rem 0.625rem;
    border-radius: var(--r-sm, 6px);
    background: var(--bg);
    box-shadow: inset 0 0 0 1px var(--hairline);
  }
  .agenda-papel-btn {
    width: 100%;
    display: grid;
    gap: 0.25rem;
    padding: 0.75rem 0.875rem;
    text-align: start;
    border: 0;
    border-radius: var(--r-md, 8px);
    background: var(--surface);
    box-shadow: var(--elev-ctrl);
    cursor: pointer;
    transition: box-shadow 140ms ease, background-color 140ms ease;
  }
  .agenda-papel-btn[aria-pressed='true'] {
    background: color-mix(in srgb, var(--change-bg) 45%, var(--surface));
    box-shadow: inset 0 0 0 1.5px var(--change);
  }

  /* Resposta conversacional do agente (spec 0009): prosa digitada ao vivo
     e trilha fina de ferramentas que se dissolve quando o texto chega. */
  .agente-texto {
    display: grid;
    gap: 0.625rem;
    max-width: 68ch;
    font-size: 0.96875rem;
    line-height: 1.65;
    color: var(--text);
  }
  .agente-texto strong { font-weight: 650; }
  .agente-texto code {
    padding: 0.0625rem 0.3125rem;
    border-radius: var(--r-sm, 6px);
    background: var(--surface2);
    box-shadow: inset 0 0 0 1px var(--hairline);
    font: 400 0.86em/1.4 var(--font-mono);
  }
  .agente-texto ul {
    display: grid;
    gap: 0.375rem;
    padding-inline-start: 1.25rem;
    list-style: disc;
  }
  .agente-cursor {
    display: inline-block;
    width: 0.5rem;
    height: 1.05em;
    margin-inline-start: 0.1875rem;
    border-radius: 1px;
    background: var(--change);
    vertical-align: -0.15em;
    animation: agente-cursor-pulso 1.05s ease-in-out infinite;
  }
  .agente-cursor-linha { min-height: 1.05em; }
  @keyframes agente-cursor-pulso {
    0%, 100% { opacity: 0.25; }
    50% { opacity: 0.9; }
  }
  .agente-tools {
    display: grid;
    gap: 0.375rem;
    max-height: 14rem;
    margin: 0 0 0.875rem;
    padding: 0;
    list-style: none;
    overflow: hidden;
    opacity: 1;
    transition: opacity 280ms ease, max-height 300ms ease, margin 300ms ease;
  }
  .agente-tools[data-dissolvendo='true'] {
    max-height: 0;
    margin-bottom: 0;
    opacity: 0;
  }
  .agente-tool {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text2);
  }
  .agente-tool svg { width: 0.875rem; height: 0.875rem; flex: none; }
  .agente-tool .cmd-spinner { flex: none; }
  .agente-tool[data-status='concluida'] svg { color: var(--ok); }
  .agente-tool[data-status='erro'] { color: var(--error); }

  @media (hover: hover) and (pointer: fine) {
    .citacao-btn:hover { background: transparent; color: var(--change); border-bottom-color: var(--change); }
    .citacao-btn[aria-pressed='true']:hover { background: color-mix(in srgb, var(--change-bg) 90%, transparent); }
    .comparador-lado:hover,
    .checklist-item:hover,
    .domino-no:hover,
    .agenda-papel-btn:hover { box-shadow: var(--elev-ctrl-hover); }
  }

  @media (max-width: 899px) {
    .palco-grid, .sim-vivo-grade { grid-template-columns: minmax(0, 1fr); }
  }

  @media (max-width: 640px) {
    .palco-genui { padding: 0.875rem; }
    .domino-palco { grid-template-columns: minmax(0, 1fr); gap: 0.75rem; }
    .domino-centro { min-height: auto; }
    .domino-svg { display: none; }
    .comparador-duelo { grid-template-columns: minmax(0, 1fr); }
    .comparador-vs { flex-direction: row; justify-content: flex-start; padding: 0; }
    .drawer-cab, .drawer-corpo { padding-inline: 1rem; }
    .sim-vivo-input, .drawer-input, .drawer-select, .domino-no, .checklist-item { min-height: 2.75rem; }
  }

  @media (prefers-reduced-motion: reduce) {
    .citacao-btn, .comparador-lado, .checklist-item, .domino-no, .agenda-papel-btn { transition: none; }
    .agente-tools { transition: none; }
    .agente-cursor { animation: none; opacity: 0.7; }
  }

  @media (forced-colors: active) {
    .palco-genui, .palco-bloco, .domino-motor, .domino-no, .drawer-panel, .drawer-card, .despacho-card, .sim-vivo-campo,
    .agente-texto code {
      border: 1px solid CanvasText;
    }
    .citacao-btn, .comparador-lado, .checklist-item, .agenda-papel-btn {
      border: 1px solid ButtonBorder;
    }
  }
}`;

export function garantirEstilosOps(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(OPS_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = OPS_STYLE_ID;
  style.textContent = OPS_BASE_CSS;
  document.head.appendChild(style);
}
