// Icones novos da frente v2-menu (spec 0014, THE-20). O arquivo de icones do
// app mora em components/icones.tsx, fora dos paths da frente; estes seguem a
// mesma convencao e podem ser fundidos la pela integracao.
const base = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const traco = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function IconeLupa() {
  return (
    <svg {...base}>
      <circle {...traco} cx="7" cy="7" r="4.25" />
      <path {...traco} d="m10.25 10.25 3 3" />
    </svg>
  );
}

export function IconeChevron() {
  return (
    <svg {...base}>
      <path {...traco} d="m6 3.75 4.5 4.25L6 12.25" />
    </svg>
  );
}
