import { useEffect, useRef, useState } from 'react';
import type { RespostaAuditoria } from '../../../shared/model.ts';
import { copiarTexto } from '../copiar.ts';
import type { Carga } from '../useTorre.ts';
import { IconeConfere, IconeCopiar, IconeErro, IconeOk } from './icones.tsx';

function Ancora({ a }: { a: RespostaAuditoria }) {
  if (a.ancora === null) return <>Âncora pendente</>;
  return <>{a.rootConfere ? 'Âncora conferida' : 'Raiz diverge da âncora'}</>;
}

interface Props {
  auditoria: Carga<RespostaAuditoria>;
  aoVerificar: () => void;
  aoAnunciar?: (texto: string) => void;
}

export function StatusCadeia({ auditoria, aoVerificar, aoAnunciar }: Props) {
  // Preserva o último resultado válido durante a reverificação para o cartão
  // não colapsar de altura ao clicar em "Verificar de novo".
  const [ultimoOk, setUltimoOk] = useState<RespostaAuditoria | null>(
    auditoria.estado === 'ok' ? auditoria.dados : null,
  );
  const [copiado, setCopiado] = useState(false);
  const copiaTimerRef = useRef<number | null>(null);

  if (auditoria.estado === 'ok' && auditoria.dados !== ultimoOk) {
    setUltimoOk(auditoria.dados);
  }

  useEffect(
    () => () => {
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    },
    [],
  );

  const verificando = auditoria.estado === 'carregando';
  const dados =
    auditoria.estado === 'ok'
      ? auditoria.dados
      : verificando
        ? ultimoOk
        : null;
  const falha = dados !== null && !dados.valida;
  const raizCurta = dados ? dados.rootAtual.slice(0, 8) : '';

  async function copiarRaiz(raiz: string) {
    if (!(await copiarTexto(raiz))) return;
    setCopiado(true);
    aoAnunciar?.('Raiz da cadeia copiada.');
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    copiaTimerRef.current = window.setTimeout(() => {
      setCopiado(false);
      copiaTimerRef.current = null;
    }, 1800);
  }

  return (
    <div className={falha ? 'cadeia cadeia-falha' : 'cadeia'} role={falha ? 'alert' : undefined}>
      {auditoria.estado === 'erro' && (
        <div className="cadeia-topo">
          <p className="aviso-erro" role="alert">
            Não foi possível verificar: {auditoria.mensagem}
          </p>
          <button
            type="button"
            className="botao-sutil cadeia-btn"
            onClick={aoVerificar}
            disabled={verificando}
          >
            Verificar de novo
          </button>
        </div>
      )}

      {verificando && !dados && (
        <div className="cadeia-topo">
          <p className="dica">Verificando a cadeia…</p>
          <button type="button" className="botao-sutil cadeia-btn" disabled>
            Verificando…
          </button>
        </div>
      )}

      {dados?.valida && (
        <>
          <div className="cadeia-topo">
            <span className="pilula-ok">
              <IconeOk />
              Cadeia íntegra
            </span>
            <button
              type="button"
              className="botao-sutil cadeia-btn"
              onClick={aoVerificar}
              disabled={verificando}
            >
              {verificando ? 'Verificando…' : 'Verificar de novo'}
            </button>
          </div>
          <div className="cadeia-meta">
            <p className="meta num">
              {dados.total} {dados.total === 1 ? 'evento' : 'eventos'} · <Ancora a={dados} />
            </p>
            <button
              type="button"
              className={copiado ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'}
              onClick={() => void copiarRaiz(dados.rootAtual)}
              aria-label={
                copiado
                  ? `Raiz ${raizCurta} copiada`
                  : `Raiz ${raizCurta}: copiar hash completo`
              }
              title={copiado ? 'Raiz copiada' : `Copiar raiz ${dados.rootAtual}`}
            >
              <span className="mono">Raiz {raizCurta}</span>
              <span className="icone-slot-sm" aria-hidden="true">
                <span className={`icone-troca icone-troca-rapida ${copiado ? '' : 'visivel'}`}>
                  <IconeCopiar />
                </span>
                <span className={`icone-troca icone-troca-rapida ${copiado ? 'visivel' : ''}`}>
                  <IconeConfere />
                </span>
              </span>
            </button>
          </div>
        </>
      )}

      {falha && dados && (
        <>
          <div className="cadeia-topo">
            <span className="pilula-erro">
              <IconeErro />
              Cadeia adulterada
            </span>
            <button
              type="button"
              className="botao-sutil cadeia-btn"
              onClick={aoVerificar}
              disabled={verificando}
            >
              {verificando ? 'Verificando…' : 'Verificar de novo'}
            </button>
          </div>
          <p className="meta">
            Falha no evento nº {(dados.indiceFalha ?? 0) + 1} de {dados.total}: hash recalculado não confere.
          </p>
        </>
      )}
    </div>
  );
}
