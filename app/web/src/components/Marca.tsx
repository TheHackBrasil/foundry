// Marca "Refinada" (estudo aprovado em 22/11/2026): duas águas de telhado raso, ouro e
// prata chapados, e uma viga de base. Ouro e prata só decoram; o contorno de tinta dá a forma.
// Decorativa: o nome "Forseti" sempre aparece em texto ao lado.
export function Marca({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <polygon points="5,32 30,19 30,28 5,41" fill="var(--gold)" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="miter" />
      <polygon points="59,32 34,19 34,28 59,41" fill="var(--silver)" stroke="var(--text)" strokeWidth="1.8" strokeLinejoin="miter" />
      <rect x="11" y="47" width="42" height="3.4" fill="var(--text)" />
    </svg>
  );
}
