import type { PedidoResumo } from '../api.ts';
import type { Carga, RotaTorre } from '../useTorre.ts';
import { MenuWiki } from './menuwiki/MenuWiki.tsx';

interface Props {
  pedidos: Carga<PedidoResumo[]>;
  selecionado: string | null;
  rota: RotaTorre;
  aoTentarDeNovo: () => void;
  aoSelecionarMobile?: () => void;
  // Opcionais para a integracao: ligam Parceiros e Regras aos drawers.
  aoAbrirAgenda?: () => void;
  aoAbrirRevisao?: () => void;
}

// Mount do rail em App.tsx (spec 0014, THE-20): o nome e as props ficam;
// o indice wiki vive em components/menuwiki/.
export function PedidoLista(props: Props) {
  return <MenuWiki {...props} />;
}
