import { ROTULO_CAMPO, ROTULO_FONTE, formatarMomento, formatarValor, variacao } from '../format.ts';
import type { Celula, LinhaMatriz, Matriz } from '../matriz.ts';
import { IconeConfere, IconeDiverge, IconeSemComparacao, IconeSeta } from './icones.tsx';

// Div com papéis ARIA, não <table>: a mesma marcação vira coluna única no celular
// sem perder a leitura por linha e coluna no leitor de tela.
function Celula({ linha, celula }: { linha: LinhaMatriz; celula: Celula }) {
  const rotulo = ROTULO_FONTE[celula.fonte];
  const comum = { role: 'cell', 'data-fonte': rotulo } as const;
  if (celula.valor === undefined) {
    return (
      <div className="cel" {...comum}>
        <span className="nd">Não declarado</span>
      </div>
    );
  }
  const delta = celula.emConflito && !celula.referencia ? variacao(linha.campo, celula.valor, linha.referencia?.valor) : null;
  return (
    <div className={celula.emConflito && !celula.referencia ? 'cel cel-dv' : 'cel'} {...comum}>
      <span className="v">{formatarValor(linha.campo, celula.valor)}</span>
      {celula.antes !== undefined && (
        <span className="antes">
          antes <s>{formatarValor(linha.campo, celula.antes)}</s>
        </span>
      )}
      {delta && (
        <span className="delta">
          <IconeSeta />
          {delta}
        </span>
      )}
      {celula.versao !== undefined && celula.em && (
        <span className="orig">
          {rotulo} v{celula.versao} · {formatarMomento(celula.em)}
        </span>
      )}
    </div>
  );
}

export function MatrizFontes({ matriz }: { matriz: Matriz }) {
  if (matriz.fontes.length === 0) {
    return <p className="dica">Este pedido ainda não tem documentos com campos para comparar.</p>;
  }
  return (
    <div className="mx" role="table" aria-label="Fontes e campos do pedido" style={{ '--n': matriz.fontes.length } as React.CSSProperties}>
      <div role="row" className="mx-row mx-h">
        <div role="columnheader">Campo</div>
        {matriz.fontes.map((fonte) => (
          <div key={fonte} role="columnheader">
            <b>{ROTULO_FONTE[fonte]}</b>
          </div>
        ))}
      </div>
      {matriz.linhas.map((linha) => (
        <div role="row" className="mx-row mx-b" key={linha.campo}>
          <div role="rowheader" className="rh">
            <span className="campo">{ROTULO_CAMPO[linha.campo]}</span>
            {linha.divergente ? (
              <span className="estado estado-dv">
                <IconeDiverge />
                Diverge
              </span>
            ) : linha.celulas.filter((c) => c.valor !== undefined).length < 2 ? (
              <span className="estado estado-nd">
                <IconeSemComparacao />
                Sem comparação
              </span>
            ) : (
              <span className="estado estado-ok">
                <IconeConfere />
                Confere
              </span>
            )}
          </div>
          {linha.celulas.map((celula) => (
            <Celula key={celula.fonte} linha={linha} celula={celula} />
          ))}
        </div>
      ))}
    </div>
  );
}
