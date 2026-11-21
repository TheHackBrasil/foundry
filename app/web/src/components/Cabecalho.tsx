import type { EstadoStream } from '../useStream.ts';

const ROTULO_STREAM: Record<EstadoStream, string> = {
  conectando: 'Conectando…',
  ao_vivo: 'Ao vivo',
  reconectando: 'Reconectando…',
};

export function Cabecalho({ stream }: { stream: EstadoStream }) {
  return (
    <header className="topo">
      <div className="topo-titulo">
        <p className="marca">The Foundry</p>
        <h1>Torre de pedidos</h1>
      </div>
      <div className="topo-selos">
        <p className="selo">Demonstração com dados fictícios</p>
        <p className={`vivo vivo-${stream}`}>
          <span className="vivo-ponto" aria-hidden="true" />
          {ROTULO_STREAM[stream]}
        </p>
      </div>
    </header>
  );
}
