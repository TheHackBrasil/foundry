import { PARTES, type CampoVigiado, type Parte, type Tarefa } from '../../../shared/model.ts';
import { rotuloCampo, rotuloFonte, rotuloParte } from '../format.ts';
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
  novas: ReadonlySet<string>;
  direcao: -1 | 0 | 1;
  painelId: string;
  rotuloAbaId: string;
}

function agruparOrigensPorCampo(
  ocorrencias: readonly Tarefa[],
): Array<{ campo: CampoVigiado; pares: string[] }> {
  const mapa = new Map<CampoVigiado, string[]>();
  for (const t of ocorrencias) {
    const { campo, fonteA, fonteB } = t.divergencia;
    const par = `${rotuloFonte(fonteA)} × ${rotuloFonte(fonteB)}`;
    const lista = mapa.get(campo);
    if (lista) {
      if (!lista.includes(par)) lista.push(par);
    } else {
      mapa.set(campo, [par]);
    }
  }
  return [...mapa.entries()].map(([campo, pares]) => ({ campo, pares }));
}

function Item({ grupo, novas }: { grupo: GrupoTarefa; novas: ReadonlySet<string> }) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  const origensPorCampo = agruparOrigensPorCampo(grupo.ocorrencias);
  return (
    <li className={nova ? 'tarefa tarefa-nova' : 'tarefa'}>
      <div className="tarefa-cab">
        <p className="tarefa-titulo">{grupo.titulo}</p>
        <div className="tarefa-badges">
          {!unica && <span className="pilula-sutil num">{grupo.ocorrencias.length} origens</span>}
          {nova && <span className="pilula-coord">Nova</span>}
        </div>
      </div>
      {unica && <p className="tarefa-detalhe">{grupo.ocorrencias[0]?.detalhe}</p>}
      <ul className="origens-lista">
        {origensPorCampo.map(({ campo, pares }) => (
          <li key={campo} className="origem-linha">
            <span className="origem-campo">{rotuloCampo(campo)}:</span>{' '}
            <span className="meta">{pares.join(' · ')}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function TarefasPorParte({ tarefas, filtro, novas, direcao, painelId, rotuloAbaId }: Props) {
  const partes: Parte[] =
    filtro === FILTRO_TODAS
      ? PARTES.filter((p) => tarefasDaParte(tarefas, p).length > 0)
      : [filtro];
  const grupos = partes.map((parte) => ({ parte, itens: agruparTarefas(tarefasDaParte(tarefas, parte)) }));
  const visiveis = grupos.reduce((soma, g) => soma + g.itens.length, 0);

  return (
    <div className="tarefas-bloco">
      <div
        id={painelId}
        key={filtro}
        role="tabpanel"
        aria-labelledby={rotuloAbaId}
        className="tarefas-lista"
        data-dir={direcao}
      >
        {tarefas.length === 0 && (
          <p className="dica tarefas-vazio">
            Nenhuma tarefa por enquanto. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.
          </p>
        )}
        {tarefas.length > 0 && visiveis === 0 && filtro !== FILTRO_TODAS && (
          <p className="dica tarefas-vazio">Nenhuma tarefa para {rotuloParte(filtro)} neste pedido.</p>
        )}
        {visiveis > 0 && (
          <div className="tarefas-superficie">
            {grupos.map(({ parte, itens }) =>
              itens.length === 0 ? null : (
                <section key={parte} aria-label={rotuloParte(parte)} className="tarefas-grupo">
                  {filtro === FILTRO_TODAS && <h3 className="tarefas-grupo-cab">{rotuloParte(parte)}</h3>}
                  <ul>
                    {itens.map((g) => (
                      <Item key={g.titulo} grupo={g} novas={novas} />
                    ))}
                  </ul>
                </section>
              ),
            )}
          </div>
        )}
      </div>
      <p className="so-leitor" role="status">
        {visiveis} {visiveis === 1 ? 'tarefa' : 'tarefas'}.
      </p>
    </div>
  );
}
