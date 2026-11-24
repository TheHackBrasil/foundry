import { useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ErroApi, enviarArquivo } from '../api.ts';
import { enviarExemploPorNome } from '../apiOps.ts';
import { chaveCurta } from '../format.ts';
import { CamadaShader } from '../shaders/index.ts';
import { IconeEnvio, IconeErro, IconeOk } from './icones.tsx';

interface Resultado {
  nome: string;
  ok: boolean;
  texto: string;
  revisaoId: number | null;
}

interface Props {
  aoEnviar: (pedidoId: string) => void;
  aoAbrirRevisao: () => void;
  aoAtualizarRevisao?: () => void;
  aoEncaminharRevisao?: (revisaoId: number, nomeArquivo: string) => void;
  emModal?: boolean;
}

const KIT_INGESTAO = [
  {
    arquivo: 'email-corpo.eml',
    rotulo: 'E-mail .eml',
    detalhe: 'Extrai sinal consultivo de atraso',
  },
  {
    arquivo: 'planilha-desconhecida.xlsx',
    rotulo: 'Planilha .xlsx → IA',
    detalhe: 'Classifica e envia para a Fila de Revisão',
  },
  {
    arquivo: 'cce-reagendamento.xml',
    rotulo: 'CC-e .xml',
    detalhe: 'Evento fiscal de reagendamento',
  },
] as const;

const EXEMPLOS_DOWNLOAD = [
  { arquivo: 'nfe-ok.xml', rotulo: 'NF-e' },
  { arquivo: 'cte-ok.xml', rotulo: 'CT-e' },
  { arquivo: 'planilha.csv', rotulo: 'Planilha' },
  { arquivo: 'email-corpo.eml', rotulo: 'E-mail' },
  { arquivo: 'planilha-desconhecida.xlsx', rotulo: 'XLSX' },
  { arquivo: 'cce-reagendamento.xml', rotulo: 'CC-e' },
] as const;

function descrever(r: Awaited<ReturnType<typeof enviarArquivo>>): {
  ok: boolean;
  texto: string;
  revisaoId: number | null;
} {
  if (r.pedidoId === null) {
    return {
      ok: r.revisaoId !== null,
      texto:
        r.revisaoId !== null
          ? `encaminhado para a Fila de Revisão (#${r.revisaoId}).`
          : 'não foi possível vincular a um pedido. Envie a NF-e antes.',
      revisaoId: r.revisaoId,
    };
  }
  if (r.eventos === 0) {
    return {
      ok: true,
      texto: `já estava registrado no pedido ${chaveCurta(r.pedidoId)}.`,
      revisaoId: r.revisaoId,
    };
  }
  const eventos = r.eventos === 1 ? '1 evento novo' : `${r.eventos} eventos novos`;
  return {
    ok: true,
    texto: `${eventos} no pedido ${chaveCurta(r.pedidoId)}.`,
    revisaoId: r.revisaoId,
  };
}

