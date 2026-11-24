import { useEffect, useRef, useState, type RefObject } from 'react';

export type EstadoSuperficieIA = 'ocioso' | 'ouvindo' | 'processando';

export interface SuperficieMineralIAProps {
  estado: EstadoSuperficieIA;
  modoFundo: 'santuario' | 'conversa';
  analyserRef?: RefObject<AnalyserNode | null>;
  energiaRef?: RefObject<number>;
  pulsoExternoSeq?: number;
  className?: string;
}

type TemaShader = 'dark' | 'light';

const VERT_SRC = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[3](
  vec2(-1.0, -1.0),
  vec2( 3.0, -1.0),
  vec2(-1.0,  3.0)
);
void main() {
  gl_Position = vec4(POS[gl_VertexID], 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2  uResolution;
uniform float uTime;
uniform float uTheme;        // 0.0 = Escuro (Structural Matte), 1.0 = Claro (Tactile Paper-Grain)
uniform float uModoConversa; // 0.0 = Santuário pleno, 1.0 = Conversa GenUI suavizada
uniform vec2  uPointer;      // Ponteiro amortecido em espaço normalizado por aspecto
uniform vec2  uPointerVel;   // Velocidade amortecida do ponteiro
uniform vec3  uStates;       // x = ocioso, y = ouvindo, z = processando
uniform vec4  uAudio;        // x = nível, y = grave, z = médio, w = agudo
uniform vec4  uPulses[4];    // xy = origem projetada, z = idade (s), w = intensidade

const float PI = 3.14159265359;

vec3 toLinear(vec3 c) {
  return pow(max(c, 0.0), vec3(2.2));
}

vec3 toSRGB(vec3 c) {
  return pow(max(c, 0.0), vec3(1.0 / 2.2));
}

mat2 rot2(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}

// Crista lapidada de perfil arquitetônico (evita lobos senoidais inchados)
float honedRidge(float x, float sharpness) {
  float s = sin(x);
  return 1.0 - sqrt(s * s + sharpness);
}

// Grão tátil ancorado em tela (monocromático, sem cintilação temporal)
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float valueNoise2D(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Pacote harmônico amortecido disparado por cliques ou eventos de IA
float pulseField(vec2 p, out float pulseCrest) {
  float disp = 0.0;
  float crest = 0.0;
  for (int i = 0; i < 4; i++) {
    float strength = uPulses[i].w;
    if (strength <= 0.001) continue;
    float age = uPulses[i].z;
    float d = length(p - uPulses[i].xy);
    float front = age * 0.88;
    float delta = d - front;
    float env = exp(-age * 1.02) * exp(-(delta * delta) * 16.0) * strength;
    float wave = cos(delta * 20.0);
    disp += env * wave * 0.058;
    crest += env * pow(max(0.0, wave), 2.0);
  }
  pulseCrest = clamp(crest, 0.0, 1.0);
  return disp;
}

// Depressão refrativa e esteira inercial sob o ponteiro
float pointerDisplacement(vec2 p, out float ptrEdge) {
  vec2 dp = p - uPointer * 1.48;
  float r2 = dot(dp, dp);
  float speed = clamp(length(uPointerVel) * 2.0, 0.0, 1.0);
  float lens = exp(-r2 * 4.4) * (0.028 + 0.026 * speed);
  float wake = dot(dp, uPointerVel) * exp(-r2 * 4.8) * 0.12;
  ptrEdge = exp(-pow((sqrt(r2) - 0.34) * 5.2, 2.0)) * (0.26 + 0.50 * speed);
  return (-lens + wake) * (1.0 - 0.45 * uModoConversa);
}

struct SurfaceInfo {
  float height;
  float ridgeCrest;
  float coreMask;
  float sanctuary;
  float wavePhase;
};

SurfaceInfo evalMineralSurface(vec2 p) {
  SurfaceInfo s;
  float conversaCalm = 1.0 - 0.36 * uModoConversa;

  float tSlow = uTime * 0.18;
  vec2 flowWarp = vec2(
    sin(p.y * 1.35 + tSlow) * 0.14 + cos((p.x + p.y) * 0.85 - tSlow * 0.7) * 0.08,
    cos(p.x * 1.15 - tSlow * 0.85) * 0.12 + sin((p.x - p.y) * 0.9 + tSlow * 0.6) * 0.07
  );
  vec2 q = p + flowWarp;

  // Estratos minerais diagonais de fundo
  vec2 diag = q * rot2(-0.46);
  float macroFold = sin(diag.x * 1.85 + 0.35 * sin(diag.y * 1.4 - tSlow)) * 0.082
                  + cos(diag.y * 1.25 - tSlow * 0.55) * 0.045;

  float bgRib1 = honedRidge(diag.x * 3.9 + sin(diag.y * 1.6 + tSlow) * 0.65, 0.055);
  float bgRib2 = honedRidge(diag.x * 7.8 - diag.y * 1.1 - tSlow * 0.9, 0.09);
  float bgTerrace = (bgRib1 * 0.040 + bgRib2 * 0.013);

  // Colar elíptico lapidado emoldurando o santuário tipográfico central
  float twistAng = 0.28 * sin(uTime * 0.19) * uStates.x
                 + 0.12 * uAudio.y * uStates.y
                 - 0.16 * uStates.z;
  vec2 cRot = p * rot2(twistAng);

  vec2 ce = cRot / vec2(1.06, 0.72);
  float r = length(ce);
  float ang = atan(ce.y, ce.x);

  float coreEnvelope = exp(-pow(r * 0.82, 2.4));
  float sanctuary = exp(-pow(r * 1.50, 2.15));
  float collarMask = smoothstep(0.22, 0.68, r) * exp(-pow(max(r - 0.88, 0.0) * 1.38, 2.0));

  float asym = 0.44 * sin(ang * 2.0 - 0.55 + uTime * 0.22 * (uStates.x + 0.5))
             + 0.22 * cos(ang * 3.0 + 0.85 - uTime * 0.16);

  float breath = 1.0 + (0.042 * sin(uTime * 0.55) * uStates.x
                     + (0.11 * uAudio.y + 0.05 * uAudio.x) * uStates.y) * conversaCalm;
  float coreMass = (coreEnvelope * 0.24 - sanctuary * 0.092) * breath;

  // Ocioso: pregas geológicas serenas (pula cálculo quando peso inativo)
  float idleCrest = 0.0;
  float idleHarm = 0.0;
  if (uStates.x > 0.005) {
    float idlePhase = r * 7.2 - uTime * 0.36 + asym;
    idleCrest = honedRidge(idlePhase, 0.032);
    idleHarm = idleCrest * 0.084 * collarMask;
  }

  // Ouvindo: terraços acústicos radiais modulados por FFT vocal / prosódia
  float listenCrest = 0.0;
  float listenDetail = 0.0;
  float listenHarm = 0.0;
  if (uStates.y > 0.005) {
    float voiceAmp = 0.066 + 0.090 * (uAudio.z * 0.72 + uAudio.x * 0.45);
    float listenPhase = r * 9.8 - uTime * 2.35 + asym * 0.55;
    listenCrest = honedRidge(listenPhase, 0.026);
    listenDetail = honedRidge(r * 16.5 - uTime * 3.6 + ang * 2.0, 0.045) * uAudio.w;
    float listenRadiate = sin(r * 10.5 - uTime * 2.65) * exp(-max(r - 0.8, 0.0) * 1.25) * (0.015 + 0.034 * uAudio.z);
    listenHarm = (listenCrest * voiceAmp + listenDetail * 0.022) * collarMask + listenRadiate;
  }

  // Processando: corrente óptica laminar desviada suavemente ao redor do santuário
  float laminarPhase = 0.0;
  float procStream = 0.0;
  float procHarm = 0.0;
  if (uStates.z > 0.005) {
    float dirAxis = dot(p, vec2(0.84, 0.54));
    float perpAxis = dot(p, vec2(-0.54, 0.84));
    float streamlineDeflect = 0.58 * exp(-r * r * 0.85) * (perpAxis / (0.45 + r * r));
    laminarPhase = (dirAxis + streamlineDeflect * 0.42) * 5.8 - uTime * 2.15 + 0.25 * sin(perpAxis * 2.4);
    procStream = honedRidge(laminarPhase, 0.036);
    float procEnvelope = 0.55 + 0.45 * coreEnvelope;
    procHarm = procStream * 0.066 * procEnvelope * (1.0 - sanctuary * 0.82)
             + honedRidge(r * 6.8 - uTime * 0.95 + asym * 0.35, 0.042) * 0.036 * collarMask;
  }

  float stateHarm = (idleHarm * uStates.x + listenHarm * uStates.y + procHarm * uStates.z) * conversaCalm;

  float activeCrest = idleCrest * uStates.x
                    + clamp(listenCrest * (0.55 + 0.65 * uAudio.z) + listenDetail * 0.35, 0.0, 1.0) * uStates.y
                    + clamp(procStream, 0.0, 1.0) * uStates.z;

  float pCrest;
  float pDisp = pulseField(p, pCrest);
  float ptrEdge;
  float ptrDisp = pointerDisplacement(p, ptrEdge);

  float bgTerraceWeight = (1.0 - sanctuary * 0.78) * (1.0 - uStates.z * 0.65);

  float h = macroFold * (1.0 - coreEnvelope * 0.45)
          + bgTerrace * bgTerraceWeight
          + coreMass
          + stateHarm
          + pDisp
          + ptrDisp;

  float procPulse = pow(max(0.0, sin(laminarPhase * 0.5 + 0.4)), 4.0) * uStates.z;
  float listenPulse = pow(max(0.0, sin(r * 5.2 - uTime * 2.2)), 3.0) * (0.22 + 0.85 * uAudio.w) * uStates.y;

  s.height = h;
  s.ridgeCrest = clamp(
    activeCrest * collarMask * 0.90
    + bgRib1 * 0.26 * (1.0 - sanctuary)
    + pCrest * 1.05
    + ptrEdge * 0.30,
    0.0,
    1.0
  );
  s.coreMask = clamp(coreEnvelope * 1.15, 0.0, 1.0);
  s.sanctuary = sanctuary;
  s.wavePhase = clamp((procPulse + listenPulse) * conversaCalm + pCrest * 1.2, 0.0, 1.0);
  return s;
}

// Estêncil único de 4 amostras fundindo normal e curvatura média (economiza 4 avaliações/pixel)
void calcNormalAndCurvature(vec2 p, float hCenter, float eps, out vec3 normal, out float curv) {
  float hpx = evalMineralSurface(p + vec2(eps, 0.0)).height;
  float hmx = evalMineralSurface(p - vec2(eps, 0.0)).height;
  float hpy = evalMineralSurface(p + vec2(0.0, eps)).height;
  float hmy = evalMineralSurface(p - vec2(0.0, eps)).height;
  normal = normalize(vec3(-(hpx - hmx), -(hpy - hmy), 2.0 * eps));
  float hAvg = 0.25 * (hpx + hmx + hpy + hmy);
  curv = (hCenter - hAvg) / (eps * eps);
}

// Auto-sombreamento direcional enxuto em 4 passos bem espaçados (t: 0.07 -> 1.05)
float calcSoftShadow(vec3 hitPos, vec3 lightDir) {
  float res = 1.0;
  float t = 0.07;
  for (int i = 0; i < 4; i++) {
    vec3 sp = hitPos + lightDir * t;
    float sh = evalMineralSurface(sp.xy).height;
    float diff = sp.z - sh;
    if (diff < 0.001) return 0.0;
    res = min(res, 5.8 * diff / t);
    t += clamp(diff * 1.05, 0.14, 0.32);
    if (t > 1.05) break;
  }
  return smoothstep(0.0, 1.0, res);
}

float ggxSpec(vec3 N, vec3 V, vec3 L, float rough) {
  vec3 H = normalize(V + L);
  float NdotH = max(dot(N, H), 0.0);
  float NdotV = max(dot(N, V), 0.001);
  float NdotL = max(dot(N, L), 0.001);
  float a = rough * rough;
  float a2 = a * a;
  float denom = NdotH * NdotH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * denom * denom + 1e-5);
  float k = (rough + 1.0) * (rough + 1.0) * 0.125;
  float Gv = NdotV / (NdotV * (1.0 - k) + k);
  float Gl = NdotL / (NdotL * (1.0 - k) + k);
  return (D * Gv * Gl) / (4.0 * NdotV * NdotL + 1e-4);
}

// Microgrão tátil monocromático calibrado (~2.3% escuro / ~2.6% papel claro)
float tactileGrain(vec2 fragCoord, float theme) {
  float g1 = hash12(fragCoord * 0.92) - 0.5;
  float g2 = valueNoise2D(fragCoord * vec2(0.24, 0.56)) - 0.5;
  float mineral = g1 * 0.72 + g2 * 0.28;
  float paper = g1 * 0.56 + g2 * 0.44;
  return mix(mineral, paper, theme) * mix(0.036, 0.040, theme);
}

void main() {
  float minDim = min(uResolution.x, uResolution.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / minDim;

  float aspect = uResolution.x / max(uResolution.y, 1.0);
  float fovScale = aspect < 0.85 ? mix(1.38, 1.0, smoothstep(0.45, 0.85, aspect)) : 1.0;
  vec2 pCam = uv * fovScale;

  // Câmera teleobjetiva de estúdio com paralaxe elástica pelo ponteiro
  vec3 ro = vec3(uPointer * 0.26, 3.35);
  vec3 target = vec3(uPointer * 0.045, 0.0);
  vec3 fw = normalize(target - ro);
  vec3 rt = normalize(cross(fw, vec3(0.0, 1.0, 0.0)));
  vec3 up = cross(rt, fw);
  vec3 rd = normalize(fw * 2.05 + rt * pCam.x + up * pCam.y);

  // Marcha restrita à laje de relevo [z = +0.38 até -0.22], máx 11 passos
  float tStart = max((0.38 - ro.z) / min(rd.z, -0.001), 0.0);
  float t = tStart;
  vec3 pos = ro + rd * t;
  SurfaceInfo surf;
  for (int i = 0; i < 11; i++) {
    pos = ro + rd * t;
    surf = evalMineralSurface(pos.xy);
    float d = pos.z - surf.height;
    if (abs(d) < 0.003 || pos.z < -0.22) break;
    t += d * 0.84;
  }

  vec3 N;
  float curv;
  calcNormalAndCurvature(pos.xy, surf.height, 0.009, N, curv);

  // Microtextura mineral sutil na normal
  float microN = valueNoise2D(pos.xy * 32.0) - 0.5;
  N = normalize(N + vec3(microN, -microN, 0.0) * 0.012);

  float sharpCrest = smoothstep(0.42, 2.55, curv);
  float valleyAO = smoothstep(-2.4, 0.45, curv);

  vec3 Lkey = normalize(vec3(-0.62 + uPointer.x * 0.14, 0.58 - uPointer.y * 0.10, 0.53));
  vec3 Lrim = normalize(vec3( 0.78 - uPointer.x * 0.12, -0.46 + uPointer.y * 0.08, 0.30));
  vec3 V = -rd;

  float NdotV = max(dot(N, V), 0.0);
  float NdotL1 = max(dot(N, Lkey), 0.0);
  float NdotL2 = max(dot(N, Lrim), 0.0);
  float shadow = calcSoftShadow(pos + N * 0.012, Lkey);

  float sanctuaryCalm = 1.0 - surf.sanctuary * 0.68;
  float roughBroad = mix(0.56, 0.44, surf.coreMask);
  float specBroad = ggxSpec(N, V, Lkey, roughBroad) * NdotL1 * shadow;
  float specEdge = ggxSpec(N, V, Lkey, 0.31) * NdotL1 * shadow * (0.24 + 0.76 * sharpCrest);
  float specRim = ggxSpec(N, V, Lrim, 0.36) * NdotL2 * (0.30 + 0.70 * sharpCrest);

  float fresnelGrazing = pow(1.0 - NdotV, 4.4);
  float slopeMag = clamp(1.0 - N.z, 0.0, 1.0);
  float surgicalFresnel = clamp(
    fresnelGrazing * (0.45 + 1.50 * sharpCrest)
    + sharpCrest * pow(1.0 - NdotV, 3.1) * (0.32 + 0.40 * surf.coreMask)
    + surf.wavePhase * sharpCrest * 0.34,
    0.0,
    1.0
  ) * (1.0 - surf.sanctuary * 0.84);

  // Espessura óptica aproximada direto da elevação do relevo (economiza 1 avaliação/pixel)
  float opticalThickness = clamp(surf.height * 2.4 + 0.45, 0.0, 1.0);

  float vig = smoothstep(1.88, 0.22, length(uv * vec2(0.84, 1.0)));

  // Paleta Escura — Structural Matte
  vec3 dBg        = toLinear(vec3(0.055, 0.075, 0.071)); // #0E1312
  vec3 dObsidian  = toLinear(vec3(0.071, 0.149, 0.137)); // #122623
  vec3 dPetroleum = toLinear(vec3(0.110, 0.239, 0.220)); // #1C3D38
  vec3 dSpec      = toLinear(vec3(0.910, 0.941, 0.933)); // #E8F0EE
  vec3 dLavender  = toLinear(vec3(0.718, 0.612, 0.910)); // #B79CE8

  // Paleta Clara — Tactile Paper-Grain (contraste AAA sobre o santuário central)
  vec3 lBg        = toLinear(vec3(0.925, 0.922, 0.902)); // #ECEBE6
  vec3 lPorcelain = toLinear(vec3(0.875, 0.867, 0.839)); // #DFDDD6
  vec3 lCeladon   = toLinear(vec3(0.780, 0.820, 0.800)); // #C7D1CC
  vec3 lPetroleum = toLinear(vec3(0.086, 0.235, 0.220)); // #163C38
  vec3 lAmethyst  = toLinear(vec3(0.396, 0.255, 0.600)); // #654199
  vec3 lLilacRim  = toLinear(vec3(0.541, 0.396, 0.761)); // #8A65C2
  vec3 lHighlight = toLinear(vec3(0.985, 0.982, 0.965));

  float stateActivity = clamp(
    0.24 * uStates.x
    + (0.30 + 0.68 * uAudio.x + 0.42 * uAudio.w) * uStates.y
    + 0.54 * uStates.z,
    0.0,
    1.15
  );

  // --- ESCURO: Structural Matte Obsidiana-Petróleo ---
  float dMassMix = clamp(
    surf.coreMask * 0.68
    + opticalThickness * 0.26 * vig
    + slopeMag * 0.25 * vig,
    0.0,
    1.0
  );
  vec3 colDark = mix(dBg, dObsidian, dMassMix);
  colDark = mix(
    colDark,
    dPetroleum,
    clamp(NdotL1 * shadow * (0.48 + 0.34 * surf.coreMask) * vig + opticalThickness * 0.20 * surf.coreMask, 0.0, 0.86)
  );
  colDark *= mix(0.58, 1.0, valleyAO * 0.68 + 0.32) * mix(0.72, 1.0, shadow);
  colDark += dPetroleum * NdotL2 * (0.13 + 0.15 * surf.coreMask) * vig;
  float dSpecTotal = clamp(specBroad * 0.16 + specEdge * 0.17 + specRim * 0.11, 0.0, 0.34) * sanctuaryCalm * vig;
  colDark += dSpec * dSpecTotal;
  float dLavAmt = clamp(surgicalFresnel * (0.42 + 0.34 * stateActivity), 0.0, 0.66) * vig;
  colDark = mix(colDark, dLavender, dLavAmt * 0.54);
  colDark += dLavender * pow(surgicalFresnel, 2.2) * (0.18 + 0.18 * stateActivity) * vig;
  // Acalma ligeiramente o fundo no modo conversa para priorizar leitura GenUI
  colDark = mix(colDark, dBg, uModoConversa * 0.34);

  // --- CLARO: Porcelana/Celadon Arquitetônica + Santuário Papel Luminoso ---
  float perimMask = 1.0 - smoothstep(0.15, 0.65, surf.sanctuary);
  vec3 colLight = mix(
    lBg,
    lPorcelain,
    clamp((surf.coreMask * 0.58 + slopeMag * 0.44 + (1.0 - valleyAO) * 0.32) * (0.30 + 0.70 * perimMask), 0.0, 1.0)
  );
  colLight = mix(
    colLight,
    lCeladon,
    clamp((surf.coreMask * (0.52 + 0.30 * opticalThickness) + surf.ridgeCrest * 0.34 * vig) * perimMask, 0.0, 0.78)
  );
  // Restringe petróleo escuro estritamente aos vincos nítidos do perímetro (zero sangria no centro)
  float petroCrevice = clamp(
    (1.0 - valleyAO) * 0.38
    + (1.0 - shadow) * 0.28
    + (1.0 - NdotL1) * slopeMag * 0.34,
    0.0,
    0.24
  ) * perimMask;
  colLight = mix(colLight, lPetroleum, petroCrevice);

  // Eleva o santuário central para papel técnico luminoso (~#F3F2ED) garantindo contraste >= 12:1
  vec3 lSanctuaryPaper = mix(lBg, lHighlight, 0.48);
  colLight = mix(colLight, lSanctuaryPaper, surf.sanctuary * 0.84);

  // Brilho cerâmico contido no colar periférico
  float lSpecTotal = clamp(specBroad * 0.15 + specEdge * 0.18 + specRim * 0.10, 0.0, 0.26) * sanctuaryCalm * vig;
  colLight += lHighlight * lSpecTotal;

  // Acento lilás cirúrgico restrito às cristas lapidadas do colar periférico
  float lRimAmt = clamp(
    (surgicalFresnel * (0.68 + 0.34 * stateActivity) + sharpCrest * 0.20 * surf.coreMask) * perimMask,
    0.0,
    0.78
  ) * vig;
  vec3 lAccent = mix(lAmethyst, lLilacRim, 0.32);
  colLight = mix(colLight, lAccent, lRimAmt * 0.64);
  colLight = mix(colLight, lSanctuaryPaper, uModoConversa * 0.32);

  vec3 col = mix(colDark, colLight, uTheme);

  // Ombro suave de altas luzes preservando a calibração tonal
  col = col / (1.0 + max(col - 0.88, 0.0) * 0.22);
  col = toSRGB(col);

  col += tactileGrain(gl_FragCoord.xy, uTheme);

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function lerTemaDocumento(): TemaShader {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-tema') === 'dark' ? 'dark' : 'light';
}

function prefereMovimentoReduzido(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function compilarShader(gl: WebGL2RenderingContext, tipo: number, fonte: string): WebGLShader {
  const shader = gl.createShader(tipo);
  if (!shader) throw new Error('Falha ao alocar shader WebGL2.');
  gl.shaderSource(shader, fonte);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'erro desconhecido';
    gl.deleteShader(shader);
    throw new Error(`Falha ao compilar shader: ${log}`);
  }
  return shader;
}

// Prosódia vocal orgânica de contingência quando o AnalyserNode ainda não entrega sinal FFT
function amostrarProsodiaSintetica(t: number, energiaBase: number) {
  const fraseBruta = Math.sin(t * 0.92) + 0.55 * Math.sin(t * 0.41 + 1.3);
  const portaFrase = Math.max(0.28, Math.min(1, (fraseBruta + 0.45) * 1.35));
  const silaba =
    0.5 +
    0.32 * Math.sin(t * 22.5 + Math.sin(t * 3.1) * 1.4) +
    0.18 * Math.sin(t * 31.2 + 0.8);
  const envSilaba = Math.pow(Math.max(0, silaba), 1.45);
  const fricativa = Math.pow(Math.max(0, Math.sin(t * 43.0 + Math.cos(t * 7.3) * 2.1)), 4.0);

  const ganho = Math.max(0.45, Math.min(1.15, 0.52 + energiaBase * 0.72));
  const low = portaFrase * (0.26 + 0.48 * envSilaba) * (0.8 + 0.2 * Math.sin(t * 5.2)) * ganho;
  const mid = portaFrase * (0.20 + 0.70 * envSilaba) * ganho;
  const high = portaFrase * (0.08 + 0.54 * fricativa + 0.20 * envSilaba) * ganho;
  const level = Math.min(1, low * 0.35 + mid * 0.5 + high * 0.25);

  return { level, low, mid, high };
}

export function SuperficieMineralIA({
  estado,
  modoFundo,
  analyserRef,
  energiaRef,
  pulsoExternoSeq = 0,
  className,
}: SuperficieMineralIAProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [webglStatus, setWebglStatus] = useState<'ok' | 'fallback'>('ok');
  const [temaAtual, setTemaAtual] = useState<TemaShader>(lerTemaDocumento);

  const estadoRef = useRef<EstadoSuperficieIA>(estado);
  const modoFundoRef = useRef<'santuario' | 'conversa'>(modoFundo);
  const analyserPropRef = useRef(analyserRef);
  const energiaPropRef = useRef(energiaRef);
  const pulsoExternoAnteriorRef = useRef(pulsoExternoSeq);
  const dispararPulsoCentroRef = useRef<(() => void) | null>(null);
  const atualizarEstaticoRef = useRef<(() => void) | null>(null);

  estadoRef.current = estado;
  modoFundoRef.current = modoFundo;
  analyserPropRef.current = analyserRef;
  energiaPropRef.current = energiaRef;

  useEffect(() => {
    if (pulsoExternoSeq > pulsoExternoAnteriorRef.current) {
      dispararPulsoCentroRef.current?.();
    }
    pulsoExternoAnteriorRef.current = pulsoExternoSeq;
  }, [pulsoExternoSeq]);

  useEffect(() => {
    atualizarEstaticoRef.current?.();
  }, [estado, modoFundo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch {
      gl = null;
    }

    if (!gl) {
      setWebglStatus('fallback');
      return;
    }

    let program: WebGLProgram | null = null;
    let vao: WebGLVertexArrayObject | null = null;
    try {
      const vs = compilarShader(gl, gl.VERTEX_SHADER, VERT_SRC);
      const fs = compilarShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
      program = gl.createProgram();
      if (!program) throw new Error('Falha ao criar programa WebGL2.');
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program) ?? 'erro desconhecido';
        gl.deleteProgram(program);
        throw new Error(`Falha ao linkar programa WebGL2: ${log}`);
      }
      vao = gl.createVertexArray();
    } catch {
      setWebglStatus('fallback');
      return;
    }

    setWebglStatus('ok');

    const glCtx = gl;
    const prog = program;
    glCtx.bindVertexArray(vao);
    glCtx.useProgram(prog);

    const uniforms = {
      resolution: glCtx.getUniformLocation(prog, 'uResolution'),
      time: glCtx.getUniformLocation(prog, 'uTime'),
      theme: glCtx.getUniformLocation(prog, 'uTheme'),
      modoConversa: glCtx.getUniformLocation(prog, 'uModoConversa'),
      pointer: glCtx.getUniformLocation(prog, 'uPointer'),
      pointerVel: glCtx.getUniformLocation(prog, 'uPointerVel'),
      states: glCtx.getUniformLocation(prog, 'uStates'),
      audio: glCtx.getUniformLocation(prog, 'uAudio'),
      pulses: glCtx.getUniformLocation(prog, 'uPulses[0]'),
    };

    const reducedMotionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;
    let reducedMotion = reducedMotionQuery?.matches ?? prefereMovimentoReduzido();
    let visivelNaTela = true;
    let contextoPerdido = false;
    let rafId: number | null = null;
    let lastFrameMs = 0;
    let elapsedTime = reducedMotion ? 0.0 : 4.2;

    let width = Math.max(1, container.clientWidth || window.innerWidth || 1);
    let height = Math.max(1, container.clientHeight || window.innerHeight || 1);

    let temaAlvo = lerTemaDocumento() === 'light' ? 1.0 : 0.0;
    let temaValor = temaAlvo;

    let conversaValor = modoFundoRef.current === 'conversa' ? 1.0 : 0.0;

    const pesosEstado = {
      x: estadoRef.current === 'ocioso' ? 1 : 0,
      y: estadoRef.current === 'ouvindo' ? 1 : 0,
      z: estadoRef.current === 'processando' ? 1 : 0,
    };

    const ponteiroAlvo = { x: 0, y: 0 };
    const ponteiroPos = { x: 0, y: 0 };
    const ponteiroVel = { x: 0, y: 0 };

    // Buffer circular de 4 pulsos harmônicos (xy = origem, z = idade, w = força)
    const bufferPulsos = new Float32Array(16);
    let cursorPulso = 0;

    let freqData: Uint8Array<ArrayBuffer> | null = null;
    const audio = { level: 0, low: 0, mid: 0, high: 0, simClock: 0 };

    function redimensionar() {
      if (contextoPerdido || !canvas || !container) return;
      const rect = container.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width || window.innerWidth || 1));
      height = Math.max(1, Math.round(rect.height || window.innerHeight || 1));
      // Superfície mineral suave: escala adaptativa preserva nitidez óptica com metade dos fragmentos em telas amplas
      const escalaBase = Math.min(window.devicePixelRatio || 1, 1.25);
      const fatorLargura = width > 720 ? 0.78 : 0.92;
      const dprEfetivo = escalaBase * fatorLargura;
      const targetW = Math.max(1, Math.round(width * dprEfetivo));
      const targetH = Math.max(1, Math.round(height * dprEfetivo));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      glCtx.viewport(0, 0, canvas.width, canvas.height);
      if (reducedMotion || document.hidden || !visivelNaTela) {
        desenharQuadro();
      }
    }

    function emitirPulsoCoordenada(clientX: number, clientY: number, forca = 0.92) {
      if (reducedMotion || !container) return;
      const rect = container.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return;
      }
      const minDim = Math.max(1, Math.min(rect.width, rect.height));
      const px = (clientX - (rect.left + rect.width * 0.5)) / minDim;
      const py = -(clientY - (rect.top + rect.height * 0.5)) / minDim;
      const aspect = rect.width / Math.max(rect.height, 1);
      const fovScale =
        aspect < 0.85
          ? 1.38 + (1.0 - 1.38) * Math.min(1, Math.max(0, (aspect - 0.45) / 0.4))
          : 1.0;

      const base = cursorPulso * 4;
      bufferPulsos[base + 0] = px * fovScale * 1.62;
      bufferPulsos[base + 1] = py * fovScale * 1.62;
      bufferPulsos[base + 2] = 0.0;
      bufferPulsos[base + 3] = forca;
      cursorPulso = (cursorPulso + 1) % 4;
    }

    function emitirPulsoCentro() {
      if (reducedMotion) return;
      const base = cursorPulso * 4;
      bufferPulsos[base + 0] = 0.0;
      bufferPulsos[base + 1] = 0.0;
      bufferPulsos[base + 2] = 0.0;
      bufferPulsos[base + 3] = 0.78;
      cursorPulso = (cursorPulso + 1) % 4;
    }

    dispararPulsoCentroRef.current = emitirPulsoCentro;

    function amostrarAudio(dt: number) {
      let alvoLevel = 0;
      let alvoLow = 0;
      let alvoMid = 0;
      let alvoHigh = 0;

      if (estadoRef.current === 'ouvindo') {
        const analyser = analyserPropRef.current?.current ?? null;
        let temSinalFft = false;

        if (analyser && analyser.frequencyBinCount > 0) {
          if (!freqData || freqData.length !== analyser.frequencyBinCount) {
            freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
          }
          analyser.getByteFrequencyData(freqData);

          const binCount = freqData.length;
          const sampleRate = analyser.context?.sampleRate || 48000;
          const hzPerBin = (sampleRate * 0.5) / binCount;

          const mediaFaixa = (minHz: number, maxHz: number) => {
            const i0 = Math.max(1, Math.floor(minHz / hzPerBin));
            const i1 = Math.min(binCount - 1, Math.ceil(maxHz / hzPerBin));
            let soma = 0;
            let n = 0;
            for (let i = i0; i <= i1; i++) {
              soma += (freqData?.[i] ?? 0) / 255;
              n++;
            }
            return n > 0 ? soma / n : 0;
          };

          const low = Math.max(0, (mediaFaixa(75, 280) - 0.05) * 1.45);
          const mid = Math.max(0, (mediaFaixa(280, 1900) - 0.04) * 1.65);
          const high = Math.max(0, (mediaFaixa(1900, 5600) - 0.04) * 1.85);
          const level = Math.min(1, low * 0.34 + mid * 0.48 + high * 0.26);

          if (level > 0.03) {
            temSinalFft = true;
            alvoLow = low;
            alvoMid = mid;
            alvoHigh = high;
            alvoLevel = level;
          }
        }

        if (!temSinalFft) {
          audio.simClock += dt;
          const energia = energiaPropRef.current?.current ?? 0;
          const sim = amostrarProsodiaSintetica(audio.simClock, energia);
          alvoLevel = sim.level;
          alvoLow = sim.low;
          alvoMid = sim.mid;
          alvoHigh = sim.high;
        }
      }

      const suavizar = (atual: number, alvo: number) => {
        const taxa = alvo > atual ? 12.0 : 5.2;
        return atual + (alvo - atual) * (1 - Math.exp(-taxa * dt));
      };

      audio.level = Math.min(1, suavizar(audio.level, alvoLevel));
      audio.low = Math.min(1, suavizar(audio.low, alvoLow));
      audio.mid = Math.min(1, suavizar(audio.mid, alvoMid));
      audio.high = Math.min(1, suavizar(audio.high, alvoHigh));
    }

    function avancarSimulacao(dt: number) {
      elapsedTime += dt;

      temaValor += (temaAlvo - temaValor) * (1 - Math.exp(-5.4 * dt));

      const conversaAlvo = modoFundoRef.current === 'conversa' ? 1.0 : 0.0;
      conversaValor += (conversaAlvo - conversaValor) * (1 - Math.exp(-4.2 * dt));

      const est = estadoRef.current;
      const tIdle = est === 'ocioso' ? 1 : 0;
      const tListen = est === 'ouvindo' ? 1 : 0;
      const tProc = est === 'processando' ? 1 : 0;
      const kEstado = 1 - Math.exp(-4.6 * dt);
      pesosEstado.x += (tIdle - pesosEstado.x) * kEstado;
      pesosEstado.y += (tListen - pesosEstado.y) * kEstado;
      pesosEstado.z += (tProc - pesosEstado.z) * kEstado;

      // Mola criticamente amortecida de 2ª ordem para paralaxe elástica do ponteiro
      const omega = 6.2;
      const ax = (ponteiroAlvo.x - ponteiroPos.x) * (omega * omega) - 2 * omega * ponteiroVel.x;
      const ay = (ponteiroAlvo.y - ponteiroPos.y) * (omega * omega) - 2 * omega * ponteiroVel.y;
      ponteiroVel.x += ax * dt;
      ponteiroVel.y += ay * dt;
      ponteiroPos.x += ponteiroVel.x * dt;
      ponteiroPos.y += ponteiroVel.y * dt;

      for (let i = 0; i < 4; i++) {
        const base = i * 4;
        if ((bufferPulsos[base + 3] ?? 0) > 0.0) {
          const novaIdade = (bufferPulsos[base + 2] ?? 0) + dt;
          bufferPulsos[base + 2] = novaIdade;
          if (novaIdade > 3.6) {
            bufferPulsos[base + 3] = 0.0;
          }
        }
      }

      amostrarAudio(dt);
    }

    function desenharQuadro() {
      if (contextoPerdido || !canvas) return;
      glCtx.useProgram(prog);
      glCtx.bindVertexArray(vao);
      glCtx.uniform2f(uniforms.resolution, canvas.width, canvas.height);
      glCtx.uniform1f(uniforms.time, elapsedTime);
      glCtx.uniform1f(uniforms.theme, temaValor);
      glCtx.uniform1f(uniforms.modoConversa, conversaValor);
      glCtx.uniform2f(uniforms.pointer, ponteiroPos.x, ponteiroPos.y);
      glCtx.uniform2f(uniforms.pointerVel, ponteiroVel.x, ponteiroVel.y);
      glCtx.uniform3f(uniforms.states, pesosEstado.x, pesosEstado.y, pesosEstado.z);
      glCtx.uniform4f(uniforms.audio, audio.level, audio.low, audio.mid, audio.high);
      glCtx.uniform4fv(uniforms.pulses, bufferPulsos);
      glCtx.drawArrays(glCtx.TRIANGLES, 0, 3);
    }

    function aplicarQuadroEstatico() {
      if (!reducedMotion) return;
      elapsedTime = 0.0;
      temaValor = temaAlvo;
      conversaValor = modoFundoRef.current === 'conversa' ? 1.0 : 0.0;
      const est = estadoRef.current;
      pesosEstado.x = est === 'ocioso' ? 1 : 0;
      pesosEstado.y = est === 'ouvindo' ? 1 : 0;
      pesosEstado.z = est === 'processando' ? 1 : 0;
      ponteiroPos.x = 0;
      ponteiroPos.y = 0;
      ponteiroVel.x = 0;
      ponteiroVel.y = 0;
      bufferPulsos.fill(0);
      if (est === 'ouvindo') {
        audio.level = 0.42;
        audio.low = 0.36;
        audio.mid = 0.48;
        audio.high = 0.3;
      } else {
        audio.level = 0;
        audio.low = 0;
        audio.mid = 0;
        audio.high = 0;
      }
      desenharQuadro();
    }

    atualizarEstaticoRef.current = aplicarQuadroEstatico;

    function loopQuadro(agoraMs: number) {
      rafId = null;
      if (reducedMotion || document.hidden || !visivelNaTela || contextoPerdido) return;
      const dt = lastFrameMs > 0 ? Math.min((agoraMs - lastFrameMs) / 1000, 0.05) : 1 / 60;
      lastFrameMs = agoraMs;
      avancarSimulacao(dt);
      desenharQuadro();
      rafId = window.requestAnimationFrame(loopQuadro);
    }

    function iniciarLoop() {
      if (reducedMotion || document.hidden || !visivelNaTela || contextoPerdido || rafId !== null) {
        return;
      }
      lastFrameMs = 0;
      rafId = window.requestAnimationFrame(loopQuadro);
    }

    function pararLoop() {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    const aoMoverPonteiro = (e: PointerEvent) => {
      if (reducedMotion || e.pointerType === 'touch') return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const minDim = Math.max(1, Math.min(rect.width, rect.height));
      const x = (e.clientX - (rect.left + rect.width * 0.5)) / minDim;
      const y = -(e.clientY - (rect.top + rect.height * 0.5)) / minDim;
      ponteiroAlvo.x = Math.max(-0.85, Math.min(0.85, x));
      ponteiroAlvo.y = Math.max(-0.85, Math.min(0.85, y));
    };

    const aoSairPonteiro = () => {
      ponteiroAlvo.x = 0;
      ponteiroAlvo.y = 0;
    };

    const aoCliqueJanela = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      emitirPulsoCoordenada(e.clientX, e.clientY, 0.88);
    };

    const aoMudarVisibilidade = () => {
      if (document.hidden) {
        pararLoop();
      } else {
        iniciarLoop();
      }
    };

    const aoMudarMovimento = (e: MediaQueryListEvent) => {
      reducedMotion = e.matches;
      if (reducedMotion) {
        pararLoop();
        aplicarQuadroEstatico();
      } else {
        elapsedTime = 4.2;
        iniciarLoop();
      }
    };

    const aoPerderContexto = (e: Event) => {
      e.preventDefault();
      contextoPerdido = true;
      pararLoop();
      setWebglStatus('fallback');
    };

    const aoRestaurarContexto = () => {
      contextoPerdido = false;
      setWebglStatus('ok');
      redimensionar();
      if (reducedMotion) {
        aplicarQuadroEstatico();
      } else {
        iniciarLoop();
      }
    };

    // Sincroniza tema imediatamente com data-tema no <html> para evitar qualquer
    // dessincronia de contraste entre o CSS (troca instantânea) e o fundo WebGL.
    const obsTema = new MutationObserver(() => {
      const novoTema = lerTemaDocumento();
      temaAlvo = novoTema === 'light' ? 1.0 : 0.0;
      temaValor = temaAlvo;
      setTemaAtual(novoTema);
      if (reducedMotion) {
        aplicarQuadroEstatico();
      } else {
        desenharQuadro();
      }
    });
    obsTema.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema'],
    });

    const obsResize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => redimensionar())
        : null;
    obsResize?.observe(container);

    const obsIntersecao =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              const entry = entries[0];
              if (!entry) return;
              visivelNaTela = entry.isIntersecting;
              if (visivelNaTela) {
                iniciarLoop();
              } else {
                pararLoop();
              }
            },
            { threshold: 0.01 },
          )
        : null;
    obsIntersecao?.observe(container);

    window.addEventListener('resize', redimensionar, { passive: true });
    window.addEventListener('pointermove', aoMoverPonteiro, { passive: true });
    document.addEventListener('pointerleave', aoSairPonteiro, { passive: true });
    window.addEventListener('pointerdown', aoCliqueJanela, { passive: true });
    document.addEventListener('visibilitychange', aoMudarVisibilidade);
    reducedMotionQuery?.addEventListener('change', aoMudarMovimento);
    canvas.addEventListener('webglcontextlost', aoPerderContexto);
    canvas.addEventListener('webglcontextrestored', aoRestaurarContexto);

    redimensionar();
    if (reducedMotion) {
      aplicarQuadroEstatico();
    } else {
      desenharQuadro();
      iniciarLoop();
    }

    return () => {
      dispararPulsoCentroRef.current = null;
      atualizarEstaticoRef.current = null;
      pararLoop();
      obsTema.disconnect();
      obsResize?.disconnect();
      obsIntersecao?.disconnect();
      window.removeEventListener('resize', redimensionar);
      window.removeEventListener('pointermove', aoMoverPonteiro);
      document.removeEventListener('pointerleave', aoSairPonteiro);
      window.removeEventListener('pointerdown', aoCliqueJanela);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      reducedMotionQuery?.removeEventListener('change', aoMudarMovimento);
      canvas.removeEventListener('webglcontextlost', aoPerderContexto);
      canvas.removeEventListener('webglcontextrestored', aoRestaurarContexto);
      if (vao) glCtx.deleteVertexArray(vao);
      glCtx.deleteProgram(prog);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={className ? `ia-superficie-mineral ${className}` : 'ia-superficie-mineral'}
      aria-hidden="true"
      data-estado={estado}
      data-modo-fundo={modoFundo}
      data-webgl={webglStatus}
      data-tema-shader={temaAtual}
      data-fallback={webglStatus === 'fallback' ? 'css' : undefined}
    >
      {webglStatus === 'fallback' ? (
        <div
          className="ia-superficie-fallback"
          data-fallback="css"
          data-webgl="fallback"
          data-estado={estado}
          data-tema-shader={temaAtual}
        />
      ) : (
        <canvas
          ref={canvasRef}
          className="ia-superficie-canvas"
          data-webgl="ok"
          data-estado={estado}
          data-tema-shader={temaAtual}
        />
      )}
    </div>
  );
}
