// Ícones simples, decorativos: o significado sempre vem junto em texto.
const base = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const traco = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function IconeAlerta() {
  return (
    <svg {...base}>
      <path {...traco} d="M8 1.75 14.75 14H1.25L8 1.75Z" />
      <path {...traco} d="M8 6.25v3.5M8 11.75v.25" />
    </svg>
  );
}

export function IconeOk() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="8" r="6.25" />
      <path {...traco} d="m5.25 8.25 1.9 1.9 3.6-4" />
    </svg>
  );
}

export function IconeErro() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="8" r="6.25" />
      <path {...traco} d="m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5" />
    </svg>
  );
}

export function IconeEnvio() {
  return (
    <svg {...base}>
      <path {...traco} d="M8 10.5V2.5m0 0L5 5.5m3-3 3 3M2.5 10.5v2.25h11V10.5" />
    </svg>
  );
}
