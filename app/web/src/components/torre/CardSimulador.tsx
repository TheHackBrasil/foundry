import { memo } from 'react';
import type {
  CamposObservados,
  RespostaSimulacao,
  VersaoPedido,
} from '../../../../shared/model.ts';
import { SimuladorVivo } from '../SimuladorVivo.tsx';

interface CardSimuladorProps {
  pedidoId: string;
  versoes: readonly VersaoPedido[];
  daSessao: boolean;
  aoResultadoSimulacao: (
    res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null,
  ) => void;
  aoAplicarNaSessao: (hipotese: CamposObservados) => Promise<void> | void;
  aoAnunciar: (texto: string) => void;
}

// O simulador vive na mesma célula do tiling que os outros cards; o resultado
// segue alimentando o modo simulação do grafo e da matriz via aoResultado.
export const CardSimulador = memo(function CardSimulador({
  pedidoId,
  versoes,
  daSessao,
  aoResultadoSimulacao,
  aoAplicarNaSessao,
  aoAnunciar,
}: CardSimuladorProps) {
  return (
    <SimuladorVivo
      pedidoId={pedidoId}
      versoes={versoes}
      daSessao={daSessao}
      aoResultadoSimulacao={aoResultadoSimulacao}
      aoAplicarNaSessao={aoAplicarNaSessao}
      aoAnunciar={aoAnunciar}
    />
  );
});
