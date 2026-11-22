import { describe, expect, it } from 'vitest';
import { propagar, propagarTodas } from './rules.js';
import type { Divergencia } from './model.js';

const atraso: Divergencia = {
  campo: 'previsaoEntrega',
  fonteA: 'nfe',
  fonteB: 'planilha',
  valorA: '2026-11-22',
  valorB: '2026-11-25',
};

const peso: Divergencia = {
  campo: 'pesoTotal',
  fonteA: 'nfe',
  fonteB: 'cte',
  valorA: 510,
  valorB: 520,
};

const volumes: Divergencia = {
  campo: 'volumes',
  fonteA: 'nfe',
  fonteB: 'planilha',
  valorA: 10,
  valorB: 8,
};

const status: Divergencia = {
  campo: 'status',
  fonteA: 'nfe',
  fonteB: 'cte',
  valorA: 'emitida',
  valorB: 'em_transito',
};

const todas = [atraso, peso, volumes, status];

describe('propagar', () => {
  it('atraso propaga para as 5 partes', () => {
    const tarefas = propagar(atraso);
    expect(tarefas).toHaveLength(5);
    expect(new Set(tarefas.map((t) => t.parte))).toEqual(
      new Set(['fornecedor', 'transportadora', 'cd', 'fiscal', 'financeiro']),
    );
    expect(tarefas.every((t) => t.divergencia === atraso)).toBe(true);
  });

  it('peso propaga para transportadora, fiscal e financeiro', () => {
    expect(propagar(peso).map((t) => t.parte)).toEqual([
      'transportadora',
      'fiscal',
      'financeiro',
    ]);
  });

  it('volumes propaga para cd e transportadora', () => {
    expect(propagar(volumes).map((t) => t.parte)).toEqual(['cd', 'transportadora']);
  });

  it('status propaga para as 5 partes', () => {
    expect(propagar(status).map((t) => t.parte)).toEqual([
      'fiscal',
      'financeiro',
      'cd',
      'transportadora',
      'fornecedor',
    ]);
  });

  it('deterministica: mesma entrada, mesma saida', () => {
    expect(propagar(atraso)).toEqual(propagar(atraso));
  });
});

describe('tarefa fiscal do atraso (R-006)', () => {
  const fiscal = propagar(atraso).find((t) => t.parte === 'fiscal')!;

  it('manda conferir se o atraso exige acao fiscal, nao conferir CC-e', () => {
    expect(fiscal.titulo).toBe('Conferir se o atraso exige ação fiscal');
  });

  it('diz que o cancelamento tem janela de 24 h e que a CC-e nao corrige data de saida', () => {
    expect(fiscal.detalhe).toBe(
      'A previsão passou de 22/11/2026 para 25/11/2026. O cancelamento da NF-e só cabe em até 24 h e sem circulação da mercadoria, e a CC-e não corrige data de saída.',
    );
  });

  it('nenhuma tarefa de atraso manda corrigir a data por CC-e', () => {
    for (const t of propagar(atraso)) {
      expect(t.titulo).not.toMatch(/conferir cc-e/i);
    }
  });
});

