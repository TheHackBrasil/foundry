import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PARTES,
  type AlvoFocoGenUI,
  type CampoVigiado,
  type ProjecaoPedido,
} from '../../../shared/model.ts';
import {
  formatarConfianca,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloParte,
  rotuloTipoSinal,
  variacao,
} from '../format.ts';
import {
  agruparTarefas,
  montarMatriz,
  tarefasDaParte,
  type Celula,
  type LinhaMatriz,
} from '../matriz.ts';
import { movimentoReduzidoAgora } from '../shaders/index.ts';
import '../painel-v2.css';
import type { FasePresenca } from '../usePresencaAnimada.ts';
import type { Carga } from '../useTorre.ts';
import { codigoCurtoPedido } from './assistente/conversaUtils.ts';
import { TextoAgente } from './assistente/TextoAgente.tsx';
import { DescricaoAoVivo } from './evidencia/DescricaoAoVivo.tsx';
import {
  alvoDescricaoIgual,
  chaveFoco,
  derivarSecoesEvidencia,
  descreverAlvoDescricao,
  rotuloAbrirNaTorre,
  type AlvoDescricao,
  type ContextoAgente,
  type SecaoEvidencia,
} from './evidencia/contexto.ts';
import { chaveDescricao } from './evidencia/descricao.ts';
import { renderizarMicroBloco } from './evidencia/microBlocos.tsx';
import { alvoIgual } from './genui/helpers.ts';
import {
  IconeConfere,
  IconeDiverge,
  IconeExterno,
  IconeFechar,
  IconeSemComparacao,
  IconeSinal,
} from './icones.tsx';

export interface EvidenciaLateralIAProps {
  id: string;
  pedidoId: string | null;
  projecao: Carga<ProjecaoPedido>;
  daSessao: boolean;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar: (alvo: AlvoFocoGenUI | null) => void;
  aoAbrirNaTorre: (pedidoId: string, foco?: AlvoFocoGenUI | null) => void;
  aoFechar?: () => void;
  ehGaveta?: boolean;
  faseGaveta?: FasePresenca;
  // THE-16: a ultima resposta do agente chega como contexto e o painel decide
  // se ela aparece (o pedido bate e ha bloco que caiba ou texto).
  contextoAgente?: ContextoAgente | null;
  // anuncios para a regiao viva da pagina (leitura concluida, destaque, erro).
  aoAnunciar?: (texto: string) => void;
}

function celulaNoFoco(campo: CampoVigiado, celula: Celula, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  switch (foco.tipo) {
    case 'celula':
      return foco.campo === campo && foco.fonte === celula.fonte;
    case 'divergencia':
      return (
        foco.campo === campo &&
        (foco.fonteA === celula.fonte || foco.fonteB === celula.fonte)
      );
    case 'versao':
      return celula.versao !== undefined && celula.versao === foco.versao;
    case 'parte':
    case 'sinal':
      return false;
  }
}

function linhaNoFoco(linha: LinhaMatriz, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'celula' || foco.tipo === 'divergencia') {
    return foco.campo === linha.campo;
  }
  if (foco.tipo === 'versao') {
    return linha.celulas.some((c) => c.versao === foco.versao);
  }
  return false;
}

