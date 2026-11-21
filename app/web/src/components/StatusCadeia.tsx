import type { RespostaAuditoria } from '../../../shared/model.ts';
import type { Carga } from '../useTorre.ts';
import { IconeErro, IconeOk } from './icones.tsx';

function Ancora({ a }: { a: RespostaAuditoria }) {
  if (a.ancora === null) return <p className="meta">Sem âncora pública ainda.</p>;
  return (
    <p className="meta">
      {a.rootConfere ? 'Âncora registrada: a raiz atual confere.' : 'A raiz atual não confere com a âncora registrada.'}
    </p>
  );
}

export function StatusCadeia({ auditoria, aoVerificar }: { auditoria: Carga<RespostaAuditoria>; aoVerificar: () => void }) {
  return (
    <div className="cadeia">
      {auditoria.estado === 'carregando' && <p className="dica">Verificando a cadeia…</p>}
      {auditoria.estado === 'erro' && (
        <p className="aviso-erro" role="alert">
          Não foi possível verificar: {auditoria.mensagem}
        </p>
      )}
      {auditoria.estado === 'ok' && auditoria.dados.valida && (
        <div className="cadeia-ok">
          <p className="cadeia-titulo">
            <IconeOk /> Cadeia íntegra
          </p>
          <p className="meta">{auditoria.dados.total} eventos conferidos, do primeiro ao último.</p>
          <Ancora a={auditoria.dados} />
        </div>
      )}
      {auditoria.estado === 'ok' && !auditoria.dados.valida && (
        <div className="cadeia-falha" role="alert">
          <p className="cadeia-titulo">
            <IconeErro /> Cadeia adulterada
          </p>
          <p>
            Falha no evento nº {(auditoria.dados.indiceFalha ?? 0) + 1} de {auditoria.dados.total}: o hash recalculado não
            bate com o gravado.
          </p>
        </div>
      )}
      <button type="button" className="botao" onClick={aoVerificar}>
        Verificar de novo
      </button>
    </div>
  );
}
