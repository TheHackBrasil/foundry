import type { Tema } from '../tema.ts';
import type { EstadoStream } from '../useStream.ts';
import { IconePausa, IconeRetomar } from './icones.tsx';
import { Marca } from './Marca.tsx';

const ROTULO_STREAM: Record<EstadoStream, string> = {
  conectando: 'Conectando…',
  ao_vivo: 'Ao vivo',
  reconectando: 'Reconectando…',
};

interface Props {
  stream: EstadoStream;
  pausado: boolean;
  pendentes: number;
  aoPausar: () => void;
  tema: Tema;
  aoTema: (tema: Tema) => void;
}

export function Cabecalho({ stream, pausado, pendentes, aoPausar, tema, aoTema }: Props) {
  return (
    <header className="topo">
      <div className="topo-marca">
        <Marca />
        <h1>
          Forseti<span className="so-leitor">: torre de pedidos</span>
        </h1>
        <p className="selo">Demonstração com dados fictícios</p>
      </div>
      <div className="topo-acoes">
        <p className={`vivo vivo-${stream}`}>
          <span className="vivo-ponto" aria-hidden="true" />
          {pausado
            ? `Pausado${pendentes > 0 ? `: ${pendentes} ${pendentes === 1 ? 'evento' : 'eventos'} na fila` : ''}`
            : ROTULO_STREAM[stream]}
        </p>
        <button type="button" className="botao" onClick={aoPausar}>
          {pausado ? <IconeRetomar /> : <IconePausa />}
          {pausado ? 'Retomar atualizações' : 'Pausar atualizações'}
        </button>
        <div className="tema" role="group" aria-label="Tema">
          <button type="button" aria-pressed={tema === 'light'} onClick={() => aoTema('light')}>
            Claro
          </button>
          <button type="button" aria-pressed={tema === 'dark'} onClick={() => aoTema('dark')}>
            Escuro
          </button>
        </div>
      </div>
    </header>
  );
}