// Painel de evidencia do Assistente (spec 0014): deriva as secoes do
// contexto — pedido selecionado, foco clicado, ultima resposta do agente —
// em vez de receber props casadas (THE-16). Cliques internos em campo,
// divergencia, setor ou citacao pedem a leitura detalhada ao vivo no mesmo
// SSE do assistente (THE-17); foco vindo de fora mostra a evidencia e so
// gera texto por acao explicita do usuario.
export function EvidenciaLateralIA({
  id,
  pedidoId,
  projecao,
  daSessao,
  focoAtivo,
  aoFocar,
  aoAbrirNaTorre,
  aoFechar,
  ehGaveta = false,
  faseGaveta,
  contextoAgente = null,
  aoAnunciar,
}: EvidenciaLateralIAProps) {
  const painelRef = useRef<HTMLElement>(null);
  const fecharBtnRef = useRef<HTMLButtonElement>(null);
  const assinaturaFoco = chaveFoco(focoAtivo);

  // detalhe = alvo que um clique interno pediu para o agente explicar;
  // guarda o foco associado para saber quando um foco externo o substituiu.
  const [detalhe, setDetalhe] = useState<{
    alvo: AlvoDescricao;
    foco: AlvoFocoGenUI;
  } | null>(null);

  // Move foco para o botão fechar ao abrir como gaveta sobreposta em viewports estreitas.
  useEffect(() => {
    if (!ehGaveta || faseGaveta === 'saindo') return;
    fecharBtnRef.current?.focus();
  }, [ehGaveta, faseGaveta]);

  // Rola o item destacado dentro da coluna lateral ao receber foco de uma citação ou grafo.
  useEffect(() => {
    if (!assinaturaFoco) return;
    const painel = painelRef.current;
    if (!painel) return;
    const alvoEl = painel.querySelector<HTMLElement>('[data-foco-ativo="true"]');
    if (!alvoEl || typeof alvoEl.scrollIntoView !== 'function') return;
    alvoEl.scrollIntoView({
      behavior: movimentoReduzidoAgora() ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [assinaturaFoco]);

  // Foco zerado por fora (limpar do palco, troca de pedido) fecha a
  // leitura interna junto.
  useEffect(() => {
    if (focoAtivo === null) setDetalhe(null);
  }, [focoAtivo]);

  const dados = projecao.estado === 'ok' ? projecao.dados : null;

  const matriz = useMemo(
    () => (dados ? montarMatriz(dados.versoes, dados.divergencias) : null),
    [dados],
  );

  const resumoPartes = useMemo(() => {
    if (!dados) return [];
    return PARTES.map((parte) => {
      const brutas = tarefasDaParte(dados.tarefas, parte);
      const agrupadas = agruparTarefas(brutas);
      return {
        parte,
        quantidade: agrupadas.length,
        ocorrencias: brutas.length,
        primeiraAcao: agrupadas[0]?.titulo ?? null,
      };
    });
  }, [dados]);

  const partesComTarefas = useMemo(
    () => resumoPartes.filter((p) => p.quantidade > 0),
    [resumoPartes],
  );

  const secoes = useMemo(
    () =>
      derivarSecoesEvidencia({
        pedidoId,
        projecao,
        focoAtivo,
        agente: contextoAgente ?? null,
      }),
    [pedidoId, projecao, focoAtivo, contextoAgente],
  );

  const detalheAtivo =
    detalhe && focoAtivo && alvoIgual(detalhe.foco, focoAtivo) ? detalhe : null;
  const alvoCard: AlvoDescricao | null = detalheAtivo?.alvo ?? focoAtivo;
  const autoPedirDescricao = detalheAtivo !== null;

  // Clique interno: destaca na matriz e marca a leitura detalhada para
  // disparar sozinha. Repetir o clique no mesmo alvo desliga.
  function alternarDetalhe(foco: AlvoFocoGenUI, alvo: AlvoDescricao, anuncio?: string) {
    const repete =
      alvoIgual(focoAtivo, foco) && alvoDescricaoIgual(detalheAtivo?.alvo ?? null, alvo);
    if (repete) {
      aoFocar(null);
      setDetalhe(null);
      aoAnunciar?.('Destaque removido.');
      return;
    }
    aoFocar(foco);
    setDetalhe({ alvo, foco });
    aoAnunciar?.(anuncio ?? `Detalhando ${descreverAlvoDescricao(alvo)}.`);
  }

  // O campo sozinho tambem e clicavel: a matriz destaca a celula de
  // referencia (ou a primeira declarada) e a leitura explica o campo.
  function alternarCampo(linha: LinhaMatriz) {
    const ref =
      linha.referencia?.fonte ??
      linha.celulas.find((c) => c.valor !== undefined)?.fonte ??
      linha.celulas[0]?.fonte;
    if (!ref) return;
    alternarDetalhe(
      { tipo: 'celula', campo: linha.campo, fonte: ref },
      { tipo: 'campo', campo: linha.campo },
    );
  }

  function divergenciaDaLinha(linha: LinhaMatriz) {
    if (!dados) return null;
    const emConflito = (fonte: string) =>
      linha.celulas.some((c) => c.fonte === fonte && c.emConflito);
    return (
      dados.divergencias.find(
        (d) => d.campo === linha.campo && emConflito(d.fonteA) && emConflito(d.fonteB),
      ) ?? null
    );
  }

  const ctxBlocos = {
    projecao: dados,
    focoAtivo,
    aoAlternarFoco: (alvo: AlvoFocoGenUI, rotulo: string) =>
      alternarDetalhe(alvo, alvo, `Detalhando ${rotulo}.`),
    aoSelecionarPapel: (papel: (typeof PARTES)[number]) => {
      const alvo: AlvoFocoGenUI = { tipo: 'parte', parte: papel };
      alternarDetalhe(alvo, alvo);
    },
  };

  function renderizarSecao(secao: SecaoEvidencia): React.ReactNode {
    switch (secao.tipo) {
      case 'foco': {
        if (!pedidoId || !alvoCard) return null;
        return (
          <section
            key="foco"
            className="ia-evidencia-bloco"
            data-alvo={secao.alvo.tipo}
            aria-label="Foco ativo e leitura detalhada"
          >
            <div className="ia-foco-banner" role="region" aria-label="Item destacado">
              <div className="ia-foco-banner-cab">
                <span className="ia-foco-etiqueta">Destaque ativo</span>
                <button type="button" className="ia-link-limpar" onClick={() => aoFocar(null)}>
                  Limpar
                </button>
              </div>
              <p className="ia-foco-descricao">{descreverAlvoDescricao(alvoCard)}</p>
              <button
                type="button"
                className="botao ia-foco-torre-btn"
                onClick={() => aoAbrirNaTorre(pedidoId, secao.alvo)}
              >
                <IconeExterno />
                <span>{rotuloAbrirNaTorre(secao.alvo)}</span>
              </button>
            </div>
            <DescricaoAoVivo
              key={chaveDescricao(pedidoId, alvoCard, dados?.totalEventos ?? 0)}
              pedidoId={pedidoId}
              alvo={alvoCard}
              dados={dados}
              autoPedir={autoPedirDescricao}
              aoAnunciar={aoAnunciar}
            />
          </section>
        );
      }
      case 'agente': {
        // Com blocos estruturados, eles sao a resposta em formato micro;
        // sem eles, entra o texto da resposta.
        return (
          <section
            key="agente"
            className="ia-evidencia-bloco ev2-bloco-agente"
            aria-label="Última resposta do agente"
          >
            <div className="ia-evidencia-sec-cab">
              <h3>Da última resposta</h3>
            </div>
            {secao.blocos.length > 0 ? (
              <div className="ev2-agente-blocos">
                {secao.blocos.map((bloco, i) => renderizarMicroBloco(bloco, i, ctxBlocos))}
              </div>
            ) : (
              <TextoAgente texto={secao.texto} aoVivo={false} />
            )}
          </section>
        );
      }
      case 'campos': {
        if (!dados || !matriz) return null;
        return (
          <section
            key="campos"
            className="ia-evidencia-bloco"
            aria-label="Mini-matriz de campos vigiados"
          >
            <div className="ia-evidencia-sec-cab">
              <h3>Campos vigiados</h3>
            </div>

            {matriz.fontes.length === 0 ? (
              <p className="ia-evidencia-nota">Nenhum documento com campos declarados ainda.</p>
            ) : (
              <ul className="ia-mini-matriz">
                {matriz.linhas.map((linha) => {
                  const linhaDestacada = linhaNoFoco(linha, focoAtivo);
                  const declaradas = linha.celulas.filter((c) => c.valor !== undefined);
                  const semComparacao = !linha.divergente && declaradas.length < 2;
                  const div = linha.divergente ? divergenciaDaLinha(linha) : null;
                  const alvoDiv: AlvoFocoGenUI | null = div
                    ? {
                        tipo: 'divergencia',
                        campo: div.campo,
                        fonteA: div.fonteA,
                        fonteB: div.fonteB,
                      }
                    : null;

                  return (
                    <li
                      key={linha.campo}
                      className="ia-mini-linha"
                      data-divergente={linha.divergente ? 'true' : undefined}
                      data-foco-linha={linhaDestacada ? 'true' : undefined}
                    >
                      <div className="ia-mini-linha-cab">
                        <button
                          type="button"
                          className="ia-mini-campo ev2-alvo"
                          aria-label={`Detalhar o campo ${rotuloCampo(linha.campo)}`}
                          onClick={() => alternarCampo(linha)}
                        >
                          {rotuloCampo(linha.campo)}
                        </button>
                        {linha.divergente ? (
                          alvoDiv ? (
                            <button
                              type="button"
                              className="estado estado-dv ev2-alvo"
                              aria-pressed={alvoIgual(focoAtivo, alvoDiv)}
                              aria-label={`${rotuloCampo(linha.campo)} diverge entre ${rotuloFonte(alvoDiv.fonteA)} e ${rotuloFonte(alvoDiv.fonteB)}. Detalhar`}
                              onClick={() => alternarDetalhe(alvoDiv, alvoDiv)}
                            >
                              <IconeDiverge />
                              Diverge
                            </button>
                          ) : (
                            <span className="estado estado-dv">
                              <IconeDiverge />
                              Diverge
                            </span>
                          )
                        ) : semComparacao ? (
                          <span className="estado estado-nd">
                            <IconeSemComparacao />1 fonte
                          </span>
                        ) : (
                          <span className="estado estado-ok">
                            <IconeConfere />
                            Confere
                          </span>
                        )}
                      </div>

                      <div className="ia-mini-celulas">
                        {linha.celulas.map((cel) => {
                          const focada = celulaNoFoco(linha.campo, cel, focoAtivo);
                          const emDivergencia = cel.emConflito && !cel.referencia;
                          const delta =
                            emDivergencia && cel.valor !== undefined
                              ? variacao(linha.campo, cel.valor, linha.referencia?.valor)
                              : null;
                          const alvo: AlvoFocoGenUI = {
                            tipo: 'celula',
                            campo: linha.campo,
                            fonte: cel.fonte,
                          };
                          const valorFmt =
                            cel.valor !== undefined
                              ? formatarValor(linha.campo, cel.valor)
                              : 'Não declarado';

                          return (
                            <button
                              key={cel.fonte}
                              type="button"
                              className="ia-mini-cel"
                              data-divergente={emDivergencia ? 'true' : undefined}
                              data-vazia={cel.valor === undefined ? 'true' : undefined}
                              data-foco-ativo={focada ? 'true' : undefined}
                              aria-pressed={focada}
                              aria-label={`${rotuloCampo(linha.campo)}, ${rotuloFonte(cel.fonte)}: ${valorFmt}${delta ? `, variação ${delta}` : ''}`}
                              onClick={() => alternarDetalhe(alvo, alvo)}
                            >
                              <span className="ia-mini-cel-topo">
                                <span className="ia-mini-fonte">{rotuloFonte(cel.fonte)}</span>
                                {delta && <span className="ia-mini-delta mono num">{delta}</span>}
                              </span>
                              <span
                                className={
                                  cel.valor !== undefined ? 'ia-mini-valor mono num' : 'ia-mini-nd'
                                }
                              >
                                {valorFmt}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      }
      case 'partes': {
        if (!dados || !pedidoId) return null;
        return (
          <section key="partes" className="ia-evidencia-bloco" aria-label="Partes afetadas">
            <div className="ia-evidencia-sec-cab">
              <h3>Partes afetadas</h3>
              <span className="ia-evidencia-contador mono num">
                {agruparTarefas(dados.tarefas).length}{' '}
                {agruparTarefas(dados.tarefas).length === 1 ? 'tarefa' : 'tarefas'}
              </span>
            </div>

            {partesComTarefas.length === 0 ? (
              <p className="ia-evidencia-nota">
                Nenhuma ação aberta entre os 5 setores neste pedido.
              </p>
            ) : (
              <ul className="ia-partes-lista">
                {partesComTarefas.map((item) => {
                  const focada = focoAtivo?.tipo === 'parte' && focoAtivo.parte === item.parte;
                  const alvoParte: AlvoFocoGenUI = { tipo: 'parte', parte: item.parte };

                  return (
                    <li
                      key={item.parte}
                      className="ia-parte-item"
                      data-foco-ativo={focada ? 'true' : undefined}
                    >
                      <button
                        type="button"
                        className="ia-parte-foco"
                        aria-pressed={focada}
                        onClick={() => alternarDetalhe(alvoParte, alvoParte)}
                      >
                        <span className="ia-parte-cab">
                          <strong className="ia-parte-nome">{rotuloParte(item.parte)}</strong>
                          <span className="pilula-coord mono num">
                            {item.quantidade} {item.quantidade === 1 ? 'ação' : 'ações'}
                          </span>
                        </span>
                        {item.primeiraAcao && (
                          <span className="ia-parte-resumo">{item.primeiraAcao}</span>
                        )}
                      </button>
                      <button
                        type="button"
                        className="ia-parte-torre"
                        aria-label={`Ver ${rotuloParte(item.parte)} na Torre`}
                        onClick={() => aoAbrirNaTorre(pedidoId, alvoParte)}
                      >
                        <span>Ver na Torre</span>
                        <IconeExterno />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      }
      case 'sinais': {
        if (!dados) return null;
        return (
          <section key="sinais" className="ia-evidencia-bloco" aria-label="Sinais consultivos">
            <div className="ia-evidencia-sec-cab">
              <h3 className="ia-sec-icone">
                <IconeSinal />
                Sinais consultivos
              </h3>
            </div>
            <p className="ia-evidencia-nota">
              Leituras derivadas do registro; não movem a linha do tempo.
            </p>
            <ul className="ev2-sinais">
              {dados.sinais.map((sinal, i) => {
                const alvo: AlvoFocoGenUI = { tipo: 'sinal', indice: i };
                const focado = alvoIgual(focoAtivo, alvo);
                return (
                  <li key={i} className="ev2-sinal-item" data-foco-ativo={focado ? 'true' : undefined}>
                    <button
                      type="button"
                      className="ev2-sinal"
                      aria-pressed={focado}
                      aria-label={`Detalhar o sinal ${rotuloTipoSinal(sinal.tipo)}: ${sinal.resumo}`}
                      onClick={() => alternarDetalhe(alvo, alvo)}
                    >
                      <span className="ev2-sinal-cab">
                        <span className="ev2-sinal-tipo">{rotuloTipoSinal(sinal.tipo)}</span>
                        <span className="ev2-sinal-meta mono num">
                          {rotuloFonte(sinal.fonte)} · {formatarConfianca(sinal.confianca)}
                        </span>
                      </span>
                      <span className="ev2-sinal-resumo">{sinal.resumo}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      }
    }
  }

  return (
    <aside
      ref={painelRef}
      id={id}
      className={ehGaveta ? 'ia-evidencia ia-evidencia-gaveta' : 'ia-evidencia'}
      data-fase={ehGaveta ? faseGaveta : undefined}
      role={ehGaveta ? 'dialog' : undefined}
      aria-modal={ehGaveta ? 'true' : undefined}
      aria-label="Evidências ao vivo do pedido"
    >
      <div className="ia-evidencia-cab">
        <div className="ia-evidencia-cab-topo">
          <h2 className="ia-evidencia-titulo">Evidências do registro</h2>
          {aoFechar && (
            <button
              ref={fecharBtnRef}
              type="button"
              className="botao-fechar"
              aria-label="Recolher painel de evidências"
              onClick={aoFechar}
            >
              <IconeFechar />
            </button>
          )}
        </div>

        {!pedidoId && (
          <p className="ia-evidencia-nota">
            Selecione um pedido no cabeçalho para inspecionar os campos vigiados.
          </p>
        )}

        {pedidoId && projecao.estado === 'carregando' && (
          <p className="ia-evidencia-nota" role="status">
            Carregando registro do pedido {codigoCurtoPedido(pedidoId)}…
          </p>
        )}

        {pedidoId && projecao.estado === 'erro' && (
          <p className="aviso-erro" role="alert">
            {projecao.mensagem}
          </p>
        )}

        {pedidoId && dados && (
          <div className="ia-evidencia-identidade">
            <div className="ia-evidencia-meta-linha">
              <span className="ia-evidencia-codigo mono num">
                Pedido {codigoCurtoPedido(pedidoId)}
              </span>
              {daSessao && <span className="ia-evidencia-sessao">Sua sessão</span>}
            </div>
            {dados.pedido && (
              <p className="ia-evidencia-rota">
                {dados.pedido.emitente.nome} → {dados.pedido.destinatario.nome}
              </p>
            )}
          </div>
        )}
      </div>

      {secoes.map(renderizarSecao)}

      {!pedidoId && secoes.length === 0 && (
        <p className="ia-evidencia-nota" style={{ padding: '0 4px' }}>
          Sem pedido em foco, esta coluna mostra a última resposta do assistente.
        </p>
      )}
    </aside>
  );
}
