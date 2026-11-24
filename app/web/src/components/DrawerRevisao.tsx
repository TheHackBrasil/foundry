import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import {
  CAMPOS_VIGIADOS,
  FONTES_DOCUMENTO,
  type CampoVigiado,
  type FonteDocumento,
  type ItemRevisao,
} from '../../../shared/model.ts';
import { decidirRevisao, garantirEstilosOps, listarRevisao } from '../apiOps.ts';
import {
  chaveCurta,
  formatarConfianca,
  formatarMomento,
  rotuloCampo,
  rotuloFonte,
} from '../format.ts';
import { IconeConfere, IconeDiverge, IconeErro, IconeFechar, IconeOk } from './icones.tsx';

export interface DrawerRevisaoProps {
  aberto: boolean;
  aoFechar: () => void;
  aoAtualizar?: () => void;
  aoAnunciar?: (texto: string) => void;
}

const FONTES_SET = new Set<string>(FONTES_DOCUMENTO);
const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);

const ROTULO_MOTIVO = new Map<string, string>([
  ['xlsx_layout_desconhecido', 'Planilha com colunas fora do padrão'],
  ['pedido_desconhecido', 'Documento sem pedido correspondente no ledger'],
  ['confianca_baixa', 'Extração com confiança abaixo do mínimo'],
  ['chave_nfe_ausente', 'Chave da NF-e não encontrada no documento'],
  ['llm_nao_configurada', 'Extração por IA indisponível nesta instalação'],
  ['llm_falhou', 'Falha na extração por IA'],
  ['extracao_invalida', 'Retorno inválido na extração do documento'],
  ['pdf_sem_texto_extraivel', 'PDF sem camada de texto extraível'],
  ['anexo_rejeitado', 'Anexo rejeitado na leitura de e-mail'],
]);

function rotuloMotivo(codigo: string): string {
  return ROTULO_MOTIVO.get(codigo) ?? codigo.replaceAll('_', ' ');
}

function rotuloCampoMapeado(campo: string): string {
  if (campo === 'pedidoId') return 'Chave do pedido (NF-e)';
  if (CAMPOS_SET.has(campo)) return rotuloCampo(campo as CampoVigiado);
  return campo;
}

function rotuloOrigem(origem: string): string {
  if (FONTES_SET.has(origem)) return rotuloFonte(origem as FonteDocumento);
  return origem;
}

function lerString(obj: Record<string, unknown>, chave: string): string | null {
  const v = obj[chave];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function dividirLinhaCsv(linha: string, delim: string): string[] {
  const celulas: string[] = [];
  let atual = '';
  let emAspas = false;
  for (let i = 0; i < linha.length; i += 1) {
    const ch = linha[i] ?? '';
    if (ch === '"') {
      if (emAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        emAspas = !emAspas;
      }
    } else if (ch === delim && !emAspas) {
      celulas.push(atual.trim());
      atual = '';
    } else {
      atual += ch;
    }
  }
  celulas.push(atual.trim());
  return celulas;
}

function parseAmostraCsv(amostra: string): { cabecalho: string[]; linhas: string[][] } | null {
  const brutas = amostra
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  const primeira = brutas[0];
  if (!primeira) return null;
  const virgulas = (primeira.match(/,/g) ?? []).length;
  const pontoVirgulas = (primeira.match(/;/g) ?? []).length;
  const delim = pontoVirgulas > virgulas ? ';' : ',';
  const cabecalho = dividirLinhaCsv(primeira, delim);
  if (cabecalho.length < 2) return null;
  const linhas = brutas.slice(1).map((l) => dividirLinhaCsv(l, delim));
  return { cabecalho, linhas };
}

function focoElementos(container: HTMLElement): HTMLElement[] {
  const seletores =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(seletores)).filter(
    (el) => el.offsetParent !== null,
  );
}

