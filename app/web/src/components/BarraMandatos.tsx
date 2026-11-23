import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import {
  ErroMandatoApi,
  carregarExemplosNaSessao,
  enviarMandato,
} from '../api.ts';
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
import { IconeErro, IconeFechar, IconeMic, IconeOk, IconeParar, IconeSeta } from './icones.tsx';

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
    <ul className="mandato-itens">
      {itens.map((item) => (
        <li key={item.pedidoId} className="mandato-item">
          <div className="mandato-metricas">
            <span className="num">
              <strong>{item.divergencias.length}</strong>{' '}
              {item.divergencias.length === 1 ? 'divergência' : 'divergências'}
            </span>
            <span className="meta" aria-hidden="true">·</span>
            <span className="num">
              <strong>{item.tarefas.length}</strong> {item.tarefas.length === 1 ? 'tarefa' : 'tarefas'}
            </span>
            <span className="meta" aria-hidden="true">·</span>
            <span className="num">
              <strong>{item.eventosNovos}</strong> {item.eventosNovos === 1 ? 'novo evento' : 'novos eventos'}
            </span>
          </div>
          {item.eventosNovos === 0 && (
            <p className="meta">
              {novosEventos === 0
                ? 'Tudo já estava propagado no registro: nenhuma duplicata gravada.'
                : 'Nenhuma novidade gravada neste pedido.'}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function CartaoSimular({ itens }: { itens: readonly ItemSimular[] }) {
  return (
    <div className="mandato-itens">
      {itens.map((item) => (
        <div key={item.pedidoId} className="mandato-item">
          {item.divergencias.length === 0 ? (
            <p className="dica">Nenhuma divergência prevista para esta hipótese.</p>
          ) : (
            <div className="sim-tabela" role="table" aria-label="Divergências previstas na simulação">
              <div role="row" className="sim-row sim-h">
                <div role="columnheader">Campo</div>
                <div role="columnheader">Atual</div>
                <div role="columnheader">Hipótese</div>
                <div role="columnheader">Variação</div>
              </div>
              <div role="rowgroup">
                {item.divergencias.map((d, i) => {
                  const delta = variacao(d.campo, d.valorB, d.valorA);
                  return (
                    <div role="row" key={`${d.campo}-${d.fonteA}-${i}`} className="sim-row sim-b">
                      <div role="rowheader" className="campo">
                        {rotuloCampo(d.campo)}
                      </div>
                      <div role="cell" data-col="Atual">
                        <span className="num">{formatarValor(d.campo, d.valorA)}</span>
                        <span className="meta"> ({rotuloFonte(d.fonteA)})</span>
                      </div>
                      <div role="cell" data-col="Hipótese" className="sim-hip">
                        <span className="num">{formatarValor(d.campo, d.valorB)}</span>
                      </div>
                      <div role="cell" data-col="Variação">
                        {delta ? (
                          <span className="delta">
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
            <p className="meta sim-partes">
              Tarefas previstas ({item.tarefas.length}):{' '}
              {item.tarefasPorParte
                .map((p) => `${rotuloParte(p.parte)} (${p.quantidade})`)
                .join(' · ')}
              .
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function CartaoResumir({ itens }: { itens: readonly ItemResumir[] }) {
  return (
    <ul className="mandato-itens">
      {itens.map((item) => (
        <li key={item.pedidoId} className="mandato-item">
          <p className="mandato-resumo">{item.resumo}</p>
          <p className="meta">
            {item.via === 'deterministico'
              ? 'Resumo determinístico montado direto do registro.'
              : 'Redigido a partir do registro atual do pedido.'}
          </p>
        </li>
      ))}
    </ul>
  );
}

function CartaoNotificar({ itens }: { itens: readonly ItemNotificar[] }) {
  return (
    <ul className="mandato-itens">
      {itens.map((item, i) => {
        const entregue = item.status === 'entregue';
        const classeStatus = entregue
          ? 'estado estado-ok'
          : item.motivo === 'falha_envio'
            ? 'estado estado-erro'
            : 'estado estado-warn';
        return (
          <li key={`${item.pedidoId}-${i}`} className="mandato-item mandato-recibo">
            <span className={classeStatus}>
              {entregue ? <IconeOk /> : <IconeErro />}
              {entregue ? 'Entregue' : 'Não entregue'}
            </span>
            <span>{item.parte ? rotuloParte(item.parte) : 'Parte não identificada'}</span>
            {item.motivo && <span className="meta">{rotuloMotivoNotificacao(item.motivo)}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function classeCartaoResultado(dados: ResultadoMandatoInterpretado): string {
  switch (dados.acao) {
    case 'propagar':
    case 'simular':
      return 'mandato-cartao mandato-cartao-coord';
    case 'resumir':
      return 'mandato-cartao mandato-cartao-ok';
    case 'notificar':
      return dados.itens.every((i) => i.status === 'entregue')
        ? 'mandato-cartao mandato-cartao-ok'
        : 'mandato-cartao mandato-cartao-aviso';
  }
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
      // Mantem o texto editavel e move o foco para Executar sem disparar escrita sozinho.
      enviarBtnRef.current?.focus();
    },
  });

  // Atalho "/" fora de campos editaveis foca a barra operacional.
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

  const classeCampo = [
    'mandato-campo',
    enviando ? 'mandato-campo-enviando' : '',
    voz.ouvindo ? 'mandato-campo-ouvindo' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className="mandato"
      aria-labelledby="bloco-mandato"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        if (voz.ouvindo) {
          e.preventDefault();
          voz.cancelar();
          inputRef.current?.focus();
        } else if (estado.tipo === 'resultado' || estado.tipo === 'erro' || estado.tipo === 'aviso') {
          e.preventDefault();
          fecharSaida();
        }
      }}
    >
      <div className="sec-cab mandato-cab">
        <h3 id="bloco-mandato">Comando operacional</h3>
        <span id={ajudaId} className="meta">
          Atua nos pedidos da sua sessão · atalho <kbd className="tecla mono">/</kbd>
        </span>
      </div>

      <form className="mandato-form" onSubmit={aoSubmeter} noValidate>
        <label htmlFor={inputId} className="so-leitor">
          Comando em português para a torre de pedidos
        </label>
        <div className={classeCampo}>
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
            placeholder='Ex.: "resuma o estado" ou "simule a entrega para 28/01/2026"'
            disabled={enviando}
            aria-invalid={estado.tipo === 'erro' ? 'true' : undefined}
            aria-describedby={estado.tipo === 'erro' ? `${ajudaId} ${erroId}` : ajudaId}
            className={provisorio ? 'mandato-input mandato-input-provisorio' : 'mandato-input'}
          />

          <div className="mandato-acoes">
            {voz.ouvindo && (
              <div className="voz-medidor" role="status" aria-live="off">
                <span className="so-leitor">Ouvindo comando por voz</span>
                <span className="voz-barras" aria-hidden="true">
                  {voz.niveis.map((nivel, idx) => (
                    <span
                      key={idx}
                      className="voz-barra"
                      data-ativo={nivel > 0.24 ? 'true' : 'false'}
                      style={{ '--nivel': nivel } as CSSProperties}
                    />
                  ))}
                </span>
                <span className="voz-tempo mono num">{formatarDuracao(voz.segundos)}</span>
              </div>
            )}

            {voz.suportado && (
              <button
                type="button"
                className="botao mandato-mic"
                aria-pressed={voz.ouvindo}
                aria-label={voz.ouvindo ? 'Parar ditado por voz' : 'Ditar comando por voz'}
                onClick={voz.alternar}
                disabled={enviando}
              >
                {voz.ouvindo ? <IconeParar /> : <IconeMic />}
                <span>{voz.ouvindo ? 'Parar' : 'Voz'}</span>
              </button>
            )}

            <button
              ref={enviarBtnRef}
              type="submit"
              className="botao botao-primario"
              disabled={enviando}
            >
              {enviando ? 'Traduzindo…' : 'Executar'}
            </button>
          </div>
        </div>
      </form>

      <div className="mandato-chips" role="group" aria-label="Sugestões de comando">
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

      {voz.erro && (
        <p className="mandato-voz-erro aviso-erro" role="alert">
          {voz.erro}
        </p>
      )}

      {estado.tipo === 'erro' && (
        <div id={erroId} className="mandato-cartao mandato-cartao-erro" role="alert">
          <div className="mandato-cartao-cab">
            <span className="estado estado-erro">
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
          <p className="mandato-erro-msg">{estado.mensagem}</p>
          {precisaSessao && (
            <div className="mandato-recupera">
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
        <div className="mandato-cartao mandato-cartao-ok" role="status">
          <div className="mandato-cartao-cab">
            <span className="estado estado-ok">
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
          <p>{estado.mensagem}</p>
        </div>
      )}

      {estado.tipo === 'resultado' && (
        <div className={classeCartaoResultado(estado.dados)} role="status">
          <div className="mandato-cartao-cab">
            <div className="mandato-cartao-meta">
              <span className="etiqueta mono">{rotuloAcaoMandato(estado.dados.acao)}</span>
              {estado.dados.acao === 'simular' && (
                <span className="etiqueta etiqueta-sim">Simulação: nenhum campo gravado</span>
              )}
              {estado.dados.alvos.length > 0 && (
                <span className="mandato-alvos meta">
                  {estado.dados.alvos.length === 1 ? 'Alvo: ' : 'Alvos: '}
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
    </section>
  );
}
