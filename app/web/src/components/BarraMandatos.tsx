import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
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

type EstadoGaveta = Extract<EstadoMandato, { tipo: 'resultado' | 'aviso' | 'erro' }>;

interface ConteudoGaveta {
  vozErro: string | null;
  estado: EstadoGaveta | null;
  seq: number;
}

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
  const textoPreVozRef = useRef('');
  const fecharGavetaTimerRef = useRef<number | null>(null);
  const tremorTimerRef = useRef<number | null>(null);
  const tremorRafRef = useRef<number | null>(null);

  const [texto, setTexto] = useState('');
  const [provisorio, setProvisorio] = useState(false);
  const [estado, setEstado] = useState<EstadoMandato>({ tipo: 'ocioso' });
  const [execSeq, setExecSeq] = useState(0);
  const [gavetaSnapshot, setGavetaSnapshot] = useState<ConteudoGaveta | null>(null);
  const [tremendo, setTremendo] = useState(false);
  const [sugestaoAtiva, setSugestaoAtiva] = useState(-1);
  const [carregandoExemplo, setCarregandoExemplo] = useState(false);

  const limparTimerAnuncio = useCallback(() => {
    if (anuncioTimerRef.current !== null) {
      window.clearTimeout(anuncioTimerRef.current);
      anuncioTimerRef.current = null;
    }
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
      limparTimerAnuncio();
      if (fecharGavetaTimerRef.current !== null) window.clearTimeout(fecharGavetaTimerRef.current);
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
      setEstado((prev) => (prev.tipo === 'erro' ? { tipo: 'ocioso' } : prev));
    },
    aoConcluir: (textoFinal) => {
      const base = textoPreVozRef.current;
      setTexto(base ? `${base} ${textoFinal}` : textoFinal);
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

  const estadoGaveta: EstadoGaveta | null =
    estado.tipo === 'resultado' || estado.tipo === 'aviso' || estado.tipo === 'erro' ? estado : null;
  const temGaveta = estadoGaveta !== null || Boolean(voz.erro);

  // Mantém o snapshot durante o recolhimento de 200ms para grid-template-rows animar o fechamento.
  useEffect(() => {
    if (fecharGavetaTimerRef.current !== null) {
      window.clearTimeout(fecharGavetaTimerRef.current);
      fecharGavetaTimerRef.current = null;
    }
    if (temGaveta) {
      setGavetaSnapshot({ vozErro: voz.erro, estado: estadoGaveta, seq: execSeq });
      return;
    }
    fecharGavetaTimerRef.current = window.setTimeout(() => {
      setGavetaSnapshot(null);
      fecharGavetaTimerRef.current = null;
    }, 200);
    return () => {
      if (fecharGavetaTimerRef.current !== null) {
        window.clearTimeout(fecharGavetaTimerRef.current);
        fecharGavetaTimerRef.current = null;
      }
    };
  }, [temGaveta, voz.erro, estadoGaveta, execSeq]);

  const exibido: ConteudoGaveta | null = temGaveta
    ? { vozErro: voz.erro, estado: estadoGaveta, seq: execSeq }
    : gavetaSnapshot;

  const enviando = estado.tipo === 'enviando';

  function alternarVoz() {
    if (!voz.ouvindo) {
      textoPreVozRef.current = texto.trim();
      setSugestaoAtiva(-1);
    }
    voz.alternar();
  }

  async function executar(comando: string) {
    const limpo = comando.trim();
    setSugestaoAtiva(-1);
    if (!limpo) {
      setExecSeq((n) => n + 1);
      setEstado({ tipo: 'erro', status: 400, mensagem: 'Digite um comando em português para continuar.' });
      acionarTremor();
      inputRef.current?.focus();
      return;
    }
    // Cancela em vez de parar para evitar onend tardio sobrescrever o texto ou roubar foco.
    if (voz.ouvindo) voz.cancelar();
    voz.limparErro();
    limparTimerAnuncio();
    setProvisorio(false);
    setEstado({ tipo: 'enviando' });

    try {
      const resposta = await enviarMandato(limpo);
      const interpretado = interpretarResultadoMandato(resposta);
      setExecSeq((n) => n + 1);
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
      setExecSeq((n) => n + 1);
      setEstado({ tipo: 'erro', mensagem, status, ...(motivo ? { motivo } : {}) });
      acionarTremor();
      aoAnunciar(`Erro no comando: ${mensagem}`);
    }
  }

  function aoSubmeter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    void executar(texto);
  }

  function aoTeclarInput(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (voz.ouvindo) voz.cancelar();
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
    setTexto(escolhida);
    setProvisorio(false);
    if (estado.tipo === 'erro') setEstado({ tipo: 'ocioso' });
  }

  function preencherSugestao(sugestao: string) {
    if (voz.ouvindo) voz.cancelar();
    voz.limparErro();
    setSugestaoAtiva(-1);
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
        setExecSeq((n) => n + 1);
        setEstado({ tipo: 'erro', status: 0, mensagem: detalhe });
        acionarTremor();
        aoAnunciar(detalhe);
        return;
      }
      aoSelecionar(r.pedidoId);
      const aviso = `${plural(r.enviados, 'arquivo de exemplo carregado', 'arquivos de exemplo carregados')} na sua sessão. Execute o comando de novo.`;
      setExecSeq((n) => n + 1);
      setEstado({ tipo: 'aviso', mensagem: aviso });
      aoAnunciar(aviso);
      enviarBtnRef.current?.focus();
    } finally {
      setCarregandoExemplo(false);
    }
  }

  const estadoExibido = exibido?.estado ?? null;
  const precisaSessao =
    estadoExibido?.tipo === 'erro' &&
    (estadoExibido.motivo === 'sem_alvo' || estadoExibido.status === 403);

  const classeSuperficie = [
    'cmd',
    enviando ? 'cmd-enviando' : '',
    estado.tipo === 'erro' || voz.erro ? 'cmd-erro' : '',
    tremendo ? 'cmd-tremor' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const classeForm = [
    'cmd-form',
    voz.ouvindo ? 'cmd-form-ouvindo' : '',
    voz.ouvindo && temGaveta ? 'cmd-form-com-gaveta' : '',
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
      aria-labelledby="bloco-mandato"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (voz.ouvindo) {
          e.preventDefault();
          voz.cancelar();
          setTexto(textoPreVozRef.current);
          setProvisorio(false);
          inputRef.current?.focus();
        } else if (sugestaoAtiva !== -1) {
          e.preventDefault();
          setSugestaoAtiva(-1);
        } else if (temGaveta) {
          e.preventDefault();
          fecharSaida();
        }
      }}
    >
      <h2 id="bloco-mandato" className="so-leitor">
        Comando operacional
      </h2>

      <div className={classeSuperficie}>
        <form className={classeForm} onSubmit={aoSubmeter} noValidate>
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
              setSugestaoAtiva(-1);
              if (estado.tipo === 'erro') setEstado({ tipo: 'ocioso' });
            }}
            onKeyDown={aoTeclarInput}
            placeholder={
              voz.fase === 'iniciando'
                ? 'Ativando microfone…'
                : voz.fase === 'finalizando'
                  ? 'Finalizando transcrição…'
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
                  type="button"
                  className="voz-ativo-parar"
                  aria-pressed="true"
                  aria-label="Parar ditado por voz"
                  onClick={alternarVoz}
                  disabled={enviando || voz.fase === 'finalizando'}
                >
                  <IconeParar />
                  <span>Parar</span>
                </button>
              </div>
            ) : (
              voz.suportado && (
                <button
                  type="button"
                  className="cmd-btn-voz"
                  aria-pressed="false"
                  aria-label="Ditar comando por voz"
                  onClick={alternarVoz}
                  disabled={enviando}
                >
                  <IconeMic />
                  <span>Voz</span>
                </button>
              )
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

        <div
          className={`cmd-gaveta ${temGaveta ? 'cmd-gaveta-aberta' : ''}`}
          aria-hidden={!temGaveta || undefined}
        >
          <div className="cmd-gaveta-inner">
            {exibido?.vozErro && (
              <div
                className="cmd-painel cmd-painel-erro"
                role={temGaveta ? 'alert' : undefined}
              >
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
                    tabIndex={temGaveta ? 0 : -1}
                  >
                    <IconeFechar />
                  </button>
                </div>
                <p className="cmd-erro-msg">{exibido.vozErro}</p>
              </div>
            )}

            {estadoExibido?.tipo === 'erro' && (
              <div
                key={`erro-${exibido?.seq ?? 0}`}
                id={erroId}
                className="cmd-painel cmd-painel-erro"
                role={temGaveta ? 'alert' : undefined}
              >
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
                    tabIndex={temGaveta ? 0 : -1}
                  >
                    <IconeFechar />
                  </button>
                </div>
                <p className="cmd-erro-msg">{estadoExibido.mensagem}</p>
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
                      tabIndex={temGaveta ? 0 : -1}
                    >
                      {carregandoExemplo ? 'Carregando exemplos…' : 'Carregar exemplo na minha sessão'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {estadoExibido?.tipo === 'aviso' && (
              <div key={`aviso-${exibido?.seq ?? 0}`} className="cmd-painel cmd-painel-ok">
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
                    tabIndex={temGaveta ? 0 : -1}
                  >
                    <IconeFechar />
                  </button>
                </div>
                <p className="cmd-resumo">{estadoExibido.mensagem}</p>
              </div>
            )}

            {estadoExibido?.tipo === 'resultado' && (
              <div key={`res-${exibido?.seq ?? 0}`} className="cmd-painel">
                <div className="cmd-painel-cab">
                  <div className="cmd-painel-meta">
                    <span className="pilula-coord mono">{rotuloAcaoMandato(estadoExibido.dados.acao)}</span>
                    {estadoExibido.dados.acao === 'simular' && (
                      <span className="pilula-sutil">Nenhum campo gravado</span>
                    )}
                    {estadoExibido.dados.alvos.length > 0 && (
                      <span className="cmd-alvos meta">
                        {estadoExibido.dados.alvos.length === 1 ? 'Pedido ' : 'Pedidos '}
                        {estadoExibido.dados.alvos.map((alvo, idx) => (
                          <span key={alvo}>
                            {idx > 0 && ', '}
                            <a
                              href={`#/pedido/${encodeURIComponent(alvo)}`}
                              className="mono"
                              tabIndex={temGaveta ? 0 : -1}
                            >
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
                    tabIndex={temGaveta ? 0 : -1}
                  >
                    <IconeFechar />
                  </button>
                </div>

                {estadoExibido.dados.acao === 'propagar' && (
                  <CartaoPropagar
                    itens={estadoExibido.dados.itens}
                    novosEventos={estadoExibido.dados.novosEventos}
                  />
                )}
                {estadoExibido.dados.acao === 'simular' && <CartaoSimular itens={estadoExibido.dados.itens} />}
                {estadoExibido.dados.acao === 'resumir' && <CartaoResumir itens={estadoExibido.dados.itens} />}
                {estadoExibido.dados.acao === 'notificar' && (
                  <CartaoNotificar itens={estadoExibido.dados.itens} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cmd-rodape">
        <div className="cmd-chips" role="group" aria-label="Sugestões de comando">
          {SUGESTOES.map((sugestao, idx) => (
            <button
              key={sugestao}
              type="button"
              className="chip"
              data-ativa={sugestaoAtiva === idx ? 'true' : undefined}
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
