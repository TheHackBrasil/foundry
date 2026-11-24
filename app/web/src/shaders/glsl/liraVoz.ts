import { montarFragmentShader } from './comum.ts';

// Lira de Anfíon Reativa à FFT:
// uMode=0 -> 4 cordas harmônicas com janela de Hann, distância corrigida pelo
// gradiente (abs(uv.y - yC) / sqrt(1 + dy*dy)) e micro-cáustica --cord nos cruzamentos.
// uMode=1 -> Feixe Interferométrico fino no topo do campo de comando durante inferência.
export const FRAGMENT_LIRA_VOZ = montarFragmentShader(`
float avaliarCorda(float x, float idx, float hann, float energia) {
  float yBase = 0.37 + idx * 0.086;
  float bandaPos = clamp(0.12 + x * 0.76 + (idx - 1.5) * 0.06, 0.0, 1.0);
  float banda = sampleBand(bandaPos);
  float freq = 1.0 + idx * 0.95;
  float vel = 2.4 + idx * 0.65;
  float fase = x * freq * PI + uTime * vel + idx * 1.18;
  float amp = (0.032 + banda * 0.22 + uRms * 0.14) * hann * energia;
  float harmonico2 = 0.24 * sin(x * (freq * 2.0) * PI - uTime * (vel * 0.7) + idx);
  return yBase + amp * (sin(fase) + harmonico2);
}

void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  float env = clamp(uEnvelope, 0.0, 1.0);

  if (env <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Modo 1: Feixe Interferométrico fino no topo durante inferência.
  if (uMode >= 0.5) {
    float yPx = uv.y * res.y;
    float nucleo = exp(-pow((yPx - 1.5) / 1.15, 2.0));
    float halo = exp(-pow(yPx / 5.5, 2.0)) * 0.24;

    float ondaA = cos(uv.x * 20.0 - uTime * 3.8);
    float ondaB = cos(uv.x * 27.0 + uTime * 3.1 + 0.9);
    float interferencia = 0.5 + 0.5 * (ondaA * 0.55 + ondaB * 0.45);
    float pacote = exp(-pow((uv.x - (0.5 + 0.36 * sin(uTime * 1.45))) / 0.32, 2.0));

    float bordas = smoothstep(0.0, 0.08, uv.x) * smoothstep(1.0, 0.92, uv.x);
    float intensidade = (nucleo * (0.48 + 0.52 * interferencia) + halo * pacote) * bordas;

    vec3 corFeixe = mix(uColChange, uColCord, clamp(interferencia * 0.65 + pacote * 0.25, 0.0, 1.0));
    float alpha = clamp(intensidade * mix(0.76, 0.88, uDark) * env, 0.0, 0.9);
    gl_FragColor = saidaPremult(corFeixe, alpha, gl_FragCoord.xy);
    return;
  }

  // Modo 0: 4 cordas harmônicas ancoradas nas extremidades por janela de Hann.
  float hann = pow(0.5 * (1.0 - cos(TAU * uv.x)), 0.85);
  float eps = 1.0 / res.x;
  float xEsq = max(0.0, uv.x - eps);
  float xDir = min(1.0, uv.x + eps);
  float hannEsq = pow(0.5 * (1.0 - cos(TAU * xEsq)), 0.85);
  float hannDir = pow(0.5 * (1.0 - cos(TAU * xDir)), 0.85);
  float razao = res.y / res.x;

  float somaCorda = 0.0;
  float maxCorda = 0.0;
  float somaHalo = 0.0;
  vec3 corAcum = vec3(0.0);
  float pesoCor = 0.0;

  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float yC = avaliarCorda(uv.x, fi, hann, env);
    float yE = avaliarCorda(xEsq, fi, hannEsq, env);
    float yD = avaliarCorda(xDir, fi, hannDir, env);
    float dy = (yD - yE) / max(xDir - xEsq, 0.0001);
    float dyPx = dy * razao;

    // Distância ortogonal real em pixels, preservando espessura constante em cristas.
    float distCorr = abs(uv.y - yC) / sqrt(1.0 + dyPx * dyPx);
    float distPx = distCorr * res.y;

    float fio = 1.0 - smoothstep(0.55, 1.45, distPx);
    float brilhoSuave = exp(-distPx * 0.42) * 0.22;
    float pesoFio = fio * (0.72 + 0.28 * (1.0 - abs(fi - 1.5) / 2.0));

    somaCorda += pesoFio;
    maxCorda = max(maxCorda, pesoFio);
    somaHalo += brilhoSuave;

    float misturaCorda = clamp(0.35 + fi * 0.16 + uRms * 0.45, 0.0, 1.0);
    vec3 corFio = mix(uColPrimary, uColChange, misturaCorda);
    corAcum += corFio * (pesoFio + brilhoSuave * 0.5);
    pesoCor += pesoFio + brilhoSuave * 0.5;
  }

  // Micro-cáustica óptica exatamente onde duas ou mais cordas se cruzam.
  float cruzamento = clamp((somaCorda - maxCorda) * 1.45, 0.0, 1.0);
  vec3 corFinal = (pesoCor > 0.0001) ? (corAcum / pesoCor) : uColChange;
  corFinal = mix(corFinal, uColCord, clamp(cruzamento * 0.85, 0.0, 1.0));

  float alpha = clamp((maxCorda * 0.82 + somaHalo * 0.26 + cruzamento * 0.34) * env, 0.0, 0.92);
  gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
}
`);
