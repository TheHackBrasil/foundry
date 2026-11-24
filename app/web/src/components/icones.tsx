// Ícones geométricos leves e consistentes: o significado sempre vem junto em texto.
const base = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const micro = { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': true, focusable: false } as const;
const traco = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const tracoMicro = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
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

export function IconeCopiar() {
  return (
    <svg {...base}>
      <rect {...traco} x="5.75" y="5.75" width="7.5" height="7.5" rx="1.5" />
      <path {...traco} d="M4.25 10.25a1.5 1.5 0 0 1-1.5-1.5v-4.5a1.5 1.5 0 0 1 1.5-1.5h4.5a1.5 1.5 0 0 1 1.5 1.5" />
    </svg>
  );
}

export function IconeTorre() {
  return (
    <svg {...base}>
      <path {...traco} d="M3 13V4.5M8 13V2.75M13 13V6.25M2 13h12" />
    </svg>
  );
}

export function IconeAssistente() {
  return (
    <svg {...base}>
      <path
        {...tracoMicro}
        d="M3.25 4.75V3.25h1.5M11.25 3.25h1.5v1.5M12.75 11.25v1.5h-1.5M4.75 12.75h-1.5v-1.5M5.5 10.75V7.25M8 10.75V5.25M10.5 10.75V8.25"
      />
    </svg>
  );
}

export function IconeSol() {
  return (
    <svg {...micro}>
      <circle {...tracoMicro} cx="8" cy="8" r="2.75" />
      <path
        {...tracoMicro}
        d="M8 2.25v1.25M8 12.5v1.25M2.25 8H3.5M12.5 8h1.25M3.95 3.95l.9.9M11.15 11.15l.9.9M12.05 3.95l-.9.9M4.85 11.15l-.9.9"
      />
    </svg>
  );
}

export function IconeLua() {
  return (
    <svg {...micro}>
      <path
        {...tracoMicro}
        d="M12.75 9.85A5.25 5.25 0 0 1 6.15 3.25a5.25 5.25 0 1 0 6.6 6.6Z"
      />
    </svg>
  );
}

export function IconeRevisao() {
  return (
    <svg {...base}>
      <rect {...traco} x="2.75" y="3" width="10.5" height="10" rx="1.25" />
      <path {...traco} d="M2.75 9.25h3.1l1.15 1.5h2l1.15-1.5h3.1" />
    </svg>
  );
}

export function IconeAgenda() {
  return (
    <svg {...base}>
      <circle {...traco} cx="8" cy="5.75" r="2.25" />
      <path {...traco} d="M3.5 13a4.5 4.5 0 0 1 9 0" />
    </svg>
  );
}

export function IconeEscudo() {
  return (
    <svg {...base}>
      <path {...traco} d="M8 2.25 12.75 4v4.2c0 2.65-1.95 4.65-4.75 5.55-2.8-.9-4.75-2.9-4.75-5.55V4Z" />
      <path {...traco} d="m5.8 8.1 1.5 1.5 3-3.1" />
    </svg>
  );
}

export function IconeExterno() {
  return (
    <svg {...base}>
      <path {...traco} d="M9.5 3.25h3.25V6.5M12.5 3.5l-5.75 5.75M6.75 4.25H4a1 1 0 0 0-1 1v6.75a1 1 0 0 0 1 1h6.75a1 1 0 0 0 1-1V9.25" />
    </svg>
  );
}

export function IconeMenu() {
  return (
    <svg {...base}>
      <path {...traco} d="M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5" />
    </svg>
  );
}

export function IconeMais() {
  return (
    <svg {...base}>
      <path {...traco} d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

export function IconePainelLateral() {
  return (
    <svg {...base}>
      <rect {...traco} x="2.5" y="3" width="11" height="10" rx="1.25" />
      <path {...traco} d="M9.5 3v10" />
    </svg>
  );
}

export function IconeFabrica() {
  return (
    <svg {...micro}>
      <path {...tracoMicro} d="M2.5 13.25V7.5l3.5-2v2l3.5-2v7.75M2 13.25h12M11.5 5.5V3h2v10.25" />
    </svg>
  );
}

export function IconeCaminhao() {
  return (
    <svg {...micro}>
      <path {...tracoMicro} d="M2 4.5h7.25v6.25H2zM9.25 6.5h2.6l2.15 2v2.25h-4.75" />
      <circle {...tracoMicro} cx="4.75" cy="11.75" r="1.35" />
      <circle {...tracoMicro} cx="11.5" cy="11.75" r="1.35" />
    </svg>
  );
}

export function IconeGalpao() {
  return (
    <svg {...micro}>
      <path {...tracoMicro} d="M2.25 6.5 8 3l5.75 3.5V13h-11.5V6.5ZM5.5 13V9h5v4" />
    </svg>
  );
}

export function IconeFiscal() {
  return (
    <svg {...micro}>
      <path {...tracoMicro} d="M4 2.5h5.5l2.75 2.75V13.5H4V2.5ZM9.25 2.5v3h3M6 8.25h4M6 10.75h2.75" />
    </svg>
  );
}

export function IconeFinanceiro() {
  return (
    <svg {...micro}>
      <rect {...tracoMicro} x="2.25" y="4" width="11.5" height="8" rx="1.5" />
      <circle {...tracoMicro} cx="8" cy="8" r="1.75" />
      <path {...tracoMicro} d="M4.5 6.25v3.5M11.5 6.25v3.5" />
    </svg>
  );
}

export function IconePlanilha() {
  return (
    <svg {...micro}>
      <rect {...tracoMicro} x="2.5" y="3" width="11" height="10" rx="1.5" />
      <path {...tracoMicro} d="M2.5 6.5h11M6.5 6.5V13M10 6.5V13" />
    </svg>
  );
}

export function IconeCalendario() {
  return (
    <svg {...micro}>
      <rect {...tracoMicro} x="2.5" y="3.5" width="11" height="9.75" rx="1.5" />
      <path {...tracoMicro} d="M5.5 2.25v2.5M10.5 2.25v2.5M2.5 6.75h11" />
    </svg>
  );
}

export function IconePeso() {
  return (
    <svg {...micro}>
      <path {...tracoMicro} d="M4.25 6h7.5l1.25 7H3l1.25-7ZM6 6a2 2 0 1 1 4 0" />
    </svg>
  );
}

export function IconeCaixa() {
  return (
    <svg {...micro}>
      <path {...tracoMicro} d="M8 2.25 13 5v6l-5 2.75L3 11V5l5-2.75ZM3 5l5 2.75L13 5M8 7.75v6" />
    </svg>
  );
}

export function IconeRota() {
  return (
    <svg {...micro}>
      <circle {...tracoMicro} cx="3.75" cy="11.75" r="1.5" />
      <circle {...tracoMicro} cx="12.25" cy="4.25" r="1.5" />
      <path {...tracoMicro} d="M5.25 11.75H9a2 2 0 0 0 0-4H7a2 2 0 0 1 0-4h3.75" />
    </svg>
  );
}
