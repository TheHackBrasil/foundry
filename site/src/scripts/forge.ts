// WebGL forge: the brand anvil extruded in 3D, a billet whose heat follows
// the chapter readings, spark streaks, bloom and heat haze.
// Loaded lazily by motion.ts, only when motion is allowed and WebGL exists.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/** Written by motion.ts every frame; read here. All values 0..1. */
export type ForgeInput = {
  heat: number; // target billet temperature
  progress: number; // whole-page scroll
  hero: number; // how far the hero has scrolled out
};

export type Forge = { strike: () => void; dispose: () => void };


const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// Piecewise blackbody-ish ramp; returns HDR so bloom picks up the hot end.
const BLACKBODY = /* glsl */ `
  vec3 blackbody(float h) {
    vec3 c = mix(vec3(0.0), vec3(0.55, 0.025, 0.0), smoothstep(0.04, 0.32, h));
    c = mix(c, vec3(1.0, 0.26, 0.02), smoothstep(0.28, 0.62, h));
    c = mix(c, vec3(1.0, 0.68, 0.22), smoothstep(0.58, 0.92, h));
    c = mix(c, vec3(1.0, 0.94, 0.78), smoothstep(0.92, 1.3, h));
    return c * (0.5 + h * 2.6);
  }
`;

// Brand mark path "M4 6h26l6 5-6 5h-8l4 4-2 6H10l-2-6 4-4H4V6z", y flipped, /4.
function anvilShape() {
  const pts: Array<[number, number]> = [
    [4, 6], [30, 6], [36, 11], [30, 16], [22, 16], [26, 20], [24, 26], [10, 26], [8, 20], [12, 16], [4, 16],
  ];
  const s = new THREE.Shape();
  pts.forEach(([x, y], i) => {
    const v = [(x - 20) / 4, (16 - y) / 4] as const;
    if (i === 0) s.moveTo(v[0], v[1]);
    else s.lineTo(v[0], v[1]);
  });
  s.closePath();
  return s;
}

// Tiny procedural environment so the metal has something to reflect:
// warm forge light low and in front, a cold window high and behind.
function forgeEnvironment(renderer: THREE.WebGLRenderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 16, 8), new THREE.MeshBasicMaterial({ color: 0x050607, side: THREE.BackSide })));
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(18, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.42, 0.1) }));
  warm.position.set(6, -7, 6);
  warm.lookAt(0, 0, 0);
  const cold = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.05, 1.25) }));
  cold.position.set(-8, 12, -8);
  cold.lookAt(0, 0, 0);
  env.add(warm, cold);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.04);
  pmrem.dispose();
  return rt;
}

