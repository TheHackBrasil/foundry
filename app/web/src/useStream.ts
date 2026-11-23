import { useEffect, useRef, useState } from 'react';
import type { Evento } from '../../shared/model.ts';

export type EstadoStream = 'conectando' | 'ao_vivo' | 'reconectando';

// O servidor manda "hello" a cada (re)conexão. É nesse ponto que a tela
// rebusca o estado, porque eventos enviados durante a queda não são reenviados.
// `pronto` só vira verdadeiro depois da primeira resposta da API: é ela que entrega o
// cookie da sessão. Abrir o stream antes pode dar à lista e ao stream workspaces diferentes.
export function useStream(aoEvento: (evento: Evento) => void, aoConectar: () => void, pronto: boolean): EstadoStream {
  const [estado, setEstado] = useState<EstadoStream>('conectando');
  const evento = useRef(aoEvento);
  const conectar = useRef(aoConectar);

  useEffect(() => {
    evento.current = aoEvento;
    conectar.current = aoConectar;
  });

  useEffect(() => {
    if (!pronto) return;
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
  }, [pronto]);

  return estado;
}
