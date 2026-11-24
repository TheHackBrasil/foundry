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
}

const KIT_INGESTAO = [
  {
    arquivo: 'email-corpo.eml',
    rotulo: 'E-mail atraso (.eml)',
    detalhe: 'Extrai sinal consultivo',
  },
  {
    arquivo: 'planilha-desconhecida.xlsx',
    rotulo: 'Planilha fora do padrão (.xlsx → IA)',
    detalhe: 'Envia para Fila de Revisão',
  },
  {
    arquivo: 'cce-reagendamento.xml',
    rotulo: 'CC-e reagendamento (.xml)',
    detalhe: 'Evento fiscal XML',
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

export function EnvioArquivos({ aoEnviar, aoAbrirRevisao, aoAtualizarRevisao }: Props) {
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
    for (const arquivo of arquivos) {
      try {
        const r = await enviarArquivo(arquivo);
        const info = descrever(r);
        setResultados((lista) => [...lista, { nome: arquivo.name, ...info }]);
        if (r.pedidoId) aoEnviar(r.pedidoId);
        if (r.revisaoId !== null || r.pedidoId === null) tocouRevisao = true;
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
  }

  async function testarIngestaoReal(arquivo: string) {
    if (ocupado) return;
    setExemploAtivo(arquivo);
    setResultados([]);
    try {
      const r = await enviarExemploPorNome(arquivo);
      const info = descrever(r);
      setResultados([{ nome: arquivo, ...info }]);
      if (r.pedidoId) aoEnviar(r.pedidoId);
      aoAtualizarRevisao?.();
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
    <section className="envio" aria-labelledby="envio-titulo">
      <h2 id="envio-titulo">Ingestão de documentos</h2>

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
          <span>{enviando ? 'Enviando…' : 'Solte arquivos ou escolha no computador'}</span>
        </span>
      </label>

      <p id={ajuda} className="dica">
        NF-e, CT-e, CC-e, CSV, XLSX, PDF ou .eml.
      </p>

      <div className="envio-kit" role="group" aria-label="Testar ingestão real">
        <p className="envio-kit-titulo">Testar ingestão real</p>
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
        <summary className="envio-detalhes-sumario">Baixar exemplos manuais</summary>
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
                      className="rail-btn-revisao"
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
