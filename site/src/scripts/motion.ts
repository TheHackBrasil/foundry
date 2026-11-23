// Motion layer: Lenis + GSAP choreography in the v4 sequence —
// Surgir (hero), Conectar (cords drawn), Propagar (the signal dot),
// Estabilizar (everything rests). Base.astro sets .reduce before paint; this
// file only reads it. Reduced motion drops Tier-1 and keeps only instant
// state changes: every cord stays drawn, nothing is only conveyed by motion.
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { MotionPathPlugin } from 'gsap/MotionPathPlugin';
import Lenis from 'lenis';

const root = document.documentElement;
const REDUCED = root.classList.contains('reduce');
const $ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => el.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, el: ParentNode = document) => [...el.querySelectorAll<T>(s)];

gsap.registerPlugin(ScrollTrigger, MotionPathPlugin);

/* ---------- smooth scroll (Tier-1) ---------- */
let lenis: Lenis | null = null;
if (!REDUCED) {
  lenis = new Lenis({ lerp: 0.1 });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((t) => lenis!.raf(t * 1000));
  gsap.ticker.lagSmoothing(0);
}

/* ---------- scroll progress bar ---------- */
const hero = $('#hero')!;
const bar = $('#progress span');
const onScroll = () => {
  const max = root.scrollHeight - innerHeight;
  const p = max > 0 ? Math.min(1, scrollY / max) : 0;
  if (bar) bar.style.transform = `scaleX(${p})`;
};
if (lenis) lenis.on('scroll', onScroll);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ---------- cordas: desenho e sinal ---------- */
// Each .cords svg: four lavender lines + an optional violet signal dot.
// Without JS or under .reduce the paths stay fully drawn — final state first.
function drawCords(svg: SVGSVGElement, trigger: Element | string, start: string) {
  const paths = $$<SVGPathElement>('path', svg);
  paths.forEach((p, i) => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
    gsap.to(p, {
      strokeDashoffset: 0,
      duration: 1.6,
      delay: i * 0.14,
      ease: 'power2.inOut',
      scrollTrigger: { trigger, start, once: true },
    });
  });
}

function propagateSignal(svg: SVGSVGElement) {
  const dot = $<SVGCircleElement>('.cord-signal', svg);
  const paths = $$<SVGPathElement>('path', svg);
  if (!dot || paths.length < 2) return;
  gsap.to(dot, {
    motionPath: { path: paths[1], align: paths[1], alignOrigin: [0.5, 0.5] },
    duration: 5.2,
    ease: 'power1.inOut',
    repeat: -1,
    repeatDelay: 2.4,
    delay: 2,
  });
}

/* ---------- hero entrance: Surgir, Conectar, Propagar ---------- */
if (!REDUCED) {
  gsap.fromTo('.hero-title .ln > span', { yPercent: 112, opacity: 1 }, { yPercent: 0, opacity: 1, duration: 1.15, ease: 'expo.out', stagger: 0.11, delay: 0.15 });
  gsap.from('.hero-sub, .hero-verbs, .hero-not, .hero-actions, .hero-facts', { opacity: 0, y: 18, duration: 1, ease: 'expo.out', stagger: 0.1, delay: 0.55, clearProps: 'transform,opacity' });

  const scene = $('.hero-scene');
  if (scene) {
    gsap.from('.hero-scene .mono', { y: 60, opacity: 0, duration: 1.3, ease: 'expo.out', stagger: 0.12, delay: 0.4 });
    drawCords(scene, '.hero', 'top 95%');
    propagateSignal(scene);
  }

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

/* ---------- sections: the nav follows the scroll ---------- */
{
  const navLinks = $$<HTMLAnchorElement>('.top nav a');
  const setSection = (sec: HTMLElement) => {
    navLinks.forEach((a) => (a.getAttribute('href') === `#${sec.id}` ? a.setAttribute('aria-current', 'location') : a.removeAttribute('aria-current')));
  };
  navLinks.forEach((a) => {
    const sec = $(a.getAttribute('href') ?? '');
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => self.isActive && setSection(sec as HTMLElement),
    });
  });
}

/* ---------- photos: a full-colour copy fades in on hover, so filter never animates ---------- */
$$<HTMLImageElement>('.print img, .portrait img, .avatar img').forEach((img) => {
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
  // On an inner wrapper: .stop-media itself carries the reveal tween on y.
  $$('.stop-media .drift').forEach((el, i) =>
    gsap.fromTo(el, { y: 40 + (i % 3) * 12 }, {
      y: -40 - (i % 3) * 12,
      ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true },
    }),
  );

  // A camada: as cordas se desenham quando entram na tela e o sinal propaga.
  $$<SVGSVGElement>('.layer-cords, .closing > .cords').forEach((svg) => {
    drawCords(svg, svg, 'top 88%');
    propagateSignal(svg);
  });

  // ABERTO: each row starts glowing and cools as it rises through the viewport.
  $$('.q .heat').forEach((el) =>
    gsap.fromTo(el, { opacity: 1 }, {
      opacity: 0,
      ease: 'none',
      scrollTrigger: { trigger: el.parentElement, start: 'top 95%', end: 'top 30%', scrub: true },
    }),
  );
}
