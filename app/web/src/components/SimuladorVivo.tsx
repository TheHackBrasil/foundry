import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
} from 'react';
import {
  CAMPOS_VIGIADOS,
  PARTES,
  type CampoVigiado,
  type CamposObservados,
  type RespostaSimulacao,
  type VersaoPedido,
} from '../../../shared/model.ts';
import { ErroApi } from '../api.ts';
import {
  aplicarHipoteseComoPlanilha,
  garantirEstilosOps,
  simularHipoteseDireta,
} from '../apiOps.ts';
import {
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloParte,
  variacao,
} from '../format.ts';
import { agruparTarefas, tarefasDaParte } from '../matriz.ts';
import {
  IconeDiverge,
  IconeEnvio,
  IconeErro,
  IconeFechar,
  IconeOk,
  IconeSeta,
} from './icones.tsx';

export interface SimuladorVivoProps {
  pedidoId: string;
  versoes: readonly VersaoPedido[];
  campoInicial?: CampoVigiado;
  valorInicial?: string | number;
  daSessao: boolean;
  aoResultadoSimulacao?: (
    res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null,
  ) => void;
  aoAplicarNaSessao?: (hipotese: CamposObservados) => Promise<void> | void;
  aoFechar?: () => void;
  aoAnunciar: (texto: string) => void;
}

const OPCOES_STATUS: ReadonlyArray<{ valor: string; rotulo: string }> = [
  { valor: 'emitida', rotulo: 'Emitida' },
  { valor: 'em_transito', rotulo: 'Em trânsito' },
  { valor: 'atrasada', rotulo: 'Atrasada' },
  { valor: 'cancelada', rotulo: 'Cancelada' },
  { valor: 'entregue', rotulo: 'Entregue' },
];

const DIA_MS = 86_400_000;

function normalizarDataIso(valor: string | number | undefined): string {
  if (valor === undefined) return '';
  const texto = String(valor).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(texto);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return '';
}

function somarDiasIso(baseIso: string, dias: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(baseIso);
  if (!m) return baseIso;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + dias * DIA_MS;
  return new Date(ts).toISOString().slice(0, 10);
}

function extrairBases(versoes: readonly VersaoPedido[]): {
  atuais: CamposObservados;
  referencia: CamposObservados;
} {
  const ordenadas = [...versoes].sort((a, b) => a.versao - b.versao);
  const atuais: CamposObservados = {};
  const referencia: CamposObservados = {};
  for (const v of ordenadas) {
    for (const campo of CAMPOS_VIGIADOS) {
      const val = v.campos[campo];
      if (val === undefined) continue;
      if (referencia[campo] === undefined) {
        (referencia as Record<string, unknown>)[campo] = val;
      }
      (atuais as Record<string, unknown>)[campo] = val;
    }
  }
  return { atuais, referencia };
}

function valorInicialTexto(
  campo: CampoVigiado,
  atuais: CamposObservados,
  campoInicial?: CampoVigiado,
  valorInicial?: string | number,
): string {
  if (campoInicial === campo && valorInicial !== undefined) {
    return campo === 'previsaoEntrega' ? normalizarDataIso(valorInicial) : String(valorInicial);
  }
  const atual = atuais[campo];
  if (atual === undefined) return '';
  return campo === 'previsaoEntrega' ? normalizarDataIso(atual) : String(atual);
}

