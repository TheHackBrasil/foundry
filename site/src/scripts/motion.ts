// Motion layer: Lenis + GSAP choreography, the thermometer HUD and the
// WebGL forge boot. Base.astro sets .reduce before paint; this file only
// reads it. Reduced motion drops Tier-1 (Lenis, WebGL, scrubbed travel)
// and keeps only instant state changes.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import type { ForgeInput } from './forge';

const root = document.documentElement;
const REDUCED = root.classList.contains('reduce');
const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => [...el.querySelectorAll<T>(s)];

gsap.registerPlugin(ScrollTrigger);

/* ---------- smooth scroll (Tier-1) ---------- */
let lenis: Lenis | null = null;
if (!REDUCED) {
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ---------- shared scroll state, also fed to the forge ---------- */
const input: ForgeInput = { heat: 0.35, progress: 0, hero: 0 };
const hero = $('#hero')!;
const bar = $('#progress span');
const onScroll = () => {
  const max = root.scrollHeight - innerHeight;
  input.progress = max > 0 ? Math.min(1, scrollY / max) : 0;
  input.hero = Math.min(1, Math.max(0, scrollY / Math.max(1, hero.offsetHeight)));
  if (bar) bar.style.transform = `scaleX(${input.progress})`;
};
if (lenis) lenis.on('scroll', onScroll);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- hero entrance ---------- */
if (!REDUCED) {
  gsap.fromTo('.hero-title .ln > span', { yPercent: 112, opacity: 1 }, { yPercent: 0, opacity: 1, duration: 1.15, ease: 'expo.out', stagger: 0.11, delay: 0.15 });
  gsap.to('.hero-title', {
    yPercent: -18,
    ease: 'none',
    scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true },
  });
}

/* ---------- reveals ---------- */
{
  const els = $$('.rv');
  // If the safety net already showed everything (slow boot), don't hide it again.
  if (REDUCED || root.classList.contains('rv-safe')) {
    els.forEach((el) => el.classList.add('rv-in'));
  } else {
    gsap.set(els, { y: 28 });
    ScrollTrigger.batch(els, {
      start: 'top 90%',
      once: true,
      onEnter: (batch) =>
        gsap.to(batch, {
          opacity: 1,
          y: 0,
          duration: 0.85,
          ease: 'power3.out',
          stagger: 0.08,
          clearProps: 'transform',
          onComplete: () => batch.forEach((el) => el.classList.add('rv-in')),
        }),
    });
  }
  // Keyboard can land inside a block that has not scrolled in yet: show it now.
  document.addEventListener('focusin', (e) => {
    const rv = (e.target as Element).closest?.('.rv:not(.rv-in)');
    if (!rv) return;
    gsap.killTweensOf(rv);
    gsap.set(rv, { opacity: 1, clearProps: 'transform' });
    rv.classList.add('rv-in');
  });
  root.classList.add('motion-ok');
}

/* ---------- chapters: readings drive the HUD and the forge heat ---------- */
{
  const thermo = $('.thermo');
  const chapEl = $('.thermo-chap');
  const valEl = $('.thermo-val');
  const nameEl = $('.thermo-name');
  const track = $('.thermo-track');
  const fill = $('.thermo-fill');
  const navLinks = $$<HTMLAnchorElement>('.top nav a');
  const shown = { v: 25 };
  let lastNumeric = 25;

  const setChapter = (sec: HTMLElement) => {
    const num = $('.chap-tag .num', sec)?.textContent ?? '';
    const name = $('.chap-tag .name', sec)?.textContent ?? '';
    const temp = $('.chap-tag .temp', sec)?.textContent ?? '';
    const m = temp.match(/(\d+)\s*°C/);
    const reading = m ? Number(m[1]) : null;
    // No number on the page means no number on the HUD (and a warm, idle forge).
    input.heat = reading === null ? 0.45 : Math.max(0.03, Math.min(1, reading / 1200));
    if (chapEl) chapEl.textContent = num;
    if (nameEl) nameEl.textContent = name;
    navLinks.forEach((a) => (a.getAttribute('href') === `#${sec.id}` ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
    const v = reading ?? lastNumeric;
    if (reading !== null) lastNumeric = reading;
    const frac = Math.min(1, v / 1200);
    const paint = () => { if (valEl) valEl.textContent = reading === null ? temp.trim() : `${Math.round(shown.v)}°C`; };
    if (REDUCED) {
      shown.v = v;
      paint();
      if (track) track.style.transform = `translateY(${-frac * 100}%)`;
      if (fill) fill.style.transform = `scaleY(${Math.max(0.02, frac)})`;
    } else {
      gsap.to(shown, { v, duration: 1.4, ease: 'power2.out', onUpdate: paint, overwrite: true });
      gsap.to(track, { yPercent: -frac * 100, duration: 1.4, ease: 'expo.out', overwrite: true });
      gsap.to(fill, { scaleY: Math.max(0.02, frac), duration: 1.4, ease: 'expo.out', overwrite: true });
    }
  };

  $$('.chapter').forEach((sec) =>
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && setChapter(sec),
    }),
  );
  ScrollTrigger.create({
    trigger: hero,
    start: 'bottom 55%',
    onEnter: () => thermo?.classList.add('on'),
    onLeaveBack: () => {
      thermo?.classList.remove('on');
      input.heat = 0.35;
      navLinks.forEach((a) => a.removeAttribute('aria-current'));
    },
  });
}

