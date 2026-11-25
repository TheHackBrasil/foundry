import type { ProjecaoPedido } from '../../../../shared/model.ts';
import { formatarMomento, rotuloFonte } from '../../format.ts';

interface CardVersoesProps {
  versoes: ProjecaoPedido['versoes'];
}

// Histórico de documentos recebidos (veio do PainelPedido).
export function CardVersoes({ versoes }: CardVersoesProps) {
  if (versoes.length === 0) {
    return <p className="meta">Nenhuma versão de documento registrada.</p>;
  }
  const recentes = [...versoes].sort(
    (a, b) => b.geradaEm.localeCompare(a.geradaEm) || b.versao - a.versao,
  );
  return (
    <details className="versoes-detalhes">
      <summary className="versoes-sumario">
        <span className="versoes-sumario-titulo">Documentos recebidos</span>
        <span className="meta num">
          {versoes.length} {versoes.length === 1 ? 'documento' : 'documentos'}
        </span>
      </summary>
      <ul className="versoes">
        {recentes.map((v) => (
          <li key={`${v.fonte}-${v.versao}`}>
            <span className="versao-ponto" aria-hidden="true" />
            <time dateTime={v.geradaEm}>{formatarMomento(v.geradaEm)}</time>
            <span>
              <strong>{rotuloFonte(v.fonte)}</strong> v{v.versao}{' '}
              {v.versao === 1 ? 'registrada' : 'recebida'}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