describe('textos das tarefas', () => {
  it('atraso: titulos e detalhes exatos, com data brasileira e fontes legiveis', () => {
    expect(propagar(atraso).map((t) => [t.parte, t.titulo, t.detalhe])).toEqual([
      [
        'transportadora',
        'Justificar nova data e reestimar ETA',
        'Previsão divergente: NF-e diz 22/11/2026, planilha diz 25/11/2026.',
      ],
      [
        'cd',
        'Reagendar janela de recebimento',
        'Nova previsão de 25/11/2026 exige replanejar doca e equipe.',
      ],
      [
        'fiscal',
        'Conferir se o atraso exige ação fiscal',
        'A previsão passou de 22/11/2026 para 25/11/2026. O cancelamento da NF-e só cabe em até 24 h e sem circulação da mercadoria, e a CC-e não corrige data de saída.',
      ],
      [
        'financeiro',
        'Recalcular SLA e provisionar multa',
        'Atraso da previsão de 22/11/2026 para 25/11/2026 pode gerar penalidade contratual.',
      ],
      [
        'fornecedor',
        'Avisar cliente da nova data',
        'Comunicar o reagendamento: de 22/11/2026 para 25/11/2026.',
      ],
    ]);
  });

  it('peso: titulos e detalhes exatos', () => {
    expect(propagar(peso).map((t) => [t.titulo, t.detalhe])).toEqual([
      [
        'Verificar tara e lotação do veículo',
        'Peso divergente: NF-e declara 510 kg, CT-e declara 520 kg.',
      ],
      [
        'Checar peso NF-e x CT-e junto ao emissor',
        'Divergência de 510 kg para 520 kg pode indicar erro de emissão ou carga extra.',
      ],
      ['Recalcular frete por peso real', 'Frete cotado sobre 510 kg; CT-e indica 520 kg.'],
    ]);
  });

  it('volumes: titulos e detalhes exatos', () => {
    expect(propagar(volumes).map((t) => [t.titulo, t.detalhe])).toEqual([
      [
        'Separar conferência física no recebimento',
        'Volumes divergentes: NF-e diz 10, planilha diz 8.',
      ],
      ['Conferir romaneio contra o documento', 'Romaneio deve bater 10 volumes ou justificar 8.'],
    ]);
  });

  it('status: codigos viram texto legivel e o rotulo nunca fica como adjetivo', () => {
    expect(propagar(status).map((t) => [t.titulo, t.detalhe])).toEqual([
      [
        'Validar mudança de status junto à SEFAZ',
        'Status divergente: NF-e diz Emitida, CT-e diz Em trânsito.',
      ],
      [
        'Estornar ou segurar provisão de pagamento',
        'Cancelamento ou bloqueio muda a provisão. Status: de Emitida para Em trânsito.',
      ],
      [
        'Suspender ou liberar operação de recebimento',
        'Novo status: Em trânsito. Pode exigir devolução ou guarda da carga.',
      ],
      [
        'Recalcular rota e instruir motorista',
        'Novo status: Em trânsito. Isso altera a entrega planejada.',
      ],
      [
        'Alinhar com cliente o novo status do pedido',
        'O cliente precisa saber que o status mudou. Antes: Emitida; agora: Em trânsito.',
      ],
    ]);
  });

  it('nenhum texto vaza data ISO, codigo de status ou nome de fonte em minusculas', () => {
    for (const t of propagarTodas(todas)) {
      for (const texto of [t.titulo, t.detalhe]) {
        expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(texto).not.toMatch(/\w_\w/);
        expect(texto).not.toMatch(/\b(nfe|cte|cce)\b/);
        expect(texto).not.toContain('->');
      }
    }
  });

  it('nenhum texto traz palavra sem acento da lista de erros conhecidos', () => {
    const semAcento =
      /\b(previsao|lotacao|veiculo|devolucao|conferencia|fisica|emissao|operacao|mudanca|provisao|divergencia|acao|saida)\b/i;
    for (const t of propagarTodas(todas)) {
      expect(t.titulo).not.toMatch(semAcento);
      expect(t.detalhe).not.toMatch(semAcento);
    }
  });

  it('o rotulo da fonte usa o nome da fonte da divergencia (CC-e, planilha, entrada manual)', () => {
    const d: Divergencia = { ...atraso, fonteA: 'planilha', fonteB: 'manual', valorB: '2026-02-01' };
    expect(propagar(d)[0]!.detalhe).toBe(
      'Previsão divergente: planilha diz 22/11/2026, entrada manual diz 01/02/2026.',
    );
  });

  it('formata so o texto: a divergencia da tarefa fica com os valores originais', () => {
    const t = propagar(atraso)[0]!;
    expect(t.divergencia.valorA).toBe('2026-11-22');
    expect(t.divergencia.fonteB).toBe('planilha');
  });
});

describe('propagarTodas', () => {
  it('preserva ordem das divergencias', () => {
    const t = propagarTodas([atraso, { ...atraso, campo: 'volumes' as const }]);
    expect(t.length).toBe(5 + 2);
    expect(t[0]!.divergencia.campo).toBe('previsaoEntrega');
    expect(t[5]!.divergencia.campo).toBe('volumes');
  });
});
