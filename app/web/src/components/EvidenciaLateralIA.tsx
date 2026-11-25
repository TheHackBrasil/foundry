import { useEffect, useMemo, useRef } from 'react';
import {
  PARTES,
  type AlvoFocoGenUI,
  type CampoVigiado,
  type ProjecaoPedido,
} from '../../../shared/model.ts';
import {
  formatarConfianca,
  formatarMomento,
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
import type { FasePresenca } from '../usePresencaAnimada.ts';
import type { Carga } from '../useTorre.ts';
import { codigoCurtoPedido } from './assistente/conversaUtils.ts';
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

function descreverFoco(foco: AlvoFocoGenUI): string {
  switch (foco.tipo) {
    case 'celula':
      return `${rotuloCampo(foco.campo)} · ${rotuloFonte(foco.fonte)}`;
    case 'divergencia':
      return `${rotuloCampo(foco.campo)} (${rotuloFonte(foco.fonteA)} × ${rotuloFonte(foco.fonteB)})`;
    case 'parte':
      return `Setor ${rotuloParte(foco.parte)}`;
    case 'versao':
      return `Versão v${foco.versao}`;
    case 'sinal':
      return `Sinal consultivo #${foco.indice + 1}`;
  }
}

function rotuloAbrirNaTorre(foco: AlvoFocoGenUI): string {
  switch (foco.tipo) {
    case 'celula':
    case 'divergencia':
      return 'Abrir esta célula na Torre';
    case 'parte':
      return 'Abrir este setor na Torre';
    case 'versao':
      return 'Abrir esta versão na Torre';
    case 'sinal':
      return 'Abrir este sinal na Torre';
  }
}

function chaveFoco(foco: AlvoFocoGenUI | null): string {
  if (!foco) return '';
  switch (foco.tipo) {
    case 'celula':
      return `celula:${foco.campo}:${foco.fonte}`;
    case 'divergencia':
      return `divergencia:${foco.campo}:${foco.fonteA}:${foco.fonteB}`;
    case 'parte':
      return `parte:${foco.parte}`;
    case 'versao':
      return `versao:${foco.versao}`;
    case 'sinal':
      return `sinal:${foco.indice}`;
  }
}

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
}: EvidenciaLateralIAProps) {
  const painelRef = useRef<HTMLElement>(null);
  const fecharBtnRef = useRef<HTMLButtonElement>(null);
  const assinaturaFoco = chaveFoco(focoAtivo);

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

  const sinalFocado =
    dados && focoAtivo?.tipo === 'sinal' ? (dados.sinais[focoAtivo.indice] ?? null) : null;

  const versaoFocada =
    dados && focoAtivo?.tipo === 'versao'
      ? (dados.versoes.find((v) => v.versao === focoAtivo.versao) ?? null)
      : null;

  function alternarFoco(alvo: AlvoFocoGenUI) {
    aoFocar(alvoIgual(focoAtivo, alvo) ? null : alvo);
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

      {pedidoId && focoAtivo && (
        <div className="ia-foco-banner" role="region" aria-label="Item destacado">
          <div className="ia-foco-banner-cab">
            <span className="ia-foco-etiqueta">Destaque ativo</span>
            <button
              type="button"
              className="ia-link-limpar"
              onClick={() => aoFocar(null)}
            >
              Limpar
            </button>
          </div>
          <p className="ia-foco-descricao">{descreverFoco(focoAtivo)}</p>
          <button
            type="button"
            className="botao ia-foco-torre-btn"
            onClick={() => aoAbrirNaTorre(pedidoId, focoAtivo)}
          >
            <IconeExterno />
            <span>{rotuloAbrirNaTorre(focoAtivo)}</span>
          </button>
        </div>
      )}

      {pedidoId && dados && versaoFocada && (
        <section className="ia-evidencia-bloco ia-evidencia-destaque" data-foco-ativo="true">
          <div className="ia-evidencia-sec-cab">
            <h3>Versão destacada</h3>
            <span className="pilula-coord mono num">v{versaoFocada.versao}</span>
          </div>
          <p className="ia-evidencia-versao-meta">
            <strong>{rotuloFonte(versaoFocada.fonte)}</strong> ·{' '}
            <time className="mono" dateTime={versaoFocada.geradaEm}>
              {formatarMomento(versaoFocada.geradaEm)}
            </time>
          </p>
        </section>
      )}

      {pedidoId && dados && sinalFocado && (
        <section className="ia-evidencia-bloco ia-evidencia-destaque" data-foco-ativo="true">
          <div className="ia-evidencia-sec-cab">
            <h3 className="ia-sec-icone">
              <IconeSinal />
              Sinal consultivo
            </h3>
            <span className="pilula-sutil mono num">
              {formatarConfianca(sinalFocado.confianca)}
            </span>
          </div>
          <p className="ia-evidencia-nota">
            {rotuloTipoSinal(sinalFocado.tipo)} · {rotuloFonte(sinalFocado.fonte)}
          </p>
          <p className="ia-evidencia-sinal-texto">{sinalFocado.resumo}</p>
        </section>
      )}

      {pedidoId && dados && matriz && (
        <section className="ia-evidencia-bloco" aria-label="Mini-matriz de campos vigiados">
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

                return (
                  <li
                    key={linha.campo}
                    className="ia-mini-linha"
                    data-divergente={linha.divergente ? 'true' : undefined}
                    data-foco-linha={linhaDestacada ? 'true' : undefined}
                  >
                    <div className="ia-mini-linha-cab">
                      <span className="ia-mini-campo">{rotuloCampo(linha.campo)}</span>
                      {linha.divergente ? (
                        <span className="estado estado-dv">
                          <IconeDiverge />
                          Diverge
                        </span>
                      ) : semComparacao ? (
                        <span className="estado estado-nd">
                          <IconeSemComparacao />
                          1 fonte
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
                            onClick={() => alternarFoco(alvo)}
                          >
                            <span className="ia-mini-cel-topo">
                              <span className="ia-mini-fonte">{rotuloFonte(cel.fonte)}</span>
                              {delta && <span className="ia-mini-delta mono num">{delta}</span>}
                            </span>
                            <span
                              className={
                                cel.valor !== undefined
                                  ? 'ia-mini-valor mono num'
                                  : 'ia-mini-nd'
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
      )}

      {pedidoId && dados && (
        <section className="ia-evidencia-bloco" aria-label="Partes afetadas">
          <div className="ia-evidencia-sec-cab">
            <h3>Partes afetadas</h3>
            <span className="ia-evidencia-contador mono num">
              {agruparTarefas(dados.tarefas).length}{' '}
              {agruparTarefas(dados.tarefas).length === 1 ? 'tarefa' : 'tarefas'}
            </span>
          </div>

          {partesComTarefas.length === 0 ? (
            <p className="ia-evidencia-nota">Nenhuma ação aberta entre os 5 setores neste pedido.</p>
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
                      onClick={() => alternarFoco(alvoParte)}
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
      )}
    </aside>
  );
}
