// Politica do operador (spec 0017, RF7 a RF10): decide se uma acao externa
// proposta pode sair e, se nao puder, por que. Funcao pura: config,
// contadores, instante e kill switch entram por parametro; nada de I/O, env
// nem relogio. O fluxo chama antes de planejar e de novo sob o lock, antes do
// efeito; o adaptador do canal repete a checagem de destino (RF8).

import type { CanalContato, Contato } from '../shared/model.js';

// Fuso da janela e do dia dos contadores (RF9). O Brasil nao tem horario de
// verao desde 2019, entao Sao Paulo fica em UTC-3 o ano todo.
export const FUSO_OPERADOR = 'America/Sao_Paulo';

// Canais em que o operador age. Compromisso (prazo, valor, reagendamento)
// nao e canal: nunca e acao do agente (RF7).
export type CanalOperador = Extract<CanalContato, 'email' | 'whatsapp' | 'ligacao'>;

export const CANAIS_OPERADOR = ['email', 'whatsapp', 'ligacao'] as const satisfies readonly CanalOperador[];

// Canais por telefone: pedem aprovacao do analista (invariante 2) e passam
// por lista de destinos, janela e limite de tentativas. E-mail sai sozinho.
export const CANAIS_COM_APROVACAO = ['whatsapp', 'ligacao'] as const satisfies readonly CanalOperador[];

// Codigos estaveis de recusa: entram no evento e na tela, nunca mudam de nome.
export const MOTIVOS_POLITICA = [
  'politica_invalida',
  'instante_invalido',
  'kill_switch_global',
  'kill_switch_workspace',
  'workspace_nao_habilitado',
  'canal_nao_suportado',
  'canal_incompativel',
  'contato_seed',
  'contato_documento',
  'contato_nao_manual',
  'contato_nao_contatar_ia',
  'destino_invalido',
  'destino_nao_permitido',
  'fora_da_janela',
  'limite_tentativas',
  'custo_invalido',
  'contadores_invalidos',
  'teto_caso',
  'teto_dia',
] as const;

export type MotivoPolitica = (typeof MOTIVOS_POLITICA)[number];

// Horas locais no FUSO_OPERADOR, so de segunda a sexta. Inicio inclusivo e
// fim exclusivo: fimHora 18 libera 17:59 e barra 18:00.
export interface JanelaPolitica {
  inicioHora: number;
  fimHora: number;
}

// Valores vindos de env (RF9), lidos uma vez e gravados no snapshot do
// operador_assumiu; a politica nunca le env.
export interface ConfigPolitica {
  workspacesHabilitados: readonly string[]; // OPERADOR_WORKSPACES
  destinosPermitidos: readonly string[]; // OPERADOR_DESTINOS_PERMITIDOS, normalizados antes de comparar
  janela: JanelaPolitica;
  tentativasPorDestinoDia: number;
  tetoCasoBrl: number;
  tetoDiaBrl: number;
}

// Padrao seguro: nenhum workspace nem destino habilitado, entao nada sai
// ate a config listar os dois.
export const POLITICA_PADRAO: ConfigPolitica = {
  workspacesHabilitados: [],
  destinosPermitidos: [],
  janela: { inicioHora: 8, fimHora: 18 },
  tentativasPorDestinoDia: 2,
  tetoCasoBrl: 5,
  tetoDiaBrl: 50,
};

// Recorte do contato que a politica olha. O destino e o valor cru da agenda
// (normalizado aqui); naoContatarIa vem da agenda por canal (T705).
export type ContatoPolitica = Pick<Contato, 'canal' | 'destino' | 'fonte'> & {
  naoContatarIa: boolean;
};

export interface AcaoExterna {
  canal: CanalOperador;
  workspace: string;
  contato: ContatoPolitica;
  custoEstimadoBrl: number;
}

export interface ContadoresPolitica {
  // Tentativas ja iniciadas no dia local (horarioLocal().data) para o mesmo
  // destino E.164, somando todos os workspaces.
  tentativasHojeDestino: number;
  gastoCasoBrl: number; // gasto mais reservas abertas do caso
  gastoDiaBrl: number; // gasto mais reservas abertas do dia
}

// Estado lido do banco antes de cada efeito (RF10), fora do snapshot.
export interface EstadoKillSwitch {
  global: boolean; // true = acionado: nenhum efeito externo sai
  workspaces: readonly string[]; // workspaces com a chave acionada
}

