import type { CSSProperties } from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  FonteDocumento,
  ProjecaoPedido,
} from '../../../../shared/model.ts';
import { formatarValor } from '../../format.ts';

export function alvoIgual(a: AlvoFocoGenUI | null, b: AlvoFocoGenUI | null): boolean {
  if (!a || !b || a.tipo !== b.tipo) return false;
  switch (a.tipo) {
    case 'celula':
      return b.tipo === 'celula' && a.campo === b.campo && a.fonte === b.fonte;
    case 'divergencia':
      return (
        b.tipo === 'divergencia' &&
        a.campo === b.campo &&
        a.fonteA === b.fonteA &&
        a.fonteB === b.fonteB
      );
    case 'parte':
      return b.tipo === 'parte' && a.parte === b.parte;
    case 'versao':
      return b.tipo === 'versao' && a.versao === b.versao;
    case 'sinal':
      return b.tipo === 'sinal' && a.indice === b.indice;
  }
}

export function blocoEhLargo(bloco: BlocoGenUI): boolean {
  return (
    bloco.tipo === 'domino_impacto' ||
    bloco.tipo === 'simulador_interativo' ||
    bloco.tipo === 'cartoes_despacho' ||
    bloco.tipo === 'matriz_focada'
  );
}

export function lerValorFonte(
  projecao: ProjecaoPedido,
  fonte: FonteDocumento,
  campo: CampoVigiado,
): { valor: unknown; versao?: number; em?: string } {
  const ordenadas = [...projecao.versoes].sort((a, b) => a.versao - b.versao);
  let encontrado: { valor: unknown; versao?: number; em?: string } = { valor: undefined };
  for (const v of ordenadas) {
    if (v.fonte === fonte && v.campos[campo] !== undefined) {
      encontrado = { valor: v.campos[campo], versao: v.versao, em: v.geradaEm };
    }
  }
  if (encontrado.valor !== undefined) return encontrado;
  for (const d of projecao.divergencias) {
    if (d.campo !== campo) continue;
    if (d.fonteA === fonte) return { valor: d.valorA };
    if (d.fonteB === fonte) return { valor: d.valorB };
  }
  return encontrado;
}

export function calcularProporcaoDesvio(
  campo: CampoVigiado,
  valA: unknown,
  valB: unknown,
): { pctA: number; pctB: number; legenda: string } | null {
  if (valA === undefined || valB === undefined) return null;
  if (campo === 'pesoTotal' || campo === 'volumes') {
    const a = Number(valA);
    const b = Number(valB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a <= 0 && b <= 0)) return null;
    const total = a + b;
    return {
      pctA: Math.max(8, Math.min(92, (a / total) * 100)),
      pctB: Math.max(8, Math.min(92, (b / total) * 100)),
      legenda: `Proporção entre ${formatarValor(campo, valA)} e ${formatarValor(campo, valB)}`,
    };
  }
  if (campo === 'previsaoEntrega') {
    const ta = Date.parse(`${String(valA).slice(0, 10)}T00:00:00Z`);
    const tb = Date.parse(`${String(valB).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
    const dias = Math.abs(Math.round((tb - ta) / 86_400_000));
    if (dias === 0) return null;
    const pctDesvio = Math.max(14, Math.min(82, Math.round((dias / 20) * 100)));
    return {
      pctA: 100 - pctDesvio,
      pctB: pctDesvio,
      legenda: `Desvio de ${dias} ${dias === 1 ? 'dia' : 'dias'} sobre a referência`,
    };
  }
  return null;
}

// A cascata de entrada do palco usa no maximo 5 degraus de atraso, entao
// --bloco-i e limitado a 4; o indice real do bloco segue em data-matriz-idx.
export function estiloEntradaBloco(indice: number): CSSProperties {
  return { '--bloco-i': Math.min(indice, 4) } as CSSProperties;
}
