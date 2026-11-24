import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  ProjecaoPedido,
} from '../../../../shared/model.ts';
import {
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  variacao,
} from '../../format.ts';
import { IconeSeta } from '../icones.tsx';
import {
  alvoIgual,
  calcularProporcaoDesvio,
  estiloEntradaBloco,
  lerValorFonte,
} from './helpers.ts';
import type { AoAlternarFoco } from './tipos.ts';

export interface BlocoComparadorConflitoProps {
  bloco: Extract<BlocoGenUI, { tipo: 'comparador_conflito' }>;
  indice: number;
  projecao: ProjecaoPedido;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
}

export function BlocoComparadorConflito({
  bloco,
  indice,
  projecao,
  focoAtivo,
  aoAlternarFoco,
}: BlocoComparadorConflitoProps) {
  const dadoA = lerValorFonte(projecao, bloco.fonteA, bloco.campo);
  const dadoB = lerValorFonte(projecao, bloco.fonteB, bloco.campo);
  const delta = variacao(bloco.campo, dadoB.valor, dadoA.valor);
  const proporcao = calcularProporcaoDesvio(bloco.campo, dadoA.valor, dadoB.valor);

  const alvoA: AlvoFocoGenUI = { tipo: 'celula', campo: bloco.campo, fonte: bloco.fonteA };
  const alvoB: AlvoFocoGenUI = { tipo: 'celula', campo: bloco.campo, fonte: bloco.fonteB };

  return (
    <article
      className="palco-bloco"
      data-bloco-tipo={bloco.tipo}
      data-matriz-bloco={bloco.id}
      data-matriz-idx={indice}
      aria-label={bloco.titulo}
      style={estiloEntradaBloco(indice)}
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
