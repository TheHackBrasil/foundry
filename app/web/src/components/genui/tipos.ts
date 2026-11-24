import type { ReactNode } from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CamposObservados,
  CampoVigiado,
  Contato,
  Parte,
  ProjecaoPedido,
  RespostaSimulacao,
  ViewSpecV2,
} from '../../../../shared/model.ts';

export interface EtapaStreamGenUI {
  id: string;
  rotulo: string;
  detalhe?: string;
  concluida: boolean;
}

export interface PalcoGenUIProps {
  spec: ViewSpecV2 | null;
  etapas: readonly EtapaStreamGenUI[];
  blocosStream: readonly BlocoGenUI[];
  carregando: boolean;
  projecao: ProjecaoPedido;
  pedidoId: string;
  daSessao: boolean;
  contatos: readonly Contato[];
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar: (alvo: AlvoFocoGenUI | null) => void;
  aoExecutarComando: (texto: string) => void;
  aoSelecionarPapel: (papel: Parte) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoSimularResultado?: (
    res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null,
  ) => void;
  aoAplicarHipotese?: (hipotese: CamposObservados) => Promise<void>;
  aoFechar?: () => void;
  aoAnunciar: (texto: string) => void;
  slotLoader?: ReactNode;
  ocultarTrilha?: boolean;
}

// Contrato entre o palco e os blocos: o bloco informa o alvo e o rotulo a
// anunciar; quem decide liga/desliga do foco e o PalcoGenUI.
export type AoAlternarFoco = (alvo: AlvoFocoGenUI, rotulo: string) => void;
