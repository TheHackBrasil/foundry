import { montarFragmentShader } from './comum.ts';

// Campo Mineral Fluido (fundo interativo da rota #/ia — Assistente Forseti):
// Domain-warped fBM com estratos minerais topográficos e cáusticas suaves em --cord/--change.
// Contraste contido (~4%–8% em repouso) para nunca competir com leitura de texto/GenUI.
// uMode=0: repouso geológico sereno; uMode=1: correnteza ascendente (IA pensando);
// uMode=2: ondas estacionárias suaves moduladas por uRms e uBands (escuta por voz).
export const FRAGMENT_CAMPO_MINERAL = montarFragmentShader(`
void main() {
  vec2 res = max(uRes, vec2(1.0));
  vec2 uv = uvTopo();
  float env = clamp(uEnvelope, 0.0, 1.0);
  if (env <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float aspecto = res.x / res.y;
  vec2 p = (uv - 0.5) * vec2(aspecto, 1.0);

  // Deformação de lente fluida / esteira suave ao redor do cursor (uOrigin + uPointer).
  vec2 deltaPtr = (uv - uOrigin) * vec2(aspecto, 1.0);
  float distPtr = length(deltaPtr);
  float forcaPtr = clamp(uPointer, 0.0, 1.0);
  float lente = exp(-distPtr * distPtr * 9.5) * forcaPtr;
  vec2 dirPtr = deltaPtr / max(distPtr, 0.001);
  vec2 pRefratado = p - dirPtr * (lente * 0.085);

  bool modoPensando = (uMode >= 0.5 && uMode < 1.5);
  bool modoVoz = (uMode >= 1.5);

  // Fluxo temporal adaptado por modo: lentíssimo em repouso, correnteza ascendente no pensamento.
  float tLento = uTime * 0.032;
  vec2 deriva = modoPensando
    ? vec2(sin(uTime * 0.14) * 0.08, uTime * 0.115)
    : vec2(tLento * 0.65, -tLento * 0.42);

  // Domain-warped fBM em duas etapas: estratos minerais orgânicos sem aspecto de nuvem genérica.
  vec2 qCoord = pRefratado * 1.45 + deriva;
  vec2 q = vec2(
    fbm2(qCoord),
    fbm2(qCoord + vec2(4.2, 1.9))
  );

  float amplitudeWarp = modoPensando ? 0.82 : 0.58;
  vec2 rCoord = pRefratado * 1.85 + q * amplitudeWarp + vec2(-deriva.y * 0.45, deriva.x * 0.55);
  float campo = fbm2(rCoord);

  // Curvas de nível topográficas sutis (estratos de ardósia / papel mineral).
  float estrato = sin((campo * 5.2 + pRefratado.y * 1.65) * PI);
  float linhasEstrato = pow(1.0 - abs(estrato), 6.0);
  float relevo = 0.5 + 0.5 * campo;

  // Cáustica óptica calma nos encontros dos estratos + reflexo da lente do ponteiro.
  float causticaBase = pow(clamp(1.0 - abs(fbm2(rCoord * 1.35 + vec2(2.7, -3.1))), 0.0, 1.0), 4.0);
  float anelLente = exp(-pow((distPtr - 0.14) / 0.09, 2.0)) * forcaPtr * 0.42;

  float impulsoPensar = 0.0;
  if (modoPensando) {
    float corrente = 0.5 + 0.5 * sin(pRefratado.y * 6.5 + uTime * 1.7 + campo * 2.8);
    impulsoPensar = pow(corrente, 3.0) * (0.45 + 0.55 * causticaBase);
  }

  float ondaVoz = 0.0;
  if (modoVoz) {
    float banda = sampleBand(clamp(uv.x, 0.0, 1.0));
    float energiaVoz = clamp(uRms * 1.35 + banda * 0.65, 0.0, 1.0);
    float estacionaria = cos(pRefratado.x * 9.0 + campo * 1.4) * cos(uTime * 2.1 - distPtr * 4.5);
    float envoltorioY = exp(-pow(pRefratado.y / 0.42, 2.0));
    ondaVoz = pow(0.5 + 0.5 * estacionaria, 2.5) * envoltorioY * (0.28 + 0.72 * energiaVoz);
  }

  // Paleta mineral calma: petróleo + lavanda sutil no claro; petróleo profundo + corda no escuro.
  vec3 corEstratoClaro = mix(uColPrimary, uColChange, 0.36);
  vec3 corEstratoEscuro = mix(uColChange, uColCord, 0.52);
  vec3 corEstrato = mix(corEstratoClaro, corEstratoEscuro, uDark);

  vec3 corCaustica = mix(uColChange, uColCord, 0.48 + 0.34 * uDark);
  vec3 corFinal = mix(corEstrato, corCaustica, clamp(causticaBase * 0.62 + anelLente + impulsoPensar * 0.7 + ondaVoz * 0.65, 0.0, 1.0));

  // Contraste estritamente contido: ~4% a 8% em repouso, leve elevação em pensamento/voz.
  float tetoRepouso = mix(0.072, 0.088, uDark);
  float massaRepouso = (relevo * 0.32 + linhasEstrato * 0.48 + causticaBase * 0.34) * tetoRepouso;
  float acentoInteracao = (lente * 0.036 + anelLente * 0.042);
  float acentoModo = impulsoPensar * mix(0.052, 0.078, uDark) + ondaVoz * mix(0.058, 0.085, uDark);

  float tetoMaximo = mix(0.135, 0.175, uDark);
  float alpha = clamp((massaRepouso + acentoInteracao + acentoModo) * env, 0.0, tetoMaximo);

  gl_FragColor = saidaPremult(corFinal, alpha, gl_FragCoord.xy);
}
`);