export interface EntradaPolitica {
  config: ConfigPolitica;
  acao: AcaoExterna;
  contadores: ContadoresPolitica;
  agoraMs: number; // instante avaliado, em ms desde a epoch
  killSwitch: EstadoKillSwitch;
}

export interface DecisaoPolitica {
  // true so quando nenhum motivo foi encontrado. Com requerAprovacao, quer
  // dizer que o plano pode ser proposto e sair depois do OK do analista.
  permitido: boolean;
  // Depende so do canal: WhatsApp e ligacao nunca saem sem aprovacao valida
  // da versao atual do plano (invariante 2), mesmo quando permitido e false.
  requerAprovacao: boolean;
  motivos: MotivoPolitica[];
}

// Telefone brasileiro (ou E.164 de outro pais, com '+') para E.164. Aceita
// separadores comuns, DDI 55 com ou sem '+', prefixo 00, prefixo de longa
// distancia 0 com ou sem codigo de operadora. Devolve null quando nao da para
// ter certeza do numero: nunca completa digito faltando.
export function normalizarTelefoneE164(entrada: string): string | null {
  const bruto = entrada.trim();
  if (!/^\+?[\d\s().-]+$/.test(bruto)) return null;
  let digitos = bruto.replace(/\D/g, '');
  let internacional = bruto.startsWith('+');
  if (!internacional && digitos.startsWith('00')) {
    digitos = digitos.slice(2);
    internacional = true;
  }
  if (internacional) {
    if (digitos.startsWith('55')) return nacionalBR(digitos.slice(2));
    return /^[1-9]\d{7,14}$/.test(digitos) ? `+${digitos}` : null;
  }
  if (digitos.startsWith('0')) {
    // 0 + DDD + numero, ou 0 + operadora (2 digitos) + DDD + numero.
    digitos = digitos.slice(1);
    if (digitos.length === 12 || digitos.length === 13) digitos = digitos.slice(2);
    return nacionalBR(digitos);
  }
  // Numero nacional tem 10 ou 11 digitos; 12 ou 13 comecando com 55 e DDI
  // sem '+'. O DDD 55 nacional (11 digitos) nao colide pelo tamanho.
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) {
    return nacionalBR(digitos.slice(2));
  }
  return nacionalBR(digitos);
}

// DDD sem zero, mais celular de 9 digitos (comeca com 9) ou fixo de 8
// (comeca com 2 a 5). Celular antigo de 8 digitos fica de fora.
function nacionalBR(nacional: string): string | null {
  return /^[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(nacional) ? `+55${nacional}` : null;
}

export interface HorarioLocal {
  data: string; // AAAA-MM-DD no fuso: chave do dia dos contadores
  diaSemana: number; // 0 = domingo, 6 = sabado
  hora: number; // 0 a 23
  minuto: number;
}

// Formatador fixo, sem estado: o instante entra por parametro.
const FORMATO_LOCAL = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_OPERADOR,
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

const DIA_SEMANA: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Data, dia da semana e hora de um instante no FUSO_OPERADOR. Lanca
// RangeError para instante que nao e numero finito.
export function horarioLocal(agoraMs: number): HorarioLocal {
  const partes = FORMATO_LOCAL.formatToParts(agoraMs);
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    data: `${parte('year')}-${parte('month')}-${parte('day')}`,
    diaSemana: DIA_SEMANA[parte('weekday')] ?? Number.NaN,
    hora: Number(parte('hour')) % 24,
    minuto: Number(parte('minute')),
  };
}

function janelaValida(j: JanelaPolitica): boolean {
  return (
    Number.isFinite(j.inicioHora) && Number.isFinite(j.fimHora) && j.inicioHora >= 0 && j.fimHora <= 24 && j.inicioHora < j.fimHora
  );
}

// Dia util (segunda a sexta) e hora dentro da janela, no FUSO_OPERADOR.
// Feriado nao entra: a janela so conhece o dia da semana.
export function dentroDaJanela(agoraMs: number, janela: JanelaPolitica): boolean {
  if (!Number.isFinite(agoraMs) || !janelaValida(janela)) return false;
  const { diaSemana, hora, minuto } = horarioLocal(agoraMs);
  if (!(diaSemana >= 1 && diaSemana <= 5)) return false;
  const minutos = hora * 60 + minuto;
  return minutos >= janela.inicioHora * 60 && minutos < janela.fimHora * 60;
}

