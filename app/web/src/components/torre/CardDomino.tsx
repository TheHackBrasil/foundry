import type {
  AlvoFocoGenUI,
  CampoVigiado,
  Divergencia,
  Parte,
  Tarefa,
} from '../../../../shared/model.ts';
import { GrafoDomino } from '../GrafoDomino.tsx';

interface CardDominoProps {
  divergencias: readonly Divergencia[];
  tarefas: readonly Tarefa[];
  modoSimulacao: boolean;
  camposFoco?: CampoVigiado[];
  partesFoco?: Parte[];
  aoFocar: (alvo: AlvoFocoGenUI | null, origem?: readonly [number, number]) => void;
  aoSelecionarPapel: (parte: Parte) => void;
}

export function CardDomino({
  divergencias,
  tarefas,
  modoSimulacao,
  camposFoco,
  partesFoco,
  aoFocar,
  aoSelecionarPapel,
}: CardDominoProps) {
  return (
    <GrafoDomino
      divergencias={divergencias}
      tarefas={tarefas}
      modo={modoSimulacao ? 'simulacao' : 'atual'}
      {...(camposFoco ? { camposFoco } : {})}
      {...(partesFoco ? { partesFoco } : {})}
      aoFocar={aoFocar}
      aoSelecionarPapel={aoSelecionarPapel}
    />
  );
}
