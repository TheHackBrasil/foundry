import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  avaliarPolitica,
  dentroDaJanela,
  horarioLocal,
  MOTIVOS_POLITICA,
  normalizarTelefoneE164,
  POLITICA_PADRAO,
  type AcaoExterna,
  type CanalOperador,
  type ConfigPolitica,
  type ContadoresPolitica,
  type ContatoPolitica,
  type DecisaoPolitica,
  type EntradaPolitica,
  type EstadoKillSwitch,
} from './politica.js';

// Instantes fixos em UTC. Sao Paulo fica em UTC-3 o ano todo; 26/11/2026 e
// uma quinta-feira.
const QUINTA_10H = Date.UTC(2026, 10, 26, 13, 0);
const QUINTA_07H59 = Date.UTC(2026, 10, 26, 10, 59);
const QUINTA_08H00 = Date.UTC(2026, 10, 26, 11, 0);
const QUINTA_17H59 = Date.UTC(2026, 10, 26, 20, 59);
const QUINTA_17H59_59 = Date.UTC(2026, 10, 26, 20, 59, 59, 999);
const QUINTA_18H00 = Date.UTC(2026, 10, 26, 21, 0);
const SEXTA_17H59 = Date.UTC(2026, 10, 27, 20, 59);
const SABADO_10H = Date.UTC(2026, 10, 28, 13, 0);
const DOMINGO_10H = Date.UTC(2026, 10, 29, 13, 0);
const SEGUNDA_08H00 = Date.UTC(2026, 10, 30, 11, 0);

const WS = 'ws-teste';
const FONE = '+5511987654321';
const EMAIL = 'ops@transportadora.dev';

interface Ajustes {
  canal?: CanalOperador;
  config?: Partial<ConfigPolitica>;
  acao?: Partial<Omit<AcaoExterna, 'canal' | 'contato'>>;
  contato?: Partial<ContatoPolitica>;
  contadores?: Partial<ContadoresPolitica>;
  agoraMs?: number;
  killSwitch?: Partial<EstadoKillSwitch>;
}

// Base que passa em todas as regras: WhatsApp, contato manual na lista,
// quinta 10h, nada gasto. Cada teste muda so o que esta testando.
function montar(a: Ajustes = {}): EntradaPolitica {
  const canal = a.canal ?? 'whatsapp';
  return {
    config: { ...POLITICA_PADRAO, workspacesHabilitados: [WS], destinosPermitidos: [FONE], ...a.config },
    acao: {
      canal,
      workspace: WS,
      custoEstimadoBrl: 0.5,
      ...a.acao,
      contato: {
        canal,
        destino: canal === 'email' ? EMAIL : FONE,
        fonte: 'manual',
        naoContatarIa: false,
        ...a.contato,
      },
    },
    contadores: { tentativasHojeDestino: 0, gastoCasoBrl: 0, gastoDiaBrl: 0, ...a.contadores },
    agoraMs: a.agoraMs ?? QUINTA_10H,
    killSwitch: { global: false, workspaces: [], ...a.killSwitch },
  };
}

function avaliar(a: Ajustes = {}): DecisaoPolitica {
  return avaliarPolitica(montar(a));
}

describe('aprovacao por canal (RF7)', () => {
  it('e-mail sai sem aprovacao', () => {
    expect(avaliar({ canal: 'email' })).toEqual({ permitido: true, requerAprovacao: false, motivos: [] });
  });

  it('WhatsApp e ligacao pedem aprovacao', () => {
    expect(avaliar({ canal: 'whatsapp' })).toEqual({ permitido: true, requerAprovacao: true, motivos: [] });
    expect(avaliar({ canal: 'ligacao' })).toEqual({ permitido: true, requerAprovacao: true, motivos: [] });
  });

  it('a exigencia de aprovacao vale pelo canal mesmo quando a acao e recusada', () => {
    const d = avaliar({ canal: 'ligacao', killSwitch: { global: true } });
    expect(d.permitido).toBe(false);
    expect(d.requerAprovacao).toBe(true);
  });
});

