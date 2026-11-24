import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PARTES,
  type AlvoFocoGenUI,
  type CampoVigiado,
  type Contato,
  type FonteDocumento,
  type Parte,
  type Tarefa,
} from '../../../shared/model.ts';
import { rotuloCampo, rotuloCanalContato, rotuloFonte, rotuloParte } from '../format.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  chaveTarefa,
  tarefasDaParte,
  type FiltroParte,
  type GrupoTarefa,
} from '../matriz.ts';
import { IconeAviso, IconeConfere, IconeErro } from './icones.tsx';

interface Props {
  tarefas: readonly Tarefa[];
  contatos: readonly Contato[];
  filtro: FiltroParte;
  novas: ReadonlySet<string>;
  direcao: -1 | 0 | 1;
  painelId: string;
  rotuloAbaId: string;
  focoAtivo?: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
}

interface OrigemAgrupada {
  chave: string;
  campo: CampoVigiado;
  fonteA: FonteDocumento;
  fonteB: FonteDocumento;
  rotulo: string;
}

function extrairOrigens(ocorrencias: readonly Tarefa[]): OrigemAgrupada[] {
  const vistos = new Set<string>();
  const lista: OrigemAgrupada[] = [];
  for (const t of ocorrencias) {
    const { campo, fonteA, fonteB } = t.divergencia;
    const chave = `${campo}|${fonteA}|${fonteB}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    lista.push({
      chave,
      campo,
      fonteA,
      fonteB,
      rotulo: `${rotuloFonte(fonteA)} × ${rotuloFonte(fonteB)}`,
    });
  }
  return lista;
}

function origemCorrespondeFoco(origem: OrigemAgrupada, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'divergencia') {
    return (
      foco.campo === origem.campo &&
      ((foco.fonteA === origem.fonteA && foco.fonteB === origem.fonteB) ||
        (foco.fonteA === origem.fonteB && foco.fonteB === origem.fonteA))
    );
  }
  if (foco.tipo === 'celula') {
    return (
      foco.campo === origem.campo &&
      (foco.fonte === origem.fonteA || foco.fonte === origem.fonteB)
    );
  }
  return false;
}

function grupoCorrespondeFoco(grupo: GrupoTarefa, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'parte') return grupo.parte === foco.parte;
  if (foco.tipo === 'divergencia') {
    return grupo.ocorrencias.some(
      (t) =>
        t.divergencia.campo === foco.campo &&
        ((t.divergencia.fonteA === foco.fonteA && t.divergencia.fonteB === foco.fonteB) ||
          (t.divergencia.fonteA === foco.fonteB && t.divergencia.fonteB === foco.fonteA)),
    );
  }
  if (foco.tipo === 'celula') {
    return grupo.ocorrencias.some(
      (t) =>
        t.divergencia.campo === foco.campo &&
        (t.divergencia.fonteA === foco.fonte || t.divergencia.fonteB === foco.fonte),
    );
  }
  return false;
}

type EstadoEnvio =
  | { tipo: 'ocioso' }
  | { tipo: 'enviando' }
  | { tipo: 'enviado' }
  | { tipo: 'erro'; mensagem: string; abrirAgenda: boolean };

function ItemTarefa({
  grupo,
  novas,
  focoAtivo,
  aoFocar,
}: {
  grupo: GrupoTarefa;
  novas: ReadonlySet<string>;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
}) {
  const unica = grupo.ocorrencias.length === 1;
  const nova = grupo.ocorrencias.some((t) => novas.has(chaveTarefa(t)));
  const focada = grupoCorrespondeFoco(grupo, focoAtivo);
  const origens = useMemo(() => extrairOrigens(grupo.ocorrencias), [grupo.ocorrencias]);

  function alternarOrigem(origem: OrigemAgrupada) {
    if (!aoFocar) return;
    if (origemCorrespondeFoco(origem, focoAtivo) && focoAtivo?.tipo === 'divergencia') {
      aoFocar(null);
      return;
    }
    aoFocar({
      tipo: 'divergencia',
      campo: origem.campo,
      fonteA: origem.fonteA,
      fonteB: origem.fonteB,
    });
  }

  const classes = ['tarefa', nova ? 'tarefa-nova' : '', focada ? 'tarefa-focada' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <li className={classes}>
      <div className="tarefa-cab">
        <p className="tarefa-titulo">{grupo.titulo}</p>
        <div className="tarefa-badges">
          {!unica && <span className="pilula-sutil num">{grupo.ocorrencias.length} origens</span>}
          {nova && <span className="pilula-coord">Nova</span>}
        </div>
      </div>

      {unica && <p className="tarefa-detalhe">{grupo.ocorrencias[0]?.detalhe}</p>}

      <div className="origens-lista" role="group" aria-label="Origens da divergência">
        {origens.map((origem) => {
          const ativa = origemCorrespondeFoco(origem, focoAtivo);
          if (!aoFocar) {
            return (
              <span key={origem.chave} className="origem-linha">
                <span className="origem-campo">{rotuloCampo(origem.campo)}:</span>{' '}
                <span className="meta">{origem.rotulo}</span>
              </span>
            );
          }
          return (
            <button
              key={origem.chave}
              type="button"
              className="origem-btn"
              aria-pressed={ativa}
              onClick={() => alternarOrigem(origem)}
            >
              <span className="origem-campo">{rotuloCampo(origem.campo)}:</span>{' '}
              <span>{origem.rotulo}</span>
            </button>
          );
        })}
      </div>
    </li>
  );
}

function SetorTarefas({
  parte,
  itens,
  contato,
  novas,
  focoAtivo,
  aoFocar,
  aoNotificar,
  aoAbrirAgenda,
}: {
  parte: Parte;
  itens: readonly GrupoTarefa[];
  contato: Contato | undefined;
  novas: ReadonlySet<string>;
  focoAtivo: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
}) {
  const [envio, setEnvio] = useState<EstadoEnvio>({ tipo: 'ocioso' });
  const resetTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const primeiroCampo = itens[0]?.ocorrencias[0]?.divergencia.campo;
  const canalIncompativel = contato?.canal === 'email';
  const semCanalDireto = !contato || canalIncompativel;
  const setorFocado = focoAtivo?.tipo === 'parte' && focoAtivo.parte === parte;

  async function dispararAviso() {
    if (envio.tipo === 'enviando') return;
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setEnvio({ tipo: 'enviando' });
    try {
      await aoNotificar(parte, primeiroCampo);
      setEnvio({ tipo: 'enviado' });
      resetTimerRef.current = window.setTimeout(() => {
        setEnvio({ tipo: 'ocioso' });
        resetTimerRef.current = null;
      }, 4500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Falha ao enviar aviso.';
      const envolveContato = /contato|canal/i.test(msg);
      setEnvio({ tipo: 'erro', mensagem: msg, abrirAgenda: envolveContato });
    }
  }

  return (
    <section
      aria-label={rotuloParte(parte)}
      className={setorFocado ? 'tarefas-grupo tarefas-grupo-focado' : 'tarefas-grupo'}
    >
      <div className="tarefas-grupo-cab">
        <div className="tarefas-grupo-info">
          <div className="tarefas-grupo-titulo-linha">
            <h3 className="tarefas-grupo-titulo">{rotuloParte(parte)}</h3>
            <span className="tarefas-grupo-cont mono num">{itens.length}</span>
          </div>
          <span className="tarefas-grupo-contato">
            {contato ? (
              <>
                {rotuloCanalContato(contato.canal)} ·{' '}
                <span className="mono">{contato.destino}</span>
              </>
            ) : (
              'Sem contato cadastrado'
            )}
          </span>
        </div>

        <div className="tarefas-grupo-acao">
          {semCanalDireto ? (
            <button
              type="button"
              className="botao-sutil tarefa-btn-acao"
              onClick={() => aoAbrirAgenda(parte)}
            >
              {contato ? 'Configurar canal' : 'Configurar'}
            </button>
          ) : (
            <button
              type="button"
              className={
                envio.tipo === 'enviado'
                  ? 'botao-sutil tarefa-btn-acao tarefa-btn-ok'
                  : 'botao-sutil tarefa-btn-acao'
              }
              disabled={envio.tipo === 'enviando'}
              onClick={() => void dispararAviso()}
            >
              {envio.tipo === 'enviando' ? (
                <span>Enviando…</span>
              ) : envio.tipo === 'enviado' ? (
                <>
                  <IconeConfere />
                  <span>Enviado</span>
                </>
              ) : (
                <>
                  <IconeAviso />
                  <span>Avisar</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {envio.tipo === 'erro' && (
        <div className="tarefa-envio-erro" role="alert">
          <span className="tarefa-envio-erro-texto">
            <IconeErro />
            <span>{envio.mensagem}</span>
          </span>
          {envio.abrirAgenda && (
            <button
              type="button"
              className="tarefa-link-config"
              onClick={() => aoAbrirAgenda(parte)}
            >
              Configurar
            </button>
          )}
        </div>
      )}

      <ul>
        {itens.map((g) => (
          <ItemTarefa
            key={g.titulo}
            grupo={g}
            novas={novas}
            focoAtivo={focoAtivo}
            {...(aoFocar ? { aoFocar } : {})}
          />
        ))}
      </ul>
    </section>
  );
}

export function TarefasPorParte({
  tarefas,
  contatos,
  filtro,
  novas,
  direcao,
  painelId,
  rotuloAbaId,
  focoAtivo = null,
  aoFocar,
  aoNotificar,
  aoAbrirAgenda,
}: Props) {
  const contatoPorParte = useMemo(
    () => new Map<Parte, Contato>(contatos.map((c) => [c.parte, c])),
    [contatos],
  );

  const partes: Parte[] =
    filtro === FILTRO_TODAS
      ? PARTES.filter((p) => tarefasDaParte(tarefas, p).length > 0)
      : [filtro];
  const grupos = partes.map((parte) => ({
    parte,
    itens: agruparTarefas(tarefasDaParte(tarefas, parte)),
  }));
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
            Nenhuma tarefa aberta. Elas aparecem quando duas fontes declaram valores diferentes para o mesmo campo.
          </p>
        )}
        {tarefas.length > 0 && visiveis === 0 && filtro !== FILTRO_TODAS && (
          <p className="dica tarefas-vazio">Nenhuma tarefa para {rotuloParte(filtro)} neste pedido.</p>
        )}
        {visiveis > 0 && (
          <div className="tarefas-superficie">
            {grupos.map(({ parte, itens }) =>
              itens.length === 0 ? null : (
                <SetorTarefas
                  key={parte}
                  parte={parte}
                  itens={itens}
                  contato={contatoPorParte.get(parte)}
                  novas={novas}
                  focoAtivo={focoAtivo}
                  {...(aoFocar ? { aoFocar } : {})}
                  aoNotificar={aoNotificar}
                  aoAbrirAgenda={aoAbrirAgenda}
                />
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
