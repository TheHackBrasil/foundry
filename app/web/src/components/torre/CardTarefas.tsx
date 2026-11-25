import { memo } from 'react';
import type {
  AlvoFocoGenUI,
  CampoVigiado,
  Contato,
  Parte,
  Tarefa,
} from '../../../../shared/model.ts';
import type { FiltroParte } from '../../matriz.ts';
import { TarefasPorParte } from '../TarefasPorParte.tsx';

interface CardTarefasProps {
  tarefas: readonly Tarefa[];
  contatos: readonly Contato[];
  filtro: FiltroParte;
  novas: ReadonlySet<string>;
  direcao: -1 | 0 | 1;
  painelId: string;
  rotuloAbaId: string;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar: (alvo: AlvoFocoGenUI | null, origem?: readonly [number, number]) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
}

export const CardTarefas = memo(function CardTarefas({
  tarefas,
  contatos,
  filtro,
  novas,
  direcao,
  painelId,
  rotuloAbaId,
  focoAtivo,
  aoFocar,
  aoNotificar,
  aoAbrirAgenda,
}: CardTarefasProps) {
  return (
    <TarefasPorParte
      tarefas={tarefas}
      contatos={contatos}
      filtro={filtro}
      novas={novas}
      direcao={direcao}
      painelId={painelId}
      rotuloAbaId={rotuloAbaId}
      focoAtivo={focoAtivo}
      aoFocar={aoFocar}
      aoNotificar={aoNotificar}
      aoAbrirAgenda={aoAbrirAgenda}
    />
  );
});
