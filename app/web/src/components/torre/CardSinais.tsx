import type { Notificacao, Sinal } from '../../../../shared/model.ts';
import { SinaisEAvisos } from '../SinaisEAvisos.tsx';

interface CardSinaisProps {
  sinais: readonly Sinal[];
  notificacoes: readonly Notificacao[];
  sinaisNovos: ReadonlySet<string>;
  avisosNovos: ReadonlySet<string>;
}

export function CardSinais({ sinais, notificacoes, sinaisNovos, avisosNovos }: CardSinaisProps) {
  if (sinais.length === 0 && notificacoes.length === 0) {
    return <p className="meta">Nenhum sinal consultivo ou aviso registrado neste pedido.</p>;
  }
  return (
    <SinaisEAvisos
      sinais={sinais}
      notificacoes={notificacoes}
      sinaisNovos={sinaisNovos}
      avisosNovos={avisosNovos}
    />
  );
}
