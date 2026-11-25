// Verificacao DKIM (spec 0010, RF9): a assinatura do dominio remetente e a
// evidencia de que o .eml saiu do dominio declarado — o que diferencia
// "registramos que alguem disse" de "a transportadora declarou e assinou".
// 'pass' segue o fluxo normal; 'fail'/'ausente' limita a confianca do claim
// a 0.6 e manda para revisao (US5).

import { dkimVerify } from 'mailauth';

export type ResultadoDkim = 'pass' | 'fail' | 'ausente';

export interface DkimResult {
  resultado: ResultadoDkim;
  // Dominio assinante (d=) quando a assinatura passou: e a parte autenticada.
  assinante?: string;
}

// Resolver DNS injetavel para teste: assina e verifica com a mesma chave.
export type ResolverDns = (name: string, rr: string) => Promise<unknown>;

export async function verificarDkim(raw: Buffer | string, resolver?: ResolverDns): Promise<DkimResult> {
  let res: Awaited<ReturnType<typeof dkimVerify>>;
  try {
    res = await dkimVerify(raw, resolver ? { resolver: resolver as never } : {});
  } catch {
    return { resultado: 'fail' };
  }
  const results = res?.results ?? [];
  if (results.length === 0) return { resultado: 'ausente' };
  const melhor =
    results.find((r) => r.status?.result === 'pass') ?? results[0]!;
  if (melhor.status?.result !== 'pass') return { resultado: 'fail' };
  // O dominio assinante sai em status.aligned (d= validado e alinhado ao From)
  // ou no i= da assinatura ('@dominio'). signature e o valor cru do b=.
  const st = melhor.status as { aligned?: string; header?: { i?: string } };
  const dom = st.aligned ?? st.header?.i?.replace(/^.*@/, '');
  return { resultado: 'pass', ...(dom ? { assinante: dom } : {}) };
}