/* ---------- chapter art (Tier-1: scrubbed travel only without reduce) ---------- */
if (!REDUCED) {
  $$('.chap-giant span').forEach((el) =>
    gsap.fromTo(el, { xPercent: 8 }, {
      xPercent: -22,
      ease: 'none',
      scrollTrigger: { trigger: el.closest('.chapter'), start: 'top bottom', end: 'bottom top', scrub: true },
    }),
  );

  const rail = $('.rail-fill');
  if (rail) {
    gsap.fromTo(rail, { scaleX: 0 }, {
      scaleX: 1,
      ease: 'none',
      scrollTrigger: { trigger: '.evidence', start: 'top 80%', end: 'bottom 70%', scrub: 0.5 },
    });
  }

  // FORMA: scattered systems settle into place, then the shared layer forms over them.
  const art = $('.layer-art');
  if (art) {
    const nodes = $$('.lnode', art);
    const tl = gsap.timeline({ scrollTrigger: { trigger: art, start: 'top 85%', end: 'center 45%', scrub: 0.6 } });
    tl.from(nodes, {
      x: (i) => [-40, 22, -18, 36][i] ?? 0,
      y: (i) => [70, 110, 60, 95][i] ?? 80,
      rotation: (i) => [-14, 9, -6, 12][i] ?? 0,
      opacity: 0.2,
      transformOrigin: '50% 50%',
      stagger: 0.06,
      ease: 'power2.out',
    })
      .from('.lwires path', { opacity: 0, stagger: 0.05 }, '-=0.2')
      .from('.lbar-g', { scaleX: 0, transformOrigin: '50% 50%', opacity: 0, ease: 'power3.out' }, '-=0.1');
  }

  // TÊMPERA: each card starts glowing and cools as it rises through the viewport.
  $$('.open-item .heat').forEach((el) =>
    gsap.fromTo(el, { opacity: 1 }, {
      opacity: 0,
      ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top 95%', end: 'top 30%', scrub: true },
    }),
  );

  // A FORJA: cards tilt toward the pointer.
  if (matchMedia('(pointer: fine)').matches) {
    $$('.member:not(.pending)').forEach((card) => {
      const rx = gsap.quickTo(card, 'rotationX', { duration: 0.5, ease: 'power3.out' });
      const ry = gsap.quickTo(card, 'rotationY', { duration: 0.5, ease: 'power3.out' });
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        ry(((e.clientX - r.left) / r.width - 0.5) * 12);
        rx(-((e.clientY - r.top) / r.height - 0.5) * 12);
      });
      card.addEventListener('pointerleave', () => { rx(0); ry(0); });
    });
  }
}

/* ---------- WebGL forge (Tier-1, isolated: any failure leaves the static backdrop) ---------- */
{
  const canvas = $<HTMLCanvasElement>('#forge');
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const lowEnd =
    (nav.hardwareConcurrency ?? 4) <= 2 || (nav.deviceMemory ?? 4) <= 2 || nav.connection?.saveData === true;
  // ?gl=0 forces the static backdrop; ?gl=force skips the frame budget guard
  // (software renderers in headless capture would otherwise trip it).
  const glParam = new URLSearchParams(location.search).get('gl');
  const off = glParam === '0';
  const hasGL = () => {
    try {
      const c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch {
      return false;
    }
  };
  // Boot after the hero entrance has had its frames: environment and shader
  // compilation can stall a weak GPU.
  const idle = (fn: () => void) =>
    'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1600 }) : setTimeout(fn, 1300);
  if (canvas && !REDUCED && !lowEnd && !off && hasGL()) idle(() => {
    import('./forge')
      .then(({ startForge }) =>
        startForge(canvas, input, {
          strikeZone: hero,
          onReady: () => root.classList.add('gl-on'),
          onLost: () => root.classList.remove('gl-on'),
          guard: glParam !== 'force',
        }),
      )
      .catch((err) => {
        root.classList.remove('gl-on');
        console.warn('forge disabled:', err);
      });
  });
}
