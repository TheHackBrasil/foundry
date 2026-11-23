import type { Parte, ViewSpec } from '../../shared/model.ts';

// A chave inclui totalEventos: quando o SSE entrega um documento novo no pedido,
// o cache invalida automaticamente e a lente nao oculta a fonte recem-chegada.
export function chaveCacheLente(pedidoId: string, papel: Parte, totalEventos: number): string {
  return `${pedidoId}|${papel}|${totalEventos}`;
}

export interface CacheLente {
  obter(chave: string): ViewSpec | undefined;
  guardar(chave: string, spec: ViewSpec): void;
  limpar(): void;
}

export function criarCacheLente(limite = 32): CacheLente {
  const mapa = new Map<string, ViewSpec>();
  return {
    obter(chave) {
      return mapa.get(chave);
    },
    guardar(chave, spec) {
      if (mapa.has(chave)) mapa.delete(chave);
      mapa.set(chave, spec);
      while (mapa.size > limite) {
        const maisAntiga = mapa.keys().next().value;
        if (maisAntiga === undefined) break;
        mapa.delete(maisAntiga);
      }
    },
    limpar() {
      mapa.clear();
    },
  };
}

// Vive fora do PainelPedido (que desmonta a cada troca de pedido via key).
export const cacheLente = criarCacheLente(32);
