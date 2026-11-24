import { useMemo, type CSSProperties } from 'react';
import {
  CAMPOS_VIGIADOS,
  type AlvoFocoGenUI,
  type BlocoGenUI,
  type ProjecaoPedido,
} from '../../../../shared/model.ts';
import {
  formatarConfianca,
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloTipoSinal,
} from '../../format.ts';
import { IconeSinal } from '../icones.tsx';
import { alvoIgual, estiloEntradaBloco } from './helpers.ts';
import type { AoAlternarFoco } from './tipos.ts';

export interface BlocoLinhaTempoCausalProps {
  bloco: Extract<BlocoGenUI, { tipo: 'linha_tempo_causal' }>;
  indice: number;
  projecao: ProjecaoPedido;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
}

export function BlocoLinhaTempoCausal({
  bloco,
  indice,
  projecao,
  focoAtivo,
  aoAlternarFoco,
}: BlocoLinhaTempoCausalProps) {
  const versoesOrdenadas = useMemo(
    () => [...projecao.versoes].sort((a, b) => a.versao - b.versao),
    [projecao.versoes],
  );

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
        <ol className="checklist-lista palco-timeline-lista">
          {versoesOrdenadas.map((v, vIdx) => {
            const declarados = CAMPOS_VIGIADOS.filter((c) => v.campos[c] !== undefined);
            const alvo: AlvoFocoGenUI = { tipo: 'versao', versao: v.versao };
            return (
              <li
                key={`${v.fonte}-${v.versao}`}
                className="palco-item-cascata"
                style={{ '--item-i': Math.min(vIdx, 8) } as CSSProperties}
              >
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
            {projecao.sinais.map((sinal, sIdx) => {
              const alvo: AlvoFocoGenUI = { tipo: 'sinal', indice: sIdx };
              const escala = Number.isFinite(sinal.confianca)
                ? Math.min(1, Math.max(0, sinal.confianca))
                : 0;
              return (
                <li key={`${sinal.tipo}-${sinal.fonte}-${sIdx}`}>
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
