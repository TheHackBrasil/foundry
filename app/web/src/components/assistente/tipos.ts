import type {
  BlocoGenUI,
  ProjecaoPedido,
  ResultadoAgente,
  StatusExecucaoTool,
  ViewSpecV2,
} from '../../../../shared/model.ts';
import type { ResultadoMandatoInterpretado } from '../../mandato.ts';
import type { EtapaStreamGenUI } from '../PalcoGenUI.tsx';

export type TipoPartida = 'rota' | 'simular' | 'fiscal' | 'despacho' | 'carga' | 'cd';

export interface PartidaSugerida {
  readonly icone: TipoPartida;
  readonly comando: string;
  readonly apoio: string;
}

export interface PontoTela {
  readonly x: number;
  readonly y: number;
}

// Linha da trilha de ferramentas do agente: o evento 'tool' do SSE nao traz
// id de chamada, entao a identidade local combina nome e posicao de chegada.
export interface ToolTurnoIA {
  id: string;
  nome: string;
  resumo: string;
  status: StatusExecucaoTool;
}

export interface TurnoIA {
  id: string;
  comando: string;
  pedidoId: string;
  criadoEm: string;
  carregando: boolean;
  etapas: EtapaStreamGenUI[];
  blocosStream: BlocoGenUI[];
  viewSpec: ViewSpecV2 | null;
  interpretado: ResultadoMandatoInterpretado | null;
  textoAgente: string;
  tools: ToolTurnoIA[];
  agente: ResultadoAgente | null;
  projecaoSnapshot: ProjecaoPedido | null;
  autoForkAplicado: boolean;
  erro: { mensagem: string; status: number; motivo?: string } | null;
}

export const PARTIDAS_DIVERGENTE: readonly PartidaSugerida[] = [
  {
    icone: 'rota',
    comando: 'Qual o atraso real e quem é impactado?',
    apoio: 'Resumo e mapa por setor',
  },
  {
    icone: 'simular',
    comando: 'Simule a entrega para 28/01/2026',
    apoio: 'Impacto sem gravar no registro',
  },
  {
    icone: 'fiscal',
    comando: 'Mostre a visão e as ações do Fiscal',
    apoio: 'Conflitos e fila do Fiscal',
  },
  {
    icone: 'despacho',
    comando: 'Avise a transportadora sobre a divergência',
    apoio: 'Rascunho revisável para envio',
  },
];

export const PARTIDAS_CONSISTENTE: readonly PartidaSugerida[] = [
  {
    icone: 'rota',
    comando: 'Resuma o pedido e verifique pendências',
    apoio: 'Síntese dos campos vigiados',
  },
  {
    icone: 'simular',
    comando: 'Simule a entrega para 28/01/2026',
    apoio: 'Setores acionados em atraso',
  },
  {
    icone: 'carga',
    comando: 'Confira peso e volumes entre NF-e e CT-e',
    apoio: 'Valores declarados por fonte',
  },
  {
    icone: 'cd',
    comando: 'Mostre a visão e as ações do CD',
    apoio: 'Recebimento, volumes e janela',
  },
];
