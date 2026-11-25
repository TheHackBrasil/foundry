import { useEffect, useRef, useState } from 'react';
import type { Evento } from '../../shared/model.ts';

export type EstadoStream = 'conectando' | 'ao_vivo' | 'reconectando';

export interface EventoAncoraStream {
  pedidoId?: string;
  txHash?: string;
  url?: string;
}

// O servidor manda "hello" a cada (re)conexão. Só a reconexão rebusca o
// estado, porque eventos enviados durante a queda não são reenviados; o hello
// de abertura chega logo após a primeira carga e reidratar ali duplicava GETs.
// `pronto` só vira verdadeiro depois da primeira resposta da API: é ela que entrega o
// cookie da sessão. Abrir o stream antes pode dar à lista e ao stream workspaces diferentes.
export function useStream(
  aoEvento: (evento: Evento) => void,
  aoConectar: () => void,
  pronto: boolean,
  aoAncora?: (ancora: EventoAncoraStream) => void,
): EstadoStream {
  const [estado, setEstado] = useState<EstadoStream>('conectando');
  const evento = useRef(aoEvento);
  const conectar = useRef(aoConectar);
  const ancora = useRef(aoAncora);

  useEffect(() => {
    evento.current = aoEvento;
    conectar.current = aoConectar;
    ancora.current = aoAncora;
  });

  useEffect(() => {
    if (!pronto) return;
    // Só vira verdadeiro depois de um erro: o hello seguinte é reconexão e
    // reidrata; o primeiro hello confirma o stream e não dispara GET.
    let houveQueda = false;
    const fonte = new EventSource('/api/stream');
    fonte.addEventListener('hello', () => {
      setEstado('ao_vivo');
      if (houveQueda) {
        houveQueda = false;
        conectar.current();
      }
    });
    fonte.addEventListener('evento', (mensagem) => {
      try {
        evento.current(JSON.parse((mensagem as MessageEvent<string>).data) as Evento);
      } catch {
        // quadro malformado: ignora, o próximo "hello" ou GET reidrata
      }
    });
    fonte.addEventListener('ancora', (mensagem) => {
      try {
        ancora.current?.(JSON.parse((mensagem as MessageEvent<string>).data) as EventoAncoraStream);
      } catch {
        // quadro malformado: ignora
      }
    });
    fonte.onerror = () => {
      houveQueda = true;
      setEstado('reconectando');
    };
    return () => fonte.close();
  }, [pronto]);

  return estado;
}
