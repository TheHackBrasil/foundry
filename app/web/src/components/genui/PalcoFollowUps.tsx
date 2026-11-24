import type { CSSProperties } from 'react';
import type { FollowUpContextual } from '../../../../shared/model.ts';

export interface PalcoFollowUpsProps {
  followUps: readonly FollowUpContextual[];
  recolhido: boolean;
  aoExecutarComando: (texto: string) => void;
}

export function PalcoFollowUps({
  followUps,
  recolhido,
  aoExecutarComando,
}: PalcoFollowUpsProps) {
  if (followUps.length === 0) return null;
  return (
    <nav className="palco-followups" aria-label="Próximas ações sugeridas">
      <span className="meta">Continuar:</span>
      {followUps.map((f, i) => (
        <button
          key={`${f.comando}-${i}`}
          type="button"
          className="chip palco-followup-chip"
          data-intencao={f.intencao}
          style={{ '--chip-i': Math.min(i, 6) } as CSSProperties}
          tabIndex={recolhido ? -1 : undefined}
          onClick={() => aoExecutarComando(f.comando)}
        >
          {f.rotulo}
        </button>
      ))}
    </nav>
  );
}
