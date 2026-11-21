import { ROTULO_CAMPO, ROTULO_FONTE, formatarValor } from '../format.ts';
import type { Matriz } from '../matriz.ts';
import { IconeAlerta } from './icones.tsx';

export function MatrizFontes({ matriz }: { matriz: Matriz }) {
  if (matriz.fontes.length === 0) {
    return <p className="dica">Este pedido ainda não tem documentos com campos para comparar.</p>;
  }
  return (
    <div className="tabela-rolavel" role="region" aria-label="Tabela de fontes e campos" tabIndex={0}>
      <table className="matriz">
        <caption>O que cada documento declara. Um campo em conflito leva o ícone de alerta e o texto "diverge".</caption>
        <thead>
          <tr>
            <th scope="col">Campo</th>
            {matriz.fontes.map((fonte) => (
              <th key={fonte} scope="col">
                {ROTULO_FONTE[fonte]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matriz.linhas.map((linha) => (
            <tr key={linha.campo} className={linha.divergente ? 'linha-diverge' : undefined}>
              <th scope="row">
                {ROTULO_CAMPO[linha.campo]}{' '}
                {linha.divergente && (
                  <span className="etiqueta">
                    <IconeAlerta /> Diverge
                  </span>
                )}
              </th>
              {linha.celulas.map((celula, i) => {
                const fonte = matriz.fontes[i];
                return (
                  <td key={fonte} className={celula.emConflito ? 'celula-conflito' : undefined}>
                    {celula.valor === undefined ? (
                      <>
                        <span aria-hidden="true">—</span>
                        <span className="so-leitor">não informado</span>
                      </>
                    ) : (
                      <>
                        <span className="mono">{formatarValor(linha.campo, celula.valor)}</span>
                        {celula.emConflito && <span className="so-leitor"> em conflito</span>}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
