import { Cabecalho } from './components/Cabecalho.tsx';
import { EnvioArquivos } from './components/EnvioArquivos.tsx';
import { PainelPedido } from './components/PainelPedido.tsx';
import { PedidoLista } from './components/PedidoLista.tsx';
import { useTorre } from './useTorre.ts';

export function App() {
  const torre = useTorre();
  const vazio = torre.pedidos.estado === 'ok' && torre.pedidos.dados.length === 0;

  return (
    <>
      <a className="pular" href="#conteudo">
        Ir para o conteúdo
      </a>
      <Cabecalho stream={torre.estadoStream} />
      <div className="corpo">
        <aside className="lateral" aria-label="Envio e lista de pedidos">
          <EnvioArquivos aoEnviar={torre.selecionar} />
          <PedidoLista pedidos={torre.pedidos} selecionado={torre.selecionado} aoTentarDeNovo={torre.recarregarLista} />
        </aside>
        <main id="conteudo" tabIndex={-1}>
          {torre.selecionado ? (
            <PainelPedido
              key={torre.selecionado}
              id={torre.selecionado}
              projecao={torre.projecao}
              auditoria={torre.auditoria}
              novas={torre.novas}
              aoVerificar={torre.verificarDeNovo}
            />
          ) : (
            <section aria-labelledby="vazio-titulo">
              <h2 id="vazio-titulo">{vazio ? 'Nada para mostrar ainda' : 'Escolha um pedido'}</h2>
              <p className="dica">
                Envie uma NF-e em XML no painel ao lado. A tela mostra o que cada documento declara, aponta onde as fontes
                divergem e diz o que cada parte precisa fazer.
              </p>
            </section>
          )}
        </main>
      </div>
      <div className="so-leitor" role="status" aria-live="polite" aria-atomic="true">
        {torre.anuncio}
      </div>
    </>
  );
}
