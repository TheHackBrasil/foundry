export {
  CamadaShader,
  SeloMonolitosShader,
  type PropsCamadaShader,
  type PropsSeloMonolitosShader,
  type RefLeitura,
  type ResolucaoShader,
} from './CamadaShader.tsx';
export {
  CATALOGO_SHADERS,
  NOMES_SHADERS,
  obterMotorWebgl,
  type EstadoQuadroSlot,
  type MotorWebgl,
  type NomeShader,
  type OpcoesRegistroSlot,
  type PonteiroShader,
} from './motorWebgl.ts';
export {
  easeOutExpo,
  easeOutQuint,
  envelopeAdsr,
  hexParaLinearRgb,
  lerPaletaDoDocumento,
  observarPaletaTema,
  obterPaletaAtual,
  type FaseEnvelope,
  type OpcoesEnvelopeAdsr,
  type PaletaShader,
  type RgbLinear,
} from './paletaTema.ts';
export { movimentoReduzidoAgora, useMovimentoReduzido } from './useMovimentoReduzido.ts';
