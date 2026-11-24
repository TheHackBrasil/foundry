import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
} from 'react';
import type { AlvoFocoGenUI, CampoVigiado, FonteDocumento } from '../../../shared/model.ts';
import { formatarMomento, formatarValor, rotuloCampo, rotuloFonte, variacao } from '../format.ts';
import type { Celula, LinhaMatriz, Matriz } from '../matriz.ts';
import { CamadaShader } from '../shaders/index.ts';
import {
  IconeConfere,
  IconeDiverge,
  IconeFechar,
  IconeMais,
  IconeSemComparacao,
} from './icones.tsx';

export interface TrilhoFonte {
  fonte: FonteDocumento;
  motivo: 'sem_dados' | 'oculta_lente';
  expandida: boolean;
}

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

// FLIP via WAAPI sobre chaves estáveis usando apenas transform/opacity a 60fps.
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
              duration: 240,
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

      const delay = Math.min(indiceRevelado, 5) * 24;
      indiceRevelado += 1;
      el.animate(
        [
          {
            opacity: 0,
            transform: `translate3d(${direcao * 10}px, 4px, 0)`,
          },
          {
            opacity: 1,
            transform: 'translate3d(0, 0, 0)',
          },
        ],
        {
          duration: 220,
          delay,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          fill: 'backwards',
        },
      );
    }
  }, [assinatura, containerRef, direcao]);
}

function alvoIgual(a: AlvoFocoGenUI | null, b: AlvoFocoGenUI): boolean {
  if (!a || a.tipo !== b.tipo) return false;
  switch (a.tipo) {
    case 'celula':
      return b.tipo === 'celula' && a.campo === b.campo && a.fonte === b.fonte;
    case 'divergencia':
      return (
        b.tipo === 'divergencia' &&
        a.campo === b.campo &&
        ((a.fonteA === b.fonteA && a.fonteB === b.fonteB) ||
          (a.fonteA === b.fonteB && a.fonteB === b.fonteA))
      );
    case 'parte':
      return b.tipo === 'parte' && a.parte === b.parte;
    case 'versao':
      return b.tipo === 'versao' && a.versao === b.versao;
    case 'sinal':
      return b.tipo === 'sinal' && a.indice === b.indice;
  }
}

function linhaEstaFocada(linha: LinhaMatriz, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'celula' || foco.tipo === 'divergencia') {
    return foco.campo === linha.campo;
  }
  if (foco.tipo === 'versao') {
    return linha.celulas.some((c) => c.versao === foco.versao);
  }
  return false;
}

function celulaEstaFocada(linha: LinhaMatriz, celula: Celula, foco: AlvoFocoGenUI | null): boolean {
  if (!foco) return false;
  if (foco.tipo === 'celula') {
    return foco.campo === linha.campo && foco.fonte === celula.fonte;
  }
  if (foco.tipo === 'divergencia') {
    return (
      foco.campo === linha.campo &&
      (foco.fonteA === celula.fonte || foco.fonteB === celula.fonte)
    );
  }
  if (foco.tipo === 'versao') {
    return celula.versao === foco.versao;
  }
  return false;
}

function alvoPrincipalLinha(linha: LinhaMatriz): AlvoFocoGenUI | null {
  const ref = linha.referencia;
  const conflito = linha.celulas.find((c) => c.emConflito && !c.referencia);
  if (linha.divergente && ref && conflito) {
    return {
      tipo: 'divergencia',
      campo: linha.campo,
      fonteA: ref.fonte,
      fonteB: conflito.fonte,
    };
  }
  const primeira = ref ?? linha.celulas.find((c) => c.valor !== undefined);
  if (primeira) {
    return { tipo: 'celula', campo: linha.campo, fonte: primeira.fonte };
  }
  return null;
}

function alvoCelula(linha: LinhaMatriz, celula: Celula): AlvoFocoGenUI {
  if (celula.emConflito && linha.referencia && celula.fonte !== linha.referencia.fonte) {
    return {
      tipo: 'divergencia',
      campo: linha.campo,
      fonteA: linha.referencia.fonte,
      fonteB: celula.fonte,
    };
  }
  return { tipo: 'celula', campo: linha.campo, fonte: celula.fonte };
}