export function SimuladorVivo({
  pedidoId,
  versoes,
  campoInicial,
  valorInicial,
  daSessao,
  aoResultadoSimulacao,
  aoAplicarNaSessao,
  aoFechar,
  aoAnunciar,
}: SimuladorVivoProps) {
  useEffect(() => {
    garantirEstilosOps();
  }, []);

  const dataId = useId();
  const pesoId = useId();
  const volId = useId();

  const { atuais, referencia } = useMemo(() => extrairBases(versoes), [versoes]);

  const [dataInput, setDataInput] = useState<string>(() =>
    valorInicialTexto('previsaoEntrega', atuais, campoInicial, valorInicial),
  );
  const [pesoInput, setPesoInput] = useState<string>(() =>
    valorInicialTexto('pesoTotal', atuais, campoInicial, valorInicial),
  );
  const [volInput, setVolInput] = useState<string>(() =>
    valorInicialTexto('volumes', atuais, campoInicial, valorInicial),
  );
  const [statusInput, setStatusInput] = useState<string>(() =>
    valorInicialTexto('status', atuais, campoInicial, valorInicial),
  );

  const [simulado, setSimulado] = useState<RespostaSimulacao | null>(null);
  const [latenciaMs, setLatenciaMs] = useState<number | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [erroSim, setErroSim] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [feedbackAplicar, setFeedbackAplicar] = useState<{
    tipo: 'ok' | 'erro';
    texto: string;
  } | null>(null);
  const [gatilhoManual, setGatilhoManual] = useState(0);

  const aoResultadoRef = useRef(aoResultadoSimulacao);
  aoResultadoRef.current = aoResultadoSimulacao;
  const aoAnunciarRef = useRef(aoAnunciar);
  aoAnunciarRef.current = aoAnunciar;
  const debounceMsRef = useRef(0);

  // Reinicia os campos quando o pedido ou a semente inicial muda.
  const chaveSemente = `${pedidoId}|${campoInicial ?? ''}|${String(valorInicial ?? '')}`;
  const ultimaSementeRef = useRef(chaveSemente);
  useEffect(() => {
    if (ultimaSementeRef.current === chaveSemente) return;
    ultimaSementeRef.current = chaveSemente;
    setDataInput(valorInicialTexto('previsaoEntrega', atuais, campoInicial, valorInicial));
    setPesoInput(valorInicialTexto('pesoTotal', atuais, campoInicial, valorInicial));
    setVolInput(valorInicialTexto('volumes', atuais, campoInicial, valorInicial));
    setStatusInput(valorInicialTexto('status', atuais, campoInicial, valorInicial));
    setFeedbackAplicar(null);
    debounceMsRef.current = 0;
  }, [chaveSemente, atuais, campoInicial, valorInicial]);

  const hipotese = useMemo<CamposObservados>(() => {
    const out: CamposObservados = {};
    const dataNorm = normalizarDataIso(dataInput);
    if (
      dataNorm &&
      (dataNorm !== normalizarDataIso(atuais.previsaoEntrega) ||
        (campoInicial === 'previsaoEntrega' && valorInicial !== undefined))
    ) {
      out.previsaoEntrega = dataNorm;
    }

    if (pesoInput.trim() !== '') {
      const n = Number(pesoInput.replace(',', '.'));
      if (
        Number.isFinite(n) &&
        n >= 0 &&
        (atuais.pesoTotal === undefined ||
          Math.abs(n - atuais.pesoTotal) > 0.001 ||
          (campoInicial === 'pesoTotal' && valorInicial !== undefined))
      ) {
        out.pesoTotal = n;
      }
    }

    if (volInput.trim() !== '') {
      const n = Math.round(Number(volInput));
      if (
        Number.isFinite(n) &&
        n >= 0 &&
        (atuais.volumes === undefined ||
          n !== atuais.volumes ||
          (campoInicial === 'volumes' && valorInicial !== undefined))
      ) {
        out.volumes = n;
      }
    }

    if (
      statusInput.trim() !== '' &&
      (statusInput !== atuais.status ||
        (campoInicial === 'status' && valorInicial !== undefined))
    ) {
      out.status = statusInput;
    }
    return out;
  }, [dataInput, pesoInput, volInput, statusInput, atuais, campoInicial, valorInicial]);

  const temHipotese = Object.keys(hipotese).length > 0;
  const assinaturaHipotese = JSON.stringify(hipotese);

  useEffect(() => {
    if (!temHipotese) {
      setSimulado(null);
      setLatenciaMs(null);
      setErroSim(null);
      setSimulando(false);
      aoResultadoRef.current?.(null);
      return;
    }

    const controller = new AbortController();
    const espera = debounceMsRef.current;
    debounceMsRef.current = 120;

    const timer = window.setTimeout(() => {
      setSimulando(true);
      setErroSim(null);
      const inicio = performance.now();
      void simularHipoteseDireta(pedidoId, hipotese, controller.signal)
        .then((res) => {
          if (controller.signal.aborted) return;
          setSimulado(res);
          setLatenciaMs(Math.max(1, Math.round(performance.now() - inicio)));
          setSimulando(false);
          aoResultadoRef.current?.({ hipotese, resultado: res });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          const msg =
            err instanceof Error ? err.message : 'Não foi possível executar a simulação.';
          setErroSim(msg);
          setSimulando(false);
        });
    }, espera);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pedidoId, assinaturaHipotese, temHipotese, gatilhoManual]);

  const baseDataRef =
    normalizarDataIso(referencia.previsaoEntrega) ||
    normalizarDataIso(atuais.previsaoEntrega) ||
    new Date().toISOString().slice(0, 10);
  const basePesoRef = referencia.pesoTotal ?? atuais.pesoTotal ?? 500;

  function aplicarAtalhoData(novaData: string) {
    debounceMsRef.current = 0;
    setDataInput(novaData);
    setFeedbackAplicar(null);
  }

  function aplicarAtalhoPeso(novoPeso: number) {
    debounceMsRef.current = 0;
    setPesoInput(String(novoPeso));
    setFeedbackAplicar(null);
  }

  function aplicarAtalhoVolumes(novosVols: number) {
    debounceMsRef.current = 0;
    setVolInput(String(novosVols));
    setFeedbackAplicar(null);
  }

  function aplicarStatus(novoStatus: string) {
    debounceMsRef.current = 0;
    setStatusInput(novoStatus);
    setFeedbackAplicar(null);
  }

  function restaurarAtuais() {
    debounceMsRef.current = 0;
    setDataInput(normalizarDataIso(atuais.previsaoEntrega));
    setPesoInput(atuais.pesoTotal !== undefined ? String(atuais.pesoTotal) : '');
    setVolInput(atuais.volumes !== undefined ? String(atuais.volumes) : '');
    setStatusInput(atuais.status ?? '');
    setFeedbackAplicar(null);
    aoAnunciarRef.current('Simulação restaurada para os valores atuais do pedido.');
  }

  const aoAplicarPlanilha = useCallback(async () => {
    if (!temHipotese || aplicando) return;
    setAplicando(true);
    setFeedbackAplicar(null);

    try {
      if (!daSessao) {
        if (aoAplicarNaSessao) {
          await aoAplicarNaSessao(hipotese);
          const texto = 'Cópia criada na sua sessão e atualização aplicada como planilha.';
          setFeedbackAplicar({ tipo: 'ok', texto });
          aoAnunciarRef.current(texto);
        } else {
          const texto =
            'Pedido de exemplo é somente leitura. Carregue exemplos na sua sessão para gravar esta atualização.';
          setFeedbackAplicar({ tipo: 'erro', texto });
          aoAnunciarRef.current(texto);
        }
        return;
      }

      const r = await aplicarHipoteseComoPlanilha(pedidoId, hipotese);
      const texto =
        r.eventos > 0
          ? `Planilha aplicada: ${r.eventos} ${r.eventos === 1 ? 'evento gravado' : 'eventos gravados'} no ledger.`
          : 'Planilha enviada sem alterações adicionais (valores já registrados).';
      setFeedbackAplicar({ tipo: 'ok', texto });
      aoAnunciarRef.current(texto);
    } catch (err) {
      if (err instanceof ErroApi && err.status === 403 && aoAplicarNaSessao) {
        try {
          await aoAplicarNaSessao(hipotese);
          const texto = 'Cópia criada na sua sessão e atualização aplicada como planilha.';
          setFeedbackAplicar({ tipo: 'ok', texto });
          aoAnunciarRef.current(texto);
          return;
        } catch (errFork) {
          const msgFork =
            errFork instanceof Error ? errFork.message : 'Falha ao aplicar na sua sessão.';
          setFeedbackAplicar({ tipo: 'erro', texto: msgFork });
          aoAnunciarRef.current(msgFork);
          return;
        }
      }
      const msg =
        err instanceof Error ? err.message : 'Não foi possível aplicar a simulação como planilha.';
      setFeedbackAplicar({ tipo: 'erro', texto: msg });
      aoAnunciarRef.current(msg);
    } finally {
      setAplicando(false);
    }
  }, [temHipotese, aplicando, daSessao, aoAplicarNaSessao, hipotese, pedidoId]);

  const resumoPartes = useMemo(() => {
    if (!simulado) return [];
    return PARTES.map((parte) => ({
      parte,
      quantidade: agruparTarefas(tarefasDaParte(simulado.tarefas, parte)).length,
    })).filter((item) => item.quantidade > 0);
  }, [simulado]);

  const totalTarefasUnicas = simulado ? agruparTarefas(simulado.tarefas).length : 0;

  return (
    <section className="sim-vivo" aria-label="Simulador de impacto em tempo real">
      <div className="palco-bloco-cab">
        <div className="palco-cab-linha">
          <span className="pilula-warn">
            <IconeDiverge />
            Simulação · nada gravado no ledger
          </span>
          <span className="meta num">
            Motor determinístico · sem IA
            {latenciaMs !== null ? ` · ${latenciaMs} ms` : ''}
          </span>
        </div>
        <div className="palco-cab-acoes">
          {temHipotese && (
            <button type="button" className="botao-sutil" onClick={restaurarAtuais}>
              Restaurar atuais
            </button>
          )}
          {aoFechar && (
            <button
              type="button"
              className="botao-fechar"
              onClick={aoFechar}
              aria-label="Fechar simulador"
            >
              <IconeFechar />
            </button>
          )}
        </div>
      </div>

      <div className="sim-vivo-grade">
        <div className="sim-vivo-campo">
          <div className="sim-vivo-label">
            <label htmlFor={dataId}>Previsão de entrega</label>
            {atuais.previsaoEntrega && (
              <span className="meta num">
                Atual: {formatarValor('previsaoEntrega', atuais.previsaoEntrega)}
              </span>
            )}
          </div>
          <input
            id={dataId}
            type="date"
            className="sim-vivo-input num"
            value={dataInput}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              debounceMsRef.current = 120;
              setDataInput(e.target.value);
              setFeedbackAplicar(null);
            }}
          />
          <div className="sim-vivo-atalhos" role="group" aria-label="Atalhos de previsão">
            <button
              type="button"
              className="chip"
              onClick={() => aplicarAtalhoData(somarDiasIso(baseDataRef, 3))}
            >
              +3 dias
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => aplicarAtalhoData(somarDiasIso(baseDataRef, 5))}
            >
              +5 dias
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => aplicarAtalhoData(somarDiasIso(baseDataRef, 10))}
            >
              +10 dias
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => aplicarAtalhoData(baseDataRef)}
            >
              Sem atraso
            </button>
          </div>
        </div>

        <div className="sim-vivo-campo">
          <div className="sim-vivo-label">
            <label htmlFor={pesoId}>Peso total (kg)</label>
            {atuais.pesoTotal !== undefined && (
              <span className="meta num">
                Atual: {formatarValor('pesoTotal', atuais.pesoTotal)}
              </span>
            )}
          </div>
          <input
            id={pesoId}
            type="number"
            step="0.5"
            min="0"
            inputMode="decimal"
            className="sim-vivo-input num"
            value={pesoInput}
            placeholder="Ex.: 510"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              debounceMsRef.current = 120;
              setPesoInput(e.target.value);
              setFeedbackAplicar(null);
            }}
          />
          <div className="sim-vivo-atalhos" role="group" aria-label="Atalhos de peso">
            <button type="button" className="chip" onClick={() => aplicarAtalhoPeso(510)}>
              510 kg
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => aplicarAtalhoPeso(Number((basePesoRef + 10).toFixed(2)))}
            >
              +10 kg
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => aplicarAtalhoPeso(Number((basePesoRef + 40).toFixed(2)))}
            >
              +40 kg
            </button>
          </div>
        </div>

        <div className="sim-vivo-campo">
          <div className="sim-vivo-label">
            <label htmlFor={volId}>Volumes</label>
            {atuais.volumes !== undefined && (
              <span className="meta num">Atual: {atuais.volumes}</span>
            )}
          </div>
          <input
            id={volId}
            type="number"
            step="1"
            min="0"
            inputMode="numeric"
            className="sim-vivo-input num"
            value={volInput}
            placeholder="Ex.: 12"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              debounceMsRef.current = 120;
              setVolInput(e.target.value);
              setFeedbackAplicar(null);
            }}
          />
          <div className="sim-vivo-atalhos" role="group" aria-label="Atalhos de volumes">
            <button type="button" className="chip" onClick={() => aplicarAtalhoVolumes(10)}>
              10
            </button>
            <button type="button" className="chip" onClick={() => aplicarAtalhoVolumes(12)}>
              12
            </button>
            <button type="button" className="chip" onClick={() => aplicarAtalhoVolumes(15)}>
              15
            </button>
          </div>
        </div>

        <div className="sim-vivo-campo">
          <div className="sim-vivo-label">
            <span>Status do pedido</span>
            {atuais.status && (
              <span className="meta">Atual: {formatarValor('status', atuais.status)}</span>
            )}
          </div>
          <div className="sim-vivo-atalhos" role="group" aria-label="Status simulado">
            {OPCOES_STATUS.map((op) => {
              const ativo = statusInput === op.valor;
              return (
                <button
                  key={op.valor}
                  type="button"
                  className="chip"
                  data-ativa={ativo ? 'true' : undefined}
                  aria-pressed={ativo}
                  onClick={() => aplicarStatus(op.valor)}
                >
                  {op.rotulo}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {erroSim && (
        <div className="cmd-recupera" role="alert">
          <p className="cmd-erro-msg">{erroSim}</p>
          <button
            type="button"
            className="botao-sutil"
            onClick={() => setGatilhoManual((n) => n + 1)}
          >
            Tentar simular novamente
          </button>
        </div>
      )}

      {!temHipotese && !erroSim && (
        <p className="dica">
          Ajuste qualquer campo ou clique em um atalho acima para calcular em tempo real o impacto
          nos 5 setores sem gravar no ledger.
        </p>
      )}

      {temHipotese && (
        <div className="cmd-bloco" aria-busy={simulando || undefined}>
          <div className="palco-cab-linha" role="status">
            {simulando && <span className="cmd-spinner" aria-hidden="true" />}
            <strong className="num" style={{ fontSize: '0.90625rem' }}>
              {simulado
                ? `${simulado.divergencias.length} ${simulado.divergencias.length === 1 ? 'divergência prevista' : 'divergências previstas'} · ${totalTarefasUnicas} ${totalTarefasUnicas === 1 ? 'tarefa disparada' : 'tarefas disparadas'} nos 5 setores`
                : 'Calculando impacto determinístico…'}
            </strong>
          </div>

          {simulado && simulado.divergencias.length === 0 && (
            <p className="meta">
              A hipótese informada coincide com os valores atuais e não dispara novas tarefas.
            </p>
          )}

          {simulado && simulado.divergencias.length > 0 && (
            <div className="sim-tabela" role="table" aria-label="Divergências previstas na simulação">
              <div role="row" className="sim-row sim-h">
                <div role="columnheader">Campo</div>
                <div role="columnheader">Atual</div>
                <div role="columnheader">Hipótese</div>
                <div role="columnheader">Impacto</div>
              </div>
              <div role="rowgroup">
                {simulado.divergencias.map((d, i) => {
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

          {resumoPartes.length > 0 && (
            <div className="sim-partes-lista">
              <span className="meta">Tarefas por papel:</span>
              {resumoPartes.map((p) => (
                <span key={p.parte} className="pilula-coord num">
                  {rotuloParte(p.parte)} · {p.quantidade}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sim-vivo-rodape">
        <div style={{ display: 'grid', gap: '0.25rem' }}>
          {!daSessao && (
            <span className="meta">
              {aoAplicarNaSessao
                ? 'Pedido de exemplo (somente leitura): ao aplicar, criaremos uma cópia na sua sessão.'
                : 'Pedido de exemplo é somente leitura: carregue exemplos na sua sessão para aplicar.'}
            </span>
          )}
          {feedbackAplicar && (
            <span
              role={feedbackAplicar.tipo === 'erro' ? 'alert' : 'status'}
              className={feedbackAplicar.tipo === 'erro' ? 'pilula-erro' : 'pilula-ok'}
              style={{ width: 'fit-content' }}
            >
              {feedbackAplicar.tipo === 'erro' ? <IconeErro /> : <IconeOk />}
              {feedbackAplicar.texto}
            </span>
          )}
        </div>

        <button
          type="button"
          className="cmd-btn-enviar"
          disabled={!temHipotese || aplicando}
          onClick={() => void aoAplicarPlanilha()}
        >
          {aplicando ? (
            <>
              <span className="cmd-spinner" aria-hidden="true" />
              Aplicando planilha…
            </>
          ) : (
            <>
              <IconeEnvio />
              Aplicar como atualização de planilha
            </>
          )}
        </button>
      </div>
    </section>
  );
}
