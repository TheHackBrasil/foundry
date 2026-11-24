import { useEffect, useRef, type RefObject } from 'react';
import { movimentoReduzidoAgora } from '../../shaders/index.ts';

export interface MatrizMaeOverlayProps {
  containerRef: RefObject<HTMLElement | null>;
  ativo: boolean;
  toolPulsoSeq: number;
}

interface ParticulaMineral {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tamanho: number;
  vida: number;
  vidaMax: number;
  rot: number;
  vrot: number;
  cor: 'acento' | 'nucleo';
}

interface OndaCinetica {
  x: number;
  y: number;
  idade: number;
  duracao: number;
  raioMax: number;
}

interface ForjaComponente {
  el: HTMLElement;
  hubEl: HTMLElement | null;
  codigo: string;
  inicioMs: number;
  atrasoMs: number;
  duracaoMs: number;
  impactoDisparado: boolean;
  ultimoEmitY: number;
}

const CODIGO_POR_TIPO: Record<string, string> = {
  simulador_interativo: 'SIM',
  domino_impacto: 'DOM',
  comparador_conflito: 'CMP',
  checklist_papel: 'CHK',
  cartoes_despacho: 'DSP',
  linha_tempo_causal: 'TML',
  resumo_citado: 'RES',
  matriz_focada: 'MTX',
};

function lerPaletaTema(): {
  acento: string;
  acentoRgb: string;
  nucleoRgb: string;
  gradeRgb: string;
  escuro: boolean;
} {
  const escuro =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-tema') === 'dark';
  if (escuro) {
    return {
      acento: '#c9b2f0',
      acentoRgb: '201, 178, 240',
      nucleoRgb: '232, 240, 238',
      gradeRgb: '183, 156, 232',
      escuro: true,
    };
  }
  return {
    acento: '#654199',
    acentoRgb: '101, 65, 153',
    nucleoRgb: '22, 60, 56',
    gradeRgb: '101, 65, 153',
    escuro: false,
  };
}

function easeOutQuart(t: number): number {
  const k = 1 - Math.min(1, Math.max(0, t));
  return 1 - k * k * k * k;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

// Dispara pulso coordenado na Matriz Mãe (canvas + shader WebGL2 de fundo).
export function dispararPulsoMatriz(x: number, y: number, forja = false): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('forseti:matriz-pulso', { detail: { x, y, forja } }),
  );
}

