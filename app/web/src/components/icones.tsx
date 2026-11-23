// Ícones geométricos leves e consistentes: o significado sempre vem junto em texto.
const base = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const traco = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

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
      <path {...traco} d="m5.25 8.25 2 2L11 6.25" />
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
      <path {...traco} d="M8 10.75V3.25m0 0L4.75 6.5M8 3.25l3.25 3.25M3 12.75h10" />
    </svg>
  );
}

export function IconeSeta() {
  return (
    <svg {...base}>
      <path {...traco} d="M2.5 8h10.5M9.25 4.25 13 8l-3.75 3.75" />
    </svg>
  );
}

export function IconePausa() {
  return (
    <svg {...base}>
      <path {...traco} d="M5.5 3.5v9M10.5 3.5v9" />
    </svg>
  );
}

export function IconeRetomar() {
  return (
    <svg {...base}>
      <path {...traco} d="M5.25 3.5 12.5 8l-7.25 4.5z" />
    </svg>
  );
}

export function IconeSemComparacao() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="8" r="5.25" strokeDasharray="2 2.6" />
    </svg>
  );
}

export function IconeComando() {
  return (
    <svg {...base}>
      <path {...traco} d="m4.5 4.5 3.75 3.5-3.75 3.5M9.25 11.5h3.25" />
    </svg>
  );
}

export function IconeMic() {
  return (
    <svg {...base}>
      <rect {...traco} x="5.75" y="2.25" width="4.5" height="6.75" rx="2.25" />
      <path {...traco} d="M3.5 7.75v.75a4.5 4.5 0 0 0 9 0v-.75M8 13v1.5M5.75 14.5h4.5" />
    </svg>
  );
}

export function IconeParar() {
  return (
    <svg {...base}>
      <rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function IconeFechar() {
  return (
    <svg {...base}>
      <path {...traco} d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5" />
    </svg>
  );
}

export function IconeLente() {
  return (
    <svg {...base}>
      <rect {...traco} x="2.25" y="3.25" width="7.25" height="9.5" rx="1.5" />
      <path {...traco} d="M9.5 5.5h2.75a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H9.5" />
    </svg>
  );
}

export function IconeSinal() {
  return (
    <svg {...base}>
      <path {...traco} d="M2.75 10.75V8.25m3.5 2.5V5.25m3.5 5.5V3.75m3.5 7V6.75" />
    </svg>
  );
}

export function IconeAviso() {
  return (
    <svg {...base}>
      <rect {...traco} x="2.25" y="3.5" width="11.5" height="9" rx="1.5" />
      <path {...traco} d="m2.75 4.5 5.25 4 5.25-4" />
    </svg>
  );
}

export function IconeRetorno() {
  return (
    <svg {...base}>
      <path {...traco} d="M12.75 4.5v3a2 2 0 0 1-2 2H3.5m0 0 2.75-2.75M3.5 9.5l2.75 2.75" />
    </svg>
  );
}
