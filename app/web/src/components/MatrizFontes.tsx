import type { CSSProperties } from 'react';
import { formatarMomento, formatarValor, rotuloCampo, rotuloFonte, variacao } from '../format.ts';
import type { Celula, LinhaMatriz, Matriz } from '../matriz.ts';
import { IconeConfere, IconeDiverge, IconeSemComparacao, IconeSeta } from './icones.tsx';

// Div com papéis ARIA, não <table>: a mesma marcação vira coluna única no celular
// sem perder a leitura por linha e coluna no leitor de tela.
function Celula({ linha, celula, destacar }: { linha: LinhaMatriz; celula: Celula; destacar: boolean }) {
  const rotulo = rotuloFonte(celula.fonte);
  const comum = { role: 'cell', 'data-fonte': rotulo } as const;
  if (celula.valor === undefined) {
    return (
      <div className="cel" {...comum}>
        <span className="nd">Não declarado</span>
      </div>
    );
  }
  const emDivergencia = celula.emConflito && !celula.referencia;
  const delta = emDivergencia ? variacao(linha.campo, celula.valor, linha.referencia?.valor) : null;
  return (
    <div className={emDivergencia && destacar ? 'cel cel-dv' : 'cel'} {...comum}>
      <div className="cel-topo">
        <span className="v">{formatarValor(linha.campo, celula.valor)}</span>
        {delta && (
          <span className={destacar ? 'delta-pilula' : 'delta-pilula delta-pilula-neutro'}>
            <IconeSeta />
            {delta}
          </span>
        )}
      </div>
      {celula.antes !== undefined && (
        <span className="antes">
          antes <s>{formatarValor(linha.campo, celula.antes)}</s>
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

interface Props {
  matriz: Matriz;
  destacar?: boolean;
  carregandoLente?: boolean;
  chaveTransicao?: string;
}

export function MatrizFontes({ matriz, destacar = true, carregandoLente = false, chaveTransicao }: Props) {
  if (matriz.fontes.length === 0) {
    return <p className="dica">Este pedido ainda não tem documentos com campos para comparar.</p>;
  }
  const classes = `mx${carregandoLente ? ' mx-carregando' : ''}`;
  return (
    <div
      className={classes}
      role="table"
      aria-label="Fontes e campos do pedido"
      aria-busy={carregandoLente || undefined}
      style={{ '--n': matriz.fontes.length } as CSSProperties}
    >
      <div role="row" className="mx-row mx-h">
        <div role="columnheader">Campo</div>
        {matriz.fontes.map((fonte) => (
          <div key={fonte} role="columnheader">
            <b>{rotuloFonte(fonte)}</b>
          </div>
        ))}
      </div>
      <div
        role="rowgroup"
        key={chaveTransicao ?? 'completa'}
        className={chaveTransicao ? 'mx-corpo mx-surgir' : 'mx-corpo'}
      >
        {matriz.linhas.map((linha, idx) => (
          <div
            role="row"
            className="mx-row mx-b"
            key={linha.campo}
            style={{ '--stagger': idx } as CSSProperties}
          >
            <div role="rowheader" className="rh">
              <span className="campo">{rotuloCampo(linha.campo)}</span>
              {linha.divergente ? (
                <span className={destacar ? 'estado estado-dv' : 'estado estado-nd'}>
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
              <Celula key={celula.fonte} linha={linha} celula={celula} destacar={destacar} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