describe('kill switch (RF10)', () => {
  it('o global barra todos os canais, inclusive e-mail', () => {
    for (const canal of ['email', 'whatsapp', 'ligacao'] as const) {
      const d = avaliar({ canal, killSwitch: { global: true } });
      expect(d.permitido).toBe(false);
      expect(d.motivos).toEqual(['kill_switch_global']);
    }
  });

  it('o do workspace barra so o workspace acionado', () => {
    expect(avaliar({ canal: 'email', killSwitch: { workspaces: [WS] } }).motivos).toEqual(['kill_switch_workspace']);
    expect(avaliar({ killSwitch: { workspaces: [WS] } }).motivos).toEqual(['kill_switch_workspace']);
    expect(avaliar({ killSwitch: { workspaces: ['outro-ws'] } }).permitido).toBe(true);
  });

  it('global e workspace acionados juntos aparecem os dois', () => {
    expect(avaliar({ killSwitch: { global: true, workspaces: [WS] } }).motivos).toEqual([
      'kill_switch_global',
      'kill_switch_workspace',
    ]);
  });
});

describe('workspace habilitado (RF8)', () => {
  it('recusa workspace fora da lista', () => {
    expect(avaliar({ acao: { workspace: 'outro-ws' } }).motivos).toEqual(['workspace_nao_habilitado']);
    expect(avaliar({ canal: 'email', acao: { workspace: 'outro-ws' } }).motivos).toEqual(['workspace_nao_habilitado']);
  });

  it('o padrao seguro nao habilita workspace nem destino', () => {
    const entrada = montar({ config: POLITICA_PADRAO });
    expect(avaliarPolitica(entrada).motivos).toEqual(['workspace_nao_habilitado', 'destino_nao_permitido']);
  });

  it('id vazio nunca vale, nem se a lista tiver string vazia', () => {
    const d = avaliar({ config: { workspacesHabilitados: ['', WS] }, acao: { workspace: '' } });
    expect(d.motivos).toEqual(['workspace_nao_habilitado']);
  });
});

describe('contato manual (RF8, invariante 4)', () => {
  it('recusa contato da seed em qualquer canal', () => {
    for (const canal of ['email', 'whatsapp', 'ligacao'] as const) {
      expect(avaliar({ canal, contato: { fonte: 'seed' } }).motivos).toEqual(['contato_seed']);
    }
  });

  it('recusa contato criado a partir de documento', () => {
    expect(avaliar({ contato: { fonte: 'documento' } }).motivos).toEqual(['contato_documento']);
    expect(avaliar({ canal: 'ligacao', contato: { fonte: 'documento' } }).motivos).toEqual(['contato_documento']);
  });

  it('recusa fonte desconhecida vinda de fora do tipo', () => {
    const d = avaliar({ contato: { fonte: 'importado' as ContatoPolitica['fonte'] } });
    expect(d.motivos).toEqual(['contato_nao_manual']);
  });

  it('recusa contato marcado para nao ser contatado por IA', () => {
    expect(avaliar({ contato: { naoContatarIa: true } }).motivos).toEqual(['contato_nao_contatar_ia']);
    expect(avaliar({ canal: 'email', contato: { naoContatarIa: true } }).motivos).toEqual(['contato_nao_contatar_ia']);
  });

  it('sem a marca preenchida, recusa em vez de liberar', () => {
    const d = avaliar({ contato: { naoContatarIa: undefined as unknown as boolean } });
    expect(d.motivos).toEqual(['contato_nao_contatar_ia']);
  });

  it('o canal do contato precisa ser o da acao', () => {
    expect(avaliar({ canal: 'ligacao', contato: { canal: 'whatsapp' } }).motivos).toEqual(['canal_incompativel']);
    expect(avaliar({ canal: 'email', contato: { canal: 'whatsapp' } }).motivos).toEqual(['canal_incompativel']);
  });

  it('recusa canal fora do operador', () => {
    const d = avaliar({ canal: 'sms' as CanalOperador });
    expect(d.permitido).toBe(false);
    expect(d.requerAprovacao).toBe(false);
    expect(d.motivos).toEqual(['canal_nao_suportado']);
  });
});

