import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CAMPOS, PARTES } from './model.ts';
import { REGRAS, tarefasPara } from './rules.ts';

describe('REGRAS', () => {
  it('tem ao menos uma tarefa para cada campo comparado', () => {
    for (const campo of CAMPOS) {
      assert.ok(tarefasPara(campo).length > 0, campo);
    }
  });

  it('só atribui tarefa a partes que existem, sem repetir parte no mesmo campo', () => {
    for (const campo of CAMPOS) {
      const partes = REGRAS[campo].map((t) => t.parte);

      assert.ok(partes.every((p) => PARTES.includes(p)), campo);
      assert.equal(new Set(partes).size, partes.length, campo);
    }
  });

  it('mantém a tarefa fiscal do atraso condicional (R-006)', () => {
    const fiscal = REGRAS.dataEntrega.filter((t) => t.parte === 'fiscal');

    assert.equal(fiscal.length, 1);
    assert.match(fiscal[0]?.condicao ?? '', /24h/);
  });
});
