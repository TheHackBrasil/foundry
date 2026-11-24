import type { Parte, ViewSpec, ViewSpecV2 } from '../../shared/model.ts';

// A chave inclui totalEventos: quando o SSE entrega um documento novo no pedido,
// o cache invalida automaticamente e a lente nao oculta a fonte recem-chegada.
export function chaveCacheLente(pedidoId: string, papel: Parte | 'operacao', totalEventos: number): string {
  return `${pedidoId}|${papel}|${totalEventos}`;
}

export interface CacheLente<T = ViewSpec> {
  obter(chave: string): T | undefined;
  guardar(chave: string, spec: T): void;
  limpar(): void;
}

export function criarCacheLente<T = ViewSpec>(limite = 32): CacheLente<T> {
  const mapa = new Map<string, T>();
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
export const cacheLente = criarCacheLente<ViewSpec>(32);
export const cacheLenteV2 = criarCacheLente<ViewSpecV2>(32);
