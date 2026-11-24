import { useCallback, useState } from 'react';
import { Cabecalho } from './components/Cabecalho.tsx';
import { EnvioArquivos } from './components/EnvioArquivos.tsx';
import { PainelPedido } from './components/PainelPedido.tsx';
import { PedidoLista } from './components/PedidoLista.tsx';
import { aplicarTema, temaInicial, type Tema } from './tema.ts';
import { useTorre } from './useTorre.ts';

export function App() {
  const torre = useTorre();
  const [tema, setTema] = useState<Tema>(temaInicial);
  const trocarTema = (t: Tema) => {
    aplicarTema(t);
    setTema(t);
  };
  const vazio = torre.pedidos.estado === 'ok' && torre.pedidos.dados.length === 0;
  const temPedidoNaSessao = torre.pedidos.estado === 'ok' && torre.pedidos.dados.some((p) => p.daSessao);
  const selecionarAposEnvio = useCallback(
    (pedidoId: string) => {
      torre.selecionar(pedidoId);
      void torre.recarregarLista();
    },
    [torre.selecionar, torre.recarregarLista],
  );

  return (
    <>
      <a
        className="pular"
        href="#conteudo"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('conteudo')?.focus();
        }}
      >
        Ir para o conteúdo
      </a>
      <Cabecalho
        stream={torre.estadoStream}
        pausado={torre.pausado}
        pendentes={torre.pendentes}
        aoPausar={torre.alternarPausa}
        tema={tema}
        aoTema={trocarTema}
      />
      <div className="corpo">
        <main id="conteudo" tabIndex={-1}>
          {torre.selecionado ? (
            <PainelPedido
              key={torre.selecionado}
              id={torre.selecionado}
              projecao={torre.projecao}
              auditoria={torre.auditoria}
              novas={torre.novas}
              aoVerificar={torre.verificarDeNovo}
              aoAnunciar={torre.anunciar}
              aoSelecionar={selecionarAposEnvio}
            />
          ) : (
            <section aria-labelledby="vazio-titulo" className="vazio">
              <h1 id="vazio-titulo">{vazio ? 'Nada para mostrar ainda' : 'Escolha um pedido'}</h1>
              <p className="dica">
                Envie uma NF-e em XML no painel ao lado. O Forseti mostra o que cada documento declara, aponta onde as fontes
                divergem e diz o que cada parte precisa fazer.
              </p>
            </section>
          )}
        </main>
        <aside id="painel-lateral" className="lateral" aria-label="Envio e lista de pedidos">
          <PedidoLista pedidos={torre.pedidos} selecionado={torre.selecionado} aoTentarDeNovo={torre.recarregarLista} />
          <EnvioArquivos aoEnviar={selecionarAposEnvio} temPedidoNaSessao={temPedidoNaSessao} />
        </aside>
      </div>
      <div className="so-leitor" role="status" aria-live="polite" aria-atomic="true">
        {torre.anuncio}
      </div>
    </>
  );
}
