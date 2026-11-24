import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import {
  CAMPOS_VIGIADOS,
  type AlvoFocoGenUI,
  type BlocoGenUI,
  type CampoVigiado,
  type CamposObservados,
  type CitacaoFactual,
  type Contato,
  type FonteDocumento,
  type Parte,
  type ProjecaoPedido,
  type RespostaSimulacao,
  type ViewSpecV2,
} from '../../../shared/model.ts';
import { garantirEstilosOps } from '../apiOps.ts';
import {
  formatarConfianca,
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloCanalContato,
  rotuloFonte,
  rotuloParte,
  rotuloTipoSinal,
  variacao,
} from '../format.ts';
import { agruparTarefas, tarefasDaParte } from '../matriz.ts';
import { GrafoDomino } from './GrafoDomino.tsx';
import { SimuladorVivo } from './SimuladorVivo.tsx';
import {
  IconeAviso,
  IconeConfere,
  IconeDiverge,
  IconeErro,
  IconeFechar,
  IconeOk,
  IconeSeta,
  IconeSinal,
} from './icones.tsx';

export interface EtapaStreamGenUI {
  id: string;
  rotulo: string;
  detalhe?: string;
  concluida: boolean;
}

export interface PalcoGenUIProps {
  spec: ViewSpecV2 | null;
  etapas: readonly EtapaStreamGenUI[];
  blocosStream: readonly BlocoGenUI[];
  carregando: boolean;
  projecao: ProjecaoPedido;
  pedidoId: string;
  daSessao: boolean;
  contatos: readonly Contato[];
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar: (alvo: AlvoFocoGenUI | null) => void;
  aoExecutarComando: (texto: string) => void;
  aoSelecionarPapel: (papel: Parte) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoSimularResultado?: (
    res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null,
  ) => void;
  aoAplicarHipotese?: (hipotese: CamposObservados) => Promise<void>;
  aoFechar?: () => void;
  aoAnunciar: (texto: string) => void;
  slotLoader?: ReactNode;
}

function alvoIgual(a: AlvoFocoGenUI | null, b: AlvoFocoGenUI | null): boolean {
  if (!a || !b || a.tipo !== b.tipo) return false;
  switch (a.tipo) {
    case 'celula':
      return b.tipo === 'celula' && a.campo === b.campo && a.fonte === b.fonte;
    case 'divergencia':
      return (
        b.tipo === 'divergencia' &&
        a.campo === b.campo &&
        a.fonteA === b.fonteA &&
        a.fonteB === b.fonteB
      );
    case 'parte':
      return b.tipo === 'parte' && a.parte === b.parte;
    case 'versao':
      return b.tipo === 'versao' && a.versao === b.versao;
    case 'sinal':
      return b.tipo === 'sinal' && a.indice === b.indice;
  }
}

function blocoEhLargo(bloco: BlocoGenUI): boolean {
  return (
    bloco.tipo === 'domino_impacto' ||
    bloco.tipo === 'simulador_interativo' ||
    bloco.tipo === 'cartoes_despacho' ||
    bloco.tipo === 'matriz_focada'
  );
}

function lerValorFonte(
  projecao: ProjecaoPedido,
  fonte: FonteDocumento,
  campo: CampoVigiado,
): { valor: unknown; versao?: number; em?: string } {
  const ordenadas = [...projecao.versoes].sort((a, b) => a.versao - b.versao);
  let encontrado: { valor: unknown; versao?: number; em?: string } = { valor: undefined };
  for (const v of ordenadas) {
    if (v.fonte === fonte && v.campos[campo] !== undefined) {
      encontrado = { valor: v.campos[campo], versao: v.versao, em: v.geradaEm };
    }
  }
  if (encontrado.valor !== undefined) return encontrado;
  for (const d of projecao.divergencias) {
    if (d.campo !== campo) continue;
    if (d.fonteA === fonte) return { valor: d.valorA };
    if (d.fonteB === fonte) return { valor: d.valorB };
  }
  return encontrado;
}

