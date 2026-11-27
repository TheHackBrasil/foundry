// Orquestrador da transportadora simulada (frente harness-transp): sobe o
// SMTP sink e a caixa IMAP TLS, aplica o roteiro nomeado e fecha o loop da
// demo pelas bordas reais (SMTP de entrada, IMAP de saida). Zero acoplamento
// interno: env vars que o app ja le apontam para estas portas.
//
// Uso: npx tsx harness/harness.ts --cenario evasiva
// Env que o app precisa (impresso no boot):
//   SMTP_HOST=127.0.0.1 SMTP_PORT=<smtp> SMTP_FROM=sistema@forseti.local
//   IMAP_HOST=localhost IMAP_PORT=<imap> IMAP_USER=caixa IMAP_PASS=caixa
//   NODE_EXTRA_CA_CERTS=<cert.pem gerado>

import { comporResposta, lerCobranca } from './mensagens.js';
import { EstadoPersonas, decidir } from './personas.js';
import { NOMES_CENARIOS, roteiro } from './cenarios.js';
import { criarServidorImap, type ServidorImap } from './servidor-imap.js';
import { criarServidorSmtp, type EnvelopeSmtp } from './servidor-smtp.js';
import { garantirCertificado } from './tls-dev.js';

interface OpcoesCli {
  cenario: string;
  smtpPorta: number;
  imapPorta: number;
  semImap: boolean;
  atrasoMs: number | null;
  upload: string | null; // URL /api/ingest para entrega alternativa
  workspace: string | null; // cookie foundry_ws do upload
}

function args(argv: string[]): OpcoesCli {
  const o: OpcoesCli = {
    cenario: 'evasiva',
    smtpPorta: 2525,
    imapPorta: 10993,
    semImap: false,
    atrasoMs: null,
    upload: null,
    workspace: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const proximo = () => argv[++i];
    if (a === '--cenario') o.cenario = proximo()!;
    else if (a === '--smtp-porta') o.smtpPorta = Number(proximo());
    else if (a === '--imap-porta') o.imapPorta = Number(proximo());
    else if (a === '--sem-imap') o.semImap = true;
    else if (a === '--atraso-ms') o.atrasoMs = Number(proximo());
    else if (a === '--upload') o.upload = proximo()!;
    else if (a === '--workspace') o.workspace = proximo()!;
    else if (a === '--roteiros') {
      console.log(NOMES_CENARIOS.join('\n'));
      process.exit(0);
    } else if (a === '--ajuda' || a === '--help') {
      console.log(
        'uso: tsx harness/harness.ts [--cenario cooperativa|evasiva|silenciosa] ' +
          '[--smtp-porta 2525] [--imap-porta 10993] [--sem-imap] [--atraso-ms N] ' +
          '[--upload http://localhost:3000/api/ingest --workspace <uuid>]',
      );
      process.exit(0);
    } else {
      throw new RangeError(`opcao desconhecida: ${a}`);
    }
  }
  return o;
}

const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const o = args(process.argv.slice(2));
  const r = roteiro(o.cenario);
  const estado = new EstadoPersonas();
  const log = (m: string): void => console.log(`harness: ${m}`);

  // Entrega alternativa pela borda HTTP real (POST /api/ingest): cobre o
  // workspace da sessao que envia — precisa do cookie foundry_ws (com
  // WORKSPACE_LOCAL todos os navegadores locais dividem o mesmo).
  const entregarUpload = async (raw: Buffer): Promise<void> => {
    if (!o.upload) return;
    const res = await fetch(o.upload, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(o.workspace ? { cookie: `foundry_ws=${o.workspace}` } : {}),
      },
      body: JSON.stringify({ nome: 'resposta.eml', conteudoBase64: raw.toString('base64') }),
    });
    log(`upload .eml -> ${res.status}`);
  };

  let imap: ServidorImap | null = null;
  let certInfo = '';
  if (!o.semImap) {
    const cert = garantirCertificado();
    imap = await criarServidorImap({ porta: o.imapPorta, cert: cert.cert, key: cert.key });
    certInfo = cert.nodeExtraCaCerts;
    log(`imap tls em localhost:${imap.porta()} (cert ${cert.cert})`);
  }

  const aoReceber = async (env: EnvelopeSmtp): Promise<void> => {
    const cb = await lerCobranca(env.de, env.para, env.raw);
    const chave = cb.pedidoId ?? cb.lida.cabecalho.messageId ?? `sem-id-${cb.recebidaEm.getTime()}`;
    const sequencia = estado.proximaSequencia(chave);
    log(
      `cobranca recebida: de=${env.de} para=${env.para.join(',')} ` +
        `pedido=${cb.pedidoId ?? '?'} msgid=${cb.lida.cabecalho.messageId ?? '?'} thread#${sequencia}`,
    );
    const decisao = decidir(r, { sequencia, pedidoId: cb.pedidoId, agora: new Date() });
    if (decisao.tipo === 'silencio') {
      log('persona silenciosa: sem resposta (a escada sobe)');
      return;
    }
    const atraso = o.atrasoMs ?? r.atrasoRespostaMs;
    if (atraso > 0) await esperar(atraso);
    const resp = comporResposta({
      de: r.remetente,
      para: env.de,
      assuntoOriginal: cb.lida.cabecalho.assunto,
      inReplyTo: cb.lida.cabecalho.messageId,
      references: cb.lida.cabecalho.references,
      corpo: decisao.corpo,
      dominio: r.dominio,
      sequencia,
    });
    if (imap) {
      const dep = imap.depositar(resp.raw);
      log(`resposta depositada na caixa (uid ${dep.uid}, thread#${sequencia})`);
    }
    await entregarUpload(resp.raw);
  };

  const smtp = await criarServidorSmtp({ porta: o.smtpPorta, aoReceber, log });
  log(`smtp em 127.0.0.1:${smtp.porta()} — cenario "${r.nome}" (${r.remetente})`);
  log(`verdade do roteiro: ${r.verdade.statusReal}, previsao real hoje+${r.verdade.previsaoRealDias} (${r.verdade.motivoReal})`);
  console.log('');
  console.log('Env para o app (app/.env):');
  console.log(`  SMTP_HOST=127.0.0.1 SMTP_PORT=${smtp.porta()} SMTP_FROM=sistema@forseti.local SMTP_DOMAIN=forseti.local`);
  if (imap) {
    console.log(`  IMAP_HOST=localhost IMAP_PORT=${imap.porta()} IMAP_USER=caixa IMAP_PASS=caixa IMAP_POLL_MS=2000`);
    console.log(`  NODE_EXTRA_CA_CERTS=${certInfo}`);
  }
  if (o.upload) console.log(`  entrega tambem por upload: ${o.upload}${o.workspace ? ` (workspace ${o.workspace})` : ''}`);
  console.log('');

  const encerrar = (): void => {
    void smtp.encerrar().then(() => imap?.encerrar()).then(() => process.exit(0));
  };
  process.once('SIGINT', encerrar);
  process.once('SIGTERM', encerrar);
}

// Executa so como processo principal (testes importam as pecas, nao o main).
const principal = process.argv[1]?.endsWith('harness.ts') || process.argv[1]?.endsWith('harness.js');
if (principal) {
  await main();
}
