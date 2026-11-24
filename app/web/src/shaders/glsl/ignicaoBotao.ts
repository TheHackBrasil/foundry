import { montarFragmentShader } from './comum.ts';

// Ignição Cáustica Perimetral: sdRoundedBox exato, 2 pulsos opostos de 1.5px,
// veios minerais fbm2 contidos (<=0.18 claro / <=0.24 escuro), onda radial de
// uOrigin e sweep óptico de resolução (uMode=1 ok / uMode=2 erro).
export const FRAGMENT_IGNICAO_BOTAO = montarFragmentShader(`
void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  vec2 px = uv * res;
  vec2 metade = res * 0.5;
  vec2 p = px - metade;

  float raio = clamp(uRadius, 1.0, min(metade.x, metade.y) - 0.5);
  float dist = sdRoundedBox(p, metade - vec2(1.0), raio);
  float dentro = 1.0 - smoothstep(-0.75, 0.75, dist);
  if (dentro <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  // Coordenada angular normalizada ao redor do perímetro para 2 pulsos opostos.
  vec2 pNorm = p / max(metade, vec2(1.0));
  float s = atan(pNorm.y, pNorm.x) / TAU + 0.5;

  // Traço perimetral de ~1.5px centrado na aresta interna do botão.
  float tracoBorda = exp(-pow((dist + 0.75) / 0.95, 2.0));
  float faseA = fract(s - uTime * 0.42);
  float faseB = fract(s - uTime * 0.42 + 0.5);
  float arcoA = exp(-pow(min(faseA, 1.0 - faseA) * 5.4, 2.0));
  float arcoB = exp(-pow(min(faseB, 1.0 - faseB) * 5.4, 2.0));
  float pulsos = clamp(arcoA + arcoB, 0.0, 1.0) * tracoBorda;

  // Veios minerais fbm2 sutis no interior, respeitando teto de contraste.
  vec2 coordVeio = p * 0.024 + vec2(uTime * 0.14, -uTime * 0.08);
  float nVeio = fbm2(coordVeio);
  float veio = pow(clamp(1.0 - abs(nVeio), 0.0, 1.0), 3.4);
  float tetoInterior = mix(0.18, 0.24, uDark);

  // Onda radial de ignição a partir de uOrigin do clique.
  vec2 origemPx = uOrigin * res;
  float distOrigem = length(px - origemPx);
  float diag = max(length(res), 1.0);
  float raioOnda = diag * (1.0 - exp(-max(uTime, 0.0) * 4.4));
  float larguraOnda = max(8.0, diag * 0.065);
  float anelClique = exp(-pow((distOrigem - raioOnda) / larguraOnda, 2.0))
    * exp(-max(uTime, 0.0) * 2.9);

  float env = clamp(uEnvelope, 0.0, 1.0);
  float alphaInterior = clamp((veio * 0.65 + anelClique * 0.55) * tetoInterior * env, 0.0, tetoInterior);
  float alphaBorda = (tracoBorda * 0.18 + pulsos * 0.56) * env;

  vec3 corBase = mix(uColPrimary, uColChange, 0.58 + 0.22 * uDark);
  vec3 corVeio = mix(corBase, uColCord, 0.35 * veio + 0.45 * anelClique);
  vec3 corBorda = mix(uColChange, uColCord, clamp(pulsos * 0.72, 0.0, 1.0));

  float alphaTotal = max(alphaInterior, alphaBorda);
  float pesoBorda = alphaBorda / max(alphaTotal, 0.0001);
  vec3 corFinal = mix(corVeio, corBorda, clamp(pesoBorda, 0.0, 1.0));

  // Resolução óptica: uMode=1 sweep esmeralda ok; uMode=2 freio mineral erro.
  float resProg = clamp(uResolve, 0.0, 1.0);
  if (resProg > 0.001 && uMode > 0.5) {
    float fadeRes = sin(resProg * PI) * (1.0 - smoothstep(0.84, 1.0, resProg));
    if (uMode < 1.5) {
      float eixo = uv.x + (uv.y - 0.5) * 0.24;
      float frente = mix(-0.22, 1.24, resProg);
      float feixe = exp(-pow((eixo - frente) / 0.11, 2.0));
      float brilhoOk = (feixe * tetoInterior * 1.15 + tracoBorda * 0.62) * fadeRes;
      vec3 corOk = mix(uColOk, uColCord, feixe * 0.28);
      corFinal = mix(corFinal, corOk, clamp(fadeRes * 0.85, 0.0, 1.0));
      alphaTotal = max(alphaTotal, brilhoOk);
    } else {
      float freio = exp(-pow(abs(dist + 1.2) / 2.2, 2.0));
      float pulsoErro = (freio * 0.74 + tetoInterior * 0.72 * (1.0 - resProg)) * fadeRes;
      corFinal = mix(corFinal, uColError, clamp(fadeRes * 0.92, 0.0, 1.0));
      alphaTotal = max(alphaTotal, pulsoErro);
    }
  }

  gl_FragColor = saidaPremult(corFinal, alphaTotal * dentro, gl_FragCoord.xy);
}
`);