function calcularMedidorLinha(linha: LinhaMatriz): { pctBase: number; pctDesvio: number } | null {
  if (!linha.divergente || !linha.referencia) return null;
  const conflito = linha.celulas.find((c) => c.emConflito && !c.referencia && c.valor !== undefined);
  if (!conflito) return null;
  const valA = linha.referencia.valor;
  const valB = conflito.valor;

  if (linha.campo === 'pesoTotal' || linha.campo === 'volumes') {
    const a = Number(valA);
    const b = Number(valB);
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.max(a, b) <= 0) return null;
    const max = Math.max(a, b);
    const diff = Math.abs(b - a);
    const pctDesvio = Math.max(14, Math.min(82, Math.round((diff / max) * 100 * 2.2)));
    return { pctBase: 100 - pctDesvio, pctDesvio };
  }
  if (linha.campo === 'previsaoEntrega') {
    const ta = Date.parse(`${String(valA).slice(0, 10)}T00:00:00Z`);
    const tb = Date.parse(`${String(valB).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
    const dias = Math.abs(Math.round((tb - ta) / 86_400_000));
    if (dias === 0) return null;
    const pctDesvio = Math.max(18, Math.min(84, Math.round((dias / 14) * 100)));
    return { pctBase: 100 - pctDesvio, pctDesvio };
  }
  return { pctBase: 50, pctDesvio: 50 };
}

function CelulaItem({
  linha,
  celula,
  destacar,
  focada,
  aoClicar,
}: {
  linha: LinhaMatriz;
  celula: Celula;
  destacar: boolean;
  focada: boolean;
  aoClicar?: (alvo: AlvoFocoGenUI, e: MouseEvent<HTMLButtonElement>) => void;
}) {
  const rotulo = rotuloFonte(celula.fonte);
  const comum = {
    role: 'cell',
    'data-fonte': rotulo,
    'data-flip-id': `cell-${linha.campo}-${celula.fonte}`,
  } as const;

  if (celula.valor === undefined) {
    return (
      <div className={focada ? 'cel cel-focada' : 'cel'} {...comum}>
        <span className="nd">Não declarado</span>
      </div>
    );
  }

  const emDivergencia = celula.emConflito && !celula.referencia;
  const delta = emDivergencia ? variacao(linha.campo, celula.valor, linha.referencia?.valor) : null;
  const classes = [
    'cel',
    emDivergencia && destacar ? 'cel-dv' : '',
    focada ? 'cel-focada' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const conteudo = (
    <>
      <div className="cel-topo">
        <span className="v mono">{formatarValor(linha.campo, celula.valor)}</span>
        {delta && (
          <span className={destacar ? 'delta-pilula mono' : 'delta-pilula delta-pilula-neutro mono'}>
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
    </>
  );

  if (!aoClicar) {
    return (
      <div className={classes} {...comum}>
        {conteudo}
      </div>
    );
  }

  const alvo = alvoCelula(linha, celula);
  return (
    <div className={classes} {...comum}>
      <button
        type="button"
        className="cel-btn"
        aria-pressed={focada}
        aria-label={`${rotuloCampo(linha.campo)} em ${rotulo}: ${formatarValor(linha.campo, celula.valor)}${delta ? `, variação ${delta}` : ''}`}
        onClick={(e) => aoClicar(alvo, e)}
      >
        {conteudo}
      </button>
    </div>
  );
}

interface Props {
  matriz: Matriz;
  trilhos?: readonly TrilhoFonte[];
  aoAlternarTrilho?: (fonte: FonteDocumento) => void;
  destacar?: boolean;
  carregandoLente?: boolean;
  assinaturaLente?: string;
  direcaoLente?: -1 | 0 | 1;
  pulsoDomino?: number;
  origemDomino?: readonly [number, number];
  pulsoRefracao?: number;
  modoSimulacao?: boolean;
  focoAtivo?: AlvoFocoGenUI | null;
  aoFocar?: (alvo: AlvoFocoGenUI | null, origem?: readonly [number, number]) => void;
}

export function MatrizFontes({
  matriz,
  trilhos = [],
  aoAlternarTrilho,
  destacar = true,
  carregandoLente = false,
  assinaturaLente = '',
  direcaoLente = 0,
  pulsoDomino = 0,
  origemDomino = [0.5, 0.5],
  pulsoRefracao = 0,
  modoSimulacao = false,
  focoAtivo = null,
  aoFocar,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  useFlipMatriz(containerRef, assinaturaLente, direcaoLente);

  function calcularOrigemRelativa(e: MouseEvent<HTMLElement>): readonly [number, number] {
    const el = containerRef.current;
    if (!el) return [0.5, 0.5];
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return [0.5, 0.5];
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    return [x, y];
  }

  function alternarFoco(alvo: AlvoFocoGenUI, e: MouseEvent<HTMLElement>) {
    if (!aoFocar) return;
    if (alvoIgual(focoAtivo, alvo)) {
      aoFocar(null);
    } else {
      aoFocar(alvo, calcularOrigemRelativa(e));
    }
  }

  if (matriz.fontes.length === 0) {
    return <p className="dica">Este pedido ainda não tem documentos com campos para comparar.</p>;
  }

  const gradeShader: readonly [number, number] = [
    Math.max(2, matriz.fontes.length + 1),
    Math.max(2, matriz.linhas.length),
  ];

  const classes = [
    'mx',
    'slab-mineral',
    carregandoLente ? 'mx-carregando' : '',
    modoSimulacao ? 'mx-simulacao' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={containerRef}
      className={classes}
      data-muitas-fontes={matriz.fontes.length > 3 ? 'true' : undefined}
      style={{ '--n': matriz.fontes.length } as CSSProperties}
    >
      <CamadaShader
        shader="tearGenUi"
        ativo={carregandoLente}
        modo={0}
        direcao={direcaoLente}
        grade={gradeShader}
        raioPx={6}
        className="mx-shader"
      />
      <CamadaShader
        shader="ondaDomino"
        ativo={false}
        pulsoChave={pulsoDomino}
        duracaoPulsoMs={850}
        origem={origemDomino}
        grade={gradeShader}
        raioPx={6}
        className="mx-shader"
      />
      <CamadaShader
        shader="laminaRefracao"
        ativo={modoSimulacao}
        modo={modoSimulacao ? 1 : 0}
        pulsoChave={pulsoRefracao}
        duracaoPulsoMs={280}
        direcao={direcaoLente}
        raioPx={6}
        className="mx-shader"
      />

      {trilhos.length > 0 && aoAlternarTrilho && (
        <div className="mx-trilhos" role="group" aria-label="Fontes dobráveis">
          <span className="mx-trilhos-label">Fontes recolhidas:</span>
          {trilhos.map((trilho) => (
            <button
              key={trilho.fonte}
              type="button"
              className="mx-trilho-btn"
              aria-pressed={trilho.expandida}
              onClick={() => aoAlternarTrilho(trilho.fonte)}
            >
              <span>
                {rotuloFonte(trilho.fonte)} ·{' '}
                {trilho.motivo === 'sem_dados' ? 'sem dados' : 'oculta'}
              </span>
              {trilho.expandida ? <IconeFechar /> : <IconeMais />}
            </button>
          ))}
        </div>
      )}

      <div
        role="table"
        aria-label="Fontes e campos do pedido"
        aria-busy={carregandoLente || undefined}
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
          {matriz.linhas.map((linha, rowIdx) => {
            const focada = linhaEstaFocada(linha, focoAtivo);
            const alvoLinha = alvoPrincipalLinha(linha);
            const podeFocarLinha = Boolean(aoFocar && alvoLinha && linha.divergente);
            const rotuloEstado = linha.divergente ? (
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
            );

            const medidor = destacar ? calcularMedidorLinha(linha) : null;
            const classesLinha = [
              'mx-row',
              'mx-b',
              linha.divergente && destacar ? 'mx-row-dv' : '',
              focada ? 'mx-row-focada' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <div
                role="row"
                className={classesLinha}
                key={linha.campo}
                data-flip-id={`row-${linha.campo}`}
                style={{ '--row-i': Math.min(rowIdx, 5) } as CSSProperties}
              >
                <div role="rowheader" className="rh">
                  {podeFocarLinha && alvoLinha ? (
                    <button
                      type="button"
                      className="rh-btn"
                      aria-pressed={focada}
                      onClick={(e) => alternarFoco(alvoLinha, e)}
                      title={`Destacar tarefas e células de ${rotuloCampo(linha.campo as CampoVigiado)}`}
                    >
                      <span className="campo">{rotuloCampo(linha.campo)}</span>
                      {rotuloEstado}
                      {medidor && (
                        <span className="mx-medidor" aria-hidden="true">
                          <span className="mx-medidor-base" style={{ width: `${medidor.pctBase}%` }} />
                          <span className="mx-medidor-desvio" style={{ width: `${medidor.pctDesvio}%` }} />
                        </span>
                      )}
                    </button>
                  ) : (
                    <>
                      <span className="campo">{rotuloCampo(linha.campo)}</span>
                      {rotuloEstado}
                      {medidor && (
                        <span className="mx-medidor" aria-hidden="true">
                          <span className="mx-medidor-base" style={{ width: `${medidor.pctBase}%` }} />
                          <span className="mx-medidor-desvio" style={{ width: `${medidor.pctDesvio}%` }} />
                        </span>
                      )}
                    </>
                  )}
                </div>
                {linha.celulas.map((celula) => (
                  <CelulaItem
                    key={celula.fonte}
                    linha={linha}
                    celula={celula}
                    destacar={destacar}
                    focada={celulaEstaFocada(linha, celula, focoAtivo)}
                    {...(aoFocar ? { aoClicar: alternarFoco } : {})}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
