import { useMemo, useState } from 'react';
import { PARTES } from '../../../shared/model.ts';
import type { ProjecaoPedido, RespostaAuditoria } from '../../../shared/model.ts';
import { ROTULO_CAMPO, ROTULO_FONTE, chaveAgrupada, chaveCurta, formatarMomento, formatarValor, variacao } from '../format.ts';
import { FILTRO_TODAS, montarMatriz, tarefasDaParte, type FiltroParte, type LinhaMatriz } from '../matriz.ts';
import type { Carga } from '../useTorre.ts';
import { IconeConfere, IconeDiverge } from './icones.tsx';
import { MatrizFontes } from './MatrizFontes.tsx';
import { StatusCadeia } from './StatusCadeia.tsx';
import { TarefasPorParte } from './TarefasPorParte.tsx';

interface Props {
  id: string;
  projecao: Carga<ProjecaoPedido>;
  auditoria: Carga<RespostaAuditoria>;
  novas: ReadonlySet<string>;
  aoVerificar: () => void;
}

// Frase que repete, em texto corrido, o que a matriz mostra por célula.
function Resumo({ linhas }: { linhas: readonly LinhaMatriz[] }) {
  const divergentes = linhas.filter((l) => l.divergente);
  if (divergentes.length === 0) {
    return (
      <p className="resumo-mx sem-diverge">
        <IconeConfere />
        <span>Nenhum campo diverge entre as fontes que já declararam valor.</span>
      </p>
    );
  }
  return (
    <p className="resumo-mx">
      <IconeDiverge />
      <span>
        <strong>
          {divergentes.length} {divergentes.length === 1 ? 'campo diverge' : 'campos divergem'}.
        </strong>{' '}
        {divergentes.map((l) => {
          const ref = l.referencia;
          const outras = l.celulas.filter((c) => c.emConflito && !c.referencia);
          return (
            <span key={l.campo}>
              {ROTULO_CAMPO[l.campo]}:{' '}
              {outras.map((c, i) => {
                const delta = variacao(l.campo, c.valor, ref?.valor);
                return (
                  <span key={c.fonte}>
                    {i > 0 && '; '}
                    {ROTULO_FONTE[c.fonte]} indica {formatarValor(l.campo, c.valor)}
                    {ref && ` e ${ROTULO_FONTE[ref.fonte]}, ${formatarValor(l.campo, ref.valor)}`}
                    {delta && ` (${delta})`}
                  </span>
                );
              })}
              .{' '}
            </span>
          );
        })}
      </span>
    </p>
  );
}

function Versoes({ versoes }: { versoes: ProjecaoPedido['versoes'] }) {
  if (versoes.length === 0) return null;
  const recentes = [...versoes].sort((a, b) => b.geradaEm.localeCompare(a.geradaEm) || b.versao - a.versao);
  return (
    <section aria-labelledby="bloco-versoes">
      <div className="sec-cab">
        <h3 id="bloco-versoes">Versões recebidas</h3>
        <span className="meta">Só acréscimo: nada é apagado do registro.</span>
      </div>
      <ul className="versoes">
        {recentes.map((v) => (
          <li key={`${v.fonte}-${v.versao}`}>
            <time dateTime={v.geradaEm}>{formatarMomento(v.geradaEm)}</time>
            <span>
              {ROTULO_FONTE[v.fonte]} v{v.versao} {v.versao === 1 ? 'registrada' : 'recebida'}.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Conteudo({ id, dados, auditoria, novas, aoVerificar }: Omit<Props, 'projecao'> & { dados: ProjecaoPedido }) {
  const matriz = useMemo(() => montarMatriz(dados.versoes, dados.divergencias), [dados.versoes, dados.divergencias]);
  // Abre na primeira parte que tem tarefa; "Todas" continua à mão.
  const [filtro, setFiltro] = useState<FiltroParte>(
    () => PARTES.find((p) => tarefasDaParte(dados.tarefas, p).length > 0) ?? FILTRO_TODAS,
  );

  return (
    <>
      <div className="painel-cab">
        <div>
          <h2 id="pedido-titulo">Pedido {chaveCurta(id)}</h2>
          {dados.pedido && (
            <p className="partes-pedido">
              {dados.pedido.emitente.nome} para {dados.pedido.destinatario.nome}.
            </p>
          )}
          <p className="chave mono">Chave NF-e {chaveAgrupada(id)}</p>
        </div>
        <StatusCadeia auditoria={auditoria} aoVerificar={aoVerificar} />
      </div>
      <div className="cols" data-fontes={matriz.fontes.length}>
        <section aria-labelledby="bloco-matriz">
          <div className="sec-cab">
            <h3 id="bloco-matriz">Fontes e campos</h3>
            <span className="meta">Referência: a primeira fonte que declara o campo. Células diferentes dela ficam marcadas.</span>
          </div>
          <MatrizFontes matriz={matriz} />
          {matriz.fontes.length > 0 && <Resumo linhas={matriz.linhas} />}
        </section>
        <section aria-labelledby="bloco-tarefas">
          <div className="sec-cab">
            <h3 id="bloco-tarefas">Tarefas por parte</h3>
          </div>
          <TarefasPorParte tarefas={dados.tarefas} filtro={filtro} aoFiltrar={setFiltro} novas={novas} />
        </section>
      </div>
      <Versoes versoes={dados.versoes} />
    </>
  );
}

export function PainelPedido({ id, projecao, auditoria, novas, aoVerificar }: Props) {
  return (
    <article aria-labelledby="pedido-titulo">
      {projecao.estado === 'carregando' && (
        <>
          <h2 id="pedido-titulo" className="so-leitor">Pedido {chaveCurta(id)}</h2>
          <p className="dica">Carregando o pedido…</p>
        </>
      )}
      {projecao.estado === 'erro' && (
        <>
          <h2 id="pedido-titulo" className="so-leitor">Pedido {chaveCurta(id)}</h2>
          <p className="aviso-erro" role="alert">Não foi possível carregar o pedido: {projecao.mensagem}</p>
        </>
      )}
      {projecao.estado === 'ok' && <Conteudo id={id} dados={projecao.dados} auditoria={auditoria} novas={novas} aoVerificar={aoVerificar} />}
    </article>
  );
}
