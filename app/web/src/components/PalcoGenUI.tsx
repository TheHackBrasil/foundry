import { useEffect, useState } from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CamposObservados,
  RespostaSimulacao,
} from '../../../shared/model.ts';
import { garantirEstilosOps } from '../apiOps.ts';
import { GrafoDomino } from './GrafoDomino.tsx';
import { SimuladorVivo } from './SimuladorVivo.tsx';
import { IconeDiverge } from './icones.tsx';
import { PalcoCabecalho } from './genui/PalcoCabecalho.tsx';
import { PalcoFollowUps } from './genui/PalcoFollowUps.tsx';
import { PalcoTrilhaViva } from './genui/PalcoTrilhaViva.tsx';
import { alvoIgual, blocoEhLargo, estiloEntradaBloco } from './genui/helpers.ts';
import { renderizarBlocoPadrao, type ContextoBlocoPadrao } from './genui/renderizarBlocoPadrao.tsx';
import type { PalcoGenUIProps } from './genui/tipos.ts';

export type { EtapaStreamGenUI, PalcoGenUIProps } from './genui/tipos.ts';

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
  ocultarTrilha = false,
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
      limparFoco();
    } else {
      aoFocar(alvo);
      aoAnunciar(`Destacando ${rotulo}.`);
    }
  }

  function limparFoco() {
    aoFocar(null);
    aoAnunciar('Destaque removido.');
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

  const ctxBloco: ContextoBlocoPadrao = {
    projecao,
    contatos,
    focoAtivo,
    aoAlternarFoco: alternarFoco,
    aoSelecionarPapel,
    aoNotificar,
    aoAbrirAgenda,
    aoAnunciar,
  };

  // domino_impacto e simulador_interativo permanecem aqui: consomem simLive e
  // a sessao diretamente; os demais blocos despacham para genui/.
  function renderizarBloco(bloco: BlocoGenUI, indice: number) {
    switch (bloco.tipo) {
      case 'domino_impacto': {
        const usarSim = bloco.modo === 'simulacao' && simLive !== null;
        return (
          <article
            key={bloco.id}
            className="palco-bloco palco-bloco-largo"
            data-bloco-tipo={bloco.tipo}
            data-matriz-bloco={bloco.id}
            data-matriz-idx={indice}
            aria-label={bloco.titulo}
            style={estiloEntradaBloco(indice)}
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

      case 'simulador_interativo':
        return (
          <article
            key={bloco.id}
            className="palco-bloco palco-bloco-largo"
            data-bloco-tipo={bloco.tipo}
            data-matriz-bloco={bloco.id}
            data-matriz-idx={indice}
            aria-label={bloco.titulo}
            style={estiloEntradaBloco(indice)}
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

      default:
        return renderizarBlocoPadrao(bloco, indice, ctxBloco);
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
      <PalcoCabecalho
        titulo={titulo}
        justificativa={spec?.justificativa}
        seloOrigem={seloOrigem}
        temFoco={focoAtivo !== null}
        aoLimparFoco={limparFoco}
        recolhido={recolhidoLocal}
        aoAlternarRecolhido={() => setRecolhidoLocal((r) => !r)}
        aoFechar={aoFechar}
      />

      {carregando && !ocultarTrilha && (
        <PalcoTrilhaViva etapas={etapas} slotLoader={slotLoader} />
      )}

      {(blocosAtivos.length > 0 || (spec && spec.followUps.length > 0)) && (
        <div
          className="palco-curtain"
          data-recolhido={recolhidoLocal ? 'true' : 'false'}
          aria-hidden={recolhidoLocal || undefined}
        >
          <div className="palco-curtain-inner">
            {blocosAtivos.length > 0 && (
              <div
                className="palco-grid"
                style={
                  compactosCount === 1 ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined
                }
              >
                {blocosAtivos.map((bloco, idx) => renderizarBloco(bloco, idx))}
              </div>
            )}

            {spec && (
              <PalcoFollowUps
                followUps={spec.followUps}
                recolhido={recolhidoLocal}
                aoExecutarComando={aoExecutarComando}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
