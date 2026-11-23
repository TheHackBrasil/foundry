import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { ErroMandatoApi, carregarExemplosNaSessao, enviarMandato } from '../api.ts';
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
import { useVoz } from '../useVoz.ts';
import {
  IconeComando,
  IconeErro,
  IconeFechar,
  IconeMic,
  IconeOk,
  IconeParar,
  IconeRetorno,
  IconeSeta,
} from './icones.tsx';
import { VisualizadorVoz } from './VisualizadorVoz.tsx';

const SUGESTOES: readonly string[] = [
  'Resuma o estado',
  'Propague o atraso',
  'Simule a entrega para 28/01/2026',
  'Avise a transportadora',
];

type EstadoMandato =
  | { tipo: 'ocioso' }
  | { tipo: 'enviando' }
  | { tipo: 'resultado'; dados: ResultadoMandatoInterpretado }
  | { tipo: 'aviso'; mensagem: string }
  | { tipo: 'erro'; mensagem: string; status: number; motivo?: string };

interface Props {
  aoAnunciar: (texto: string) => void;
  aoSelecionar: (pedidoId: string) => void;
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

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
                          <span className="delta-pilula">
                            <IconeSeta />
                            {delta}
                          </span>
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
          <p className="meta">
            {item.via === 'deterministico'
              ? 'Resumo determinístico montado direto do registro.'
              : 'Redigido a partir do estado consolidado do pedido.'}
          </p>
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

function elementoEditavel(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function BarraMandatos({ aoAnunciar, aoSelecionar }: Props) {
  const inputId = useId();
  const ajudaId = useId();
  const erroId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const enviarBtnRef = useRef<HTMLButtonElement>(null);
  const anuncioTimerRef = useRef<number | null>(null);

  const [texto, setTexto] = useState('');
  const [provisorio, setProvisorio] = useState(false);
  const [estado, setEstado] = useState<EstadoMandato>({ tipo: 'ocioso' });
  const [carregandoExemplo, setCarregandoExemplo] = useState(false);

  const limparTimerAnuncio = useCallback(() => {
    if (anuncioTimerRef.current !== null) {
      window.clearTimeout(anuncioTimerRef.current);
      anuncioTimerRef.current = null;
    }
  }, []);

  useEffect(() => limparTimerAnuncio, [limparTimerAnuncio]);

  const voz = useVoz({
    aoTranscrever: (trecho, ehProvisorio) => {
      setTexto(trecho);
      setProvisorio(ehProvisorio);
      setEstado((prev) => (prev.tipo === 'erro' ? { tipo: 'ocioso' } : prev));
    },
    aoConcluir: (textoFinal) => {
      setTexto(textoFinal);
      setProvisorio(false);
      enviarBtnRef.current?.focus();
    },
  });

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

  const enviando = estado.tipo === 'enviando';

  async function executar(comando: string) {
    const limpo = comando.trim();
    if (!limpo) {
      setEstado({ tipo: 'erro', status: 400, mensagem: 'Digite um comando em português para continuar.' });
      inputRef.current?.focus();
      return;
    }
    if (voz.ouvindo) voz.parar();
    voz.limparErro();
    limparTimerAnuncio();
    setProvisorio(false);
    setEstado({ tipo: 'enviando' });

    try {
      const resposta = await enviarMandato(limpo);
      const interpretado = interpretarResultadoMandato(resposta);
      setEstado({ tipo: 'resultado', dados: interpretado });
      // Aguarda o lote SSE de 300ms para o anuncio do mandato nao ser sobrescrito.
      const frase = resumoParaAnuncio(interpretado);
      anuncioTimerRef.current = window.setTimeout(() => {
        aoAnunciar(frase);
        anuncioTimerRef.current = null;
      }, 420);
    } catch (e) {
      const mensagem =
        e instanceof ErroMandatoApi
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Não foi possível executar o comando agora.';
      const status = e instanceof ErroMandatoApi ? e.status : 0;
      const motivo = e instanceof ErroMandatoApi ? e.motivo : undefined;
      setEstado({ tipo: 'erro', mensagem, status, ...(motivo ? { motivo } : {}) });
      aoAnunciar(`Erro no comando: ${mensagem}`);
    }
  }

  function aoSubmeter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    void executar(texto);
  }

  function preencherSugestao(sugestao: string) {
    if (voz.ouvindo) voz.cancelar();
    voz.limparErro();
    setTexto(sugestao);
    setProvisorio(false);
    if (estado.tipo === 'erro') setEstado({ tipo: 'ocioso' });
    inputRef.current?.focus();
  }

  function fecharSaida() {
    limparTimerAnuncio();
    voz.limparErro();
    setEstado({ tipo: 'ocioso' });
    inputRef.current?.focus();
  }

  async function importarExemploNaSessao() {
    if (carregandoExemplo) return;
    setCarregandoExemplo(true);
    try {
      const r = await carregarExemplosNaSessao();
      if (r.enviados === 0 || !r.pedidoId) {
        const detalhe = r.falhas[0] ?? 'Não foi possível carregar os arquivos de exemplo.';
        setEstado({ tipo: 'erro', status: 0, mensagem: detalhe });
        aoAnunciar(detalhe);
        return;
      }
      aoSelecionar(r.pedidoId);
      const aviso = `${plural(r.enviados, 'arquivo de exemplo carregado', 'arquivos de exemplo carregados')} na sua sessão. Execute o comando de novo.`;
      setEstado({ tipo: 'aviso', mensagem: aviso });
      aoAnunciar(aviso);
      enviarBtnRef.current?.focus();
    } finally {
      setCarregandoExemplo(false);
    }
  }

  const precisaSessao =
    estado.tipo === 'erro' && (estado.motivo === 'sem_alvo' || estado.status === 403);
  const temGaveta =
    estado.tipo === 'resultado' ||
    estado.tipo === 'erro' ||
    estado.tipo === 'aviso' ||
    Boolean(voz.erro);

  const classeSuperficie = [
    'cmd',
    enviando ? 'cmd-enviando' : '',
    voz.ouvindo ? 'cmd-ouvindo' : '',
    estado.tipo === 'erro' || voz.erro ? 'cmd-erro' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className="mandato-secao"
      aria-labelledby="bloco-mandato"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (voz.ouvindo) {
          e.preventDefault();
          voz.cancelar();
          inputRef.current?.focus();
        } else if (temGaveta) {
          e.preventDefault();
          fecharSaida();
        }
      }}
    >
      <h3 id="bloco-mandato" className="so-leitor">
        Comando operacional
      </h3>

