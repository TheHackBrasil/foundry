import { montarFragmentShader } from './comum.ts';

// Onda Dominó de Propagação: onda elíptica harmônica dupla one-shot (850ms)
// partindo de uOrigin, modulada por snoise, acendendo arestas da grade uGrid
// já atravessadas e dissolvendo suavemente.
export const FRAGMENT_ONDA_DOMINO = montarFragmentShader(`
void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  float env = clamp(uEnvelope, 0.0, 1.0);

  float t = clamp(uTime / 0.85, 0.0, 1.0);
  float dissolver = (1.0 - smoothstep(0.62, 1.0, t)) * env;
  if (dissolver <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float progresso = 1.0 - pow(1.0 - t, 3.0);
  float aspecto = res.x / res.y;
  vec2 delta = (uv - uOrigin) * vec2(aspecto, 1.0);

  // Geometria elíptica suave alinhada à matriz horizontal.
  float dist = length(delta * vec2(0.86, 1.12));
  float maxDist = length(vec2(aspecto, 1.0)) * 1.14;
  float modulacao = snoise(uv * 5.2 + vec2(uTime * 0.55, -uTime * 0.35)) * 0.028 * maxDist;
  float distMod = dist + modulacao;

  // Dupla crista harmônica: frente principal + eco secundário defasado.
  float raio1 = progresso * maxDist;
  float raio2 = max(0.0, progresso - 0.13) * maxDist;
  float largura1 = max(0.028, maxDist * 0.045);
  float largura2 = max(0.042, maxDist * 0.068);

  float onda1 = exp(-pow((distMod - raio1) / largura1, 2.0));
  float onda2 = exp(-pow((distMod - raio2) / largura2, 2.0)) * 0.58 * smoothstep(0.08, 0.24, progresso);

  // Arestas da grade uGrid acendem em ressonância conforme a frente as atravessa.
  vec2 grade = max(uGrid, vec2(2.0, 2.0));
  vec2 passoPx = res / grade;
  vec2 distLinhaPx = abs(fract(uv * grade + 0.5) - 0.5) * passoPx;
  float linhaX = 1.0 - smoothstep(0.35, 1.25, distLinhaPx.x);
  float linhaY = 1.0 - smoothstep(0.35, 1.25, distLinhaPx.y);
  float arestaGrade = max(linhaX, linhaY);

  float jaAtravessada = 1.0 - smoothstep(raio1 - largura1 * 0.6, raio1 + largura1 * 0.35, distMod);
  float rastro = exp(-max(0.0, raio1 - distMod) / max(maxDist * 0.26, 0.08));
  float ressonanciaGrade = arestaGrade * jaAtravessada * rastro;

  float tetoOnda = mix(0.14, 0.21, uDark);
  float tetoAresta = mix(0.24, 0.34, uDark);

  float alphaOnda = (onda1 * 0.85 + onda2 * 0.55) * tetoOnda * dissolver;
  float alphaAresta = ressonanciaGrade * tetoAresta * dissolver;
  float alphaFinal = clamp(max(alphaOnda, alphaAresta), 0.0, 0.36);

  vec3 corOnda = mix(uColChange, uColCord, clamp(onda1 * 0.65, 0.0, 1.0));
  vec3 corAresta = mix(uColChange, uColCord, clamp(rastro * 0.38, 0.0, 1.0));
  float pesoAresta = alphaAresta / max(alphaOnda + alphaAresta, 0.0001);
  vec3 corFinal = mix(corOnda, corAresta, clamp(pesoAresta, 0.0, 1.0));

  gl_FragColor = saidaPremult(corFinal, alphaFinal, gl_FragCoord.xy);
}
`);
