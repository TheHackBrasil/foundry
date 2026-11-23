import type { RespostaAuditoria } from '../../../shared/model.ts';
import type { Carga } from '../useTorre.ts';
import { IconeErro, IconeOk } from './icones.tsx';

function Ancora({ a }: { a: RespostaAuditoria }) {
  if (a.ancora === null) return <>Âncora pública pendente.</>;
  return <>{a.rootConfere ? 'Âncora conferida.' : 'Raiz diverge da âncora.'}</>;
}

export function StatusCadeia({
  auditoria,
  aoVerificar,
}: {
  auditoria: Carga<RespostaAuditoria>;
  aoVerificar: () => void;
}) {
  const dados = auditoria.estado === 'ok' ? auditoria.dados : null;
  const falha = dados !== null && !dados.valida;
  return (
    <div className={falha ? 'cadeia cadeia-falha' : 'cadeia'} role={falha ? 'alert' : undefined}>
      {auditoria.estado === 'carregando' && <p className="dica">Verificando a cadeia…</p>}
      {auditoria.estado === 'erro' && (
        <p className="aviso-erro" role="alert">
          Não foi possível verificar: {auditoria.mensagem}
        </p>
      )}
      {dados?.valida && (
        <>
          <div className="cadeia-topo">
            <span className="pilula-ok">
              <IconeOk />
              Cadeia íntegra
            </span>
            <span className="cadeia-raiz mono">Raiz {dados.rootAtual.slice(0, 8)}</span>
          </div>
          <p className="meta num">
            {dados.total} {dados.total === 1 ? 'evento conferido' : 'eventos conferidos'}. <Ancora a={dados} />
          </p>
        </>
      )}
      {falha && dados && (
        <>
          <div className="cadeia-topo">
            <span className="pilula-erro">
              <IconeErro />
              Cadeia adulterada
            </span>
          </div>
          <p className="meta">
            Falha no evento nº {(dados.indiceFalha ?? 0) + 1} de {dados.total}: hash recalculado não confere.
          </p>
        </>
      )}
      <button type="button" className="botao-sutil cadeia-btn" onClick={aoVerificar}>
        Verificar de novo
      </button>
    </div>
  );
}
