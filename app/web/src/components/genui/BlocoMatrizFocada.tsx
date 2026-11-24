import type {
  AlvoFocoGenUI,
  BlocoGenUI,
} from '../../../../shared/model.ts';
import { rotuloCampo, rotuloFonte } from '../../format.ts';
import { alvoIgual, estiloEntradaBloco } from './helpers.ts';
import type { AoAlternarFoco } from './tipos.ts';

export interface BlocoMatrizFocadaProps {
  bloco: Extract<BlocoGenUI, { tipo: 'matriz_focada' }>;
  indice: number;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
}

export function BlocoMatrizFocada({
  bloco,
  indice,
  focoAtivo,
  aoAlternarFoco,
}: BlocoMatrizFocadaProps) {
  return (
    <article
      className="palco-bloco palco-bloco-largo"
      data-bloco-tipo={bloco.tipo}
      data-matriz-bloco={bloco.id}
      data-matriz-idx={indice}
      aria-label={bloco.titulo}
      style={estiloEntradaBloco(indice)}
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
