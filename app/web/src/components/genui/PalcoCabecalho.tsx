import type { ReactNode } from 'react';
import { IconeFechar } from '../icones.tsx';

export interface PalcoCabecalhoProps {
  titulo: string;
  justificativa?: string;
  seloOrigem: ReactNode;
  temFoco: boolean;
  aoLimparFoco: () => void;
  recolhido: boolean;
  aoAlternarRecolhido: () => void;
  aoFechar?: () => void;
}

export function PalcoCabecalho({
  titulo,
  justificativa,
  seloOrigem,
  temFoco,
  aoLimparFoco,
  recolhido,
  aoAlternarRecolhido,
  aoFechar,
}: PalcoCabecalhoProps) {
  return (
    <header className="palco-cab">
      <div className="palco-cab-texto">
        <div className="palco-cab-linha">
          <h2>{titulo}</h2>
          {seloOrigem}
        </div>
        {justificativa && <p className="meta">{justificativa}</p>}
      </div>

      <div className="palco-cab-acoes">
        {temFoco && (
          <button type="button" className="botao-sutil" onClick={aoLimparFoco}>
            Limpar destaque
          </button>
        )}
        <button
          type="button"
          className="botao-sutil"
          onClick={() => {
            if (aoFechar) aoFechar();
            else aoAlternarRecolhido();
          }}
          aria-expanded={aoFechar ? true : !recolhido}
        >
          {aoFechar ? (
            <>
              <IconeFechar />
              Recolher
            </>
          ) : recolhido ? (
            'Expandir'
          ) : (
            'Recolher'
          )}
        </button>
      </div>
    </header>
  );
}