describe('lista de destinos em E.164 (RF8)', () => {
  it('normaliza o destino da agenda antes de comparar', () => {
    expect(avaliar({ contato: { destino: '(11) 98765-4321' } }).permitido).toBe(true);
    expect(avaliar({ canal: 'ligacao', contato: { destino: '011 98765 4321' } }).permitido).toBe(true);
  });

  it('normaliza tambem a lista', () => {
    const d = avaliar({ config: { destinosPermitidos: ['(11) 98765-4321'] }, contato: { destino: '+5511987654321' } });
    expect(d.permitido).toBe(true);
  });

  it('recusa destino fora da lista', () => {
    expect(avaliar({ contato: { destino: '+55 11 98765-4322' } }).motivos).toEqual(['destino_nao_permitido']);
    expect(avaliar({ config: { destinosPermitidos: [] } }).motivos).toEqual(['destino_nao_permitido']);
  });

  it('ignora item invalido da lista sem liberar nada', () => {
    const d = avaliar({ config: { destinosPermitidos: ['lixo', '', '123'] } });
    expect(d.motivos).toEqual(['destino_nao_permitido']);
  });

  it('recusa destino que nao e telefone', () => {
    expect(avaliar({ contato: { destino: EMAIL } }).motivos).toEqual(['destino_invalido']);
    expect(avaliar({ contato: { destino: '(11) 8765-4321' } }).motivos).toEqual(['destino_invalido']);
  });

  it('e-mail nao passa pela lista de telefones', () => {
    expect(avaliar({ canal: 'email', config: { destinosPermitidos: [] } }).permitido).toBe(true);
  });
});

describe('janela em America/Sao_Paulo (RF9)', () => {
  it('17:59 ainda esta dentro e 18:00 ja esta fora', () => {
    expect(avaliar({ agoraMs: QUINTA_17H59 }).permitido).toBe(true);
    expect(avaliar({ agoraMs: QUINTA_17H59_59 }).permitido).toBe(true);
    expect(avaliar({ agoraMs: QUINTA_18H00 }).motivos).toEqual(['fora_da_janela']);
  });

  it('08:00 abre e 07:59 ainda esta fechado', () => {
    expect(avaliar({ agoraMs: QUINTA_08H00 }).permitido).toBe(true);
    expect(avaliar({ agoraMs: QUINTA_07H59 }).motivos).toEqual(['fora_da_janela']);
  });

  it('sabado e domingo ficam fora, sexta e segunda dentro', () => {
    expect(avaliar({ canal: 'ligacao', agoraMs: SABADO_10H }).motivos).toEqual(['fora_da_janela']);
    expect(avaliar({ agoraMs: DOMINGO_10H }).motivos).toEqual(['fora_da_janela']);
    expect(avaliar({ agoraMs: SEXTA_17H59 }).permitido).toBe(true);
    expect(avaliar({ agoraMs: SEGUNDA_08H00 }).permitido).toBe(true);
  });

  it('usa o fuso de Sao Paulo e nao o UTC', () => {
    // 09:00 UTC seria dentro da janela em UTC; em Sao Paulo sao 06:00.
    expect(avaliar({ agoraMs: Date.UTC(2026, 10, 26, 9, 0) }).motivos).toEqual(['fora_da_janela']);
    // 20:30 UTC seria fora em UTC; em Sao Paulo sao 17:30.
    expect(avaliar({ agoraMs: Date.UTC(2026, 10, 26, 20, 30) }).permitido).toBe(true);
  });

  it('e-mail nao depende da janela', () => {
    expect(avaliar({ canal: 'email', agoraMs: SABADO_10H }).permitido).toBe(true);
    expect(avaliar({ canal: 'email', agoraMs: QUINTA_18H00 }).permitido).toBe(true);
  });

  it('respeita a janela configurada', () => {
    expect(avaliar({ config: { janela: { inicioHora: 9, fimHora: 17 } }, agoraMs: QUINTA_08H00 }).motivos).toEqual([
      'fora_da_janela',
    ]);
  });

  it('instante invalido recusa', () => {
    expect(avaliar({ agoraMs: Number.NaN }).motivos).toEqual(['instante_invalido']);
    expect(avaliar({ canal: 'email', agoraMs: Number.POSITIVE_INFINITY }).motivos).toEqual(['instante_invalido']);
  });
});

