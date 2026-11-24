import { montarFragmentShader } from './comum.ts';

// Selo de Cadeia & Campo Magnético de Ingestão:
// uMode=0 -> Matriz discreta de 8 nós + selo esmeralda --ok na verificação de integridade.
// uMode=1 -> Ondas concêntricas sutis em --cord acompanhando uOrigin no drag-and-drop.
// uMode=2 -> Flash --error na falha de integridade da cadeia.
export const FRAGMENT_SELO_CADEIA = montarFragmentShader(`
void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  vec2 px = uv * res;
  float env = clamp(uEnvelope, 0.0, 1.0);
  float resProg = clamp(uResolve, 0.0, 1.0);

  if (env <= 0.001 && resProg <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Modo 1: Campo Magnético de Ingestão (ondas concêntricas em --cord seguindo uOrigin).
  if (uMode >= 0.5 && uMode < 1.5) {
    vec2 origemPx = uOrigin * res;
    vec2 deltaPx = px - origemPx;
    float distPx = length(deltaPx);
    float escala = max(min(res.x, res.y) * 0.58, 44.0);

    // Fase positiva em uTime faz as ondas convergirem suavemente até o ponteiro.
    float onda = 0.5 + 0.5 * sin(distPx * 0.145 + uTime * 3.8);
    float anel = pow(onda, 4.0);
    float decaimento = exp(-distPx / escala);
    float centro = exp(-pow(distPx / 14.0, 2.0)) * 0.35;

    // Alinhamento sutil na borda do monólito de ingestão.
    vec2 metade = res * 0.5;
    float dBorda = sdRoundedBox(px - metade, metade - vec2(1.5), max(uRadius, 2.0));
    float borda = exp(-pow((dBorda + 0.75) / 1.15, 2.0)) * 0.24;

    float alpha = clamp((anel * decaimento * 0.26 + centro * 0.22 + borda) * env, 0.0, 0.34);
    vec3 corFinal = mix(uColCord, uColChange, clamp(0.18 * (1.0 - decaimento), 0.0, 0.25));
    gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
    return;
  }

  // Modos 0 (ok esmeralda) e 2 (erro): matriz discreta de 8 nós + selo de integridade.
  bool ehErro = uMode >= 1.5;
  vec3 corStatus = ehErro ? uColError : uColOk;

  // Adapta disposição dos 8 nós à proporção: 8x1 em faixas horizontais ou 4x2 em cartões.
  vec2 gradeNos = (res.x > res.y * 2.15) ? vec2(8.0, 1.0) : vec2(4.0, 2.0);
  vec2 celula = floor(uv * gradeNos);
  vec2 local = fract(uv * gradeNos) - 0.5;
  vec2 celulaPx = res / gradeNos;
  vec2 localPx = local * celulaPx;

  float indiceNo = celula.y * gradeNos.x + celula.x;
  float semiLado = clamp(min(celulaPx.x, celulaPx.y) * 0.22, 2.0, 6.5);
  float dNo = sdRoundedBox(localPx, vec2(semiLado), 1.4);
  float noSolido = 1.0 - smoothstep(-0.6, 0.85, dNo);
  float noAro = exp(-pow(abs(dNo) / 0.9, 2.0));

  // Filamento horizontal ligando nós adjacentes da cadeia.
  float fioLigacao = exp(-pow(localPx.y / 0.75, 2.0)) * smoothstep(semiLado + 1.0, semiLado + 2.5, abs(localPx.x));

  // Varredura sequencial dos 8 elos durante verificação ativa.
  float posVarredura = fract(uTime * 0.95) * 8.0;
  float distNo = abs(indiceNo - posVarredura);
  float distCircular = min(distNo, 8.0 - distNo);
  float pulsoNo = exp(-pow(distCircular / 1.15, 2.0));

  float ativacaoAtiva = (noAro * 0.30 + noSolido * (0.14 + 0.42 * pulsoNo) + fioLigacao * 0.14) * env;

  // Selo de resolução: anel verificador esmeralda (uMode=0) ou flash perimetral (uMode=2).
  float seloAlpha = 0.0;
  if (resProg > 0.001) {
    float fadeRes = sin(resProg * PI) * (1.0 - smoothstep(0.84, 1.0, resProg));
    vec2 metade = res * 0.5;
    float dBorda = sdRoundedBox(px - metade, metade - vec2(1.0), max(uRadius, 1.5));
    float borda = exp(-pow((dBorda + 0.75) / 1.25, 2.0));

    if (ehErro) {
      float corteCentral = exp(-pow((uv.x - 0.5) / 0.025, 2.0)) * 0.32;
      seloAlpha = (borda * 0.76 + noSolido * 0.42 + corteCentral) * fadeRes;
    } else {
      float raioSelo = length(metade) * resProg * 1.15;
      float dCentro = length(px - metade);
      float anelSelo = exp(-pow((dCentro - raioSelo) / max(6.0, min(res.x, res.y) * 0.16), 2.0));
      seloAlpha = (anelSelo * 0.34 + noSolido * 0.48 + borda * 0.58) * fadeRes;
    }
  }

  float teto = mix(0.46, 0.56, uDark);
  float alphaFinal = clamp(max(ativacaoAtiva * 0.65, seloAlpha), 0.0, teto);
  vec3 corAtiva = mix(uColPrimary, corStatus, clamp(pulsoNo * 0.75 + (resProg > 0.001 ? 0.85 : 0.2), 0.0, 1.0));
  vec3 corFinal = mix(corAtiva, uColCord, clamp(noAro * pulsoNo * 0.25, 0.0, 0.25));

  gl_FragColor = saidaPremult(corFinal, alphaFinal, gl_FragCoord.xy);
}
`);
