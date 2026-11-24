import type { ReactNode } from 'react';
import { IconeConfere } from '../icones.tsx';
import type { EtapaStreamGenUI } from './tipos.ts';

export interface PalcoTrilhaVivaProps {
  etapas: readonly EtapaStreamGenUI[];
  slotLoader?: ReactNode;
}

export function PalcoTrilhaViva({ etapas, slotLoader }: PalcoTrilhaVivaProps) {
  return (
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
  );
}
