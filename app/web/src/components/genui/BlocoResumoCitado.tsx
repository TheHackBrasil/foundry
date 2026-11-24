import { useMemo } from 'react';
import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CitacaoFactual,
} from '../../../../shared/model.ts';
import { alvoIgual, estiloEntradaBloco } from './helpers.ts';
import type { AoAlternarFoco } from './tipos.ts';

export interface BlocoResumoCitadoProps {
  bloco: Extract<BlocoGenUI, { tipo: 'resumo_citado' }>;
  indice: number;
  focoAtivo: AlvoFocoGenUI | null;
  aoAlternarFoco: AoAlternarFoco;
}

export function BlocoResumoCitado({
  bloco,
  indice,
  focoAtivo,
  aoAlternarFoco,
}: BlocoResumoCitadoProps) {
  const mapaCitacoes = useMemo(
    () => new Map<string, CitacaoFactual>(bloco.citacoes.map((c) => [c.id, c])),
    [bloco.citacoes],
  );

  const { segmentos, usadas } = useMemo(() => {
    const partes = bloco.corpo.split(/(\[\[[^\]]+\]\])/g);
    const idsUsados = new Set<string>();
    const nos = partes.map((parte, i) => {
      const m = /^\[\[([^\]]+)\]\]$/.exec(parte);
      if (!m) return { tipo: 'texto' as const, chave: `t-${i}`, texto: parte };
      const id = m[1]?.trim() ?? '';
      const cit = mapaCitacoes.get(id);
      if (!cit) return { tipo: 'texto' as const, chave: `t-${i}`, texto: parte };
      idsUsados.add(id);
      return { tipo: 'citacao' as const, chave: `c-${id}-${i}`, cit };
    });
    return { segmentos: nos, usadas: idsUsados };
  }, [bloco.corpo, mapaCitacoes]);

  const restantes = useMemo(
    () => bloco.citacoes.filter((c) => !usadas.has(c.id)),
    [bloco.citacoes, usadas],
  );

  return (
    <article
      className="palco-bloco palco-bloco-largo"
      data-bloco-tipo={bloco.tipo}
      data-matriz-bloco={bloco.id}
      data-matriz-idx={indice}
      aria-label={bloco.titulo}
      style={estiloEntradaBloco(indice)}
    >
      <div className="palco-bloco-cab">
        <h3>{bloco.titulo}</h3>
      </div>

      <p className="palco-resumo-texto">
        {segmentos.map((seg) =>
          seg.tipo === 'texto' ? (
            <span key={seg.chave}>{seg.texto}</span>
          ) : (
            <button
              key={seg.chave}
              type="button"
              className="citacao-btn"
              aria-pressed={alvoIgual(focoAtivo, seg.cit.alvo)}
              onClick={() => aoAlternarFoco(seg.cit.alvo, seg.cit.rotulo)}
            >
              {seg.cit.rotulo}
            </button>
          ),
        )}
      </p>

      {restantes.length > 0 && (
        <div className="palco-citacoes-rodape">
          <span className="meta">Evidências:</span>
          {restantes.map((cit) => (
            <button
              key={cit.id}
              type="button"
              className="citacao-btn"
              aria-pressed={alvoIgual(focoAtivo, cit.alvo)}
              onClick={() => aoAlternarFoco(cit.alvo, cit.rotulo)}
            >
              {cit.rotulo}
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
