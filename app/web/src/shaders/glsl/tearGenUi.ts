import { montarFragmentShader } from './comum.ts';

// Tear Mineral da GenUI:
// uMode=0 -> Lâmina de vidro lavanda canelado varrendo em uDir com cruzetas SDF
// sincronizadas a uGrid e dispersão mineral sutil (alpha <= 0.16 claro / 0.24 escuro).
// uMode=1 -> Selo 3 Monólitos SDF (24x24px) com alinhamento vertical e 4 micro-fios --change.
export const FRAGMENT_TEAR_GENUI = montarFragmentShader(`
float sdMonolito(vec2 p, vec2 centro, vec2 semiTam, float chanfro) {
  vec2 q = p - centro;
  // Inclinação arquitetônica sutil no topo e na base evocando os 3 monólitos do Forseti.
  float inclinacao = q.x * chanfro;
  q.y += inclinacao;
  return sdRoundedBox(q, semiTam, 0.045);
}

void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  float env = clamp(uEnvelope, 0.0, 1.0);
  if (env <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Modo 1: Selo 3 Monólitos SDF (micro-loader 24x24px).
  if (uMode >= 0.5) {
    vec2 p = (uv - 0.5) * 2.0;
    float aa = 2.0 / max(min(res.x, res.y), 16.0);

    // Fase harmônica que alinha periodicamente os 3 monólitos no eixo vertical.
    float onda0 = sin(uTime * 2.65) * 0.085;
    float onda1 = sin(uTime * 2.65 - 0.85) * 0.085;
    float onda2 = sin(uTime * 2.65 - 1.70) * 0.085;

    float dEsq = sdMonolito(p, vec2(-0.54, 0.14 + onda0), vec2(0.18, 0.44), 0.30);
    float dCen = sdMonolito(p, vec2(0.00, -0.01 + onda1), vec2(0.19, 0.62), 0.28);
    float dDir = sdMonolito(p, vec2(0.54, -0.14 + onda2), vec2(0.18, 0.46), 0.30);

    float dPedra = min(dEsq, min(dCen, dDir));
    float mascaraPedra = 1.0 - smoothstep(-aa, aa, dPedra);

    // 4 micro-fios lavanda atravessando os vãos entre os 3 monólitos.
    float mascaraFios = 0.0;
    float recortePedra = 0.0;
    for (int k = 0; k < 4; k++) {
      float fk = float(k);
      float yFio = -0.20 + fk * 0.135 - p.x * 0.24
        + 0.055 * sin(p.x * 2.6 - uTime * 2.8 + fk * 0.55);
      float dFio = abs(p.y - yFio);
      float fio = 1.0 - smoothstep(0.018, 0.018 + aa * 1.15, dFio);
      float sulco = 1.0 - smoothstep(0.032, 0.032 + aa * 1.15, dFio);
      mascaraFios = max(mascaraFios, fio);
      recortePedra = max(recortePedra, sulco);
    }

    // Recorta os 4 fios na pedra e acende os micro-fios nos vãos entre os monólitos.
    float pedraVisivel = mascaraPedra * (1.0 - recortePedra * 0.88);
    float mascaraVao = smoothstep(-0.74, -0.68, p.x) * (1.0 - smoothstep(0.68, 0.74, p.x))
      * (1.0 - pedraVisivel);
    float fiosNosVaos = mascaraFios * mascaraVao;

    vec3 corFio = mix(uColChange, uColCord, 0.22 + 0.32 * uDark);
    float alpha = clamp((pedraVisivel * 0.94 + fiosNosVaos * 0.92) * env, 0.0, 0.96);
    float pesoFio = fiosNosVaos / max(pedraVisivel + fiosNosVaos, 0.0001);
    vec3 corFinal = mix(uColPrimary, corFio, clamp(pesoFio, 0.0, 1.0));

    gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
    return;
  }

  // Modo 0: Lâmina de vidro lavanda canelado (fluted glass) + cruzetas SDF da grade.
  vec2 px = uv * res;
  float dir = (abs(uDir) < 0.01) ? 1.0 : sign(uDir);
  float ciclo = fract(uTime * 0.38);
  float frente = mix(-0.26, 1.26, (dir > 0.0) ? ciclo : (1.0 - ciclo));

  float distFrente = uv.x - frente;
  float envoltorioLamina = exp(-pow(distFrente / 0.18, 2.0));

  // Caneluras verticais de vidro refrativo com dispersão mineral sutil.
  float turb = fbm2(uv * vec2(3.2, 4.8) + vec2(uTime * 0.18 * dir, 0.0));
  float faseCanelura = px.x * 0.42 + turb * 0.9;
  float caneluraA = 0.5 + 0.5 * sin(faseCanelura - 0.38);
  float caneluraB = 0.5 + 0.5 * sin(faseCanelura + 0.38);
  float cristaVidro = exp(-pow(distFrente / 0.022, 2.0));

  // Cruzetas SDF sincronizadas com uGrid (colunas x linhas).
  vec2 grade = max(uGrid, vec2(2.0, 2.0));
  vec2 passoPx = res / grade;
  vec2 localPx = (fract(uv * grade + 0.5) - 0.5) * passoPx;
  float braco = min(4.5, min(passoPx.x, passoPx.y) * 0.16);
  float dH = sdRoundedBox(localPx, vec2(braco, 0.65), 0.35);
  float dV = sdRoundedBox(localPx, vec2(0.65, braco), 0.35);
  float cruzeta = 1.0 - smoothstep(-0.35, 0.85, min(dH, dV));
  float cruzetaIluminada = cruzeta * envoltorioLamina;

  float teto = mix(0.16, 0.24, uDark);
  float corpoVidro = envoltorioLamina * (0.42 + 0.58 * (0.5 * caneluraA + 0.5 * caneluraB));
  float intensidade = clamp(corpoVidro * 0.72 + cristaVidro * 0.38 + cruzetaIluminada * 0.65, 0.0, 1.0);
  float alpha = min(teto, intensidade * teto * 1.15) * env;

  // Dispersão óptica mineral entre lavanda profunda e corda lavanda (sem arco-íris).
  vec3 corVidro = mix(uColChange, uColCord, clamp(caneluraB * 0.55 + cristaVidro * 0.35, 0.0, 1.0));
  vec3 corFinal = mix(corVidro, mix(uColPrimary, uColChange, 0.65), cruzetaIluminada * 0.55);

  gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
}
`);