// Worn iron: speckle, hammer dents and scratches baked once into a canvas.
// Used as roughness and bump so the flat faces stop reading as plastic.
function wornIron() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7a7a7a';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 90 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, r = 3 + Math.random() * 10;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(40,40,40,0.5)');
    grd.addColorStop(1, 'rgba(40,40,40,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.lineWidth = 0.6;
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * 256, y = Math.random() * 256, a = Math.random() * Math.PI, l = 6 + Math.random() * 30;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '200,200,200' : '30,30,30'},0.35)`;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(0.55, 0.55);
  return tex;
}

export function startForge(
  canvas: HTMLCanvasElement,
  input: ForgeInput,
  opts: { strikeZone: HTMLElement; onReady: () => void; onLost: () => void },
): Forge {
  const small = Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, small ? 1.25 : 1.5));
  renderer.setClearColor(0x000000, 1);
  // The finish pass owns tone mapping and sRGB encoding. Left at sRGB, three
  // would also encode the clear colour into the linear target and lift the black.
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const envRT = forgeEnvironment(renderer);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

  /* ---------- anvil ---------- */
  const anvilGeo = new THREE.ExtrudeGeometry(anvilShape(), {
    depth: 2.6, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 3, curveSegments: 4,
  });
  anvilGeo.translate(0, 0, -1.3);
  const wear = wornIron();
  const anvilMat = new THREE.MeshStandardMaterial({
    color: 0x5a6068, metalness: 0.62, roughness: 0.6, roughnessMap: wear, bumpMap: wear, bumpScale: 0.8, envMapIntensity: 1.3,
  });
  const anvil = new THREE.Mesh(anvilGeo, anvilMat);
  scene.add(anvil);

  /* ---------- billet ---------- */
  const billetU = {
    uHeat: { value: 0 },
    uTime: { value: 0 },
    uHot: { value: new THREE.Vector3(0, 99, 0) },
    uHotAmt: { value: 0 },
    uLight: { value: new THREE.Vector3(-0.5, 0.9, 0.4).normalize() },
  };
  const billetMat = new THREE.ShaderMaterial({
    uniforms: billetU,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vLocal; varying vec3 vN; varying vec3 vView;
      void main() {
        vLocal = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHeat, uTime, uHotAmt; uniform vec3 uHot, uLight;
      varying vec3 vWorld; varying vec3 vLocal; varying vec3 vN; varying vec3 vView;
      ${NOISE}
      ${BLACKBODY}
      void main() {
        vec3 N = normalize(vN);
        float scale = fbm(vLocal * vec3(2.4, 5.0, 3.0) + vec3(0.0, 0.0, uTime * 0.12));
        float crack = smoothstep(0.42, 0.58, fbm(vLocal * 7.0 - uTime * 0.05));
        vec3 d = vWorld - uHot;
        float local = uHotAmt * exp(-dot(d, d) / 0.55);
        // Ends cool first, like a real bar out of the fire.
        float ends = 1.0 - smoothstep(1.6, 2.7, abs(vLocal.x));
        float h = uHeat * (0.55 + 0.45 * ends) * (0.7 + 0.6 * scale) + local * (0.75 + 0.5 * scale);
        h *= 0.82 + 0.18 * crack;
        float lambert = max(dot(N, uLight), 0.0);
        float rim = pow(1.0 - max(dot(N, normalize(vView)), 0.0), 3.0);
        vec3 iron = vec3(0.05, 0.052, 0.058) * (0.3 + 0.9 * lambert) + vec3(0.12, 0.16, 0.22) * rim * 0.6;
        iron *= 0.75 + 0.5 * scale;
        vec3 col = mix(iron, vec3(0.0), smoothstep(0.1, 0.4, h)) + blackbody(h);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const billet = new THREE.Mesh(new RoundedBoxGeometry(5.0, 0.62, 1.15, 3, 0.14), billetMat);
  billet.position.set(-0.55, 2.5 + 0.31 + 0.1, 0.1);
  billet.rotation.y = 0.16;
  scene.add(billet);
  // Generous invisible target so the cursor finds the bar easily.
  const hitBox = new THREE.Mesh(new THREE.BoxGeometry(5.8, 2.2, 2.4), new THREE.MeshBasicMaterial({ visible: false }));
  hitBox.position.copy(billet.position);
  hitBox.rotation.copy(billet.rotation);
  scene.add(hitBox);

  /* ---------- lights ---------- */
  const glow = new THREE.PointLight(0xff6a1a, 0, 14, 2);
  glow.position.set(billet.position.x, billet.position.y + 0.9, -0.2);
  const rim = new THREE.DirectionalLight(0x7f9fc0, 2.2);
  rim.position.set(-6, 8, -10);
  const key = new THREE.DirectionalLight(0xaabbd0, 1.5);
  key.position.set(-10, 6, 14);
  const fill = new THREE.HemisphereLight(0x2a3a4c, 0x1a0c04, 0.5);
  scene.add(glow, rim, key, fill);

  /* ---------- floor ---------- */
  const floorU = { uHeat: { value: 0 }, uCenter: { value: new THREE.Vector2(billet.position.x, billet.position.z) } };
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.ShaderMaterial({
      uniforms: floorU,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uHeat; uniform vec2 uCenter; varying vec2 vP;
        ${BLACKBODY}
        void main() {
          vec2 fw = fwidth(vP / 2.0);
          vec2 g = abs(fract(vP / 2.0 - 0.5) - 0.5) / fw;
          // Fade lines out where they get thinner than a pixel, or the far floor turns into a grey sheet.
          float line = (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(0.15, 0.6, max(fw.x, fw.y)));
          float r = length(vP - uCenter);
          float fade = exp(-r * 0.09);
          vec3 col = vec3(0.16, 0.19, 0.22) * line * 0.55 * fade;
          col += blackbody(uHeat * 0.55) * exp(-r * r * 0.05) * 0.22 * uHeat;
          gl_FragColor = vec4(col, max(line * 0.6 * fade, 0.0) + exp(-r * r * 0.05) * uHeat * 0.5);
        }`,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.62;
  scene.add(floor);

  /* ---------- sparks: line streaks, CPU integrated ---------- */
  const MAXS = small ? 260 : 720;
  const sPos = new Float32Array(MAXS * 3);
  const sVel = new Float32Array(MAXS * 3);
  const sLife = new Float32Array(MAXS);
  const sMax = new Float32Array(MAXS).fill(1);
  const sHeat = new Float32Array(MAXS);
  const segPos = new Float32Array(MAXS * 6);
  const segCol = new Float32Array(MAXS * 6);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(segPos, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeo.setAttribute('color', new THREE.BufferAttribute(segCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sparks = new THREE.LineSegments(
    sparkGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  sparks.frustumCulled = false;
  scene.add(sparks);
  let cursor = 0;
  const tmp = new THREE.Vector3();
  const spawn = (at: THREE.Vector3, speed: number, spread: number, heat: number) => {
    const i = cursor;
    cursor = (cursor + 1) % MAXS;
    const a = Math.random() * Math.PI * 2;
    const up = 0.55 + Math.random() * 0.45;
    const s = speed * (0.45 + Math.random() * 0.75);
    sPos.set([at.x, at.y, at.z], i * 3);
    sVel.set([Math.cos(a) * spread * s, up * s, Math.sin(a) * spread * s], i * 3);
    sLife[i] = sMax[i] = 0.5 + Math.random() * 1.1;
    sHeat[i] = heat;
  };
  const onBillet = (out: THREE.Vector3) => {
    out.set((Math.random() - 0.5) * 4.4, 0.32, (Math.random() - 0.5) * 1.0);
    return billet.localToWorld(out);
  };

  /* ---------- ambient embers ---------- */
  const NE = small ? 70 : 180;
  const ePos = new Float32Array(NE * 3);
  const eSeed = new Float32Array(NE);
  for (let i = 0; i < NE; i++) {
    ePos.set([(Math.random() - 0.5) * 44, -3 + Math.random() * 18, -14 + Math.random() * 20], i * 3);
    eSeed[i] = Math.random();
  }
  const emberGeo = new THREE.BufferGeometry();
  emberGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3).setUsage(THREE.DynamicDrawUsage));
  emberGeo.setAttribute('seed', new THREE.BufferAttribute(eSeed, 1));
  const emberU = { uTime: { value: 0 }, uHeat: { value: 0 }, uPx: { value: renderer.getPixelRatio() } };
  const embers = new THREE.Points(
    emberGeo,
    new THREE.ShaderMaterial({
      uniforms: emberU,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float seed; uniform float uTime, uPx; varying float vA;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = (2.0 + seed * 3.5) * uPx * (14.0 / -mv.z);
          vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (1.5 + seed * 3.0) + seed * 40.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uHeat; varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA * (0.25 + 0.75 * uHeat);
          gl_FragColor = vec4(vec3(1.0, 0.42, 0.12) * 1.6, a);
        }`,
    }),
  );
  embers.frustumCulled = false;
  scene.add(embers);

  /* ---------- post ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.82);
  composer.addPass(bloom);
  const finish = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uHot: { value: new THREE.Vector2(0.5, 0.5) },
      uAspect: { value: 1 },
      uFade: { value: 1 },
      uBg: { value: new THREE.Vector3(10 / 255, 12 / 255, 14 / 255) },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uTime, uHeat, uAspect, uFade; uniform vec2 uHot; uniform vec3 uBg;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        vec2 uv = vUv;
        // Heat haze: a column of shimmer rising off the billet.
        vec2 d = (uv - uHot) * vec2(uAspect, 1.0);
        float column = exp(-d.x * d.x * 18.0) * smoothstep(-0.02, 0.06, d.y) * exp(-max(d.y, 0.0) * 2.4);
        float n = noise(vec3(uv.x * 22.0, uv.y * 9.0 - uTime * 1.8, uTime * 0.3));
        uv.x += (n - 0.5) * 0.012 * uHeat * column;
        // Tone map (ACES fit) and encode here: one place owns the display transform.
        vec3 x = texture2D(tDiffuse, uv).rgb * 1.1;
        vec3 col = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
        col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
        vec2 v = vUv - 0.5; v.x *= uAspect;
        col *= mix(1.0, 1.0 - smoothstep(0.25, 1.05, length(v)), 0.75);
        // Scene light is screened over the page colour so the canvas edge never shows.
        col = uBg + col * (1.0 - uBg) * uFade;
        float grain = hash(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5;
        col += grain * 0.035;
        gl_FragColor = vec4(max(col, 0.0), 1.0);
      }`,
  });
  composer.addPass(finish);

  /* ---------- sizing ---------- */
  let W = 1, H = 1;
  const resize = () => {
    W = innerWidth;
    H = innerHeight;
    renderer.setSize(W, H, false);
    composer.setSize(W, H);
    bloom.resolution.set(W / 2, H / 2);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    finish.uniforms.uAspect.value = W / H;
    emberU.uPx.value = renderer.getPixelRatio();
  };
  resize();
  addEventListener('resize', resize);

  /* ---------- pointer heat ---------- */
  const ndc = new THREE.Vector2(9, 9);
  const look = { x: 0, y: 0 };
  let moved = 0;
  const onMove = (e: PointerEvent) => {
    const x = (e.clientX / W) * 2 - 1;
    const y = -(e.clientY / H) * 2 + 1;
    moved += Math.hypot(x - ndc.x, y - ndc.y);
    ndc.set(x, y);
    look.x = x;
    look.y = y;
  };
  addEventListener('pointermove', onMove, { passive: true });
  const ray = new THREE.Raycaster();
  let hotAmt = 0;
  let flash = 0;
  let shake = 0;

  const strike = () => {
    flash = 1;
    shake = 1;
    for (let i = 0; i < (small ? 70 : 160); i++) spawn(onBillet(tmp), 11, 0.75, 1.15);
  };
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('a, button, input, label')) return;
    strike();
  };
  opts.strikeZone.addEventListener('pointerdown', onDown);

  /* ---------- camera path ---------- */
  // [azimuth, elevation, distance] keyed across the page.
  const KEYS: Array<[number, number, number]> = [
    [0.42, 0.2, 31],
    [-0.3, 0.24, 32],
    [-0.9, 0.42, 33],
    [0.2, 0.72, 35],
    [0.7, 0.26, 31],
  ];
  const camAt = (p: number) => {
    const f = Math.min(KEYS.length - 1.0001, Math.max(0, p * (KEYS.length - 1)));
    const i = Math.floor(f);
    const t = f - i;
    const s = t * t * (3 - 2 * t);
    return KEYS[i].map((v, k) => v + (KEYS[i + 1][k] - v) * s) as [number, number, number];
  };
  const cam = camAt(0);
  const target = new THREE.Vector3(0, 2.1, 0);
  const screen = new THREE.Vector3();

  /* ---------- loop ---------- */
  let prev = performance.now();
  let t = 0;
  let heat = 0;
  let raf = 0;
  let ready = false;
  let autoStrike = 0;
  let emitAcc = 0;

  const frame = () => {
    raf = requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - prev) / 1000, 1 / 20);
    prev = now;
    if (document.hidden) return;
    t += dt;
    const k = 1 - Math.exp(-dt * 2.2);

    heat += (input.heat - heat) * k;
    flash *= Math.exp(-dt * 5);
    shake *= Math.exp(-dt * 9);

    // Cursor over the bar raises a local hot spot and throws sparks.
    if (moved > 0) {
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(hitBox)[0];
      if (hit) {
        const local = billet.worldToLocal(hit.point.clone());
        local.set(Math.max(-2.4, Math.min(2.4, local.x)), 0.31, Math.max(-0.5, Math.min(0.5, local.z)));
        billetU.uHot.value.lerp(billet.localToWorld(local), 0.5);
        hotAmt = Math.min(1.25, hotAmt + moved * 1.6);
        const n = Math.min(6, Math.floor(moved * 40));
        for (let i = 0; i < n; i++) spawn(billetU.uHot.value, 6, 0.6, 0.9);
      }
      moved = 0;
    }
    hotAmt *= Math.exp(-dt * 0.7);

    // Forge working: at full heat the hammer falls on its own.
    autoStrike += dt;
    if (input.heat > 0.9 && autoStrike > 2.8) {
      autoStrike = 0;
      flash = Math.max(flash, 0.6);
      for (let i = 0; i < (small ? 40 : 90); i++) spawn(onBillet(tmp), 9, 0.7, 1.05);
    }

    const h = Math.min(1.35, heat + flash * 0.35);
    billetU.uHeat.value = h;
    billetU.uHotAmt.value = hotAmt;
    billetU.uTime.value = t;
    floorU.uHeat.value = Math.min(1, h + hotAmt * 0.3);
    emberU.uTime.value = t;
    emberU.uHeat.value = Math.max(0.25, h);
    glow.intensity = (h * h * 26 + hotAmt * 10) * (1 + flash);
    bloom.strength = 0.28 + h * 0.3 + flash * 0.45;

    // Idle emission scales with heat squared.
    emitAcc += dt * (h * h * 70 + 2);
    while (emitAcc > 1) {
      emitAcc -= 1;
      spawn(onBillet(tmp), 4 + h * 5, 0.5, h);
    }

    // Integrate sparks into line segments (head, tail).
    for (let i = 0; i < MAXS; i++) {
      const o = i * 3, s = i * 6;
      if (sLife[i] <= 0) {
        segCol.fill(0, s, s + 6);
        continue;
      }
      sLife[i] -= dt;
      sVel[o + 1] -= 15 * dt;
      const drag = Math.exp(-dt * 0.9);
      sVel[o] *= drag; sVel[o + 1] *= drag; sVel[o + 2] *= drag;
      sPos[o] += sVel[o] * dt; sPos[o + 1] += sVel[o + 1] * dt; sPos[o + 2] += sVel[o + 2] * dt;
      if (sPos[o + 1] < -2.6) { sPos[o + 1] = -2.6; sVel[o + 1] *= -0.3; sVel[o] *= 0.6; sVel[o + 2] *= 0.6; }
      const life = Math.max(0, sLife[i] / sMax[i]);
      const tail = 0.028 + 0.012 * life;
      segPos[s] = sPos[o]; segPos[s + 1] = sPos[o + 1]; segPos[s + 2] = sPos[o + 2];
      segPos[s + 3] = sPos[o] - sVel[o] * tail; segPos[s + 4] = sPos[o + 1] - sVel[o + 1] * tail; segPos[s + 5] = sPos[o + 2] - sVel[o + 2] * tail;
      const e = life * (0.6 + sHeat[i]) * 3.2;
      segCol[s] = e; segCol[s + 1] = e * (0.28 + 0.4 * life); segCol[s + 2] = e * 0.06 * life;
      segCol[s + 3] = e * 0.4; segCol[s + 4] = e * 0.08; segCol[s + 5] = 0;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.attributes.color.needsUpdate = true;

    for (let i = 0; i < NE; i++) {
      const o = i * 3;
      ePos[o + 1] += dt * (0.25 + eSeed[i] * 0.6);
      ePos[o] += Math.sin(t * 0.5 + eSeed[i] * 20) * dt * 0.15;
      if (ePos[o + 1] > 15) ePos[o + 1] = -3;
    }
    emberGeo.attributes.position.needsUpdate = true;

    // Camera: scroll picks the key, pointer adds a little parallax.
    const want = camAt(input.progress);
    const kc = 1 - Math.exp(-dt * 3);
    for (let i = 0; i < 3; i++) cam[i] += (want[i] - cam[i]) * kc;
    const az = cam[0] + look.x * 0.07;
    const el = cam[1] + look.y * 0.04;
    // Narrow screens see less horizontally; back off so the anvil still fits.
    const dist = cam[2] * Math.max(1, Math.pow(1.1 / (W / H), 0.7));
    camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist + 0.9, Math.cos(az) * Math.cos(el) * dist);
    camera.position.x += (Math.random() - 0.5) * shake * 0.12;
    camera.position.y += (Math.random() - 0.5) * shake * 0.12;
    camera.lookAt(target);

    // Frame the anvil away from the copy: right on wide screens, low on tall ones.
    const wide = W / H > 1.05;
    if (wide) camera.setViewOffset(W, H, -W * (0.32 + 0.02 * input.hero), 0, W, H);
    else camera.setViewOffset(W, H, -W * 0.07, -H * (0.19 + 0.05 * input.hero), W, H);

    screen.copy(billet.position).project(camera);
    finish.uniforms.uHot.value.set(screen.x * 0.5 + 0.5, screen.y * 0.5 + 0.5);
    finish.uniforms.uHeat.value = h;
    finish.uniforms.uTime.value = t;
    // Behind the chapters the scene steps back so copy stays readable.
    const dim = wide ? 0.42 : 0.2;
    finish.uniforms.uFade.value = 1 - (1 - dim) * Math.min(1, Math.max(0, (input.hero - 0.15) / 0.75));

    composer.render(dt);
    if (!ready) {
      ready = true;
      opts.onReady();
    }
  };
  raf = requestAnimationFrame(frame);

  const dispose = () => {
    cancelAnimationFrame(raf);
    removeEventListener('resize', resize);
    removeEventListener('pointermove', onMove);
    opts.strikeZone.removeEventListener('pointerdown', onDown);
    composer.dispose();
    envRT.dispose();
    renderer.dispose();
  };

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    dispose();
    opts.onLost();
  });

  return { strike, dispose };
}
