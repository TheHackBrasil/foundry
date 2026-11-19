// Motion layer: Lenis smooth scroll + GSAP reveals + progress + embers.
// Everything gated on prefers-reduced-motion (or ?reduce=1 for testing).
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

const REDUCED =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
  new URLSearchParams(location.search).get('reduce') === '1';

gsap.registerPlugin(ScrollTrigger);

/* ---------- smooth scroll (Tier-1: never instantiate when reduced) ---------- */
let lenis: Lenis | null = null;
if (!REDUCED) {
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ---------- reading progress ---------- */
{
  const bar = document.querySelector<HTMLElement>('#progress span');
  const set = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 0})`;
  };
  if (lenis) lenis.on('scroll', set);
  addEventListener('scroll', set, { passive: true });
  set();
}

/* ---------- reveals ---------- */
{
  const els = gsap.utils.toArray<HTMLElement>('.rv');
  if (REDUCED) {
    els.forEach((el) => el.classList.add('rv-in'));
  } else {
    els.forEach((el) => {
      gsap.fromTo(
        el,
        { opacity: 0, y: 26 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          ease: 'power3.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
          onComplete: () => el.classList.add('rv-in'),
        },
      );
    });
  }
}

/* ---------- ember particles ---------- */
{
  const cv = document.querySelector<HTMLCanvasElement>('#embers');
  if (cv && !REDUCED) {
    const ctx = cv.getContext('2d')!;
    let W = 0, H = 0;
    type P = { x: number; y: number; s: number; v: number; a: number; drift: number };
    const spawn = (y?: number): P => ({
      x: Math.random() * W,
      y: y ?? Math.random() * H,
      s: 1 + Math.random() * 2.2,
      v: 0.12 + Math.random() * 0.35,
      a: 0.08 + Math.random() * 0.3,
      drift: (Math.random() - 0.5) * 0.15,
    });
    const size = () => { W = cv.width = innerWidth; H = cv.height = innerHeight; };
    size();
    addEventListener('resize', size);
    const parts = Array.from({ length: Math.min(40, Math.round(innerWidth / 34)) }, () => spawn());
    let last = 0;
    const tick = (t: number) => {
      requestAnimationFrame(tick);
      if (document.hidden || t - last < 33) return;
      last = t;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y -= p.v * 2; p.x += p.drift;
        if (p.y < -8) Object.assign(p, spawn(H + 8));
        ctx.globalAlpha = p.a;
        ctx.fillStyle = '#ff8a3d';
        ctx.fillRect(p.x, p.y, p.s, p.s);
      }
      ctx.globalAlpha = 1;
    };
    requestAnimationFrame(tick);
  }
}
