import { useLayoutEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { formatarMomento, formatarValor, rotuloCampo, rotuloFonte, variacao } from '../format.ts';
import type { Celula, LinhaMatriz, Matriz } from '../matriz.ts';
import { IconeConfere, IconeDiverge, IconeSemComparacao, IconeSeta } from './icones.tsx';

interface PosicaoRelativa {
  left: number;
  top: number;
}

function movimentoReduzidoAtivo(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// FLIP via WAAPI sobre chaves estáveis: nós persistentes deslizam para a nova
// posição e nós recém-revelados pela lente entram com atraso escalonado.
function useFlipMatriz(
  containerRef: RefObject<HTMLDivElement | null>,
  assinatura: string,
  direcao: -1 | 0 | 1,
) {
  const montadoRef = useRef(false);
  const posicoesRef = useRef<Map<string, PosicaoRelativa>>(new Map());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const nos = Array.from(container.querySelectorAll<HTMLElement>('[data-flip-id]'));
    for (const el of nos) {
      if (typeof el.getAnimations === 'function') {
        for (const anim of el.getAnimations()) anim.cancel();
      }
    }

    const baseRect = container.getBoundingClientRect();
    const atuais = new Map<string, PosicaoRelativa>();
    for (const el of nos) {
      const id = el.dataset['flipId'];
      if (!id) continue;
      const r = el.getBoundingClientRect();
      atuais.set(id, { left: r.left - baseRect.left, top: r.top - baseRect.top });
    }

    const anteriores = posicoesRef.current;
    posicoesRef.current = atuais;

    if (!montadoRef.current) {
      montadoRef.current = true;
      return;
    }
    if (movimentoReduzidoAtivo()) return;

    const linhasNovas = new Set<string>();
    const deslocamentoLinha = new Map<string, { dx: number; dy: number }>();
    let indiceRevelado = 0;

    for (const el of nos) {
      const id = el.dataset['flipId'];
      if (!id || typeof el.animate !== 'function') continue;
      const agora = atuais.get(id);
      if (!agora) continue;
      const antes = anteriores.get(id);

      if (antes) {
        let dx = antes.left - agora.left;
        let dy = antes.top - agora.top;

        if (id.startsWith('row-')) {
          const campo = id.slice(4);
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            deslocamentoLinha.set(campo, { dx, dy });
          }
        } else if (id.startsWith('cell-')) {
          // Desconta o deslocamento da linha pai para evitar soma dupla de transform.
          const campo = id.slice(5, id.lastIndexOf('-'));
          const pai = deslocamentoLinha.get(campo);
          if (pai) {
            dx -= pai.dx;
            dy -= pai.dy;
          }
        }

        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          el.animate(
            [
              { transform: `translate3d(${dx}px, ${dy}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            {
              duration: 260,
              easing: 'cubic-bezier(0.25, 1, 0.5, 1)',
            },
          );
        }
        continue;
      }

      if (id.startsWith('row-')) {
        linhasNovas.add(id.slice(4));
      } else if (id.startsWith('cell-')) {
        const campo = id.slice(5, id.lastIndexOf('-'));
        if (linhasNovas.has(campo)) continue;
      }

      const delay = Math.min(indiceRevelado, 5) * 26;
      indiceRevelado += 1;
      el.animate(
        [
          {
            opacity: 0,
            transform: `translate3d(${direcao * 10}px, 4px, 0)`,
            filter: 'blur(3px)',
          },
          {
            opacity: 1,
            transform: 'translate3d(0, 0, 0)',
            filter: 'blur(0)',
          },
        ],
        {
          duration: 240,
          delay,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'backwards',
        },
      );
    }
  }, [assinatura, containerRef, direcao]);
}

// Div com papéis ARIA, não <table>: a mesma marcação vira coluna única no celular
// sem perder a leitura por linha e coluna no leitor de tela.
function Celula({ linha, celula, destacar }: { linha: LinhaMatriz; celula: Celula; destacar: boolean }) {
  const rotulo = rotuloFonte(celula.fonte);
  const comum = {
    role: 'cell',
    'data-fonte': rotulo,
    'data-flip-id': `cell-${linha.campo}-${celula.fonte}`,
  } as const;
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
          v{celula.versao} · {formatarMomento(celula.em)}
        </span>
      )}
    </div>
  );
}

interface Props {
  matriz: Matriz;
  destacar?: boolean;
  carregandoLente?: boolean;
  assinaturaLente?: string;
  direcaoLente?: -1 | 0 | 1;
}

export function MatrizFontes({
  matriz,
  destacar = true,
  carregandoLente = false,
  assinaturaLente = '',
  direcaoLente = 0,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFlipMatriz(containerRef, assinaturaLente, direcaoLente);

  if (matriz.fontes.length === 0) {
    return <p className="dica">Este pedido ainda não tem documentos com campos para comparar.</p>;
  }
  const classes = `mx${carregandoLente ? ' mx-carregando' : ''}`;
  return (
    <div
      ref={containerRef}
      className={classes}
      role="table"
      aria-label="Fontes e campos do pedido"
      aria-busy={carregandoLente || undefined}
      data-muitas-fontes={matriz.fontes.length > 3 ? 'true' : undefined}
      style={{ '--n': matriz.fontes.length } as CSSProperties}
    >
      <div role="row" className="mx-row mx-h">
        <div role="columnheader">Campo</div>
        {matriz.fontes.map((fonte) => (
          <div key={fonte} role="columnheader" data-flip-id={`col-${fonte}`}>
            <b>{rotuloFonte(fonte)}</b>
          </div>
        ))}
      </div>
      <div role="rowgroup" className="mx-corpo">
        {matriz.linhas.map((linha) => (
          <div
            role="row"
            className="mx-row mx-b"
            key={linha.campo}
            data-flip-id={`row-${linha.campo}`}
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