export function EnvioArquivos({
  aoEnviar,
  aoAbrirRevisao,
  aoAtualizarRevisao,
  aoEncaminharRevisao,
  emModal = false,
}: Props) {
  const entrada = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [exemploAtivo, setExemploAtivo] = useState<string | null>(null);
  const [sobre, setSobre] = useState(false);
  const [origemDrop, setOrigemDrop] = useState<readonly [number, number]>([0.5, 0.5]);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const ajuda = useId();

  const ocupado = enviando || exemploAtivo !== null;

  async function enviar(arquivos: File[]) {
    if (arquivos.length === 0 || ocupado) return;
    setEnviando(true);
    setResultados([]);
    let tocouRevisao = false;
    let primeiroPedidoId: string | null = null;
    let primeiraRevisao: { id: number; nome: string } | null = null;

    for (const arquivo of arquivos) {
      try {
        const r = await enviarArquivo(arquivo);
        const info = descrever(r);
        setResultados((lista) => [...lista, { nome: arquivo.name, ...info }]);
        if (r.pedidoId && !primeiroPedidoId) primeiroPedidoId = r.pedidoId;
        if (r.revisaoId !== null || r.pedidoId === null) tocouRevisao = true;
        if (r.pedidoId === null && r.revisaoId !== null && !primeiraRevisao) {
          primeiraRevisao = { id: r.revisaoId, nome: arquivo.name };
        }
      } catch (e) {
        const texto =
          e instanceof ErroApi && e.status === 422
            ? `arquivo recusado: ${e.message}`
            : e instanceof Error
              ? e.message
              : 'falhou.';
        setResultados((lista) => [...lista, { nome: arquivo.name, ok: false, texto, revisaoId: null }]);
      }
    }
    if (tocouRevisao) aoAtualizarRevisao?.();
    setEnviando(false);
    if (entrada.current) entrada.current.value = '';

    if (primeiroPedidoId) {
      aoEnviar(primeiroPedidoId);
    } else if (primeiraRevisao && aoEncaminharRevisao) {
      aoEncaminharRevisao(primeiraRevisao.id, primeiraRevisao.nome);
    }
  }

  async function testarIngestaoReal(arquivo: string) {
    if (ocupado) return;
    setExemploAtivo(arquivo);
    setResultados([]);
    try {
      const r = await enviarExemploPorNome(arquivo);
      const info = descrever(r);
      setResultados([{ nome: arquivo, ...info }]);
      aoAtualizarRevisao?.();
      if (r.pedidoId) {
        aoEnviar(r.pedidoId);
      } else if (r.revisaoId !== null && aoEncaminharRevisao) {
        aoEncaminharRevisao(r.revisaoId, arquivo);
      }
    } catch (e) {
      const texto = e instanceof Error ? e.message : 'falhou.';
      setResultados([{ nome: arquivo, ok: false, texto, revisaoId: null }]);
    } finally {
      setExemploAtivo(null);
    }
  }

  const aoEscolher = (e: ChangeEvent<HTMLInputElement>) =>
    void enviar(Array.from(e.target.files ?? []));

  const aoArrastarSobre = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    if (!sobre) setSobre(true);
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const nx = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const ny = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
      if (Math.abs(nx - origemDrop[0]) > 0.02 || Math.abs(ny - origemDrop[1]) > 0.02) {
        setOrigemDrop([nx, ny]);
      }
    }
  };

  const aoSoltar = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setSobre(false);
    void enviar(Array.from(e.dataTransfer.files));
  };

  return (
    <section
      className={emModal ? 'envio envio-modal' : 'envio'}
      aria-labelledby={emModal ? undefined : 'envio-titulo'}
    >
      {!emModal && <h2 id="envio-titulo">Ingestão de documentos</h2>}

      <label
        className={`envio-zona${sobre ? ' envio-sobre' : ''}`}
        onDragOver={aoArrastarSobre}
        onDragLeave={() => setSobre(false)}
        onDrop={aoSoltar}
      >
        <CamadaShader
          shader="seloCadeia"
          ativo={sobre}
          modo={1}
          origem={origemDrop}
          raioPx={4}
          className="envio-shader"
        />
        <input
          ref={entrada}
          type="file"
          multiple
          accept=".xml,.csv,.xlsx,.pdf,.eml"
          disabled={ocupado}
          onChange={aoEscolher}
          aria-describedby={ajuda}
        />
        <span className="envio-zona-conteudo">
          <IconeEnvio />
          <span className="envio-zona-texto">
            <strong>{enviando ? 'Enviando documentos…' : 'Solte arquivos ou escolha no computador'}</strong>
            <span id={ajuda} className="envio-zona-sub">
              NF-e, CT-e, CC-e, CSV, XLSX, PDF ou .eml
            </span>
          </span>
        </span>
      </label>

      <div className="envio-kit" role="group" aria-label="Exemplos prontos em 1 clique">
        <p className="envio-kit-titulo">Testar ingestão real em 1 clique</p>
        <div className="envio-kit-lista">
          {KIT_INGESTAO.map((item) => {
            const ativo = exemploAtivo === item.arquivo;
            return (
              <button
                key={item.arquivo}
                type="button"
                className="envio-kit-btn"
                disabled={ocupado}
                onClick={() => void testarIngestaoReal(item.arquivo)}
              >
                <span className="envio-kit-rotulo">
                  {ativo ? 'Ingerindo…' : item.rotulo}
                </span>
                <span className="envio-kit-detalhe">{item.detalhe}</span>
              </button>
            );
          })}
        </div>
      </div>

      <details className="envio-detalhes">
        <summary className="envio-detalhes-sumario">Baixar arquivos de exemplo</summary>
        <div className="envio-exemplos">
          {EXEMPLOS_DOWNLOAD.map((x) => (
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
                <div className="resultado-corpo">
                  <span>
                    <span className="so-leitor">{r.ok ? 'Processado. ' : 'Falhou. '}</span>
                    <strong>{r.nome}</strong>: {r.texto}
                  </span>
                  {r.revisaoId !== null && (
                    <button
                      type="button"
                      className={emModal ? 'botao-sutil' : 'rail-btn-revisao'}
                      onClick={aoAbrirRevisao}
                    >
                      Abrir na Revisão
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
