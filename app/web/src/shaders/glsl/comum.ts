// Triângulo único full-screen: evita 2 triângulos e diagonal interna no rasterizador.
export const VERTICES_TRIANGULO_TELA = new Float32Array([-1, -1, 3, -1, -1, 3]);

export const VERTEX_SHADER_UNIVERSAL = `
attribute vec2 aPos;
varying vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`.trim();

// Prelude GLSL ES 1.00 compatível com WebGL2 e WebGL1.
// Toda a acumulação óptica ocorre em RGB linear e converte para sRGB premultiplicado
// com dither Interleaved Gradient Noise (+/-1.5/255) contra banding mineral.
export const PRELUDIO_FRAGMENTO = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 vUv;

uniform vec2 uRes;
uniform float uTime;
uniform float uEnvelope;
uniform float uResolve;
uniform vec2 uOrigin;
uniform float uDir;
uniform float uMode;
uniform vec2 uGrid;
uniform float uRadius;
uniform float uRms;
uniform float uDark;
uniform float uPointer;
uniform vec3 uColPrimary;
uniform vec3 uColChange;
uniform vec3 uColCord;
uniform vec3 uColSurface;
uniform vec3 uColOk;
uniform vec3 uColError;
uniform float uBands[16];

const float PI = 3.14159265;
const float TAU = 6.28318530;

vec2 uvTopo() {
  return vec2(vUv.x, 1.0 - vUv.y);
}

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec3 _mod289v3(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec2 _mod289v2(vec2 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec3 _permute(vec3 x) {
  return _mod289v3(((x * 34.0) + 1.0) * x);
}

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = _mod289v2(i);
  vec3 p = _permute(
    _permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0)
  );
  vec3 m = max(
    0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)),
    0.0
  );
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm2(vec2 p) {
  float n0 = snoise(p);
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  float n1 = snoise(rot * p * 2.03 + vec2(17.1, 31.7));
  return n0 * 0.667 + n1 * 0.333;
}

// Interleaved Gradient Noise centrado em 0 com amplitude +/-1.5/255.
float ignDither(vec2 fragCoord) {
  float n = fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
  return (n - 0.5) * (3.0 / 255.0);
}

vec3 linearToSrgb(vec3 c) {
  return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
}

// Interpolação linear em uBands[16] com laço de índice constante (compatível WebGL1).
float sampleBand(float t) {
  float idx = clamp(t, 0.0, 1.0) * 15.0;
  float soma = 0.0;
  float peso = 0.0;
  for (int i = 0; i < 16; i++) {
    float w = max(0.0, 1.0 - abs(float(i) - idx));
    soma += uBands[i] * w;
    peso += w;
  }
  return soma / max(peso, 0.0001);
}

vec4 saidaPremult(vec3 corLinear, float alpha, vec2 fragCoord) {
  float a = clamp(alpha, 0.0, 1.0);
  if (a <= 0.0005) {
    return vec4(0.0);
  }
  float d = ignDither(fragCoord);
  vec3 srgb = clamp(linearToSrgb(corLinear) + vec3(d), 0.0, 1.0);
  float aDither = clamp(a + d * 0.35, 0.0, 1.0);
  return vec4(srgb * aDither, aDither);
}
`.trim();

export function montarFragmentShader(corpo: string): string {
  return `${PRELUDIO_FRAGMENTO}\n\n${corpo.trim()}\n`;
}
