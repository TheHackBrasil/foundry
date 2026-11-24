import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ErroApi, carregarExemplosNaSessao, enviarArquivo } from '../api.ts';
import { chaveCurta } from '../format.ts';
import { IconeEnvio, IconeErro, IconeOk } from './icones.tsx';

interface Resultado {
  nome: string;
  ok: boolean;
  texto: string;
}

interface Props {
  aoEnviar: (pedidoId: string) => void;
  temPedidoNaSessao: boolean;
}

const EXEMPLOS = [
  { arquivo: 'nfe-ok.xml', rotulo: 'NF-e' },
  { arquivo: 'cte-ok.xml', rotulo: 'CT-e' },
  { arquivo: 'planilha.csv', rotulo: 'Planilha' },
  { arquivo: 'exemplo.eml', rotulo: 'E-mail' },
];

function descrever(r: Awaited<ReturnType<typeof enviarArquivo>>): { ok: boolean; texto: string } {
  if (r.pedidoId === null) {
    return {
      ok: false,
      texto: `foi para a fila de revisão (nº ${r.revisaoId ?? '?'}): o pedido ainda não existe. Envie a NF-e antes.`,
    };
  }
  if (r.eventos === 0) return { ok: true, texto: `já estava no registro do pedido ${chaveCurta(r.pedidoId)}.` };
  const eventos = r.eventos === 1 ? '1 evento novo' : `${r.eventos} eventos novos`;
  return { ok: true, texto: `${eventos} no pedido ${chaveCurta(r.pedidoId)}.` };
}

export function EnvioArquivos({ aoEnviar, temPedidoNaSessao }: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [criandoExemplo, setCriandoExemplo] = useState(false);
  const [sobre, setSobre] = useState(false);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const ajuda = useId();

  async function enviar(arquivos: File[]) {
    if (arquivos.length === 0 || enviando || criandoExemplo) return;
    setEnviando(true);
    setResultados([]);
    for (const arquivo of arquivos) {
      try {
        const r = await enviarArquivo(arquivo);
        setResultados((lista) => [...lista, { nome: arquivo.name, ...descrever(r) }]);
        if (r.pedidoId) aoEnviar(r.pedidoId);
      } catch (e) {
        const texto =
          e instanceof ErroApi && e.status === 422
            ? `arquivo recusado: ${e.message}`
            : e instanceof Error
              ? e.message
              : 'falhou.';
        setResultados((lista) => [...lista, { nome: arquivo.name, ok: false, texto }]);
      }
    }
    setEnviando(false);
    if (entrada.current) entrada.current.value = '';
  }

  async function criarPedidoTeste() {
    if (enviando || criandoExemplo) return;
    setCriandoExemplo(true);
    setResultados([]);
    try {
      const r = await carregarExemplosNaSessao();
      if (r.enviados === 0 || !r.pedidoId) {
        setResultados([
          {
            nome: 'Pedido de teste',
            ok: false,
            texto: r.falhas[0] ?? 'não foi possível copiar os documentos de exemplo.',
          },
        ]);
        return;
      }
      aoEnviar(r.pedidoId);
      const docs = r.enviados === 1 ? '1 documento copiado' : `${r.enviados} documentos copiados`;
      setResultados([
        {
          nome: 'Pedido de teste',
          ok: true,
          texto: `${docs} para sua sessão (pedido ${chaveCurta(r.pedidoId)}).`,
        },
        ...r.falhas.map((falha) => ({ nome: 'Aviso', ok: false, texto: falha })),
      ]);
    } finally {
      setCriandoExemplo(false);
    }
  }

  const aoEscolher = (e: ChangeEvent<HTMLInputElement>) => void enviar(Array.from(e.target.files ?? []));
  const aoSoltar = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setSobre(false);
    void enviar(Array.from(e.dataTransfer.files));
  };

  return (
    <section className="envio" aria-labelledby="envio-titulo">
      <h2 id="envio-titulo">Enviar documento</h2>
      {!temPedidoNaSessao && (
        <div className="envio-sessao-cta">
          <button
            type="button"
            className="botao envio-sessao-btn"
            disabled={enviando || criandoExemplo}
            onClick={() => void criarPedidoTeste()}
          >
            {criandoExemplo ? 'Criando pedido de teste…' : 'Criar pedido de teste na minha sessão'}
          </button>
          <p className="dica">
            Copia os documentos fictícios para sua sessão para testar propagação e avisos.
          </p>
        </div>
      )}
      <label
        className={`envio-zona${sobre ? ' envio-sobre' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={aoSoltar}
      >
        <input
          ref={entrada}
          type="file"
          multiple
          accept=".xml,.csv,.xlsx,.pdf,.eml"
          disabled={enviando || criandoExemplo}
          onChange={aoEscolher}
          aria-describedby={ajuda}
        />
        <IconeEnvio />
        <span>{enviando ? 'Enviando…' : 'Solte arquivos aqui ou escolha no computador'}</span>
      </label>
      <p id={ajuda} className="dica">
        NF-e, CT-e, CC-e, CSV, XLSX, PDF ou .eml. Envie a NF-e primeiro para criar o pedido.
      </p>
      <details className="envio-detalhes">
        <summary className="envio-detalhes-sumario">Baixar arquivos de exemplo</summary>
        <div className="envio-exemplos">
          {EXEMPLOS.map((x) => (
            <a key={x.arquivo} href={`/exemplos/${x.arquivo}`} download>
              {x.rotulo}
            </a>
          ))}
        </div>
      </details>
      <div role="status" aria-live="polite">
        {resultados.length > 0 && (
          <ul className="resultados" aria-label="Resultado dos envios">
            {resultados.map((r, i) => (
              <li key={`${r.nome}-${i}`}>
                {r.ok ? <IconeOk /> : <IconeErro />}
                <span>
                  <span className="so-leitor">{r.ok ? 'Enviado. ' : 'Falhou. '}</span>
                  <strong>{r.nome}</strong>: {r.texto}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
