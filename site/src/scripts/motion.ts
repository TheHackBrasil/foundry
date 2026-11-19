// Motion layer: Lenis + GSAP choreography, section heat and the
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
const input: ForgeInput = { heat: 0.6, progress: 0, hero: 0 };
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
  gsap.from('.hero-sub, .hero-actions, .hero-facts', { opacity: 0, y: 18, duration: 1, ease: 'expo.out', stagger: 0.1, delay: 0.55, clearProps: 'transform,opacity' });
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

/* ---------- sections: data-heat drives the forge, the nav follows ---------- */
{
  const navLinks = $$<HTMLAnchorElement>('.top nav a');
  const setSection = (sec: HTMLElement) => {
    input.heat = Number(sec.dataset.heat ?? 0.4);
    navLinks.forEach((a) => (a.getAttribute('href') === `#${sec.id}` ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
  };
  $$('[data-heat]').forEach((sec) =>
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && setSection(sec),
    }),
  );
}

/* ---------- photos: a full-colour copy fades in on hover, so filter never animates ---------- */
$$<HTMLImageElement>('.print img, .portrait img').forEach((img) => {
  const c = img.cloneNode() as HTMLImageElement;
  c.className = 'colour';
  c.alt = '';
  c.setAttribute('aria-hidden', 'true');
  img.after(c);
});

/* ---------- ASCII map (Tier-2: one still frame under reduce) ---------- */
{
  const canvas = $<HTMLCanvasElement>('.ascii-map');
  if (canvas) import('./ascii-map').then(({ startAsciiMap }) => startAsciiMap(canvas, { reduced: REDUCED }));
}

/* ---------- chapter art (Tier-1: scrubbed travel only without reduce) ---------- */
if (!REDUCED) {
  const spine = $('.spine');
  if (spine) {
    gsap.fromTo(spine, { '--fill': 0 }, {
      '--fill': 1,
      ease: 'none',
      scrollTrigger: { trigger: spine, start: 'top 60%', end: 'bottom 60%', scrub: 0.5 },
    });
  }

  // Prints drift a little against the scroll, each at its own rate.
  $$('.stop-media').forEach((el, i) =>
    gsap.fromTo(el, { y: 40 + (i % 3) * 12 }, {
      y: -40 - (i % 3) * 12,
      ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
    }),
  );

  const bar = $('.layer-bar');
  if (bar) gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, ease: 'power2.out', scrollTrigger: { trigger: bar, start: 'top 85%', end: 'top 55%', scrub: 0.6 } });

  // ABERTO: each row starts glowing and cools as it rises through the viewport.
  $$('.q .heat').forEach((el) =>
    gsap.fromTo(el, { opacity: 1 }, {
      opacity: 0,
      ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top 95%', end: 'top 30%', scrub: true },
    }),
  );
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
