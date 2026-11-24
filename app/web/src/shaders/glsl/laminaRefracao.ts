import { montarFragmentShader } from './comum.ts';

// Lâmina de Refração & Câmara de Hipótese:
// uMode=0 -> Lâmina oblíqua de vidro biselado (260ms) na troca de lente em cache.
// uMode=1 -> Varredura de hachura arquitetônica blueprint (440ms) marcando What-If não gravado.
export const FRAGMENT_LAMINA_REFRACAO = montarFragmentShader(`
void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  vec2 px = uv * res;
  float env = clamp(uEnvelope, 0.0, 1.0);
  if (env <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float dir = (abs(uDir) < 0.01) ? 1.0 : sign(uDir);

  // Modo 1: Câmara de Hipótese — hachura arquitetônica blueprint (440ms).
  if (uMode >= 0.5) {
    float tSweep = clamp(uTime / 0.44, 0.0, 1.0);
    float easeSweep = 1.0 - pow(1.0 - tSweep, 3.0);

    float eixo = uv.x + uv.y * 0.22;
    float frente = mix(-0.12, 1.28, easeSweep);
    float revelado = 1.0 - smoothstep(frente - 0.04, frente + 0.02, eixo);
    float linhaFrente = exp(-pow((eixo - frente) / 0.018, 2.0)) * (1.0 - smoothstep(0.82, 1.0, tSweep));

    // Hachura diagonal arquitetônica a 45 graus com passo físico de 10px.
    float distHachura = abs(mod(px.x + px.y, 10.0) - 5.0);
    float hachura = 1.0 - smoothstep(0.35, 1.1, distHachura);

    // Moldura de prancheta sutil para manter legibilidade total do conteúdo interno.
    vec2 metade = res * 0.5;
    float dCaixa = sdRoundedBox(px - metade, metade - vec2(1.0), max(uRadius, 1.0));
    float bordaCaixa = exp(-pow((dCaixa + 1.0) / 1.15, 2.0));
    float faixaPerimetral = 1.0 - smoothstep(10.0, 34.0, -dCaixa);

    float picoVarredura = exp(-max(0.0, frente - eixo) * 4.2) * (1.0 - smoothstep(0.75, 1.0, tSweep));
    float presencaHachura = hachura * revelado * (0.26 * faixaPerimetral + 0.74 * picoVarredura);

    float tetoBlueprint = mix(0.16, 0.24, uDark);
    float alpha = clamp(
      (presencaHachura * tetoBlueprint + linhaFrente * 0.34 + bordaCaixa * 0.28 * revelado) * env,
      0.0,
      0.38
    );

    vec3 corHachura = mix(uColChange, uColPrimary, 0.30);
    vec3 corFinal = mix(corHachura, uColCord, clamp(linhaFrente * 0.72 + bordaCaixa * 0.25, 0.0, 1.0));
    gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
    return;
  }

  // Modo 0: Lâmina oblíqua de vidro biselado (260ms) para troca instantânea em cache.
  float t = clamp(uTime / 0.26, 0.0, 1.0);
  float pulso = sin(t * PI) * env;
  if (pulso <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float ease = 1.0 - pow(1.0 - t, 3.0);
  float coord = ((dir > 0.0) ? uv.x : (1.0 - uv.x)) + (uv.y - 0.5) * 0.28;
  float pos = mix(-0.22, 1.28, ease);
  float dist = coord - pos;

  float grao = 0.85 + 0.15 * snoise(px * 0.06);
  float biselFrente = exp(-pow((dist - 0.016) / 0.0085, 2.0));
  float corpoLamina = exp(-pow(dist / 0.062, 2.0)) * grao;
  float biselTras = exp(-pow((dist + 0.024) / 0.011, 2.0));

  float teto = mix(0.20, 0.28, uDark);
  float alpha = clamp((corpoLamina * teto + biselFrente * teto * 1.25 + biselTras * teto * 0.65) * pulso, 0.0, 0.36);

  vec3 corBisel = mix(uColSurface, uColCord, 0.68);
  vec3 corNucleo = mix(uColChange, uColCord, 0.35);
  vec3 corFinal = mix(corNucleo, corBisel, clamp(biselFrente * 0.85, 0.0, 1.0));
  corFinal = mix(corFinal, uColPrimary, clamp(biselTras * 0.45, 0.0, 1.0));

  gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
}
`);
