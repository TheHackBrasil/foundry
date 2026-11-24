import type { AlvoFocoGenUI, CampoVigiado, Contato, Parte, ProjecaoPedido } from '../../shared/model.ts';
import type { PedidoResumo } from './api.ts';
import type { Carga } from './useTorre.ts';

export interface PaginaAssistenteIAProps {
  pedidos: readonly PedidoResumo[];
  pedidoId: string | null;
  projecao: Carga<ProjecaoPedido>;
  contatos: readonly Contato[];
  comandoInicial?: string | null;
  aoConsumirComandoInicial?: () => void;
  aoSelecionarPedido: (pedidoId: string) => void;
  aoAbrirNaTorre: (pedidoId: string, foco?: AlvoFocoGenUI | null) => void;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoGarantirSessao: (pedidoId?: string | null) => Promise<string | null>;
  aoNotificar: (pedidoId: string, parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoRecarregarPedido: () => Promise<void>;
  aoAnunciar: (texto: string) => void;
}
