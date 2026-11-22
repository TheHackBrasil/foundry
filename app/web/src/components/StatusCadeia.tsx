import type { RespostaAuditoria } from '../../../shared/model.ts';
import type { Carga } from '../useTorre.ts';
import { IconeErro, IconeOk } from './icones.tsx';

function Ancora({ a }: { a: RespostaAuditoria }) {
  if (a.ancora === null) return <>Âncora pública: ainda não registrada.</>;
  return <>{a.rootConfere ? 'Âncora registrada: a raiz atual confere.' : 'A raiz atual não confere com a âncora registrada.'}</>;
}

export function StatusCadeia({ auditoria, aoVerificar }: { auditoria: Carga<RespostaAuditoria>; aoVerificar: () => void }) {
  const dados = auditoria.estado === 'ok' ? auditoria.dados : null;
  const falha = dados !== null && !dados.valida;
  return (
    <div className={falha ? 'cadeia cadeia-falha' : 'cadeia'} role={falha ? 'alert' : undefined}>
      {auditoria.estado === 'carregando' && <p className="dica">Verificando a cadeia…</p>}
      {auditoria.estado === 'erro' && <p className="aviso-erro" role="alert">Não foi possível verificar: {auditoria.mensagem}</p>}
      {dados?.valida && (
        <>
          <IconeOk />
          <p className="cadeia-titulo">Cadeia íntegra</p>
          <p className="meta">
            {dados.total} {dados.total === 1 ? 'evento conferido' : 'eventos conferidos'}, do primeiro ao último. <Ancora a={dados} />{' '}
            Raiz <span className="mono">{dados.rootAtual.slice(0, 8)}</span>.
          </p>
        </>
      )}
      {falha && dados && (
        <>
          <IconeErro />
          <p className="cadeia-titulo">Cadeia adulterada</p>
          <p className="meta">
            Falha no evento nº {(dados.indiceFalha ?? 0) + 1} de {dados.total}: o hash recalculado não bate com o gravado.
          </p>
        </>
      )}
      <button type="button" className="botao" onClick={aoVerificar}>
        Verificar de novo
      </button>
    </div>
  );
}
