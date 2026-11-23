// Divergencia entre fontes (spec 0004, RF10): diverge quando duas
// fontes declaram valores diferentes para o mesmo campo vigiado.

import {
  CAMPOS_VIGIADOS,
  type CamposObservados,
  type Divergencia,
  type FonteDocumento,
  type VersaoPedido,
} from './model.js';

export interface FonteCampos {
  fonte: FonteDocumento;
  campos: CamposObservados;
}

const TOLERANCIA_PESO_KG = 0.01;

// Comparacao unica de campo vigiado (exportada para o "e se?" da API, RF10):
// peso diverge acima da tolerancia, o resto e igualdade estrita.
export function diverge(campo: string, a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return false;
  if (campo === 'pesoTotal') {
    return Math.abs(Number(a) - Number(b)) > TOLERANCIA_PESO_KG;
  }
  return a !== b;
}

// Compara duas fontes e devolve as divergencias campo a campo.
export function compararFontes(a: FonteCampos, b: FonteCampos): Divergencia[] {
  const out: Divergencia[] = [];
  for (const campo of CAMPOS_VIGIADOS) {
    const va = a.campos[campo];
    const vb = b.campos[campo];
    if (diverge(campo, va, vb)) {
      out.push({ campo, fonteA: a.fonte, fonteB: b.fonte, valorA: va, valorB: vb });
    }
  }
  return out;
}

// Compara a fonte nova com o estado mais recente de cada outra fonte.
// Divergencia entre a fonte nova e ela mesma nao existe.
export function divergenciasDaNovaFonte(
  nova: FonteCampos,
  existentes: FonteCampos[],
): Divergencia[] {
  return existentes
    .filter((f) => f.fonte !== nova.fonte)
    .flatMap((f) => compararFontes(f, nova));
}

// "E se?" deterministico (RF10/RF12): a hipotese ('manual') e comparada campo
// a campo com o valor atual, usando a mesma regra e a tolerancia de
// compararFontes. fonteA e a fonte real do valor atual: a ultima versao que
// declarou o campo na linha do tempo do pedido.
export function simularHipotese(
  versoes: Array<Pick<VersaoPedido, 'fonte' | 'campos'>>,
  hipotese: CamposObservados,
): Divergencia[] {
  const out: Divergencia[] = [];
  for (const campo of CAMPOS_VIGIADOS) {
    const novo = hipotese[campo];
    if (novo === undefined) continue;
    let fonteA: FonteDocumento | undefined;
    let valorA: unknown;
    for (const v of versoes) {
      const declarado = v.campos[campo];
      if (declarado !== undefined) {
        fonteA = v.fonte;
        valorA = declarado;
      }
    }
    if (fonteA === undefined) continue;
    if (diverge(campo, valorA, novo)) {
      out.push({ campo, fonteA, fonteB: 'manual', valorA, valorB: novo });
    }
  }
  return out;
}
