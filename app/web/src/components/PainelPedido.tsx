import { useMemo, useState } from 'react';
import type { ProjecaoPedido, RespostaAuditoria } from '../../../shared/model.ts';
import { chaveCurta } from '../format.ts';
import { FILTRO_TODAS, montarMatriz, type FiltroParte } from '../matriz.ts';
import type { Carga } from '../useTorre.ts';
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

function Conteudo({ dados, auditoria, novas, aoVerificar }: Omit<Props, 'id' | 'projecao'> & { dados: ProjecaoPedido }) {
  const [filtro, setFiltro] = useState<FiltroParte>(FILTRO_TODAS);
  const matriz = useMemo(() => montarMatriz(dados.versoes, dados.divergencias), [dados.versoes, dados.divergencias]);

  return (
    <>
      {dados.pedido && (
        <p className="partes-pedido">
          {dados.pedido.emitente.nome} para {dados.pedido.destinatario.nome}. {dados.totalEventos} eventos no registro.
        </p>
      )}
      <section className="bloco" aria-labelledby="bloco-cadeia">
        <h3 id="bloco-cadeia">Registro verificável</h3>
        <StatusCadeia auditoria={auditoria} aoVerificar={aoVerificar} />
      </section>
      <section className="bloco" aria-labelledby="bloco-matriz">
        <h3 id="bloco-matriz">Fontes e campos</h3>
        <MatrizFontes matriz={matriz} />
      </section>
      <section className="bloco" aria-labelledby="bloco-tarefas">
        <h3 id="bloco-tarefas">Tarefas por parte</h3>
        <TarefasPorParte tarefas={dados.tarefas} filtro={filtro} aoFiltrar={setFiltro} novas={novas} />
      </section>
    </>
  );
}

export function PainelPedido({ id, projecao, auditoria, novas, aoVerificar }: Props) {
  return (
    <article aria-labelledby="pedido-titulo">
      <h2 id="pedido-titulo">Pedido {chaveCurta(id)}</h2>
      <p className="chave mono">{id}</p>
      {projecao.estado === 'carregando' && <p className="dica">Carregando o pedido…</p>}
      {projecao.estado === 'erro' && (
        <p className="aviso-erro" role="alert">
          Não foi possível carregar o pedido: {projecao.mensagem}
        </p>
      )}
      {projecao.estado === 'ok' && (
        <Conteudo dados={projecao.dados} auditoria={auditoria} novas={novas} aoVerificar={aoVerificar} />
      )}
    </article>
  );
}