describe('horarioLocal e dentroDaJanela', () => {
  it('devolve data, dia da semana e hora no fuso', () => {
    expect(horarioLocal(QUINTA_17H59)).toEqual({ data: '2026-11-26', diaSemana: 4, hora: 17, minuto: 59 });
    expect(horarioLocal(SABADO_10H)).toEqual({ data: '2026-11-28', diaSemana: 6, hora: 10, minuto: 0 });
  });

  it('o dia local vira na meia-noite de Sao Paulo, nao na de UTC', () => {
    expect(horarioLocal(Date.UTC(2026, 10, 27, 2, 30)).data).toBe('2026-11-26');
    expect(horarioLocal(Date.UTC(2026, 10, 27, 3, 0))).toEqual({ data: '2026-11-27', diaSemana: 5, hora: 0, minuto: 0 });
  });

  it('recusa janela mal configurada', () => {
    expect(dentroDaJanela(QUINTA_10H, { inicioHora: 18, fimHora: 8 })).toBe(false);
    expect(dentroDaJanela(QUINTA_10H, { inicioHora: Number.NaN, fimHora: 18 })).toBe(false);
    expect(dentroDaJanela(Number.NaN, POLITICA_PADRAO.janela)).toBe(false);
  });
});

describe('tentativas por destino no dia (RF9)', () => {
  it('libera abaixo do limite e recusa ao atingir', () => {
    expect(avaliar({ contadores: { tentativasHojeDestino: 1 } }).permitido).toBe(true);
    expect(avaliar({ contadores: { tentativasHojeDestino: 2 } }).motivos).toEqual(['limite_tentativas']);
    expect(avaliar({ canal: 'ligacao', contadores: { tentativasHojeDestino: 3 } }).motivos).toEqual(['limite_tentativas']);
  });

  it('respeita o limite configurado', () => {
    expect(avaliar({ config: { tentativasPorDestinoDia: 0 } }).motivos).toEqual(['limite_tentativas']);
  });

  it('o limite e de telefone: e-mail nao conta', () => {
    expect(avaliar({ canal: 'email', contadores: { tentativasHojeDestino: 10 } }).permitido).toBe(true);
  });
});

describe('orcamento com reserva (RF9)', () => {
  it('a reserva que bate no teto exato do caso ainda cabe', () => {
    expect(avaliar({ acao: { custoEstimadoBrl: 0.3 }, contadores: { gastoCasoBrl: 4.7 } }).permitido).toBe(true);
    expect(avaliar({ acao: { custoEstimadoBrl: 5 } }).permitido).toBe(true);
  });

  it('um centavo acima do teto do caso recusa', () => {
    expect(avaliar({ acao: { custoEstimadoBrl: 0.3 }, contadores: { gastoCasoBrl: 4.71 } }).motivos).toEqual(['teto_caso']);
    expect(avaliar({ acao: { custoEstimadoBrl: 5.01 } }).motivos).toEqual(['teto_caso']);
  });

  it('a reserva que bate no teto exato do dia ainda cabe; um centavo acima recusa', () => {
    expect(avaliar({ contadores: { gastoDiaBrl: 49.5 } }).permitido).toBe(true);
    expect(avaliar({ contadores: { gastoDiaBrl: 49.51 } }).motivos).toEqual(['teto_dia']);
  });

  it('estourar os dois tetos registra os dois', () => {
    const d = avaliar({ acao: { custoEstimadoBrl: 1 }, contadores: { gastoCasoBrl: 4.5, gastoDiaBrl: 49.5 } });
    expect(d.motivos).toEqual(['teto_caso', 'teto_dia']);
  });

  it('soma em centavos, sem erro de ponto flutuante', () => {
    const d = avaliar({ config: { tetoCasoBrl: 0.3 }, acao: { custoEstimadoBrl: 0.2 }, contadores: { gastoCasoBrl: 0.1 } });
    expect(d.permitido).toBe(true);
  });

  it('e-mail tambem reserva: custo zero cabe no teto cheio, qualquer centavo nao', () => {
    expect(avaliar({ canal: 'email', acao: { custoEstimadoBrl: 0 }, contadores: { gastoDiaBrl: 50 } }).permitido).toBe(true);
    expect(avaliar({ canal: 'email', acao: { custoEstimadoBrl: 0.01 }, contadores: { gastoDiaBrl: 50 } }).motivos).toEqual([
      'teto_dia',
    ]);
  });

  it('custo invalido recusa', () => {
    for (const custo of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(avaliar({ acao: { custoEstimadoBrl: custo } }).motivos).toEqual(['custo_invalido']);
    }
  });

  it('contador invalido recusa em vez de liberar', () => {
    expect(avaliar({ contadores: { gastoDiaBrl: Number.NaN } }).motivos).toEqual(['contadores_invalidos']);
    expect(avaliar({ contadores: { tentativasHojeDestino: -1 } }).motivos).toEqual(['contadores_invalidos']);
  });

  it('config invalida recusa em vez de liberar', () => {
    expect(avaliar({ config: { tetoCasoBrl: Number.NaN } }).motivos).toEqual(['politica_invalida']);
    expect(avaliar({ config: { tentativasPorDestinoDia: Number.NaN } }).motivos).toEqual(['politica_invalida']);
    expect(avaliar({ config: { janela: { inicioHora: 18, fimHora: 8 } } }).motivos).toEqual(['politica_invalida']);
  });
});

