import { useEffect, useRef, useState } from 'react';
import type { Evento } from '../../shared/model.ts';

export type EstadoStream = 'conectando' | 'ao_vivo' | 'reconectando';

// O servidor manda "hello" a cada (re)conexão. É nesse ponto que a tela
// rebusca o estado, porque eventos enviados durante a queda não são reenviados.
export function useStream(aoEvento: (evento: Evento) => void, aoConectar: () => void): EstadoStream {
  const [estado, setEstado] = useState<EstadoStream>('conectando');
  const evento = useRef(aoEvento);
  const conectar = useRef(aoConectar);

  useEffect(() => {
    evento.current = aoEvento;
    conectar.current = aoConectar;
  });

  useEffect(() => {
    const fonte = new EventSource('/api/stream');
    fonte.addEventListener('hello', () => {
      setEstado('ao_vivo');
      conectar.current();
    });
    fonte.addEventListener('evento', (mensagem) => {
      try {
        evento.current(JSON.parse((mensagem as MessageEvent<string>).data) as Evento);
      } catch {
        // quadro malformado: ignora, o próximo "hello" ou GET reidrata
      }
    });
    fonte.onerror = () => setEstado('reconectando');
    return () => fonte.close();
  }, []);

  return estado;
}