function calcularProporcaoDesvio(
  campo: CampoVigiado,
  valA: unknown,
  valB: unknown,
): { pctA: number; pctB: number; legenda: string } | null {
  if (valA === undefined || valB === undefined) return null;
  if (campo === 'pesoTotal' || campo === 'volumes') {
    const a = Number(valA);
    const b = Number(valB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a <= 0 && b <= 0)) return null;
    const total = a + b;
    return {
      pctA: Math.max(8, Math.min(92, (a / total) * 100)),
      pctB: Math.max(8, Math.min(92, (b / total) * 100)),
      legenda: `Proporção entre ${formatarValor(campo, valA)} e ${formatarValor(campo, valB)}`,
    };
  }
  if (campo === 'previsaoEntrega') {
    const ta = Date.parse(`${String(valA).slice(0, 10)}T00:00:00Z`);
    const tb = Date.parse(`${String(valB).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
    const dias = Math.abs(Math.round((tb - ta) / 86_400_000));
    if (dias === 0) return null;
    const pctDesvio = Math.max(14, Math.min(82, Math.round((dias / 20) * 100)));
    return {
      pctA: 100 - pctDesvio,
      pctB: pctDesvio,
      legenda: `Desvio de ${dias} ${dias === 1 ? 'dia' : 'dias'} sobre a referência`,
    };
  }
  return null;
}

function BlocoResumoCitado({
  bloco,
  indice,
  focoAtivo,
  aoAlternarFoco,
}: {
  bloco: Extract<BlocoGenUI, { tipo: 'resumo_citado' }>;
  indice: number;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: (alvo: AlvoFocoGenUI, rotulo: string) => void;
}) {
  const mapaCitacoes = useMemo(
    () => new Map<string, CitacaoFactual>(bloco.citacoes.map((c) => [c.id, c])),
    [bloco.citacoes],
  );

  const { segmentos, usadas } = useMemo(() => {
    const partes = bloco.corpo.split(/(\[\[[^\]]+\]\])/g);
    const idsUsados = new Set<string>();
    const nos = partes.map((parte, i) => {
      const m = /^\[\[([^\]]+)\]\]$/.exec(parte);
      if (!m) return { tipo: 'texto' as const, chave: `t-${i}`, texto: parte };
      const id = m[1]?.trim() ?? '';
      const cit = mapaCitacoes.get(id);
      if (!cit) return { tipo: 'texto' as const, chave: `t-${i}`, texto: parte };
      idsUsados.add(id);
      return { tipo: 'citacao' as const, chave: `c-${id}-${i}`, cit };
    });
    return { segmentos: nos, usadas: idsUsados };
  }, [bloco.corpo, mapaCitacoes]);

  const restantes = useMemo(
    () => bloco.citacoes.filter((c) => !usadas.has(c.id)),
    [bloco.citacoes, usadas],
  );

  return (
    <article
      className="palco-bloco palco-bloco-largo"
      aria-label={bloco.titulo}
      style={{ '--bloco-i': indice } as CSSProperties}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
      </div>

      <p className="palco-resumo-texto">
        {segmentos.map((seg) =>
          seg.tipo === 'texto' ? (
            <span key={seg.chave}>{seg.texto}</span>
          ) : (
            <button
              key={seg.chave}
              type="button"
              className="citacao-btn"
              aria-pressed={alvoIgual(focoAtivo, seg.cit.alvo)}
              onClick={() => aoAlternarFoco(seg.cit.alvo, seg.cit.rotulo)}
            >
              {seg.cit.rotulo}
            </button>
          ),
        )}
      </p>

      {restantes.length > 0 && (
        <div className="palco-citacoes-rodape">
          <span className="meta">Evidências:</span>
          {restantes.map((cit) => (
            <button
              key={cit.id}
              type="button"
              className="citacao-btn"
              aria-pressed={alvoIgual(focoAtivo, cit.alvo)}
              onClick={() => aoAlternarFoco(cit.alvo, cit.rotulo)}
            >
              {cit.rotulo}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

function BlocoComparadorConflito({
  bloco,
  indice,
  projecao,
  focoAtivo,
  aoAlternarFoco,
}: {
  bloco: Extract<BlocoGenUI, { tipo: 'comparador_conflito' }>;
  indice: number;
  projecao: ProjecaoPedido;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: (alvo: AlvoFocoGenUI, rotulo: string) => void;
}) {
  const dadoA = lerValorFonte(projecao, bloco.fonteA, bloco.campo);
  const dadoB = lerValorFonte(projecao, bloco.fonteB, bloco.campo);
  const delta = variacao(bloco.campo, dadoB.valor, dadoA.valor);
  const proporcao = calcularProporcaoDesvio(bloco.campo, dadoA.valor, dadoB.valor);

  const alvoA: AlvoFocoGenUI = { tipo: 'celula', campo: bloco.campo, fonte: bloco.fonteA };
  const alvoB: AlvoFocoGenUI = { tipo: 'celula', campo: bloco.campo, fonte: bloco.fonteB };

  return (
    <article
      className="palco-bloco"
      aria-label={bloco.titulo}
      style={{ '--bloco-i': indice } as CSSProperties}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
        <span className="pilula-coord">{rotuloCampo(bloco.campo)}</span>
      </div>

      <div className="comparador-duelo">
        <button
          type="button"
          className="comparador-lado"
          aria-pressed={alvoIgual(focoAtivo, alvoA)}
          onClick={() =>
            aoAlternarFoco(alvoA, `${rotuloCampo(bloco.campo)} em ${rotuloFonte(bloco.fonteA)}`)
          }
        >
          <span className="meta">{rotuloFonte(bloco.fonteA)} · referência</span>
          <span className="comparador-lado-valor num">
            {dadoA.valor !== undefined ? formatarValor(bloco.campo, dadoA.valor) : 'Não declarado'}
          </span>
          {dadoA.versao !== undefined && dadoA.em && (
            <span className="meta num">
              v{dadoA.versao} · {formatarMomento(dadoA.em)}
            </span>
          )}
        </button>

        <div className="comparador-vs" aria-hidden="true">
          <span>vs</span>
          {delta && (
            <span className="delta-pilula num">
              <IconeSeta />
              {delta}
            </span>
          )}
        </div>

        <button
          type="button"
          className="comparador-lado"
          aria-pressed={alvoIgual(focoAtivo, alvoB)}
          onClick={() =>
            aoAlternarFoco(alvoB, `${rotuloCampo(bloco.campo)} em ${rotuloFonte(bloco.fonteB)}`)
          }
        >
          <span className="meta">{rotuloFonte(bloco.fonteB)} · divergente</span>
          <span className="comparador-lado-valor num">
            {dadoB.valor !== undefined ? formatarValor(bloco.campo, dadoB.valor) : 'Não declarado'}
          </span>
          {dadoB.versao !== undefined && dadoB.em && (
            <span className="meta num">
              v{dadoB.versao} · {formatarMomento(dadoB.em)}
            </span>
          )}
        </button>
      </div>

      {proporcao && (
        <div className="comparador-barra-wrap">
          <div className="comparador-barra-trilha" aria-hidden="true">
            <span className="comparador-barra-a" style={{ width: `${proporcao.pctA}%` }} />
            <span className="comparador-barra-b" style={{ width: `${proporcao.pctB}%` }} />
          </div>
          <span className="meta">{proporcao.legenda}</span>
        </div>
      )}

      {bloco.notaRegra && (
        <p className="comparador-nota">
          <strong>Regra factual:</strong> {bloco.notaRegra}
        </p>
      )}
    </article>
  );
}

function BlocoLinhaTempoCausal({
  bloco,
  indice,
  projecao,
  focoAtivo,
  aoAlternarFoco,
}: {
  bloco: Extract<BlocoGenUI, { tipo: 'linha_tempo_causal' }>;
  indice: number;
  projecao: ProjecaoPedido;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: (alvo: AlvoFocoGenUI, rotulo: string) => void;
}) {
  const versoesOrdenadas = useMemo(
    () => [...projecao.versoes].sort((a, b) => a.versao - b.versao),
    [projecao.versoes],
  );

  return (
    <article
      className="palco-bloco"
      aria-label={bloco.titulo}
      style={{ '--bloco-i': indice } as CSSProperties}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
        <div className="palco-cab-linha">
          {bloco.campoFoco && (
            <span className="pilula-coord">Foco: {rotuloCampo(bloco.campoFoco)}</span>
          )}
          <span className="meta num">
            {versoesOrdenadas.length}{' '}
            {versoesOrdenadas.length === 1 ? 'versão' : 'versões'}
          </span>
        </div>
      </div>

      {versoesOrdenadas.length === 0 ? (
        <p className="dica">Nenhuma versão registrada neste pedido ainda.</p>
      ) : (
        <ol className="checklist-lista">
          {versoesOrdenadas.map((v) => {
            const declarados = CAMPOS_VIGIADOS.filter((c) => v.campos[c] !== undefined);
            const alvo: AlvoFocoGenUI = { tipo: 'versao', versao: v.versao };
            return (
              <li key={`${v.fonte}-${v.versao}`}>
                <button
                  type="button"
                  className="checklist-item"
                  aria-pressed={alvoIgual(focoAtivo, alvo)}
                  onClick={() =>
                    aoAlternarFoco(alvo, `Versão ${v.versao} (${rotuloFonte(v.fonte)})`)
                  }
                >
                  <div className="domino-no-topo">
                    <span className="palco-cab-linha">
                      <span className="pilula-neutra mono num">v{v.versao}</span>
                      <strong>{rotuloFonte(v.fonte)}</strong>
                    </span>
                    <time className="meta mono" dateTime={v.geradaEm}>
                      {formatarMomento(v.geradaEm)}
                    </time>
                  </div>
                  {declarados.length === 0 ? (
                    <span className="meta">Nenhum campo vigiado declarado neste documento.</span>
                  ) : (
                    <div className="palco-cab-linha" style={{ marginTop: '0.25rem' }}>
                      {declarados.map((campo) => {
                        const destacado = bloco.campoFoco === campo;
                        return (
                          <span
                            key={campo}
                            className={destacado ? 'pilula-coord num' : 'pilula-sutil num'}
                          >
                            {rotuloCampo(campo)}: {formatarValor(campo, v.campos[campo])}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      {bloco.incluirSinais && projecao.sinais.length > 0 && (
        <div className="palco-sinais-sep">
          <span className="meta palco-sinais-rotulo">
            <IconeSinal />
            Sinais consultivos (texto livre · não alteram campos vigiados)
          </span>
          <ul className="checklist-lista">
            {projecao.sinais.map((sinal, indice) => {
              const alvo: AlvoFocoGenUI = { tipo: 'sinal', indice };
              const escala = Number.isFinite(sinal.confianca)
                ? Math.min(1, Math.max(0, sinal.confianca))
                : 0;
              return (
                <li key={`${sinal.tipo}-${sinal.fonte}-${indice}`}>
                  <button
                    type="button"
                    className="checklist-item"
                    aria-pressed={alvoIgual(focoAtivo, alvo)}
                    onClick={() =>
                      aoAlternarFoco(alvo, `Sinal consultivo: ${rotuloTipoSinal(sinal.tipo)}`)
                    }
                  >
                    <div className="registro-topo">
                      <span className="pilula-neutra">{rotuloTipoSinal(sinal.tipo)}</span>
                      <span className="pilula-sutil">{rotuloFonte(sinal.fonte)}</span>
                      <span className="confianca">
                        <span className="confianca-trilha" aria-hidden="true">
                          <span
                            className="confianca-barra"
                            style={{ '--escala': escala } as CSSProperties}
                          />
                        </span>
                        <span className="mono num">{formatarConfianca(sinal.confianca)}</span>
                      </span>
                    </div>
                    <span className="palco-sinal-resumo">{sinal.resumo}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}

function BlocoCartoesDespacho({
  bloco,
  indice,
  contatos,
  projecao,
  aoNotificar,
  aoAbrirAgenda,
  aoAnunciar,
}: {
  bloco: Extract<BlocoGenUI, { tipo: 'cartoes_despacho' }>;
  indice: number;
  contatos: readonly Contato[];
  projecao: ProjecaoPedido;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoAnunciar: (texto: string) => void;
}) {
  const baseId = useId();
  const [rascunhosEditados, setRascunhosEditados] = useState<Record<string, string>>({});
  const [enviando, setEnviando] = useState<Record<string, boolean>>({});
  const [recibos, setRecibos] = useState<
    Record<string, { tipo: 'ok' | 'erro'; texto: string }>
  >({});

  const partesUnicas = useMemo(
    () => Array.from(new Set(bloco.partes)),
    [bloco.partes],
  );

  const contatoPorParte = useMemo(
    () => new Map<Parte, Contato>(contatos.map((c) => [c.parte, c])),
    [contatos],
  );

  async function dispararAviso(parte: Parte, campo?: CampoVigiado) {
    setEnviando((prev) => ({ ...prev, [parte]: true }));
    setRecibos((prev) => {
      const copia = { ...prev };
      delete copia[parte];
      return copia;
    });
    try {
      await aoNotificar(parte, campo);
      const msg = `Aviso disparado para ${rotuloParte(parte)}.`;
      setRecibos((prev) => ({ ...prev, [parte]: { tipo: 'ok', texto: msg } }));
      aoAnunciar(msg);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : `Não foi possível avisar ${rotuloParte(parte)}.`;
      setRecibos((prev) => ({ ...prev, [parte]: { tipo: 'erro', texto: msg } }));
      aoAnunciar(msg);
    } finally {
      setEnviando((prev) => ({ ...prev, [parte]: false }));
    }
  }

  return (
    <article
      className="palco-bloco palco-bloco-largo"
      aria-label={bloco.titulo}
      style={{ '--bloco-i': indice } as CSSProperties}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
      </div>

      {partesUnicas.length === 0 ? (
        <p className="dica">Nenhuma parte selecionada para despacho.</p>
      ) : (
        <div className="despacho-grid">
          {partesUnicas.map((parte) => {
            const contato = contatoPorParte.get(parte);
            const rascunho = bloco.rascunhos.find((r) => r.parte === parte);
            const tarefasParte = agruparTarefas(tarefasDaParte(projecao.tarefas, parte));
            const fallbackMsg =
              tarefasParte.length > 0
                ? `${rotuloParte(parte)}: ${tarefasParte.map((g) => g.titulo).join('; ')}.`
                : `Atualização do pedido para ${rotuloParte(parte)}.`;
            const chave = `${bloco.id}:${parte}`;
            const valorTexto = rascunhosEditados[chave] ?? rascunho?.mensagemSugerida ?? fallbackMsg;
            const canalIncompativel = contato?.canal === 'email';
            const bloqueadoCanal = !contato || canalIncompativel;
            const emEnvio = Boolean(enviando[parte]);
            const recibo = recibos[parte];
            const textareaId = `${baseId}-${parte}`;

            return (
              <div key={parte} className="despacho-card">
                <div className="domino-no-topo">
                  <strong>{rotuloParte(parte)}</strong>
                  {!contato ? (
                    <span className="pilula-warn">
                      <IconeErro />
                      Sem contato
                    </span>
                  ) : canalIncompativel ? (
                    <span className="pilula-warn">
                      <IconeAviso />
                      E-mail incompatível
                    </span>
                  ) : (
                    <span className="pilula-ok">
                      <IconeOk />
                      {rotuloCanalContato(contato.canal)}
                    </span>
                  )}
                </div>

                {contato ? (
                  <p className="meta">
                    {contato.nome} · <span className="mono">{contato.destino}</span>
                  </p>
                ) : (
                  <p className="meta">
                    Nenhum destino cadastrado na agenda para {rotuloParte(parte)}.
                  </p>
                )}

                <div className="drawer-field">
                  <div className="domino-no-topo">
                    <label htmlFor={textareaId}>Mensagem</label>
                    {rascunho && (
                      <span className="pilula-sutil">{rotuloCampo(rascunho.campo)}</span>
                    )}
                  </div>
                  <textarea
                    id={textareaId}
                    className="despacho-textarea"
                    value={valorTexto}
                    onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
                      setRascunhosEditados((prev) => ({ ...prev, [chave]: e.target.value }))
                    }
                  />
                </div>

                {recibo && (
                  <span
                    role={recibo.tipo === 'erro' ? 'alert' : 'status'}
                    className={recibo.tipo === 'erro' ? 'pilula-erro' : 'pilula-ok'}
                    style={{ width: 'fit-content' }}
                  >
                    {recibo.tipo === 'erro' ? <IconeErro /> : <IconeOk />}
                    {recibo.texto}
                  </span>
                )}

                <div className="despacho-acoes">
                  <button
                    type="button"
                    className={bloqueadoCanal ? 'botao' : 'botao-sutil'}
                    onClick={() => aoAbrirAgenda(parte)}
                  >
                    {bloqueadoCanal ? 'Configurar contato' : 'Editar contato'}
                  </button>

                  <button
                    type="button"
                    className="cmd-btn-enviar"
                    disabled={bloqueadoCanal || emEnvio}
                    onClick={() => void dispararAviso(parte, rascunho?.campo)}
                  >
                    {emEnvio ? (
                      <>
                        <span className="cmd-spinner" aria-hidden="true" />
                        Avisando…
                      </>
                    ) : (
                      `Avisar ${rotuloParte(parte)}`
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

function BlocoChecklistPapel({
  bloco,
  indice,
  projecao,
  focoAtivo,
  aoAlternarFoco,
  aoSelecionarPapel,
}: {
  bloco: Extract<BlocoGenUI, { tipo: 'checklist_papel' }>;
  indice: number;
  projecao: ProjecaoPedido;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: (alvo: AlvoFocoGenUI, rotulo: string) => void;
  aoSelecionarPapel: (papel: Parte) => void;
}) {
  const gruposOrdenados = useMemo(() => {
    const prioridade = new Map<CampoVigiado, number>(
      bloco.camposPrioritarios.map((c, idx) => [c, idx]),
    );
    const grupos = agruparTarefas(tarefasDaParte(projecao.tarefas, bloco.parte));
    return [...grupos].sort((a, b) => {
      const ca = a.ocorrencias[0]?.divergencia.campo;
      const cb = b.ocorrencias[0]?.divergencia.campo;
      const pa = ca !== undefined ? (prioridade.get(ca) ?? 99) : 99;
      const pb = cb !== undefined ? (prioridade.get(cb) ?? 99) : 99;
      return pa - pb;
    });
  }, [projecao.tarefas, bloco.parte, bloco.camposPrioritarios]);

  return (
    <article
      className="palco-bloco palco-bloco-largo"
      aria-label={bloco.titulo}
      style={{ '--bloco-i': indice } as CSSProperties}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
        <button
          type="button"
          className="botao-sutil"
          onClick={() => aoSelecionarPapel(bloco.parte)}
        >
          Lente: {rotuloParte(bloco.parte)}
        </button>
      </div>

      {gruposOrdenados.length === 0 ? (
        <p className="dica">
          Nenhuma tarefa aberta para {rotuloParte(bloco.parte)} neste pedido.
        </p>
      ) : (
        <ul className="checklist-lista">
          {gruposOrdenados.map((grupo) => {
            const principal = grupo.ocorrencias[0];
            if (!principal) return null;
            const d = principal.divergencia;
            const alvo: AlvoFocoGenUI = {
              tipo: 'divergencia',
              campo: d.campo,
              fonteA: d.fonteA,
              fonteB: d.fonteB,
            };
            const prioritario = bloco.camposPrioritarios.includes(d.campo);
            return (
              <li key={`${grupo.parte}-${grupo.titulo}`}>
                <button
                  type="button"
                  className="checklist-item"
                  aria-pressed={alvoIgual(focoAtivo, alvo)}
                  onClick={() =>
                    aoAlternarFoco(alvo, `${rotuloCampo(d.campo)}: ${grupo.titulo}`)
                  }
                >
                  <div className="domino-no-topo">
                    <strong className="checklist-titulo">{grupo.titulo}</strong>
                    <span className={prioritario ? 'pilula-coord' : 'pilula-sutil'}>
                      {rotuloCampo(d.campo)}
                    </span>
                  </div>
                  <span className="meta">{principal.detalhe}</span>
                  <span className="meta num">
                    {rotuloFonte(d.fonteA)} ({formatarValor(d.campo, d.valorA)}) ×{' '}
                    {rotuloFonte(d.fonteB)} ({formatarValor(d.campo, d.valorB)})
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function BlocoMatrizFocada({
  bloco,
  indice,
  focoAtivo,
  aoAlternarFoco,
}: {
  bloco: Extract<BlocoGenUI, { tipo: 'matriz_focada' }>;
  indice: number;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: (alvo: AlvoFocoGenUI, rotulo: string) => void;
}) {
  return (
    <article
      className="palco-bloco palco-bloco-largo"
      aria-label={bloco.titulo}
      style={{ '--bloco-i': indice } as CSSProperties}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
        <span className="meta">
          {bloco.fontesVisiveis.map(rotuloFonte).join(' · ')}
        </span>
      </div>
      {bloco.celulasDestacadas.length === 0 ? (
        <p className="meta">
          Campos priorizados: {bloco.colunas.map(rotuloCampo).join(', ')}.
        </p>
      ) : (
        <div className="palco-cab-linha">
          <span className="meta">Células em destaque:</span>
          {bloco.celulasDestacadas.map((cel) => {
            const alvo: AlvoFocoGenUI = { tipo: 'celula', campo: cel.campo, fonte: cel.fonte };
            const rotulo = `${rotuloCampo(cel.campo)} · ${rotuloFonte(cel.fonte)}`;
            return (
              <button
                key={`${cel.campo}-${cel.fonte}`}
                type="button"
                className="citacao-btn"
                aria-pressed={alvoIgual(focoAtivo, alvo)}
                onClick={() => aoAlternarFoco(alvo, rotulo)}
              >
                {rotulo}
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function PalcoGenUI({
  spec,
  etapas,
  blocosStream,
  carregando,
  projecao,
  pedidoId,
  daSessao,
  contatos,
  focoAtivo,
  aoFocar,
  aoExecutarComando,
  aoSelecionarPapel,
  aoNotificar,
  aoAbrirAgenda,
  aoSimularResultado,
  aoAplicarHipotese,
  aoFechar,
  aoAnunciar,
  slotLoader,
}: PalcoGenUIProps) {
  useEffect(() => {
    garantirEstilosOps();
  }, []);

  const [recolhidoLocal, setRecolhidoLocal] = useState(false);
  const [simLive, setSimLive] = useState<{
    hipotese: CamposObservados;
    resultado: RespostaSimulacao;
  } | null>(null);

  // Encerrado sem spec nem blocos (ex.: resposta so em texto do agente) nao
  // renderiza um palco vazio so porque a trilha de etapas ficou registrada.
  if (!carregando && !spec && blocosStream.length === 0) {
    return null;
  }

  const blocosAtivos: readonly BlocoGenUI[] =
    spec && spec.blocos.length > 0 ? spec.blocos : blocosStream;

  const titulo = spec?.tituloVisao ?? (carregando ? 'Compondo visão operacional…' : 'Visão composta');

  function alternarFoco(alvo: AlvoFocoGenUI, rotulo: string) {
    if (alvoIgual(focoAtivo, alvo)) {
      aoFocar(null);
      aoAnunciar('Destaque removido.');
    } else {
      aoFocar(alvo);
      aoAnunciar(`Destacando ${rotulo}.`);
    }
  }

  function lidarSimulacao(
    res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null,
  ) {
    setSimLive(res);
    aoSimularResultado?.(res);
  }

  const seloOrigem =
    spec?.layout === 'simulacao' ? (
      <span className="pilula-warn">
        <IconeDiverge />
        Simulação
      </span>
    ) : null;

  function renderizarBloco(bloco: BlocoGenUI, idx: number) {
    const indice = Math.min(idx, 4);
    switch (bloco.tipo) {
      case 'resumo_citado':
        return (
          <BlocoResumoCitado
            key={bloco.id}
            bloco={bloco}
            indice={indice}
            focoAtivo={focoAtivo}
            aoAlternarFoco={alternarFoco}
          />
        );

      case 'domino_impacto': {
        const usarSim = bloco.modo === 'simulacao' && simLive !== null;
        return (
          <article
            key={bloco.id}
            className="palco-bloco palco-bloco-largo"
            aria-label={bloco.titulo}
            style={{ '--bloco-i': indice } as CSSProperties}
          >
            <GrafoDomino
              divergencias={usarSim ? simLive.resultado.divergencias : projecao.divergencias}
              tarefas={usarSim ? simLive.resultado.tarefas : projecao.tarefas}
              modo={bloco.modo}
              camposFoco={bloco.camposFoco}
              partesFoco={bloco.partesFoco}
              titulo={bloco.titulo}
              aoFocar={aoFocar}
              aoSelecionarPapel={aoSelecionarPapel}
            />
          </article>
        );
      }

      case 'comparador_conflito':
        return (
          <BlocoComparadorConflito
            key={bloco.id}
            bloco={bloco}
            indice={indice}
            projecao={projecao}
            focoAtivo={focoAtivo}
            aoAlternarFoco={alternarFoco}
          />
        );

      case 'linha_tempo_causal':
        return (
          <BlocoLinhaTempoCausal
            key={bloco.id}
            bloco={bloco}
            indice={indice}
            projecao={projecao}
            focoAtivo={focoAtivo}
            aoAlternarFoco={alternarFoco}
          />
        );

      case 'simulador_interativo':
        return (
          <article
            key={bloco.id}
            className="palco-bloco palco-bloco-largo"
            aria-label={bloco.titulo}
            style={{ '--bloco-i': indice } as CSSProperties}
          >
            <div className="palco-bloco-cab">
              <h3>{bloco.titulo}</h3>
            </div>
            <SimuladorVivo
              pedidoId={pedidoId}
              versoes={projecao.versoes}
              campoInicial={bloco.campoInicial}
              valorInicial={bloco.valorInicial}
              daSessao={daSessao}
              aoResultadoSimulacao={lidarSimulacao}
              aoAplicarNaSessao={aoAplicarHipotese}
              aoAnunciar={aoAnunciar}
            />
          </article>
        );

      case 'cartoes_despacho':
        return (
          <BlocoCartoesDespacho
            key={bloco.id}
            bloco={bloco}
            indice={indice}
            contatos={contatos}
            projecao={projecao}
            aoNotificar={aoNotificar}
            aoAbrirAgenda={aoAbrirAgenda}
            aoAnunciar={aoAnunciar}
          />
        );

      case 'checklist_papel':
        return (
          <BlocoChecklistPapel
            key={bloco.id}
            bloco={bloco}
            indice={indice}
            projecao={projecao}
            focoAtivo={focoAtivo}
            aoAlternarFoco={alternarFoco}
            aoSelecionarPapel={aoSelecionarPapel}
          />
        );

      case 'matriz_focada':
        return (
          <BlocoMatrizFocada
            key={bloco.id}
            bloco={bloco}
            indice={indice}
            focoAtivo={focoAtivo}
            aoAlternarFoco={alternarFoco}
          />
        );
    }
  }

  const compactosCount = blocosAtivos.filter((b) => !blocoEhLargo(b)).length;

  return (
    <section
      className="palco-genui"
      aria-label={titulo}
      aria-busy={carregando || undefined}
      data-layout={spec?.layout ?? 'investigacao'}
    >
      <header className="palco-cab">
        <div className="palco-cab-texto">
          <div className="palco-cab-linha">
            <h2>{titulo}</h2>
            {seloOrigem}
          </div>
          {spec?.justificativa && <p className="meta">{spec.justificativa}</p>}
        </div>

        <div className="palco-cab-acoes">
          {focoAtivo && (
            <button
              type="button"
              className="botao-sutil"
              onClick={() => {
                aoFocar(null);
                aoAnunciar('Destaque removido.');
              }}
            >
              Limpar destaque
            </button>
          )}
          <button
            type="button"
            className="botao-sutil"
            onClick={() => {
              if (aoFechar) aoFechar();
              else setRecolhidoLocal((r) => !r);
            }}
            aria-expanded={aoFechar ? true : !recolhidoLocal}
          >
            {aoFechar ? (
              <>
                <IconeFechar />
                Recolher
              </>
            ) : recolhidoLocal ? (
              'Expandir'
            ) : (
              'Recolher'
            )}
          </button>
        </div>
      </header>

      {carregando && (
        <div className="palco-trilha-viva" role="status" aria-live="polite">
          {slotLoader}
          <ol className="palco-etapas">
            {etapas.length === 0 ? (
              <li className="palco-etapa palco-etapa-ativa">
                <span className="cmd-spinner" aria-hidden="true" />
                <span>Lendo estado do pedido…</span>
              </li>
            ) : (
              etapas.map((et) => (
                <li
                  key={et.id}
                  className={et.concluida ? 'palco-etapa' : 'palco-etapa palco-etapa-ativa'}
                  data-concluida={et.concluida ? 'true' : 'false'}
                >
                  {et.concluida ? (
                    <IconeConfere />
                  ) : (
                    <span className="cmd-spinner" aria-hidden="true" />
                  )}
                  <span>
                    {et.rotulo}
                    {et.detalhe ? ` · ${et.detalhe}` : ''}
                  </span>
                </li>
              ))
            )}
          </ol>
        </div>
      )}

      {!recolhidoLocal && blocosAtivos.length > 0 && (
        <div
          className="palco-grid"
          style={compactosCount === 1 ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}
        >
          {blocosAtivos.map((bloco, idx) => renderizarBloco(bloco, idx))}
        </div>
      )}

      {!recolhidoLocal && spec && spec.followUps.length > 0 && (
        <nav className="palco-followups" aria-label="Próximas ações sugeridas">
          <span className="meta">Continuar:</span>
          {spec.followUps.map((f, i) => (
            <button
              key={`${f.comando}-${i}`}
              type="button"
              className="chip"
              data-intencao={f.intencao}
              onClick={() => aoExecutarComando(f.comando)}
            >
              {f.rotulo}
            </button>
          ))}
        </nav>
      )}
    </section>
  );
}