function valorNaoNegativo(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

// Dinheiro comparado em centavos inteiros: 0,10 + 0,20 cabe num teto de 0,30.
function centavos(brl: number): number {
  return Math.round(brl * 100);
}

// Avalia todas as regras e junta os motivos na ordem fixa abaixo, para o
// evento registrar tudo o que barrou e nao so o primeiro. Entrada fora do
// tipo (NaN, campo ausente) recusa em vez de liberar.
export function avaliarPolitica(entrada: EntradaPolitica): DecisaoPolitica {
  const { config, acao, contadores, agoraMs, killSwitch } = entrada;
  const motivos: MotivoPolitica[] = [];

  const janelaOk = janelaValida(config.janela);
  const tentativasOk = Number.isInteger(config.tentativasPorDestinoDia) && config.tentativasPorDestinoDia >= 0;
  const tetosOk = valorNaoNegativo(config.tetoCasoBrl) && valorNaoNegativo(config.tetoDiaBrl);
  if (!janelaOk || !tentativasOk || !tetosOk) motivos.push('politica_invalida');
  const instanteOk = Number.isFinite(agoraMs);
  if (!instanteOk) motivos.push('instante_invalido');

  // Kill switch (RF10): barra qualquer canal, inclusive e-mail.
  if (killSwitch.global) motivos.push('kill_switch_global');
  if (killSwitch.workspaces.includes(acao.workspace)) motivos.push('kill_switch_workspace');

  // Workspace habilitado (RF8). Id vazio nunca vale, nem se a lista tiver ''.
  if (!acao.workspace.trim() || !config.workspacesHabilitados.includes(acao.workspace)) {
    motivos.push('workspace_nao_habilitado');
  }

  // Canal da acao e canal do contato precisam bater: o destino de um canal
  // nao serve para outro.
  if (!(CANAIS_OPERADOR as readonly string[]).includes(acao.canal)) motivos.push('canal_nao_suportado');
  else if (acao.contato.canal !== acao.canal) motivos.push('canal_incompativel');

  // Contato manual do proprio workspace, nunca o ficticio da seed nem o
  // criado a partir de documento (RF8, invariante 4).
  if (acao.contato.fonte === 'seed') motivos.push('contato_seed');
  else if (acao.contato.fonte === 'documento') motivos.push('contato_documento');
  else if (acao.contato.fonte !== 'manual') motivos.push('contato_nao_manual');
  if (acao.contato.naoContatarIa !== false) motivos.push('contato_nao_contatar_ia');

  const contadoresOk =
    valorNaoNegativo(contadores.tentativasHojeDestino) &&
    valorNaoNegativo(contadores.gastoCasoBrl) &&
    valorNaoNegativo(contadores.gastoDiaBrl);

  const requerAprovacao = (CANAIS_COM_APROVACAO as readonly string[]).includes(acao.canal);
  if (requerAprovacao) {
    // Lista de destinos em E.164 (RF8): os dois lados normalizados.
    const destino = normalizarTelefoneE164(acao.contato.destino);
    if (!destino) {
      motivos.push('destino_invalido');
    } else {
      const permitidos = new Set(config.destinosPermitidos.map(normalizarTelefoneE164));
      if (!permitidos.has(destino)) motivos.push('destino_nao_permitido');
    }
    // Janela e limite de tentativas por destino no dia (RF9).
    if (instanteOk && janelaOk && !dentroDaJanela(agoraMs, config.janela)) motivos.push('fora_da_janela');
    if (contadoresOk && tentativasOk && contadores.tentativasHojeDestino >= config.tentativasPorDestinoDia) {
      motivos.push('limite_tentativas');
    }
  }

  // Orcamento com reserva (RF9): o custo estimado entra antes do efeito e
  // nao pode passar do teto; bater no teto exato ainda cabe.
  const custoOk = valorNaoNegativo(acao.custoEstimadoBrl);
  if (!custoOk) motivos.push('custo_invalido');
  if (!contadoresOk) motivos.push('contadores_invalidos');
  if (custoOk && contadoresOk && tetosOk) {
    const custo = centavos(acao.custoEstimadoBrl);
    if (centavos(contadores.gastoCasoBrl) + custo > centavos(config.tetoCasoBrl)) motivos.push('teto_caso');
    if (centavos(contadores.gastoDiaBrl) + custo > centavos(config.tetoDiaBrl)) motivos.push('teto_dia');
  }

  return { permitido: motivos.length === 0, requerAprovacao, motivos };
}