describe('avaliarPolitica', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('junta todos os motivos numa ordem estavel', () => {
    const d = avaliar({
      killSwitch: { global: true },
      contato: { fonte: 'seed', destino: '+55 11 90000-0002' },
      agoraMs: SABADO_10H,
      contadores: { tentativasHojeDestino: 2, gastoCasoBrl: 5 },
    });
    expect(d).toEqual({
      permitido: false,
      requerAprovacao: true,
      motivos: ['kill_switch_global', 'contato_seed', 'destino_nao_permitido', 'fora_da_janela', 'limite_tentativas', 'teto_caso'],
    });
    for (const m of d.motivos) expect(MOTIVOS_POLITICA).toContain(m);
  });

  it('nao muda a entrada', () => {
    const entrada = montar({ canal: 'ligacao' });
    const copia = structuredClone(entrada);
    avaliarPolitica(entrada);
    expect(entrada).toEqual(copia);
  });

  it('nao le o relogio do sistema: so o instante passado conta', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SABADO_10H);
    expect(avaliar({ agoraMs: QUINTA_10H }).permitido).toBe(true);
    vi.setSystemTime(QUINTA_10H);
    expect(avaliar({ agoraMs: SABADO_10H }).motivos).toEqual(['fora_da_janela']);
  });
});

describe('normalizarTelefoneE164', () => {
  it.each([
    ['(11) 98765-4321', '+5511987654321'],
    ['11987654321', '+5511987654321'],
    ['+5511987654321', '+5511987654321'],
    ['+55 (11) 98765-4321', '+5511987654321'],
    ['5511987654321', '+5511987654321'],
    ['0055 11 98765 4321', '+5511987654321'],
    ['011 98765-4321', '+5511987654321'],
    ['0 21 11 98765-4321', '+5511987654321'],
    ['11.98765.4321', '+5511987654321'],
    ['(11) 3456-7890', '+551134567890'],
    ['55 98765-4321', '+5555987654321'],
    ['+55 11 90000-0002', '+5511900000002'],
    ['+1 415 555 0100', '+14155550100'],
  ])('%s vira %s', (entrada, esperado) => {
    expect(normalizarTelefoneE164(entrada)).toBe(esperado);
  });

  it.each([
    [''],
    ['   '],
    ['12345'],
    ['(11) 8765-4321'],
    ['(01) 98765-4321'],
    ['+55 11 98765-43210'],
    ['(11) 98765-4321 ramal 2'],
    ['ops@transportadora.dev'],
    ['+0 11 98765 4321'],
    ['11+987654321'],
  ])('%j nao vira E.164', (entrada) => {
    expect(normalizarTelefoneE164(entrada)).toBeNull();
  });
});
