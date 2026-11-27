// Certificado TLS de desenvolvimento (frente harness-transp): o IMAP do
// sistema conecta com secure:true fixo (server/ingest/imap.ts), entao a
// caixa simulada precisa de TLS. Gerado em os.tmpdir() pelo openssl do
// sistema: o repo-guard barra .pem/.key versionados, entao nada nasce no
// worktree. O servidor confia nele via NODE_EXTRA_CA_CERTS apontando para
// o cert.pem: config por env, zero mudanca no nucleo.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface CertificadoDev {
  cert: string; // caminho do cert.pem (self-signed, CA:TRUE, SAN localhost)
  key: string; // caminho do key.pem
  // Env que faz o processo do app confiar no certificado.
  nodeExtraCaCerts: string;
}

// Gera uma vez por pasta; reusa se ja existe (a demo sobe e desce sem
// regerar e o NODE_EXTRA_CA_CERTS fica estavel entre restarts).
export function garantirCertificado(dir = join(tmpdir(), 'forseti-harness-tls')): CertificadoDev {
  mkdirSync(dir, { recursive: true });
  const cert = join(dir, 'cert.pem');
  const key = join(dir, 'key.pem');
  if (!existsSync(cert) || !existsSync(key)) {
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', key, '-out', cert,
        '-days', '30', '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
        // CA:TRUE deixa o proprio cert servir de raiz no NODE_EXTRA_CA_CERTS.
        '-addext', 'basicConstraints=critical,CA:TRUE',
      ],
      { stdio: 'pipe' },
    );
  }
  return { cert, key, nodeExtraCaCerts: cert };
}
