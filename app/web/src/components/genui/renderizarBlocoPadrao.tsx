import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  Contato,
  Parte,
  ProjecaoPedido,
} from '../../../../shared/model.ts';
import { BlocoCartoesDespacho } from './BlocoCartoesDespacho.tsx';
import { BlocoChecklistPapel } from './BlocoChecklistPapel.tsx';
import { BlocoComparadorConflito } from './BlocoComparadorConflito.tsx';
import { BlocoLinhaTempoCausal } from './BlocoLinhaTempoCausal.tsx';
import { BlocoMatrizFocada } from './BlocoMatrizFocada.tsx';
import { BlocoResumoCitado } from './BlocoResumoCitado.tsx';
import type { AoAlternarFoco } from './tipos.ts';

// domino_impacto e simulador_interativo leem o estado vivo do palco (simulacao
// em andamento, pedido e sessao), entao o orquestrador os renderiza direto.
export type BlocoPadrao = Exclude<
  BlocoGenUI,
  { tipo: 'domino_impacto' } | { tipo: 'simulador_interativo' }
>;

export interface ContextoBlocoPadrao {
  projecao: ProjecaoPedido;
  contatos: readonly Contato[];
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
  aoSelecionarPapel: (papel: Parte) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoAnunciar: (texto: string) => void;
}

export function renderizarBlocoPadrao(
  bloco: BlocoPadrao,
  indice: number,
  ctx: ContextoBlocoPadrao,
) {
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
      return (
        <BlocoComparadorConflito
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          projecao={ctx.projecao}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
        />
      );

    case 'linha_tempo_causal':
      return (
        <BlocoLinhaTempoCausal
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          projecao={ctx.projecao}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
        />
      );

    case 'cartoes_despacho':
      return (
        <BlocoCartoesDespacho
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          contatos={ctx.contatos}
          projecao={ctx.projecao}
          aoNotificar={ctx.aoNotificar}
          aoAbrirAgenda={ctx.aoAbrirAgenda}
          aoAnunciar={ctx.aoAnunciar}
        />
      );

    case 'checklist_papel':
      return (
        <BlocoChecklistPapel
          key={bloco.id}
          bloco={bloco}
          indice={indice}
          projecao={ctx.projecao}
          focoAtivo={ctx.focoAtivo}
          aoAlternarFoco={ctx.aoAlternarFoco}
          aoSelecionarPapel={ctx.aoSelecionarPapel}
        />
      );

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
  }
}
