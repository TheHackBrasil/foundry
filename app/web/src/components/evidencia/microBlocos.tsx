// Renderiza os micro-blocos GenUI que cabem na coluna estreita do painel
// (spec 0014, THE-16). E o subconjunto da matriz do PalcoGenUI que nao
// precisa de torre, simulacao ou acao de escrita.

import type { AlvoFocoGenUI, BlocoGenUI, Parte, ProjecaoPedido } from '../../../../shared/model.ts';
import { BlocoChecklistPapel } from '../genui/BlocoChecklistPapel.tsx';
import { BlocoComparadorConflito } from '../genui/BlocoComparadorConflito.tsx';
import { BlocoLinhaTempoCausal } from '../genui/BlocoLinhaTempoCausal.tsx';
import { BlocoMatrizFocada } from '../genui/BlocoMatrizFocada.tsx';
import { BlocoResumoCitado } from '../genui/BlocoResumoCitado.tsx';
import type { AoAlternarFoco } from '../genui/tipos.ts';

export interface ContextoMicroBloco {
  projecao: ProjecaoPedido | null;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
  aoSelecionarPapel: (papel: Parte) => void;
}

export function renderizarMicroBloco(
  bloco: BlocoGenUI,
  indice: number,
  ctx: ContextoMicroBloco,
): React.ReactNode {
  switch (bloco.tipo) {
    case 'resumo_citado':
      return (
        <BlocoResumoCitado
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
        />
      );
    case 'comparador_conflito':
      return ctx.projecao ? (
        <BlocoComparadorConflito
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          projecao={ctx.projecao}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
        />
      ) : null;
    case 'linha_tempo_causal':
      return ctx.projecao ? (
        <BlocoLinhaTempoCausal
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          projecao={ctx.projecao}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
        />
      ) : null;
    case 'checklist_papel':
      return ctx.projecao ? (
        <BlocoChecklistPapel
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          projecao={ctx.projecao}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
          aoSelecionarPapel={ctx.aoSelecionarPapel}
        />
      ) : null;
    case 'matriz_focada':
      return (
        <BlocoMatrizFocada
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
        />
      );
    default:
      return null;
  }
}
