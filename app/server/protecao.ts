// Protecoes da demo publica sem login (P-010): erro HTTP com mensagem em
// portugues, janela de contagem por chave e guarda de espaco do banco. O volume
// do Postgres no plano Hobby da Railway e de 5 GB e nao cresce; disco cheio
// derruba ate a leitura, entao a escrita para antes.

import type { Limites } from './config.js';
import type { Db } from './db.js';

export class ErroRequisicao extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroRequisicao';
  }
}

export function formatarBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
  return `${Math.ceil(n / 1024)} KB`;
}

const numero = (n: number): string => n.toLocaleString('pt-BR');

export const mensagens = {
  seedSomenteLeitura: (acao: string) =>
    `Os pedidos de exemplo são compartilhados entre todos os visitantes e só podem ser lidos: não é possível ${acao}. ` +
    'Envie seus próprios arquivos, que ficam só na sua sessão.',
  sessaoCheia: (lim: Limites) =>
    `Esta sessão chegou ao limite da demonstração (${numero(lim.documentosPorWorkspace)} documentos ou ` +
    `${numero(lim.eventosPorWorkspace)} eventos). Abra uma janela anônima para começar outra sessão.`,
  documentosDemais: (n: number) =>
    `O arquivo traz mais de ${numero(n)} documentos (linhas da planilha ou anexos do e-mail), o limite da demonstração ` +
    'por envio. Divida o arquivo em partes menores.',
  arquivoGrande: (bytes: number) => `O arquivo passa de ${formatarBytes(bytes)}, o limite da demonstração por envio.`,
  muitasEscritas: (segundos: number) =>
    `Muitos envios seguidos a partir deste endereço. Tente de novo em ${numero(Math.max(1, segundos))} s.`,
  muitasAncoras: (segundos: number) =>
    `Muitas âncoras seguidas a partir deste endereço: cada uma é uma transação na rede de testes. Tente de novo em ${numero(Math.max(1, segundos))} s.`,
  muitosPdfs: () =>
    'Muitos PDFs seguidos a partir deste endereço: a leitura de PDF usa um serviço externo com cota. Tente de novo em alguns minutos.',
  muitosMandatos: () =>
    'Muitos comandos seguidos a partir deste endereço: cada comando em linguagem natural usa um serviço externo com cota. Tente de novo em alguns minutos.',
  llmIndisponivel: () =>
    'Os comandos em linguagem natural dependem de um serviço de IA que não está configurado nesta instalação. O restante da demonstração funciona normalmente.',
  semEspaco: () =>
    'A demonstração atingiu o limite de armazenamento e está só para leitura. Os pedidos de exemplo seguem disponíveis.',
  sessoesNovasDemais: () =>
    'Muitas sessões novas a partir deste endereço. A demonstração guarda seus arquivos na sessão atual: ' +
    'volte à aba onde você já enviou ou tente de novo em alguns minutos.',
  demoLotada: () =>
    'A demonstração está lotada agora: muitas sessões de teste foram criadas. ' +
    'Os pedidos de exemplo seguem abertos para leitura.',
};

// Contador de janela fixa por chave (IP). Serve para o que o @fastify/rate-limit
// nao enxerga por rota, como o PDF dentro de um .eml.
export class JanelaFixa {
  private contagens = new Map<string, { inicio: number; n: number }>();

  constructor(
    private readonly max: number,
    private readonly janelaMs: number,
  ) {}

  consumir(chave: string, agora = Date.now()): boolean {
    const c = this.contagens.get(chave);
    if (!c || agora - c.inicio >= this.janelaMs) {
      if (this.contagens.size >= 10_000) this.podar(agora);
      this.contagens.set(chave, { inicio: agora, n: 1 });
      return true;
    }
    if (c.n >= this.max) return false;
    c.n += 1;
    return true;
  }

  private podar(agora: number): void {
    for (const [k, c] of this.contagens) if (agora - c.inicio >= this.janelaMs) this.contagens.delete(k);
  }
}

// pg_database_size e barato, mas nao a cada requisicao: o valor vale por 30 s.
// Falha na medicao deixa gravar e registra o erro: a guarda e rede de seguranca,
// nao pode derrubar a demo sozinha.
export class GuardaEspaco {
  private bytes = 0;
  private medidoEm = Number.NEGATIVE_INFINITY;
  private medindo: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly limite: number,
    private readonly aoFalhar: (e: unknown) => void,
    private readonly validadeMs = 30_000,
  ) {}

  async exigirEspaco(): Promise<void> {
    if (this.limite <= 0) return;
    if (Date.now() - this.medidoEm > this.validadeMs) {
      this.medindo ??= this.medir().finally(() => {
        this.medindo = null;
      });
      await this.medindo;
    }
    if (this.bytes >= this.limite) throw new ErroRequisicao(507, mensagens.semEspaco());
  }

  private async medir(): Promise<void> {
    try {
      const r = await this.db.query<{ bytes: string }>('SELECT pg_database_size(current_database())::text AS bytes');
      this.bytes = Number(r[0]?.bytes ?? 0);
    } catch (e) {
      this.aoFalhar(e);
    }
    this.medidoEm = Date.now();
  }
}
