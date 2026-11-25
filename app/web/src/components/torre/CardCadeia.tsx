import { memo } from 'react';
import type { RespostaAuditoria } from '../../../../shared/model.ts';
import type { Carga } from '../../useTorre.ts';
import { StatusCadeia } from '../StatusCadeia.tsx';

interface CardCadeiaProps {
  auditoria: Carga<RespostaAuditoria>;
  pulsoExterno: number;
  aoVerificar: () => void;
  aoAbrirAuditoria: () => void;
  aoAncorar: () => Promise<void>;
  aoAnunciar: (texto: string) => void;
}

export const CardCadeia = memo(function CardCadeia({
  auditoria,
  pulsoExterno,
  aoVerificar,
  aoAbrirAuditoria,
  aoAncorar,
  aoAnunciar,
}: CardCadeiaProps) {
  return (
    <StatusCadeia
      auditoria={auditoria}
      pulsoExterno={pulsoExterno}
      aoVerificar={aoVerificar}
      aoAbrirAuditoria={aoAbrirAuditoria}
      aoAncorar={aoAncorar}
      aoAnunciar={aoAnunciar}
    />
  );
});
