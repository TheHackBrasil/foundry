// Linha do tempo do caso (spec 0017, US5, RF26, T771): cada ação com canal,
// horário, aprovação e custo, a evidência por hash (áudio com player,
// transcrição, mensagem, e-mail bruto) e a declaração extraída com a
// confiança. O pai recarrega a lista a cada evento do SSE.

import { useEffect, useId, useRef, useState } from 'react';
import type { ItemLinhaTempo } from '../../../shared/casos.ts';
import type { CampoVigiado } from '../../../shared/model.ts';
import { formatarConfianca, formatarMomento, formatarValor, rotuloCampo, rotuloFonte } from '../format.ts';
import { obterEvidencia } from './api.ts';
import {
  formatarBrl,
  rotuloCanalOperador,
  rotuloCategoria,
  rotuloCodigo,
  rotuloItemLinha,
} from './operador.ts';

export type CargaLinha =
  | { estado: 'carregando' }
  | { estado: 'ok'; itens: ItemLinhaTempo[] }
  | { estado: 'erro'; mensagem: string };

export interface LinhaTempoCasoProps {
  casoId: string;
  carga: CargaLinha;
  // Estado do SSE, quando o pai o conhece: só informa, não muda a lista.
  aoVivo?: boolean;
}

const CLASSE_CATEGORIA: Record<ItemLinhaTempo['categoria'], string> = {
  caso: 'pilula-neutra',
  operador: 'pilula-neutra',
  aprovacao: 'pilula-warn',
  tentativa: 'pilula-sutil',
  evidencia: 'pilula-ok',
  declaracao: 'pilula-ok',
};

type EstadoEvidencia =
  | { estado: 'fechada' }
  | { estado: 'carregando' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'audio'; url: string }
  | { estado: 'texto'; texto: string; falas: Fala[] | null };

interface Fala {
  quem: string;
  texto: string;
}

// Transcrição em JSON: lista de falas { quem|papel|falante, texto }.
export function lerFalas(conteudo: unknown): Fala[] | null {
  const lista = Array.isArray(conteudo)
    ? conteudo
    : conteudo && typeof conteudo === 'object' && Array.isArray((conteudo as Record<string, unknown>)['falas'])
      ? ((conteudo as Record<string, unknown>)['falas'] as unknown[])
      : null;
  if (!lista) return null;
  const falas: Fala[] = [];
  for (const f of lista) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const texto = typeof r['texto'] === 'string' ? r['texto'] : typeof r['text'] === 'string' ? r['text'] : null;
    const quem = [r['quem'], r['papel'], r['falante'], r['role']].find((x) => typeof x === 'string') as string | undefined;
    if (texto) falas.push({ quem: quem ?? 'fala', texto });
  }
  return falas.length > 0 ? falas : null;
}

function rotuloEvidencia(item: ItemLinhaTempo, indice: number, total: number): string {
  if (item.tipo === 'contato_planejado' || item.tipo === 'contato_aprovado' || item.tipo === 'contato_recusado') {
    return 'roteiro';
  }
  if (item.categoria === 'declaracao') return total > 1 ? `evidência ${indice + 1} da declaração` : 'evidência da declaração';
  if (item.tipo === 'ligacao_concluida') return indice === 0 && total > 1 ? 'áudio da ligação' : total > 1 ? 'transcrição' : 'evidência da ligação';
  return total > 1 ? `evidência ${indice + 1}` : 'evidência';
}

