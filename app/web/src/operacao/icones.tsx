// Ícones da tela #/operacao no mesmo traço dos de components/icones.tsx.

const base = { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false } as const;
const traco = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// Fila de exceções: três linhas com um marcador.
export function IconeOperacao() {
  return (
    <svg {...base}>
      <path {...traco} d="M3 4.5h10M3 8h10M3 11.5h6" />
      <circle {...traco} cx="12" cy="11.5" r="2.2" />
      <path {...traco} d="m11.1 11.5.6.6 1.2-1.2" />
    </svg>
  );
}

// Comprovante verificável: documento com selo de cadeia.
export function IconeComprovante() {
  return (
    <svg {...base}>
      <path {...traco} d="M4 2.5h8v11H4zM6 5.5h4M6 8h4" />
      <path {...traco} d="M6 11h1.5M9.5 11H11" />
    </svg>
  );
}

// Cobrança de status: envelope saindo.
export function IconeEnvelope() {
  return (
    <svg {...base}>
      <rect {...traco} x="2" y="4" width="12" height="8.5" rx="1" />
      <path {...traco} d="m2.5 4.8 5.5 3.4 5.5-3.4" />
    </svg>
  );
}
