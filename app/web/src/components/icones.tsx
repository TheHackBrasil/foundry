// Ícones simples, decorativos: o significado sempre vem junto em texto.
const base = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const traco = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'square', strokeLinejoin: 'miter' } as const;

export function IconeDiverge() {
  return (
    <svg {...base}>
      <path {...traco} d="M3 6h10M3 10h10M10 3 6 13" />
    </svg>
  );
}

export function IconeConfere() {
  return (
    <svg {...base}>
      <path {...traco} d="m3 8.5 3.2 3L13 4.5" />
    </svg>
  );
}

export function IconeOk() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="8" r="6" />
      <path {...traco} d="m5 8.3 2.2 2L11 6" />
    </svg>
  );
}

export function IconeErro() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="8" r="6" />
      <path {...traco} d="m5.75 5.75 4.5 4.5m0-4.5-4.5 4.5" />
    </svg>
  );
}

export function IconeEnvio() {
  return (
    <svg {...base}>
      <path {...traco} d="M8 11V3m0 0L4.5 6.5M8 3l3.5 3.5M3 13h10" />
    </svg>
  );
}

export function IconeSeta() {
  return (
    <svg {...base}>
      <path {...traco} d="M2 8h11M9 4l4 4-4 4" />
    </svg>
  );
}

export function IconePausa() {
  return (
    <svg {...base}>
      <path {...traco} d="M5.5 3v10M10.5 3v10" />
    </svg>
  );
}

export function IconeRetomar() {
  return (
    <svg {...base}>
      <path {...traco} d="M5 3l8 5-8 5z" />
    </svg>
  );
}

export function IconeSemComparacao() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="8" r="5.2" strokeDasharray="2 2.4" />
    </svg>
  );
}

export function IconeMic() {
  return (
    <svg {...base}>
      <rect {...traco} x="5.75" y="2.25" width="4.5" height="7" rx="2.25" />
      <path {...traco} d="M3.5 7.5v1a4.5 4.5 0 0 0 9 0v-1M8 13v1.5M5.5 14.5h5" />
    </svg>
  );
}

export function IconeParar() {
  return (
    <svg {...base}>
      <rect x="4" y="4" width="8" height="8" fill="currentColor" />
    </svg>
  );
}

export function IconeFechar() {
  return (
    <svg {...base}>
      <path {...traco} d="m4 4 8 8m0-8-8 8" />
    </svg>
  );
}

export function IconeLente() {
  return (
    <svg {...base}>
      <rect {...traco} x="2.25" y="3.25" width="7.5" height="9.5" />
      <path {...traco} d="M9.75 5.5h4v5h-4" />
    </svg>
  );
}

export function IconeSinal() {
  return (
    <svg {...base}>
      <path {...traco} d="M2.5 11V8m3.5 3V5m3.5 6V3.5M13 11V7" />
    </svg>
  );
}

export function IconeAviso() {
  return (
    <svg {...base}>
      <rect {...traco} x="2.25" y="3.5" width="11.5" height="9" />
      <path {...traco} d="m2.5 4 5.5 4.5L13.5 4" />
    </svg>
  );
}