// Overlay AAA 60fps da Matriz Mãe: projeta condutos ortogonais de energia,
// retículos de travamento de canto e varredura holográfica componente por
// componente sobre blocos GenUI recém-montados — com latência zero (nunca
// bloqueia interação nem esconde o DOM). Hiberna a 0% CPU quando ocioso.
export function MatrizMaeOverlay({
  containerRef,
  ativo,
  toolPulsoSeq,
}: MatrizMaeOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ativoRef = useRef(ativo);
  ativoRef.current = ativo;

  const toolPulsoRef = useRef(toolPulsoSeq);
  const acordarRef = useRef<(() => void) | null>(null);
  const emitirOndaHubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (ativo) {
      acordarRef.current?.();
    }
  }, [ativo]);

  useEffect(() => {
    if (toolPulsoSeq > toolPulsoRef.current) {
      emitirOndaHubRef.current?.();
    }
    toolPulsoRef.current = toolPulsoSeq;
  }, [toolPulsoSeq]);

  useEffect(() => {
    if (typeof window === 'undefined' || movimentoReduzidoAgora()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const c2d = ctx;
    let rafId: number | null = null;
    let ultimoMs = 0;
    let largura = window.innerWidth;
    let altura = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let paleta = lerPaletaTema();

    const forjas: ForjaComponente[] = [];
    const particulas: ParticulaMineral[] = [];
    const ondas: OndaCinetica[] = [];
    const elementosVistos = new WeakSet<HTMLElement>();

    function redimensionar() {
      if (!canvas) return;
      largura = window.innerWidth;
      altura = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(largura * dpr));
      canvas.height = Math.max(1, Math.round(altura * dpr));
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawnParticulas(x: number, y: number, qtd: number, espalhamentoX = 120) {
      for (let i = 0; i < qtd; i++) {
        if (particulas.length > 96) particulas.shift();
        const ang = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 1.4;
        const vel = 28 + Math.random() * 88;
        particulas.push({
          x: x + (Math.random() - 0.5) * espalhamentoX,
          y: y + (Math.random() - 0.5) * 6,
          vx: Math.cos(ang) * vel,
          vy: Math.sin(ang) * vel - 14,
          tamanho: 1.5 + Math.random() * 2.4,
          vida: 0,
          vidaMax: 0.34 + Math.random() * 0.34,
          rot: Math.random() * Math.PI,
          vrot: (Math.random() - 0.5) * 6.5,
          cor: Math.random() > 0.32 ? 'acento' : 'nucleo',
        });
      }
    }

    function adicionarOnda(x: number, y: number, raioMax = 54, duracao = 0.52) {
      ondas.push({ x, y, idade: 0, duracao, raioMax });
      spawnParticulas(x, y, 8, 12);
      acordar();
    }

    function registrarBloco(el: HTMLElement, ordemLote: number) {
      if (elementosVistos.has(el)) return;
      elementosVistos.add(el);

      const tipo = el.getAttribute('data-bloco-tipo') ?? el.getAttribute('data-matriz-tipo') ?? '';
      const idxAttr = Number(el.getAttribute('data-matriz-idx') ?? ordemLote);
      const numero = String(Math.max(1, (Number.isFinite(idxAttr) ? idxAttr : ordemLote) + 1)).padStart(2, '0');
      const sigla = CODIGO_POR_TIPO[tipo] ?? 'GEN';
      const turnoEl = el.closest('.ia-turno');
      const hubEl =
        (turnoEl?.querySelector('[data-matriz-hub="true"]') as HTMLElement | null) ?? null;

      const atrasoMs = Math.min(ordemLote, 5) * 75;
      forjas.push({
        el,
        hubEl,
        codigo: `M·${numero} ${sigla}`,
        inicioMs: performance.now(),
        atrasoMs,
        duracaoMs: 680,
        impactoDisparado: false,
        ultimoEmitY: -1,
      });

      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top < altura && r.bottom > 0) {
        dispararPulsoMatriz(r.left + r.width * 0.5, Math.max(40, Math.min(altura - 40, r.top + 28)), true);
      }
      acordar();
    }

    function varrerNovosBlocos(raiz: ParentNode) {
      const lista = raiz.querySelectorAll<HTMLElement>('[data-matriz-bloco]');
      let novos = 0;
      lista.forEach((el) => {
        if (!elementosVistos.has(el)) {
          registrarBloco(el, novos);
          novos++;
        }
      });
    }

    function desenharConduite(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      progresso: number,
      alpha: number,
    ) {
      if (alpha <= 0.01) return;
      const meioY = y0 + Math.min(34, Math.max(14, (y1 - y0) * 0.36));
      const pts: Array<[number, number]> = [
        [x0, y0],
        [x0, meioY],
        [x1, meioY],
        [x1, y1],
      ];

      // Comprimento acumulado dos segmentos para traçar o conduto e posicionar o pacote de luz
      const segs: number[] = [];
      let total = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        segs.push(len);
        total += len;
      }
      if (total < 4) return;

      const alvoLen = total * Math.min(1, progresso);
      c2d.save();
      c2d.beginPath();
      c2d.moveTo(pts[0]![0], pts[0]![1]);
      let corrido = 0;
      let pontaX = pts[0]![0];
      let pontaY = pts[0]![1];

      for (let i = 0; i < segs.length; i++) {
        const segLen = segs[i]!;
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (corrido + segLen <= alvoLen) {
          c2d.lineTo(b[0], b[1]);
          pontaX = b[0];
          pontaY = b[1];
          corrido += segLen;
        } else {
          const frac = segLen > 0 ? (alvoLen - corrido) / segLen : 0;
          pontaX = a[0] + (b[0] - a[0]) * frac;
          pontaY = a[1] + (b[1] - a[1]) * frac;
          c2d.lineTo(pontaX, pontaY);
          break;
        }
      }

      c2d.strokeStyle = `rgba(${paleta.acentoRgb}, ${(alpha * (paleta.escuro ? 0.62 : 0.44)).toFixed(3)})`;
      c2d.lineWidth = 1.25;
      c2d.stroke();

      // Cabeça luminosa do pacote energético percorrendo o conduto
      if (progresso > 0.02 && progresso < 0.98) {
        const grad = c2d.createRadialGradient(pontaX, pontaY, 0, pontaX, pontaY, 10);
        grad.addColorStop(0, `rgba(${paleta.nucleoRgb}, ${(alpha * 0.95).toFixed(3)})`);
        grad.addColorStop(0.45, `rgba(${paleta.acentoRgb}, ${(alpha * 0.72).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${paleta.acentoRgb}, 0)`);
        c2d.fillStyle = grad;
        c2d.beginPath();
        c2d.arc(pontaX, pontaY, 10, 0, Math.PI * 2);
        c2d.fill();
      }
      c2d.restore();
    }

    function desenharCantosTravamento(
      r: DOMRect,
      espacamento: number,
      alpha: number,
      codigo: string,
      pct: number,
    ) {
      if (alpha <= 0.01) return;
      const braco = Math.min(14, r.width * 0.08, r.height * 0.16);
      const l = r.left - espacamento;
      const t = r.top - espacamento;
      const ri = r.right + espacamento;
      const b = r.bottom + espacamento;

      c2d.save();
      c2d.strokeStyle = `rgba(${paleta.acentoRgb}, ${(alpha * (paleta.escuro ? 0.92 : 0.78)).toFixed(3)})`;
      c2d.lineWidth = 1.5;
      c2d.lineCap = 'square';

      c2d.beginPath();
      // Superior esquerdo
      c2d.moveTo(l, t + braco);
      c2d.lineTo(l, t);
      c2d.lineTo(l + braco, t);
      // Superior direito
      c2d.moveTo(ri - braco, t);
      c2d.lineTo(ri, t);
      c2d.lineTo(ri, t + braco);
      // Inferior esquerdo
      c2d.moveTo(l, b - braco);
      c2d.lineTo(l, b);
      c2d.lineTo(l + braco, b);
      // Inferior direito
      c2d.moveTo(ri - braco, b);
      c2d.lineTo(ri, b);
      c2d.lineTo(ri, b - braco);
      c2d.stroke();

      // Etiqueta técnica de coordenada no topo direito durante a materialização
      c2d.font = '600 10px "Geist Mono", ui-monospace, monospace';
      c2d.textAlign = 'right';
      c2d.textBaseline = 'bottom';
      const etiqueta = `${codigo} · ${String(Math.round(pct * 100)).padStart(3, '0')}%`;
      c2d.fillStyle = `rgba(${paleta.acentoRgb}, ${(alpha * (paleta.escuro ? 0.88 : 0.72)).toFixed(3)})`;
      c2d.fillText(etiqueta, ri - 2, t - 4);
      c2d.restore();
    }

    function desenharVarreduraLaser(r: DOMRect, progresso: number, alpha: number) {
      if (alpha <= 0.01 || r.height < 8) return;
      const scanY = r.top + r.height * progresso;
      const rastroH = Math.min(54, r.height * 0.34);
      const topoRastro = Math.max(r.top, scanY - rastroH);

      c2d.save();
      c2d.beginPath();
      c2d.rect(r.left, r.top, r.width, r.height);
      c2d.clip();

      // Véu holográfico curto atrás da frente laser
      const grad = c2d.createLinearGradient(0, topoRastro, 0, scanY);
      grad.addColorStop(0, `rgba(${paleta.acentoRgb}, 0)`);
      grad.addColorStop(0.7, `rgba(${paleta.acentoRgb}, ${(alpha * (paleta.escuro ? 0.14 : 0.08)).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${paleta.acentoRgb}, ${(alpha * (paleta.escuro ? 0.28 : 0.16)).toFixed(3)})`);
      c2d.fillStyle = grad;
      c2d.fillRect(r.left, topoRastro, r.width, scanY - topoRastro);

      // Micro-malha arquitetônica iluminada apenas na faixa de rasterização
      const passo = 22;
      c2d.strokeStyle = `rgba(${paleta.gradeRgb}, ${(alpha * (paleta.escuro ? 0.22 : 0.13)).toFixed(3)})`;
      c2d.lineWidth = 0.75;
      c2d.beginPath();
      for (let gx = r.left + passo; gx < r.right; gx += passo) {
        c2d.moveTo(gx, topoRastro);
        c2d.lineTo(gx, scanY);
      }
      for (let gy = Math.ceil(topoRastro / passo) * passo; gy < scanY; gy += passo) {
        c2d.moveTo(r.left, gy);
        c2d.lineTo(r.right, gy);
      }
      c2d.stroke();

      // Feixe laser principal na borda de impressão
      const beamGrad = c2d.createLinearGradient(r.left, scanY, r.right, scanY);
      beamGrad.addColorStop(0, `rgba(${paleta.acentoRgb}, 0)`);
      beamGrad.addColorStop(0.14, `rgba(${paleta.acentoRgb}, ${(alpha * 0.92).toFixed(3)})`);
      beamGrad.addColorStop(0.5, `rgba(${paleta.nucleoRgb}, ${(alpha * (paleta.escuro ? 0.96 : 0.85)).toFixed(3)})`);
      beamGrad.addColorStop(0.86, `rgba(${paleta.acentoRgb}, ${(alpha * 0.92).toFixed(3)})`);
      beamGrad.addColorStop(1, `rgba(${paleta.acentoRgb}, 0)`);
      c2d.strokeStyle = beamGrad;
      c2d.lineWidth = 1.75;
      c2d.beginPath();
      c2d.moveTo(r.left, scanY);
      c2d.lineTo(r.right, scanY);
      c2d.stroke();

      c2d.restore();
    }

    function desenharHubAtivo(agoraSec: number) {
      const raiz = containerRef.current;
      if (!raiz || !ativoRef.current) return;
      const hubs = raiz.querySelectorAll<HTMLElement>('[data-matriz-hub="true"][data-ativa="true"]');
      const hub = hubs[hubs.length - 1];
      if (!hub) return;
      const r = hub.getBoundingClientRect();
      if (r.width <= 0 || r.bottom < 0 || r.top > altura) return;

      const cx = r.left + 22;
      const cy = r.top + 20;
      const raio = 13;

      c2d.save();
      // Arco orbital de calibração ao redor do emblema da Matriz Mãe
      c2d.strokeStyle = `rgba(${paleta.acentoRgb}, ${paleta.escuro ? 0.72 : 0.56})`;
      c2d.lineWidth = 1.25;
      c2d.beginPath();
      c2d.arc(cx, cy, raio, agoraSec * 2.2, agoraSec * 2.2 + Math.PI * 0.82);
      c2d.stroke();

      c2d.strokeStyle = `rgba(${paleta.nucleoRgb}, ${paleta.escuro ? 0.48 : 0.34})`;
      c2d.beginPath();
      c2d.arc(cx, cy, raio + 3, -agoraSec * 1.4, -agoraSec * 1.4 + Math.PI * 0.45);
      c2d.stroke();

      // Micro-cruzetas nas extremidades do cartão ativo
      const tick = 5;
      c2d.strokeStyle = `rgba(${paleta.acentoRgb}, ${paleta.escuro ? 0.55 : 0.42})`;
      c2d.lineWidth = 1;
      c2d.beginPath();
      c2d.moveTo(r.right - tick, r.top);
      c2d.lineTo(r.right, r.top);
      c2d.lineTo(r.right, r.top + tick);
      c2d.moveTo(r.left, r.bottom - tick);
      c2d.lineTo(r.left, r.bottom);
      c2d.lineTo(r.left + tick, r.bottom);
      c2d.stroke();
      c2d.restore();
    }

    function quadro(agoraMs: number) {
      rafId = null;
      if (document.hidden) return;
      const dt = ultimoMs > 0 ? Math.min((agoraMs - ultimoMs) / 1000, 0.05) : 1 / 60;
      ultimoMs = agoraMs;

      c2d.clearRect(0, 0, largura, altura);
      const agoraSec = agoraMs / 1000;

      // 1. Retículo orbital do hub ativo durante pensamento/tools SSE
      desenharHubAtivo(agoraSec);

      // 2. Forjas componente por componente da GenUI
      for (let i = forjas.length - 1; i >= 0; i--) {
        const f = forjas[i]!;
        if (!f.el.isConnected) {
          forjas.splice(i, 1);
          continue;
        }
        const decorrido = agoraMs - f.inicioMs - f.atrasoMs;
        if (decorrido < 0) continue;
        const t = decorrido / f.duracaoMs;
        if (t >= 1) {
          forjas.splice(i, 1);
          continue;
        }

        const r = f.el.getBoundingClientRect();
        if (r.width < 12 || r.height < 12 || r.bottom < -40 || r.top > altura + 40) {
          continue;
        }

        // Conduto de energia da Matriz Mãe -> topo do componente (0..0.62)
        const tConduto = easeOutQuart(Math.min(1, t / 0.34));
        const alphaConduto = t < 0.38 ? 1 : Math.max(0, 1 - (t - 0.38) / 0.28);
        if (alphaConduto > 0.01) {
          let ox = r.left + 28;
          let oy = Math.max(16, r.top - 48);
          if (f.hubEl && f.hubEl.isConnected) {
            const hr = f.hubEl.getBoundingClientRect();
            if (hr.width > 0 && hr.height > 0) {
              ox = hr.left + 22;
              oy = hr.bottom;
            }
          }
          desenharConduite(ox, oy, r.left + 16, r.top + 1, tConduto, alphaConduto);
        }

        // Impacto inicial: partículas geométricas no topo do componente
        if (!f.impactoDisparado && t >= 0.16) {
          f.impactoDisparado = true;
          spawnParticulas(r.left + r.width * 0.5, r.top + 2, 12, Math.min(r.width * 0.72, 340));
        }

        // Travamento de cantos com micro-overshoot (0.04..0.96)
        const tLock = Math.min(1, Math.max(0, (t - 0.04) / 0.32));
        const espacamento = (1 - easeOutBack(tLock)) * 10;
        const alphaLock =
          t < 0.16 ? t / 0.16 : t > 0.72 ? Math.max(0, 1 - (t - 0.72) / 0.28) : 1;
        const tScan = easeOutQuart(Math.min(1, Math.max(0, (t - 0.1) / 0.64)));
        desenharCantosTravamento(r, espacamento, alphaLock, f.codigo, tScan);

        // Varredura laser de impressão holográfica top -> bottom (0.10..0.78)
        if (t >= 0.1 && t <= 0.82) {
          const alphaScan =
            t < 0.2 ? (t - 0.1) / 0.1 : t > 0.64 ? Math.max(0, 1 - (t - 0.64) / 0.18) : 1;
          desenharVarreduraLaser(r, tScan, alphaScan);

          const scanY = r.top + r.height * tScan;
          if (f.ultimoEmitY < 0 || Math.abs(scanY - f.ultimoEmitY) > 36) {
            f.ultimoEmitY = scanY;
            spawnParticulas(r.left + r.width * 0.5, scanY, 3, Math.min(r.width * 0.85, 420));
          }
        }
      }

      // 3. Ondas cinéticas de clique / conclusão de tool
      for (let i = ondas.length - 1; i >= 0; i--) {
        const o = ondas[i]!;
        o.idade += dt;
        const p = o.idade / o.duracao;
        if (p >= 1) {
          ondas.splice(i, 1);
          continue;
        }
        const e = easeOutQuart(p);
        const alpha = (1 - p) * (1 - p);
        const raio = 6 + o.raioMax * e;
        c2d.save();
        c2d.strokeStyle = `rgba(${paleta.acentoRgb}, ${(alpha * (paleta.escuro ? 0.78 : 0.58)).toFixed(3)})`;
        c2d.lineWidth = 1.4;
        c2d.beginPath();
        c2d.arc(o.x, o.y, raio, 0, Math.PI * 2);
        c2d.stroke();

        // Anel secundário octogonal de calibração
        c2d.strokeStyle = `rgba(${paleta.nucleoRgb}, ${(alpha * 0.35).toFixed(3)})`;
        c2d.lineWidth = 0.9;
        c2d.beginPath();
        c2d.arc(o.x, o.y, raio * 0.64, p * 2.4, p * 2.4 + Math.PI * 1.15);
        c2d.stroke();
        c2d.restore();
      }

      // 4. Partículas minerais geométricas (losangos lapidados)
      for (let i = particulas.length - 1; i >= 0; i--) {
        const pt = particulas[i]!;
        pt.vida += dt;
        if (pt.vida >= pt.vidaMax) {
          particulas.splice(i, 1);
          continue;
        }
        const p = pt.vida / pt.vidaMax;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vx *= Math.pow(0.18, dt);
        pt.vy *= Math.pow(0.24, dt);
        pt.rot += pt.vrot * dt;

        const alpha = Math.sin(Math.min(1, p) * Math.PI);
        const s = pt.tamanho * (1 - p * 0.45);
        const rgb = pt.cor === 'acento' ? paleta.acentoRgb : paleta.nucleoRgb;

        c2d.save();
        c2d.translate(pt.x, pt.y);
        c2d.rotate(pt.rot);
        c2d.fillStyle = `rgba(${rgb}, ${(alpha * (paleta.escuro ? 0.88 : 0.68)).toFixed(3)})`;
        c2d.fillRect(-s * 0.5, -s * 0.5, s, s);
        c2d.restore();
      }

      if (forjas.length > 0 || particulas.length > 0 || ondas.length > 0 || ativoRef.current) {
        rafId = window.requestAnimationFrame(quadro);
      } else {
        ultimoMs = 0;
      }
    }

    function acordar() {
      if (rafId !== null || document.hidden || movimentoReduzidoAgora()) return;
      ultimoMs = 0;
      rafId = window.requestAnimationFrame(quadro);
    }

    acordarRef.current = acordar;
    emitirOndaHubRef.current = () => {
      const raiz = containerRef.current;
      if (!raiz) return;
      const hubs = raiz.querySelectorAll<HTMLElement>('[data-matriz-hub="true"]');
      const hub = hubs[hubs.length - 1];
      if (!hub) return;
      const r = hub.getBoundingClientRect();
      if (r.width > 0 && r.top < altura && r.bottom > 0) {
        adicionarOnda(r.left + 22, r.top + 20, 42, 0.48);
      }
    };

    const obsDom = new MutationObserver(() => {
      const raiz = containerRef.current;
      if (raiz) varrerNovosBlocos(raiz);
    });
    if (containerRef.current) {
      varrerNovosBlocos(containerRef.current);
      obsDom.observe(containerRef.current, { childList: true, subtree: true });
    }

    const obsTema = new MutationObserver(() => {
      paleta = lerPaletaTema();
    });
    obsTema.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema'],
    });

    const aoEventoPulso = (e: Event) => {
      const det = (e as CustomEvent<{ x?: number; y?: number; forja?: boolean }>).detail;
      if (!det || det.forja) return;
      if (typeof det.x === 'number' && typeof det.y === 'number') {
        adicionarOnda(det.x, det.y, 44, 0.46);
      }
    };

    const aoVisibilidade = () => {
      if (document.hidden && rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      } else if (!document.hidden && (forjas.length > 0 || ativoRef.current)) {
        acordar();
      }
    };

    redimensionar();
    window.addEventListener('resize', redimensionar, { passive: true });
    window.addEventListener('forseti:matriz-pulso', aoEventoPulso);
    document.addEventListener('visibilitychange', aoVisibilidade);
    if (ativoRef.current) acordar();

    return () => {
      acordarRef.current = null;
      emitirOndaHubRef.current = null;
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      obsDom.disconnect();
      obsTema.disconnect();
      window.removeEventListener('resize', redimensionar);
      window.removeEventListener('forseti:matriz-pulso', aoEventoPulso);
      document.removeEventListener('visibilitychange', aoVisibilidade);
    };
  }, [containerRef]);

  return (
    <canvas
      ref={canvasRef}
      className="ia-matriz-overlay"
      aria-hidden="true"
    />
  );
}
