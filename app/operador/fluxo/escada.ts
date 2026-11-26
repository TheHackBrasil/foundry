// Escada do operador (spec 0017, RF2 e RF3): ordem fixa em codigo e decisao
// pura do proximo passo. Sem I/O, sem relogio e sem env: o fluxo passa o
// tempo decorrido, o estado do caso e os prazos ja lidos da politica.

import type { CanalContato } from '../../shared/model.js';

export const CANAIS_ESCADA = ['email', 'whatsapp', 'ligacao'] as const satisfies readonly CanalContato[];

export type CanalEscada = (typeof CANAIS_ESCADA)[number];

// O ultimo degrau devolve o caso ao analista; a IA nunca escolhe a ordem.
export const ORDEM_ESCADA = [...CANAIS_ESCADA, 'analista'] as const;

export type DegrauEscada = (typeof ORDEM_ESCADA)[number];

// Por que um canal ficou de fora: o motivo vai para o evento do operador.
export type MotivoPulo =
  | 'sem_contato'
  | 'contato_seed'
  | 'contato_documento'
  | 'nao_contatar_ia'
  | 'destino_nao_permitido';

export interface PuloDegrau {
  degrau: CanalEscada;
  motivo: MotivoPulo;
}

// Prazo de cada degrau em ms, contado desde que o contato saiu (na ligacao,
// desde o fim da chamada). Ligacao 0: sem declaracao, volta ao analista.
export interface ConfigEscada {
  prazoMs: Readonly<Record<CanalEscada, number>>;
}

const HORA_MS = 3_600_000;

// Monta a config a partir das horas de OPERADOR_PRAZO_EMAIL_H e
// OPERADOR_PRAZO_WHATSAPP_H, lidas fora daqui. Prazo invalido falha cedo.
export function configEscada(horas: { emailH: number; whatsappH: number }): ConfigEscada {
  for (const [nome, h] of Object.entries(horas)) {
    if (!Number.isFinite(h) || h < 0) throw new RangeError(`prazo invalido em ${nome}: ${h}`);
  }
  return { prazoMs: { email: horas.emailH * HORA_MS, whatsapp: horas.whatsappH * HORA_MS, ligacao: 0 } };
}

export interface CanaisEscada {
  canaisDisponiveis: readonly CanalEscada[];
  // Motivo de cada canal fora da lista; sem motivo, vale 'sem_contato'.
  motivosPulo?: Partial<Record<CanalEscada, MotivoPulo>>;
}

export interface EntradaEscada extends CanaisEscada {
  degrau: DegrauEscada;
  // null enquanto o contato do degrau nao saiu (plano esperando o OK,
  // ligacao em curso): o prazo ainda nao corre.
  decorridoMs: number | null;
  // Declaracao nova desde o inicio do prazo: 'em_revisao' pausa a escada
  // (RF18); 'aceita' sem fechar o caso reinicia o prazo do degrau.
  declaracao: 'nenhuma' | 'em_revisao' | 'aceita';
  optout: boolean;
  casoFechado: boolean;
}

export type AcaoEscada = 'manter' | 'pausar' | 'reiniciar' | 'subir' | 'encerrar';

export type MotivoEscada =
  | 'aguardando_contato'
  | 'no_prazo'
  | 'declaracao_em_revisao'
  | 'declaracao_aceita'
  | 'prazo_vencido'
  | 'caso_fechado'
  | 'optout'
  | 'escada_esgotada';

export interface PassoEscada {
  acao: AcaoEscada;
  de: DegrauEscada;
  para: DegrauEscada;
  motivo: MotivoEscada;
  pulos: PuloDegrau[];
  restanteMs?: number; // so em 'manter' com o prazo correndo
  // Plano proposto e passo ainda nao enviado sao cancelados (casos de borda).
  cancelarPendentes: boolean;
}

// Primeiro degrau com contato a partir de `inicio`, registrando cada pulo.
function proximoDisponivel(inicio: number, canais: CanaisEscada): { degrau: DegrauEscada; pulos: PuloDegrau[] } {
  const pulos: PuloDegrau[] = [];
  for (let i = inicio; i < ORDEM_ESCADA.length; i++) {
    const degrau = ORDEM_ESCADA[i] as DegrauEscada;
    if (degrau === 'analista') return { degrau, pulos };
    if (canais.canaisDisponiveis.includes(degrau)) return { degrau, pulos };
    pulos.push({ degrau, motivo: canais.motivosPulo?.[degrau] ?? 'sem_contato' });
  }
  return { degrau: 'analista', pulos };
}

// Degrau em que o operador comeca ao assumir o caso.
export function degrauInicial(canais: CanaisEscada): { degrau: DegrauEscada; pulos: PuloDegrau[] } {
  return proximoDisponivel(0, canais);
}

// Ordem das checagens: caso fechado, opt-out, fim da escada, declaracao nova,
// contato ainda nao saiu, prazo. So o prazo vencido sobe de degrau.
export function proximoPasso(entrada: EntradaEscada, config: ConfigEscada): PassoEscada {
  const de = entrada.degrau;
  const passo = (
    acao: AcaoEscada,
    para: DegrauEscada,
    motivo: MotivoEscada,
    extra: Partial<PassoEscada> = {},
  ): PassoEscada => ({
    acao,
    de,
    para,
    motivo,
    pulos: [],
    cancelarPendentes: acao !== 'manter' && acao !== 'subir',
    ...extra,
  });

  if (entrada.casoFechado) return passo('encerrar', de, 'caso_fechado');
  if (entrada.optout) return passo('encerrar', 'analista', 'optout');
  if (de === 'analista') return passo('encerrar', 'analista', 'escada_esgotada');
  if (entrada.declaracao === 'em_revisao') return passo('pausar', de, 'declaracao_em_revisao');
  if (entrada.declaracao === 'aceita') return passo('reiniciar', de, 'declaracao_aceita');
  if (entrada.decorridoMs === null) return passo('manter', de, 'aguardando_contato');

  const prazo = config.prazoMs[de];
  if (entrada.decorridoMs < prazo) {
    return passo('manter', de, 'no_prazo', { restanteMs: prazo - entrada.decorridoMs });
  }

  const { degrau, pulos } = proximoDisponivel(ORDEM_ESCADA.indexOf(de) + 1, entrada);
  if (degrau === 'analista') return passo('encerrar', 'analista', 'escada_esgotada', { pulos });
  return passo('subir', degrau, 'prazo_vencido', { pulos });
}
