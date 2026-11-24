import { useEffect, useRef, useState } from 'react';
import type { RespostaAuditoria } from '../../../shared/model.ts';
import { copiarTexto } from '../copiar.ts';
import { CamadaShader } from '../shaders/index.ts';
import type { Carga } from '../useTorre.ts';
import {
  IconeConfere,
  IconeCopiar,
  IconeErro,
  IconeEscudo,
  IconeExterno,
} from './icones.tsx';

interface Props {
  auditoria: Carga<RespostaAuditoria>;
  pulsoExterno?: number;
  aoVerificar: () => void;
  aoAbrirAuditoria: () => void;
  aoAncorar: () => Promise<void>;
  aoAnunciar?: (texto: string) => void;
}

function urlAncoraSegura(ancora: Record<string, unknown> | null | undefined): string | null {
  if (!ancora) return null;
  const raw = ancora['url'];
  if (typeof raw !== 'string') return null;
  const limpa = raw.trim();
  return /^https?:\/\//i.test(limpa) ? limpa : null;
}

export function StatusCadeia({
  auditoria,
  pulsoExterno = 0,
  aoVerificar,
  aoAbrirAuditoria,
  aoAncorar,
  aoAnunciar,
}: Props) {
  // Preserva o último resultado válido durante a reverificação para o selo não saltar.
  const [ultimoOk, setUltimoOk] = useState<RespostaAuditoria | null>(
    auditoria.estado === 'ok' ? auditoria.dados : null,
  );
  const [copiado, setCopiado] = useState(false);
  const [ancorando, setAncorando] = useState(false);
  const [pulsoSelo, setPulsoSelo] = useState(0);
  const copiaTimerRef = useRef<number | null>(null);
  const ultimaRaizRef = useRef<string | null>(
    auditoria.estado === 'ok' ? auditoria.dados.rootAtual : null,
  );
  const pulsoExternoRef = useRef(pulsoExterno);

  if (auditoria.estado === 'ok' && auditoria.dados !== ultimoOk) {
    setUltimoOk(auditoria.dados);
  }

  useEffect(() => {
    if (auditoria.estado !== 'ok') return;
    if (ultimaRaizRef.current !== null && ultimaRaizRef.current !== auditoria.dados.rootAtual) {
      setPulsoSelo((n) => n + 1);
    }
    ultimaRaizRef.current = auditoria.dados.rootAtual;
  }, [auditoria]);

  useEffect(() => {
    if (pulsoExterno > pulsoExternoRef.current) {
      pulsoExternoRef.current = pulsoExterno;
      setPulsoSelo((n) => n + 1);
    }
  }, [pulsoExterno]);

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
  const urlBaseScan = urlAncoraSegura(dados?.ancora);

  async function copiarRaiz(raiz: string) {
    if (!(await copiarTexto(raiz))) return;
    setCopiado(true);
    aoAnunciar?.('Raiz Merkle copiada.');
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    copiaTimerRef.current = window.setTimeout(() => {
      setCopiado(false);
      copiaTimerRef.current = null;
    }, 1800);
  }

  async function dispararAncora() {
    if (ancorando) return;
    setAncorando(true);
    try {
      await aoAncorar();
      setPulsoSelo((n) => n + 1);
    } finally {
      setAncorando(false);
    }
  }

  return (
    <div
      className={falha ? 'selo-cadeia selo-cadeia-falha' : 'selo-cadeia'}
      role={falha ? 'alert' : undefined}
    >
      <CamadaShader
        shader="seloCadeia"
        ativo={verificando || ancorando}
        modo={falha ? 2 : 0}
        pulsoChave={pulsoSelo}
        duracaoPulsoMs={720}
        raioPx={4}
        className="selo-cadeia-shader"
      />

      <div className="selo-cadeia-info">
        {auditoria.estado === 'erro' && (
          <>
            <span className="selo-status selo-status-erro">
              <IconeErro />
              <span>Auditoria indisponível</span>
            </span>
            <button
              type="button"
              className="selo-btn"
              onClick={aoVerificar}
              disabled={verificando}
            >
              Tentar
            </button>
          </>
        )}

        {verificando && !dados && (
          <span className="selo-status selo-status-neutro">
            <IconeEscudo />
            <span>Verificando cadeia…</span>
          </span>
        )}

        {dados?.valida && (
          <>
            <span className="selo-status selo-status-ok">
              <IconeEscudo />
              <span>Cadeia íntegra</span>
            </span>
            <span className="selo-sep" aria-hidden="true">·</span>
            <span className="selo-meta num">{dados.total} ev</span>
            <span className="selo-sep" aria-hidden="true">·</span>
            <button
              type="button"
              className={copiado ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'}
              onClick={() => void copiarRaiz(dados.rootAtual)}
              aria-label={
                copiado
                  ? `Raiz ${raizCurta} copiada`
                  : `Copiar Raiz Merkle ${raizCurta}`
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
          </>
        )}

        {falha && dados && (
          <>
            <span className="selo-status selo-status-erro">
              <IconeErro />
              <span>Cadeia adulterada</span>
            </span>
            <span className="selo-sep" aria-hidden="true">·</span>
            <span className="selo-meta num">
              Ev {(dados.indiceFalha ?? 0) + 1}/{dados.total}
            </span>
          </>
        )}
      </div>

      <div className="selo-cadeia-acoes">
        <button type="button" className="selo-btn" onClick={aoAbrirAuditoria}>
          Auditar
        </button>

        {urlBaseScan ? (
          <a
            href={urlBaseScan}
            target="_blank"
            rel="noopener noreferrer"
            className="selo-btn selo-btn-link"
          >
            <span>BaseScan</span>
            <IconeExterno />
          </a>
        ) : (
          <button
            type="button"
            className="selo-btn selo-btn-destaque"
            disabled={ancorando || verificando}
            onClick={() => void dispararAncora()}
          >
            {ancorando ? 'Ancorando…' : 'Ancorar'}
          </button>
        )}
      </div>
    </div>
  );
}