export function EvidenciaHash({ casoId, hash, rotulo }: { casoId: string; hash: string; rotulo: string }) {
  const [ev, setEv] = useState<EstadoEvidencia>({ estado: 'fechada' });
  const urlRef = useRef<string | null>(null);
  const regiaoId = useId();

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  async function abrir() {
    if (ev.estado !== 'fechada' && ev.estado !== 'erro') {
      setEv({ estado: 'fechada' });
      return;
    }
    setEv({ estado: 'carregando' });
    try {
      const { tipoConteudo, blob } = await obterEvidencia(casoId, hash);
      if (tipoConteudo.startsWith('audio/')) {
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = URL.createObjectURL(blob);
        setEv({ estado: 'audio', url: urlRef.current });
        return;
      }
      const texto = await blob.text();
      let falas: Fala[] | null = null;
      let mostrado = texto;
      if (tipoConteudo === 'application/json' || /^\s*[[{]/.test(texto)) {
        try {
          const json: unknown = JSON.parse(texto);
          falas = lerFalas(json);
          mostrado = JSON.stringify(json, null, 2);
        } catch {
          // texto que parecia JSON e não era: mostra cru
        }
      }
      setEv({ estado: 'texto', texto: mostrado, falas });
    } catch (e) {
      setEv({ estado: 'erro', mensagem: e instanceof Error ? e.message : 'Não foi possível abrir a evidência.' });
    }
  }

  const aberta = ev.estado === 'audio' || ev.estado === 'texto';
  return (
    <div className="op-evidencia">
      <button
        type="button"
        className="botao-sutil"
        aria-expanded={aberta}
        aria-controls={regiaoId}
        disabled={ev.estado === 'carregando'}
        onClick={() => void abrir()}
      >
        {aberta ? 'Fechar' : 'Abrir'} {rotulo}{' '}
        <span className="mono meta" aria-label={`hash ${hash}`}>
          {hash.slice(0, 10)}
        </span>
      </button>
      <div id={regiaoId}>
        {ev.estado === 'carregando' && (
          <p className="meta" role="status">
            Abrindo evidência…
          </p>
        )}
        {ev.estado === 'erro' && (
          <p className="aviso-erro" role="alert">
            {ev.mensagem}
          </p>
        )}
        {ev.estado === 'audio' && (
          <>
            {/* A transcrição da mesma ligação é o texto alternativo do áudio. */}
            <audio controls preload="metadata" src={ev.url} aria-label={`Gravação: ${rotulo}`} className="op-audio" />
            <p className="meta">A transcrição desta ligação aparece no mesmo registro, quando o fornecedor a entrega.</p>
          </>
        )}
        {ev.estado === 'texto' &&
          (ev.falas ? (
            <ol className="op-transcricao" aria-label={`Conteúdo: ${rotulo}`}>
              {ev.falas.map((f, i) => (
                <li key={i}>
                  <strong>{rotuloCodigo(f.quem)}:</strong> {f.texto}
                </li>
              ))}
            </ol>
          ) : (
            <pre className="op-evidencia-texto mono" aria-label={`Conteúdo: ${rotulo}`} tabIndex={0}>
              {ev.texto}
            </pre>
          ))}
      </div>
    </div>
  );
}

function CamposDeclarados({ item }: { item: ItemLinhaTempo }) {
  const campos = item.campos;
  if (!campos) return null;
  const chaves = (Object.keys(campos) as CampoVigiado[]).filter((k) => campos[k] !== undefined);
  if (chaves.length === 0) return null;
  return (
    <dl className="op-fat-lista">
      {chaves.map((k) => (
        <div key={k}>
          <dt className="meta">{rotuloCampo(k)}</dt>
          <dd className="mono">{formatarValor(k, campos[k])}</dd>
        </div>
      ))}
    </dl>
  );
}

const temFatos = (i: ItemLinhaTempo): boolean =>
  [i.canal, i.fonte, i.versao, i.aprovador, i.fornecedor, i.motivo, i.resultado, i.custoEstimadoBrl, i.custoBrl, i.confianca].some(
    (v) => v !== undefined,
  );

function ItemLinha({ casoId, item }: { casoId: string; item: ItemLinhaTempo }) {
  const hashes = item.hashes ?? [];
  return (
    <li className="op-linha-item" data-categoria={item.categoria}>
      <div className="op-caso-topo">
        <span className={CLASSE_CATEGORIA[item.categoria]}>{rotuloCategoria(item.categoria)}</span>
        <strong className="op-linha-titulo">{rotuloItemLinha(item)}</strong>
        <time className="meta mono num" dateTime={item.ts}>
          {formatarMomento(item.ts)}
        </time>
      </div>
      {temFatos(item) && (
        <dl className="op-fat-lista">
          {item.canal && (
            <div>
              <dt className="meta">Canal</dt>
              <dd>{rotuloCanalOperador(item.canal)}</dd>
            </div>
          )}
          {item.fonte && (
            <div>
              <dt className="meta">Fonte</dt>
              <dd>{rotuloFonte(item.fonte)}</dd>
            </div>
          )}
          {item.versao !== undefined && (
            <div>
              <dt className="meta">Versão</dt>
              <dd className="num">{item.versao}</dd>
            </div>
          )}
          {item.aprovador && (
            <div>
              <dt className="meta">Aprovador</dt>
              <dd className="mono">{item.aprovador}</dd>
            </div>
          )}
          {item.fornecedor && (
            <div>
              <dt className="meta">Fornecedor</dt>
              <dd>{item.fornecedor}</dd>
            </div>
          )}
          {item.motivo && (
            <div>
              <dt className="meta">Motivo</dt>
              <dd>{rotuloCodigo(item.motivo)}</dd>
            </div>
          )}
          {item.resultado && (
            <div>
              <dt className="meta">Resultado</dt>
              <dd>{rotuloCodigo(item.resultado)}</dd>
            </div>
          )}
          {item.custoEstimadoBrl !== undefined && (
            <div>
              <dt className="meta">
                Custo estimado <span className="pilula-sutil">estimativa</span>
              </dt>
              <dd className="num">{formatarBrl(item.custoEstimadoBrl)}</dd>
            </div>
          )}
          {item.custoBrl !== undefined && (
            <div>
              <dt className="meta">Custo informado pelo fornecedor</dt>
              <dd className="num">{formatarBrl(item.custoBrl)}</dd>
            </div>
          )}
          {item.confianca !== undefined && (
            <div>
              <dt className="meta">Confiança da extração</dt>
              <dd className="num">{formatarConfianca(item.confianca)}</dd>
            </div>
          )}
        </dl>
      )}
      {item.categoria === 'declaracao' && <CamposDeclarados item={item} />}
      {hashes.length > 0 && (
        <div className="op-evidencias">
          {hashes.map((h, i) => (
            <EvidenciaHash key={h} casoId={casoId} hash={h} rotulo={rotuloEvidencia(item, i, hashes.length)} />
          ))}
        </div>
      )}
    </li>
  );
}

export function LinhaTempoCaso({ casoId, carga, aoVivo }: LinhaTempoCasoProps) {
  const tituloId = useId();
  return (
    <section className="op-linha" aria-labelledby={tituloId}>
      <div className="op-caso-topo">
        <h4 id={tituloId} className="op-aprovacao-t">
          Linha do tempo do caso
        </h4>
        {aoVivo !== undefined && (
          <span className={aoVivo ? 'pilula-ok' : 'pilula-sutil'}>{aoVivo ? 'ao vivo' : 'reconectando'}</span>
        )}
      </div>
      {carga.estado === 'carregando' && <p className="meta">Carregando a linha do tempo…</p>}
      {carga.estado === 'erro' && <p className="meta">{carga.mensagem}</p>}
      {carga.estado === 'ok' && (
        <>
          <p className="meta" role="status">
            {carga.itens.length === 0
              ? 'O operador ainda não agiu neste caso.'
              : `${carga.itens.length} ${carga.itens.length === 1 ? 'registro' : 'registros'}, do mais recente ao mais antigo.`}
          </p>
          {carga.itens.length > 0 && (
            <ol className="op-linha-lista">
              {[...carga.itens].reverse().map((item) => (
                <ItemLinha key={`${item.seq}-${item.tipo}`} casoId={casoId} item={item} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
