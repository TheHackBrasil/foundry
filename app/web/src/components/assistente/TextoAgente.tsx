import { Fragment, useMemo, type CSSProperties } from 'react';
import { useTextoFluido } from '../../useTextoFluido.ts';
import { dividirProsaAgente } from './conversaUtils.ts';

const RE_INLINE_AGENTE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

// Formatacao inline do texto do agente em JSX puro: sem dangerouslySetInnerHTML.
function InlineAgente({ texto }: { texto: string }) {
  return (
    <>
      {texto.split(RE_INLINE_AGENTE).map((parte, i) => {
        if (parte.length > 4 && parte.startsWith('**') && parte.endsWith('**')) {
          return <strong key={`b${i}`}>{parte.slice(2, -2)}</strong>;
        }
        if (parte.length > 2 && parte.startsWith('`') && parte.endsWith('`')) {
          return <code key={`c${i}`}>{parte.slice(1, -1)}</code>;
        }
        return <Fragment key={`t${i}`}>{parte}</Fragment>;
      })}
    </>
  );
}

export interface TextoAgenteProps {
  texto: string;
  aoVivo: boolean;
}

// Resposta em linguagem natural do agente: suaviza a cadencia do SSE em 60fps
// com useTextoFluido, revela cada novo bloco de prosa sem saltos e mantem um
// cursor mineral fino que se dissolve ao concluir.
export function TextoAgente({ texto, aoVivo }: TextoAgenteProps) {
  const { visivel, compondo } = useTextoFluido(texto, aoVivo);
  const segmentos = useMemo(() => dividirProsaAgente(visivel), [visivel]);
  const cursor = (
    <span
      className="agente-cursor"
      data-ativo={compondo ? 'true' : 'false'}
      aria-hidden="true"
    />
  );
  const ultimo = segmentos.length - 1;
  const ultimoSeg = ultimo >= 0 ? segmentos[ultimo] : undefined;
  const ultimoEhParagrafo = ultimoSeg?.tipo === 'paragrafo';
  const ultimoEhLista = ultimoSeg?.tipo === 'lista';

  return (
    <div className="agente-texto" data-compondo={compondo ? 'true' : 'false'}>
      {segmentos.map((seg, i) => {
        const ehUltimoSeg = i === ultimo;
        if (seg.tipo === 'lista') {
          const ultimoItem = seg.itens.length - 1;
          return (
            <ul
              key={`lista-${i}`}
              className="agente-seg"
              style={{ '--seg-i': Math.min(i, 6) } as CSSProperties}
            >
              {seg.itens.map((item, j) => (
                <li
                  key={`item-${i}-${j}`}
                  className="agente-item"
                  style={{ '--item-i': Math.min(j, 8) } as CSSProperties}
                >
                  <InlineAgente texto={item} />
                  {ehUltimoSeg && j === ultimoItem ? cursor : null}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p
            key={`p-${i}`}
            className="agente-seg"
            style={{ '--seg-i': Math.min(i, 6) } as CSSProperties}
          >
            {seg.linhas.map((linha, j) => (
              <Fragment key={`l-${i}-${j}`}>
                {j > 0 && <br />}
                <InlineAgente texto={linha} />
              </Fragment>
            ))}
            {ehUltimoSeg ? cursor : null}
          </p>
        );
      })}
      {compondo && !ultimoEhParagrafo && !ultimoEhLista && (
        <p className="agente-cursor-linha">{cursor}</p>
      )}
    </div>
  );
}