export function DrawerRevisao({
  aberto,
  aoFechar,
  aoAtualizar,
  aoAnunciar,
}: DrawerRevisaoProps) {
  const tituloId = useId();
  const painelRef = useRef<HTMLDivElement>(null);
  const fecharBtnRef = useRef<HTMLButtonElement>(null);
  const triggerAnteriorRef = useRef<HTMLElement | null>(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  const [itens, setItens] = useState<ItemRevisao[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [decidindoId, setDecidindoId] = useState<number | null>(null);
  const [erroDecisao, setErroDecisao] = useState<string | null>(null);
  const [recibo, setRecibo] = useState<string | null>(null);

  useEffect(() => {
    garantirEstilosOps();
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const r = await listarRevisao();
      setItens(Array.isArray(r.itens) ? r.itens : []);
    } catch (err) {
      setErroCarga(
        err instanceof Error ? err.message : 'Não foi possível carregar a fila de revisão.',
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!aberto) return;
    triggerAnteriorRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setErroDecisao(null);
    setRecibo(null);
    void carregar();

    const anteriorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focoFrame = window.requestAnimationFrame(() => {
      fecharBtnRef.current?.focus();
    });

    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        aoFecharRef.current();
        return;
      }
      if (e.key === 'Tab' && painelRef.current) {
        const focaveis = focoElementos(painelRef.current);
        if (focaveis.length === 0) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis.at(-1);
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo?.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro?.focus();
        }
      }
    };

    document.addEventListener('keydown', aoTecla);
    return () => {
      window.cancelAnimationFrame(focoFrame);
      document.removeEventListener('keydown', aoTecla);
      document.body.style.overflow = anteriorOverflow;
      triggerAnteriorRef.current?.focus({ preventScroll: true });
    };
  }, [aberto, carregar]);

  const { pendentes, decididos } = useMemo(() => {
    const pend: ItemRevisao[] = [];
    const dec: ItemRevisao[] = [];
    for (const item of itens) {
      if (item.status === 'pendente') pend.push(item);
      else dec.push(item);
    }
    pend.sort((a, b) => b.id - a.id);
    dec.sort((a, b) => b.id - a.id);
    return { pendentes: pend, decididos: dec };
  }, [itens]);

  async function decidir(item: ItemRevisao, status: 'aprovado' | 'descartado') {
    setDecidindoId(item.id);
    setErroDecisao(null);
    setRecibo(null);
    try {
      const r = await decidirRevisao(item.id, status);
      const eventos = typeof r['eventos'] === 'number' ? r['eventos'] : null;
      const msg =
        status === 'aprovado'
          ? item.proposta
            ? `Item #${item.id} aprovado e template salvo${eventos !== null ? ` (${eventos} ${eventos === 1 ? 'evento' : 'eventos'})` : ''}.`
            : `Item #${item.id} aprovado${eventos !== null ? ` (${eventos} ${eventos === 1 ? 'evento' : 'eventos'})` : ''}.`
          : `Item #${item.id} descartado da fila.`;
      setRecibo(msg);
      aoAnunciar?.(msg);
      await carregar();
      aoAtualizar?.();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Não foi possível registrar a decisão deste item.';
      setErroDecisao(msg);
      aoAnunciar?.(msg);
    } finally {
      setDecidindoId(null);
    }
  }

  if (!aberto) return null;

  function renderizarItem(item: ItemRevisao) {
    const p = item.payload ?? {};
    const arquivo = lerString(p, 'arquivo');
    const planilha = lerString(p, 'planilha');
    const pedidoId = lerString(p, 'pedidoId');
    const textoPreview = lerString(p, 'textoPreview');
    const amostraCsv = lerString(p, 'amostraCsv');
    const detalhe = lerString(p, 'detalhe') ?? lerString(p, 'erro');
    const confiancaPayload =
      typeof p['confianca'] === 'number' && Number.isFinite(p['confianca'])
        ? p['confianca']
        : null;
    const truncado = p['truncado'] === true;
    const temCsvCompleto = typeof p['csvCompleto'] === 'string' && p['csvCompleto'].trim() !== '';
    const podeAprovar = Boolean((item.proposta && temCsvCompleto && !truncado) || pedidoId);
    const emDecisao = decidindoId === item.id;
    const tabelaAmostra = amostraCsv ? parseAmostraCsv(amostraCsv) : null;

    const classeStatus =
      item.status === 'pendente'
        ? 'pilula-coord'
        : item.status === 'aprovado'
          ? 'pilula-ok'
          : 'pilula-sutil';
    const textoStatus =
      item.status === 'pendente'
        ? 'Pendente'
        : item.status === 'aprovado'
          ? 'Aprovado'
          : 'Descartado';

    return (
      <article key={item.id} className="drawer-card" aria-label={`Item de revisão ${item.id}`}>
        <div className="palco-bloco-cab">
          <div className="palco-cab-linha">
            <span className={classeStatus}>{textoStatus}</span>
            <span className="pilula-neutra">{rotuloOrigem(item.origem)}</span>
            <span className="meta mono num">#{item.id}</span>
          </div>
          <time className="meta mono" dateTime={item.ts}>
            {formatarMomento(item.ts)}
          </time>
        </div>

        <div style={{ display: 'grid', gap: '0.25rem' }}>
          <strong style={{ fontSize: '0.90625rem' }}>{rotuloMotivo(item.motivo)}</strong>
          {(arquivo || planilha || pedidoId) && (
            <p className="meta">
              {arquivo && (
                <>
                  Arquivo: <span className="mono">{arquivo}</span>
                </>
              )}
              {planilha && (
                <>
                  {arquivo ? ' · ' : ''}Aba: {planilha}
                </>
              )}
              {pedidoId && (
                <>
                  {arquivo || planilha ? ' · ' : ''}Pedido:{' '}
                  <span className="mono">{chaveCurta(pedidoId)}</span>
                </>
              )}
            </p>
          )}
          {detalhe && <p className="meta">{detalhe}</p>}
        </div>

        {item.proposta && (
          <div style={{ display: 'grid', gap: '0.625rem' }}>
            <div className="registro-topo">
              <span className="pilula-warn">Proposta IA de mapeamento</span>
              <span className="confianca">
                <span className="confianca-trilha" aria-hidden="true">
                  <span
                    className="confianca-barra"
                    style={
                      {
                        '--escala': Math.min(1, Math.max(0, item.proposta.confianca)),
                      } as CSSProperties
                    }
                  />
                </span>
                <span>Confiança</span>
                <span className="mono num">{formatarConfianca(item.proposta.confianca)}</span>
              </span>
            </div>

            <p className="meta">{item.proposta.motivo}</p>

            <div style={{ overflowX: 'auto' }}>
              <table className="drawer-tabela">
                <thead>
                  <tr>
                    <th scope="col">Coluna do arquivo</th>
                    <th scope="col">Campo Forseti</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(item.proposta.mapeamento).map(([coluna, campo]) => (
                    <tr key={coluna}>
                      <td className="mono">{coluna}</td>
                      <td>
                        <strong>{rotuloCampoMapeado(campo)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {tabelaAmostra ? (
              <div style={{ display: 'grid', gap: '0.3125rem' }}>
                <span className="meta">Prévia das linhas</span>
                <div style={{ overflowX: 'auto' }}>
                  <table className="drawer-tabela">
                    <thead>
                      <tr>
                        {tabelaAmostra.cabecalho.map((col, idx) => (
                          <th key={`${col}-${idx}`} scope="col" className="mono">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tabelaAmostra.linhas.map((linha, rIdx) => (
                        <tr key={rIdx}>
                          {tabelaAmostra.cabecalho.map((_, cIdx) => (
                            <td key={cIdx} className="mono">
                              {linha[cIdx] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : amostraCsv ? (
              <div style={{ display: 'grid', gap: '0.3125rem' }}>
                <span className="meta">Prévia da planilha</span>
                <pre className="drawer-pre">{amostraCsv}</pre>
              </div>
            ) : null}

            {truncado && (
              <p className="meta">
                Esta planilha excedeu o limite para reingestão pela fila. Exporte como CSV no padrão
                esperado ou descarte este item.
              </p>
            )}
          </div>
        )}

        {!item.proposta && (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {confiancaPayload !== null && (
              <div className="registro-topo">
                <span className="meta">Confiança da extração</span>
                <span className="confianca">
                  <span className="confianca-trilha" aria-hidden="true">
                    <span
                      className="confianca-barra"
                      style={
                        {
                          '--escala': Math.min(1, Math.max(0, confiancaPayload)),
                        } as CSSProperties
                      }
                    />
                  </span>
                  <span className="mono num">{formatarConfianca(confiancaPayload)}</span>
                </span>
              </div>
            )}
            {textoPreview && (
              <div style={{ display: 'grid', gap: '0.3125rem' }}>
                <span className="meta">Trecho extraído</span>
                <pre className="drawer-pre">{textoPreview}</pre>
              </div>
            )}
            {item.status === 'pendente' && !podeAprovar && (
              <p className="meta">
                Sem chave de pedido nem proposta de mapeamento aprovável: descarte ou reenvie o
                documento corrigido.
              </p>
            )}
          </div>
        )}

        {item.status === 'pendente' && (
          <div className="despacho-acoes">
            {podeAprovar && (
              <button
                type="button"
                className="cmd-btn-enviar"
                disabled={emDecisao}
                onClick={() => void decidir(item, 'aprovado')}
              >
                {emDecisao ? (
                  <>
                    <span className="cmd-spinner" aria-hidden="true" />
                    Processando…
                  </>
                ) : item.proposta ? (
                  <>
                    <IconeConfere />
                    Aprovar e salvar template
                  </>
                ) : (
                  <>
                    <IconeConfere />
                    Aprovar e gravar
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              className="botao-sutil"
              disabled={emDecisao}
              onClick={() => void decidir(item, 'descartado')}
            >
              Descartar
            </button>
          </div>
        )}
      </article>
    );
  }

  return (
    <div
      className="drawer-backdrop"
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        ref={painelRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >
        <header className="drawer-cab">
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <div className="palco-cab-linha">
              <h2 id={tituloId}>Fila de revisão</h2>
              <span className={pendentes.length > 0 ? 'pilula-coord num' : 'pilula-sutil num'}>
                {pendentes.length} {pendentes.length === 1 ? 'pendente' : 'pendentes'}
              </span>
            </div>
            <p className="meta">
              Planilhas com layout desconhecido, PDFs incertos ou documentos sem pedido.
            </p>
          </div>

          <div className="palco-cab-acoes">
            <button
              type="button"
              className="botao-sutil"
              disabled={carregando}
              onClick={() => void carregar()}
            >
              {carregando ? 'Atualizando…' : 'Atualizar'}
            </button>
            <button
              ref={fecharBtnRef}
              type="button"
              className="botao-fechar"
              onClick={aoFechar}
              aria-label="Fechar fila de revisão"
            >
              <IconeFechar />
            </button>
          </div>
        </header>

        <div className="drawer-corpo">
          {recibo && (
            <div className="pilula-ok" role="status" style={{ width: 'fit-content' }}>
              <IconeOk />
              {recibo}
            </div>
          )}

          {erroDecisao && (
            <div className="drawer-card" role="alert" style={{ boxShadow: 'inset 0 0 0 1px var(--error)' }}>
              <span className="pilula-erro" style={{ width: 'fit-content' }}>
                <IconeErro />
                Não foi possível concluir a decisão
              </span>
              <p className="meta" style={{ color: 'var(--text)' }}>
                {erroDecisao}
              </p>
            </div>
          )}

          {erroCarga && (
            <div className="drawer-card" role="alert">
              <p className="aviso-erro">{erroCarga}</p>
              <button type="button" className="botao-sutil" onClick={() => void carregar()}>
                Tentar carregar novamente
              </button>
            </div>
          )}

          {carregando && itens.length === 0 && (
            <div className="palco-cab-linha" role="status">
              <span className="cmd-spinner" aria-hidden="true" />
              <span className="dica">Carregando itens da fila de revisão…</span>
            </div>
          )}

          {!carregando && !erroCarga && itens.length === 0 && (
            <div className="drawer-card">
              <span className="pilula-ok" style={{ width: 'fit-content' }}>
                <IconeConfere />
                Fila limpa
              </span>
              <p className="dica">
                Nenhum documento aguardando revisão. Envie uma planilha fora do padrão ou um PDF
                para testar a triagem assistida.
              </p>
            </div>
          )}

          {pendentes.length > 0 && (
            <section aria-label="Itens pendentes" style={{ display: 'grid', gap: '0.75rem' }}>
              <div className="palco-cab-linha">
                <IconeDiverge />
                <strong style={{ fontSize: '0.875rem' }}>Aguardando decisão</strong>
              </div>
              {pendentes.map(renderizarItem)}
            </section>
          )}

          {decididos.length > 0 && (
            <section aria-label="Itens já decididos" style={{ display: 'grid', gap: '0.75rem' }}>
              <strong className="meta" style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Histórico decidido ({decididos.length})
              </strong>
              {decididos.map(renderizarItem)}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
