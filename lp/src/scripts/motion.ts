/* Forseti LP · motion: Surgir, Conectar, Propagar, Estabilizar.
   No dependencies: an IntersectionObserver turns .rv reveals on and sets
   .on on every svg.cords, which triggers the cord drawing and the one-pass
   signal in CSS. With .reduce the CSS already renders the final state and
   this file only marks the document as booted. */

const root = document.documentElement;
const reduced = root.classList.contains('reduce');

const targets = document.querySelectorAll<HTMLElement>('.rv, svg.cords');

if (reduced || !('IntersectionObserver' in window)) {
  targets.forEach((el) => el.classList.add('on'));
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('on');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );
  targets.forEach((el) => io.observe(el));
}

/* Marks the document so the no-JS fallback timer in Base.astro stands down. */
root.classList.add('motion-ok');
