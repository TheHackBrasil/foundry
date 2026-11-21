import { PARTES, type Parte, type Tarefa } from '../../../shared/model.ts';
import { ROTULO_CAMPO, ROTULO_FONTE, ROTULO_PARTE, formatarValor } from '../format.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  chaveTarefa,
  tarefasDaParte,
  type FiltroParte,
  type GrupoTarefa,
} from '../matriz.ts';

interface Props {
  tarefas: readonly Tarefa[];
  filtro: FiltroParte;
  aoFiltrar: (filtro: FiltroParte) => void;
  novas: ReadonlySet<string>;
}

const OPCOES: ReadonlyArray<{ valor: FiltroParte; rotulo: string }> = [
  { valor: FILTRO_TODAS, rotulo: 'Todas as partes' },
  ...PARTES.map((p) => ({ valor: p as FiltroParte, rotulo: ROTULO_PARTE[p] })),
];

function Item({ grupo, novas }: { grupo: GrupoTarefa; novas: ReadonlySet<string> }) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  return (
    <li className={nova ? 'tarefa tarefa-nova' : 'tarefa'}>
      <p className="tarefa-titulo">
        {grupo.titulo}{' '}
        {!unica && <span className="etiqueta">{grupo.ocorrencias.length} divergências</span>}
        {nova && <span className="etiqueta etiqueta-nova">Nova</span>}
      </p>
      {unica && <p>{grupo.ocorrencias[0]?.detalhe}</p>}
      <ul className="origens">
        {grupo.ocorrencias.map((t) => {
          const d = t.divergencia;
          return (
            <li key={chaveTarefa(t)} className="meta">
              {ROTULO_CAMPO[d.campo]}: {ROTULO_FONTE[d.fonteA]} declara {formatarValor(d.campo, d.valorA)},{' '}
              {ROTULO_FONTE[d.fonteB]} declara {formatarValor(d.campo, d.valorB)}.
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export function TarefasPorParte({ tarefas, filtro, aoFiltrar, novas }: Props) {
  const visiveis = tarefasDaParte(tarefas, filtro);
  const partes: Parte[] = filtro === FILTRO_TODAS ? PARTES.filter((p) => visiveis.some((t) => t.parte === p)) : [filtro];
  const grupos = partes.map((parte) => ({
    parte,
    itens: agruparTarefas(visiveis.filter((t) => t.parte === parte)),
  }));
  const total = grupos.reduce((soma, g) => soma + g.itens.length, 0);
  const alvo = filtro === FILTRO_TODAS ? 'todas as partes' : ROTULO_PARTE[filtro];

  return (
    <div>
      <fieldset className="ver-como">
        <legend>Ver como</legend>
        <div className="segmentos">
          {OPCOES.map((o) => (
            <label key={o.valor} className="segmento">
              <input
                type="radio"
                name="ver-como"
                value={o.valor}
                checked={filtro === o.valor}
                onChange={() => aoFiltrar(o.valor)}
              />
              <span>{o.rotulo}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="so-leitor" role="status">
        {total} {total === 1 ? 'tarefa' : 'tarefas'} para {alvo}.
      </p>

      {tarefas.length === 0 && (
        <p className="dica">
          Nenhuma tarefa por enquanto. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.
        </p>
      )}
      {tarefas.length > 0 && total === 0 && filtro !== FILTRO_TODAS && (
        <p className="dica">Nenhuma tarefa para {ROTULO_PARTE[filtro]} neste pedido.</p>
      )}
      {grupos.map(({ parte, itens }) =>
        itens.length === 0 ? null : (
          <div key={parte} className="grupo">
            <h4>
              {ROTULO_PARTE[parte]} <span className="meta">({itens.length})</span>
            </h4>
            <ul>
              {itens.map((g) => (
                <Item key={g.titulo} grupo={g} novas={novas} />
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