      <div className={classeSuperficie}>
        <form className="cmd-form" onSubmit={aoSubmeter} noValidate>
          <label htmlFor={inputId} className="so-leitor">
            Comando em português para os pedidos da sua sessão
          </label>

          <span className="cmd-prefixo" aria-hidden="true">
            <span className={`icone-troca ${!enviando && !voz.ouvindo ? 'visivel' : ''}`}>
              <IconeComando />
            </span>
            <span className={`icone-troca ${voz.ouvindo ? 'visivel' : ''}`}>
              <span className="cmd-pulso" />
            </span>
            <span className={`icone-troca ${enviando ? 'visivel' : ''}`}>
              <span className="cmd-spinner" />
            </span>
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
              if (estado.tipo === 'erro') setEstado({ tipo: 'ocioso' });
            }}
            placeholder={
              voz.fase === 'iniciando'
                ? 'Ativando microfone…'
                : voz.ouvindo
                  ? 'Ouvindo em português… fale seu comando'
                  : 'Comande sua sessão: "resuma o estado", "simule a entrega para 28/01/2026"…'
            }
            disabled={enviando}
            aria-invalid={estado.tipo === 'erro' ? 'true' : undefined}
            aria-describedby={estado.tipo === 'erro' ? `${ajudaId} ${erroId}` : ajudaId}
            className={provisorio ? 'cmd-input cmd-input-provisorio' : 'cmd-input'}
          />

          <div className="cmd-acoes">
            {voz.ouvindo && (
              <div className="voz-faixa" role="status" aria-live="off">
                <span className="so-leitor">
                  {voz.fase === 'iniciando' ? 'Ativando microfone' : 'Ouvindo comando por voz'}
                </span>
                <VisualizadorVoz
                  analyserRef={voz.analyserRef}
                  energiaRef={voz.energiaRef}
                  ativo={voz.ouvindo}
                  movimentoReduzido={voz.movimentoReduzido}
                />
                <span className="voz-tempo mono num">
                  {voz.fase === 'iniciando' ? '…' : formatarDuracao(voz.segundos)}
                </span>
              </div>
            )}

            {voz.suportado && (
              <button
                type="button"
                className="cmd-btn-voz"
                aria-pressed={voz.ouvindo}
                aria-label={voz.ouvindo ? 'Parar ditado por voz' : 'Ditar comando por voz'}
                onClick={voz.alternar}
                disabled={enviando}
              >
                <span className="icone-slot" aria-hidden="true">
                  <span className={`icone-troca ${voz.ouvindo ? 'visivel' : ''}`}>
                    <IconeParar />
                  </span>
                  <span className={`icone-troca ${!voz.ouvindo ? 'visivel' : ''}`}>
                    <IconeMic />
                  </span>
                </span>
                <span>{voz.ouvindo ? 'Parar' : 'Voz'}</span>
              </button>
            )}

            <button
              ref={enviarBtnRef}
              type="submit"
              className="cmd-btn-enviar"
              disabled={enviando}
            >
              <span>{enviando ? 'Traduzindo…' : 'Executar'}</span>
              {!enviando && <IconeRetorno />}
            </button>
          </div>
        </form>

        <div className={`cmd-gaveta ${temGaveta ? 'cmd-gaveta-aberta' : ''}`}>
          <div className="cmd-gaveta-inner">
            {voz.erro && (
              <div className="cmd-painel cmd-painel-erro" role="alert">
                <div className="cmd-painel-cab">
                  <span className="pilula-erro">
                    <IconeErro />
                    Microfone indisponível
                  </span>
                  <button
                    type="button"
                    className="botao-fechar"
                    aria-label="Fechar aviso de microfone"
                    onClick={voz.limparErro}
                  >
                    <IconeFechar />
                  </button>
                </div>
                <p className="cmd-erro-msg">{voz.erro}</p>
              </div>
            )}

            {estado.tipo === 'erro' && (
              <div id={erroId} className="cmd-painel cmd-painel-erro" role="alert">
                <div className="cmd-painel-cab">
                  <span className="pilula-erro">
                    <IconeErro />
                    Comando recusado
                  </span>
                  <button
                    type="button"
                    className="botao-fechar"
                    aria-label="Fechar aviso de erro"
                    onClick={fecharSaida}
                  >
                    <IconeFechar />
                  </button>
                </div>
                <p className="cmd-erro-msg">{estado.mensagem}</p>
                {precisaSessao && (
                  <div className="cmd-recupera">
                    <p className="meta">
                      Os pedidos iniciais são compartilhados para leitura. Carregue os arquivos fictícios na sua sessão para comandar ao vivo.
                    </p>
                    <button
                      type="button"
                      className="botao"
                      disabled={carregandoExemplo}
                      onClick={() => void importarExemploNaSessao()}
                    >
                      {carregandoExemplo ? 'Carregando exemplos…' : 'Carregar exemplo na minha sessão'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {estado.tipo === 'aviso' && (
              <div className="cmd-painel cmd-painel-ok" role="status">
                <div className="cmd-painel-cab">
                  <span className="pilula-ok">
                    <IconeOk />
                    Sessão pronta
                  </span>
                  <button
                    type="button"
                    className="botao-fechar"
                    aria-label="Fechar aviso"
                    onClick={fecharSaida}
                  >
                    <IconeFechar />
                  </button>
                </div>
                <p className="cmd-resumo">{estado.mensagem}</p>
              </div>
            )}

            {estado.tipo === 'resultado' && (
              <div className="cmd-painel" role="status">
                <div className="cmd-painel-cab">
                  <div className="cmd-painel-meta">
                    <span className="pilula-coord mono">{rotuloAcaoMandato(estado.dados.acao)}</span>
                    {estado.dados.acao === 'simular' && (
                      <span className="pilula-sutil">Simulação · nenhum campo gravado</span>
                    )}
                    {estado.dados.alvos.length > 0 && (
                      <span className="cmd-alvos meta">
                        {estado.dados.alvos.length === 1 ? 'Pedido ' : 'Pedidos '}
                        {estado.dados.alvos.map((alvo, idx) => (
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
                    onClick={fecharSaida}
                  >
                    <IconeFechar />
                  </button>
                </div>

                {estado.dados.acao === 'propagar' && (
                  <CartaoPropagar itens={estado.dados.itens} novosEventos={estado.dados.novosEventos} />
                )}
                {estado.dados.acao === 'simular' && <CartaoSimular itens={estado.dados.itens} />}
                {estado.dados.acao === 'resumir' && <CartaoResumir itens={estado.dados.itens} />}
                {estado.dados.acao === 'notificar' && <CartaoNotificar itens={estado.dados.itens} />}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cmd-rodape">
        <div className="cmd-chips" role="group" aria-label="Sugestões de comando">
          {SUGESTOES.map((sugestao) => (
            <button
              key={sugestao}
              type="button"
              className="chip"
              disabled={enviando}
              onClick={() => preencherSugestao(sugestao)}
            >
              {sugestao}
            </button>
          ))}
        </div>
        <span id={ajudaId} className="cmd-atalho meta">
          Sessão atual · <kbd className="tecla mono">/</kbd>
        </span>
      </div>
    </section>
  );
}
