import { memo } from 'react';
import type { AlvoFocoGenUI, FonteDocumento } from '../../../../shared/model.ts';
import { formatarValor, rotuloCampo, rotuloFonte, variacao } from '../../format.ts';
import type { LinhaMatriz, Matriz } from '../../matriz.ts';
import { IconeConfere, IconeDiverge } from '../icones.tsx';
import { MatrizFontes, type TrilhoFonte } from '../MatrizFontes.tsx';

interface CardMatrizProps {
  matriz: Matriz;
  trilhos: readonly TrilhoFonte[];
  aoAlternarTrilho: (fonte: FonteDocumento) => void;
  destacar: boolean;
  carregandoLente: boolean;
  assinaturaLente: string;
  direcaoLente: -1 | 0 | 1;
  pulsoDomino: number;
  origemDomino: readonly [number, number];
  pulsoRefracao: number;
  modoSimulacao: boolean;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar: (alvo: AlvoFocoGenUI | null, origem?: readonly [number, number]) => void;
}

// Resumo das divergências ativas da matriz exibida (veio do PainelPedido).
function Resumo({ linhas }: { linhas: readonly LinhaMatriz[] }) {
  const divergentes = linhas.filter((l) => l.divergente);
  if (divergentes.length === 0) {
    return (
      <p className="resumo-mx sem-diverge">
        <IconeConfere />
        <span>Nenhum campo diverge entre as fontes declaradas.</span>
      </p>
    );
  }
  return (
    <p className="resumo-mx">
      <IconeDiverge />
      <span>
        <strong>
          {divergentes.length} {divergentes.length === 1 ? 'campo diverge' : 'campos divergem'}.
        </strong>{' '}
        {divergentes.map((l) => {
          const ref = l.referencia;
          const outras = l.celulas.filter((c) => c.emConflito && !c.referencia);
          return (
            <span key={l.campo}>
              {rotuloCampo(l.campo)}:{' '}
              {outras.length === 0 ? (
                <span>diverge em fonte recolhida</span>
              ) : (
                outras.map((c, i) => {
                  const delta = variacao(l.campo, c.valor, ref?.valor);
                  return (
                    <span key={c.fonte}>
                      {i > 0 && '; '}
                      {rotuloFonte(c.fonte)} indica {formatarValor(l.campo, c.valor)}
                      {ref && ` e ${rotuloFonte(ref.fonte)}, ${formatarValor(l.campo, ref.valor)}`}
                      {delta && ` (${delta})`}
                    </span>
                  );
                })
              )}
              .{' '}
            </span>
          );
        })}
      </span>
    </p>
  );
}

export const CardMatriz = memo(function CardMatriz({
  matriz,
  trilhos,
  aoAlternarTrilho,
  destacar,
  carregandoLente,
  assinaturaLente,
  direcaoLente,
  pulsoDomino,
  origemDomino,
  pulsoRefracao,
  modoSimulacao,
  focoAtivo,
  aoFocar,
}: CardMatrizProps) {
  return (
    <>
      <MatrizFontes
        matriz={matriz}
        trilhos={trilhos}
        aoAlternarTrilho={aoAlternarTrilho}
        destacar={destacar}
        carregandoLente={carregandoLente}
        assinaturaLente={assinaturaLente}
        direcaoLente={direcaoLente}
        pulsoDomino={pulsoDomino}
        origemDomino={origemDomino}
        pulsoRefracao={pulsoRefracao}
        modoSimulacao={modoSimulacao}
        focoAtivo={focoAtivo}
        aoFocar={aoFocar}
      />
      {matriz.fontes.length > 0 && <Resumo linhas={matriz.linhas} />}
    </>
  );
});
