// ============================================================
// INTO THE VOID — Milky Way Particle System
// Scattered stars → whirling ring → gravitational collapse
// ============================================================

const canvas = document.getElementById('void');
const gl = canvas.getContext('webgl', { alpha: false, antialias: false });

if (!gl) {
  document.body.innerHTML = '<p style="color:#fff;text-align:center;margin-top:40vh">WebGL not supported</p>';
  throw new Error('WebGL not supported');
}

let W, H, scale;
function resize() {
  scale = Math.min(window.devicePixelRatio || 1, 1.5);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W * scale;
  canvas.height = H * scale;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  gl.viewport(0, 0, canvas.width, canvas.height);
}
window.addEventListener('resize', resize);
resize();

// --- Mouse ---
let mouseNX = 0, mouseNY = 0, mouseActive = false;
let mouseLastMoveTime = 0;
let mouseIdleFade = 1.0;
canvas.addEventListener('mousemove', (e) => {
  mouseNX = (e.clientX / W) * 2 - 1;
  mouseNY = -((e.clientY / H) * 2 - 1);
  mouseActive = true;
  mouseLastMoveTime = performance.now() / 1000;
});
canvas.addEventListener('mouseleave', () => { mouseActive = false; });

// --- Generate particle sprite texture (soft radial glow) ---
function createSpriteTexture() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const half = size / 2;

  const g1 = ctx.createRadialGradient(half, half, 0, half, half, half);
  g1.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  g1.addColorStop(0.05, 'rgba(240, 250, 255, 0.95)');
  g1.addColorStop(0.15, 'rgba(200, 235, 255, 0.6)');
  g1.addColorStop(0.35, 'rgba(120, 200, 255, 0.2)');
  g1.addColorStop(0.6, 'rgba(60, 150, 255, 0.05)');
  g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, size, size);

  const g2 = ctx.createRadialGradient(half, half, 0, half, half, half);
  g2.addColorStop(0, 'rgba(180, 220, 255, 0.4)');
  g2.addColorStop(0.3, 'rgba(100, 180, 255, 0.1)');
  g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, size, size);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texture;
}

// --- Shaders ---
const VERT_SRC = `
attribute vec2 a_scatter;
attribute float a_phase;
attribute float a_speed;
attribute float a_size;
attribute float a_brightness;

uniform float u_time;
uniform float u_gather;
uniform float u_energy;
uniform float u_aspect;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_mouseActive;
uniform float u_collapse;  // 0 = normal, 0→1 = collapsing
uniform vec2 u_shake;

varying float v_alpha;
varying float v_energy;
varying float v_phase;
varying float v_collapse;

void main() {
  float pi2 = 6.283185;
  float e = u_energy;
  v_energy = e;
  v_phase = a_phase;
  v_collapse = u_collapse;

  // --- Breath cycle ---
  float breathPeriod = 5.0 - e * 1.5;
  float breathPhaseRaw = mod(u_time, breathPeriod) / breathPeriod;
  float breath = sin(breathPhaseRaw * pi2 - 0.4) * 0.5 + 0.5;
  float deepBreath = sin(u_time * 0.15) * 0.5 + 0.5;
  float combinedBreath = breath * 0.7 + deepBreath * 0.3;

  // --- Ring orbit ---
  float orbitSpeed = 0.15 + e * 0.12;
  float orbitAngle = a_phase * pi2 + u_time * a_speed * orbitSpeed;

  // --- Ring radius ---
  float breathRadius = combinedBreath * 0.07;
  float energyExpand = e * 0.04;
  float wobbleAmp = 1.0 + e * 1.0;
  float ringR = 0.45 + breathRadius + energyExpand
    + sin(a_phase * pi2 * 3.0 + u_time * 0.4) * 0.03 * wobbleAmp
    + sin(a_phase * pi2 * 7.0 + u_time * 0.7) * 0.015 * wobbleAmp
    + sin(a_phase * pi2 * 13.0 + u_time * 1.1) * 0.008 * wobbleAmp;

  float depthWobble = sin(orbitAngle * 2.0 + u_time * 0.3) * (0.015 + e * 0.015);
  vec2 ringPos = vec2(
    cos(orbitAngle) * ringR,
    sin(orbitAngle) * ringR + depthWobble
  );

  // --- Particle drift ---
  float driftPhase = a_phase * pi2 * 2.3;
  float driftAmt = 0.02 + e * 0.025;
  float driftSpeed = 0.9 + e * 0.6;
  float particleDrift = sin(u_time * driftSpeed + driftPhase) * driftAmt * combinedBreath;
  vec2 driftDir = normalize(ringPos + vec2(0.001));
  ringPos += driftDir * particleDrift;

  // --- Halo ---
  float haloRand = fract(sin(a_phase * 7919.0) * 43758.5453);
  float haloThreshold = 0.7 - e * 0.15;
  if (haloRand > haloThreshold) {
    float haloSpread = (haloRand - haloThreshold) / (1.0 - haloThreshold);
    float haloBreath = 1.0 + combinedBreath * 0.4;
    float energyHalo = 1.0 + e * 1.0;
    float haloSpeed = 0.5 + e * 0.5;
    ringPos += vec2(
      sin(a_phase * 100.0 + u_time * haloSpeed) * haloSpread * 0.12 * haloBreath * energyHalo,
      cos(a_phase * 80.0 + u_time * haloSpeed * 0.8) * haloSpread * 0.12 * haloBreath * energyHalo
    );
  }

  // --- Scattered position (pre-gather) ---
  vec2 sPos = a_scatter;
  float breathPhase = a_phase * pi2 * 3.7;
  sPos.x += sin(u_time * 0.2 + breathPhase) * 0.025;
  sPos.y += cos(u_time * 0.17 + breathPhase * 1.3) * 0.025;
  float twinkle = sin(u_time * 0.5 + a_phase * 200.0);
  sPos *= 1.0 + twinkle * 0.008;

  // --- Blend scattered → ring ---
  float dist = length(a_scatter);
  float stagger = smoothstep(0.0, 1.0, u_gather * 1.5 - dist * 0.3);
  stagger = clamp(stagger, 0.0, 1.0);
  vec2 pos = mix(sPos, ringPos, stagger);

  // ============================================================
  // COLLAPSE: random dissolve — particles vanish into the swirl
  // ============================================================
  if (u_collapse > 0.0) {
    // Each particle gets a random fade-out threshold based on its phase
    float fadeThreshold = fract(sin(a_phase * 7919.0) * 43758.5453);
    // Particles vanish when u_collapse passes their threshold
    if (u_collapse > fadeThreshold) {
      // Push particle off-screen so it's invisible
      pos = vec2(10.0, 10.0);
    }
  }

  // --- Cursor interaction (disabled during collapse) ---
  if (u_mouseActive > 0.5 && u_collapse <= 0.0) {
    vec2 mPos = u_mouse;
    mPos.x *= u_aspect;
    vec2 aPos = pos;
    aPos.x *= u_aspect;
    vec2 diff = mPos - aPos;
    float d = length(diff);
    float attractR = 0.55;
    if (d < attractR && d > 0.001) {
      float force = (1.0 - d / attractR);
      force = force * force * force;
      vec2 pull = normalize(diff) * force * 0.28;
      pos += vec2(pull.x / u_aspect, pull.y);
    }
  }

  // --- Output position ---
  vec2 screenPos = pos;
  screenPos.x /= u_aspect;
  screenPos.y += 0.18;
  screenPos += u_shake;
  gl_Position = vec4(screenPos, 0.0, 1.0);

  // --- Size ---
  float perspective = 0.8 + a_phase * 0.4;
  float pulseSpeed = 1.2 + e * 0.8;
  float pulse = 1.0 + sin(u_time * pulseSpeed + a_phase * 50.0) * (0.08 + e * 0.06);
  float energySize = 1.0 + e * 0.5;
  float baseSize = a_size * perspective * pulse * energySize
    * min(u_resolution.x, u_resolution.y) / 800.0;

  // During collapse: no size change (particles dissolve randomly)
  gl_PointSize = baseSize;

  // --- Alpha ---
  float scatterAlpha = a_brightness * (0.4 + twinkle * 0.3);
  float breathGlow = 0.38 + combinedBreath * 0.14;
  float energyGlow = 1.0 + e * 0.8;
  float ringAlpha = a_brightness * breathGlow * energyGlow;
  v_alpha = mix(scatterAlpha, ringAlpha, stagger);
  v_alpha *= pulse;

  // --- Sparkle ---
  float sparkleSpeed = 0.6 + e * 0.5;
  float sparkleWave = sin(u_time * sparkleSpeed + a_phase * 437.0)
                    * sin(u_time * (0.9 + e * 0.3) + a_phase * 193.0);
  float sparkleThresh = 0.92 - e * 0.07;
  float sparkleFade = smoothstep(sparkleThresh, 1.0, sparkleWave);
  v_alpha += sparkleFade * 1.8;
  gl_PointSize += sparkleFade * 4.0;

  // During collapse: already handled by random dissolve (pos pushed off-screen)
}
`;

const FRAG_SRC = `
precision mediump float;
uniform sampler2D u_sprite;
uniform float u_collapse;
varying float v_alpha;
varying float v_energy;
varying float v_phase;
varying float v_collapse;
void main() {
  vec4 texColor = texture2D(u_sprite, gl_PointCoord);

  vec3 coolCyan = vec3(0.55, 0.85, 1.0);
  vec3 brightCyan = vec3(0.7, 0.92, 1.0);
  vec3 baseTint = mix(coolCyan, brightCyan, v_energy * 0.6);

  vec3 warmGold = vec3(1.0, 0.65, 0.2);
  vec3 hotAmber = vec3(1.0, 0.45, 0.15);
  vec3 warmColor = mix(warmGold, hotAmber, v_energy);

  float emberChance = fract(sin(v_phase * 12345.6789) * 43758.5453);
  float emberThreshold = 1.0 - v_energy * 0.25;
  float isEmber = step(emberThreshold, emberChance) * step(0.15, v_energy);

  vec3 tint = mix(baseTint, warmColor, isEmber);

  // During collapse: nebula colors emerge, then converge to hot white
  if (v_collapse > 0.0) {
    float c = v_collapse;

    // Nebula palette — each particle picks a color based on its phase
    vec3 nebulaPurple = vec3(0.6, 0.2, 0.85);
    vec3 nebulaRose   = vec3(0.9, 0.25, 0.45);
    vec3 nebulaTeal   = vec3(0.15, 0.75, 0.7);
    vec3 nebulaGold   = vec3(1.0, 0.7, 0.15);
    vec3 nebulaViolet = vec3(0.45, 0.15, 0.8);

    // Use phase to assign each particle a nebula color
    float colorPick = fract(v_phase * 5.7 + 0.3);
    vec3 nebulaColor;
    if (colorPick < 0.25) {
      nebulaColor = mix(nebulaPurple, nebulaRose, colorPick / 0.25);
    } else if (colorPick < 0.5) {
      nebulaColor = mix(nebulaRose, nebulaGold, (colorPick - 0.25) / 0.25);
    } else if (colorPick < 0.75) {
      nebulaColor = mix(nebulaTeal, nebulaViolet, (colorPick - 0.5) / 0.25);
    } else {
      nebulaColor = mix(nebulaViolet, nebulaPurple, (colorPick - 0.75) / 0.25);
    }

    // Only some particles shift to nebula (staggered by phase)
    float nebulaChance = fract(sin(v_phase * 9137.0) * 43758.5453);
    float nebulaActive = step(0.4, nebulaChance); // ~60% of particles

    // Phase A (0.0–0.55): nebula colors fade in on select particles
    float nebulaFade = smoothstep(0.05, 0.4, c) * nebulaActive;

    // Phase B (0.55–0.8): nebula colors shift toward hot white
    float whiteShift = smoothstep(0.55, 0.8, c);
    vec3 collapseHot = vec3(1.0, 0.95, 0.9);
    vec3 finalColor = mix(nebulaColor, collapseHot, whiteShift);

    tint = mix(tint, finalColor, nebulaFade * (1.0 - whiteShift * 0.3));

    // All particles converge to white at the very end
    tint = mix(tint, vec3(1.0), smoothstep(0.7, 0.9, c));
  }

  vec3 color = texColor.rgb * tint;
  float a = texColor.a * v_alpha * 1.3;
  gl_FragColor = vec4(color * a, a);
}
`;

// --- Compile ---
function createShader(type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
    return null;
  }
  return s;
}
function createProgram(v, f) {
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error('Program error:', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

const vs = createShader(gl.VERTEX_SHADER, VERT_SRC);
const fs = createShader(gl.FRAGMENT_SHADER, FRAG_SRC);
const program = createProgram(vs, fs);
gl.useProgram(program);

// --- Locations ---
const aScatter = gl.getAttribLocation(program, 'a_scatter');
const aPhase = gl.getAttribLocation(program, 'a_phase');
const aSpeed = gl.getAttribLocation(program, 'a_speed');
const aSize = gl.getAttribLocation(program, 'a_size');
const aBrightness = gl.getAttribLocation(program, 'a_brightness');

const uTime = gl.getUniformLocation(program, 'u_time');
const uGather = gl.getUniformLocation(program, 'u_gather');
const uAspect = gl.getUniformLocation(program, 'u_aspect');
const uResolution = gl.getUniformLocation(program, 'u_resolution');
const uEnergy = gl.getUniformLocation(program, 'u_energy');
const uMouse = gl.getUniformLocation(program, 'u_mouse');
const uMouseActive = gl.getUniformLocation(program, 'u_mouseActive');
const uSprite = gl.getUniformLocation(program, 'u_sprite');
const uCollapse = gl.getUniformLocation(program, 'u_collapse');
const uShake = gl.getUniformLocation(program, 'u_shake');

// --- Energy shake state ---
let shakeX = 0, shakeY = 0;
let shakeIntensity = 0;

// --- Particles ---
const PARTICLE_COUNT = 45000;

const scatter = new Float32Array(PARTICLE_COUNT * 2);
const phase = new Float32Array(PARTICLE_COUNT);
const speed = new Float32Array(PARTICLE_COUNT);
const sizes = new Float32Array(PARTICLE_COUNT);
const brightness = new Float32Array(PARTICLE_COUNT);

for (let i = 0; i < PARTICLE_COUNT; i++) {
  const bandBias = Math.pow(Math.random(), 0.4);

  if (Math.random() < 0.6) {
    scatter[i * 2] = (Math.random() - 0.5) * 3.2;
    scatter[i * 2 + 1] = (Math.random() - 0.5) * 0.8 * bandBias;
    const bx = scatter[i * 2];
    const by = scatter[i * 2 + 1];
    const rot = 0.15;
    scatter[i * 2] = bx * Math.cos(rot) - by * Math.sin(rot);
    scatter[i * 2 + 1] = bx * Math.sin(rot) + by * Math.cos(rot);
  } else {
    scatter[i * 2] = (Math.random() - 0.5) * 3.6;
    scatter[i * 2 + 1] = (Math.random() - 0.5) * 2.4;
  }

  phase[i] = Math.random();
  speed[i] = 0.2 + Math.random() * 0.8;

  const sRoll = Math.random();
  if (sRoll < 0.90) sizes[i] = 0.4 + Math.random() * 1.2;
  else if (sRoll < 0.96) sizes[i] = 1.8 + Math.random() * 3.0;
  else if (sRoll < 0.99) sizes[i] = 3.5 + Math.random() * 5.0;
  else sizes[i] = 6.0 + Math.random() * 10.0;

  const bRoll = Math.random();
  if (bRoll < 0.5) brightness[i] = 0.3 + Math.random() * 0.4;
  else if (bRoll < 0.85) brightness[i] = 0.5 + Math.random() * 0.6;
  else brightness[i] = 0.8 + Math.random() * 0.7;
}

// --- Buffers ---
function makeBuf(data, attrib, size) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(attrib);
  gl.vertexAttribPointer(attrib, size, gl.FLOAT, false, 0, 0);
  return buf;
}
const scatterBuf = makeBuf(scatter, aScatter, 2);
const phaseBuf = makeBuf(phase, aPhase, 1);
const speedBuf = makeBuf(speed, aSpeed, 1);
const sizesBuf = makeBuf(sizes, aSize, 1);
const brightnessBuf = makeBuf(brightness, aBrightness, 1);

// ============================================================
// BLACK HOLE — CPU-driven particle system for collapse stage
// Exact copy of blackhole.html shaders + physics
// ============================================================

// Smoke sprite texture matching blackhole.html exactly
function createBhSprite() {
  const sz = 64, half = sz / 2;
  const c = document.createElement('canvas');
  c.width = c.height = sz;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(half, half, 0, half, half, half);
  g.addColorStop(0,    'rgba(255,255,255,1.0)');
  g.addColorStop(0.06, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.12)');
  g.addColorStop(0.6,  'rgba(255,255,255,0.03)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, sz, sz);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return tex;
}
const bhSpriteTexture = createBhSprite();

// Shaders — exact copy from blackhole.html
const BH_VERT = `
attribute vec2 a_pos;
attribute float a_size;
attribute float a_bright;
attribute float a_colorSeed;
attribute float a_doppler;
uniform float u_aspect;
uniform vec2  u_res;
uniform float u_bloom;
uniform float u_time;
varying float v_alpha;
varying float v_dist;
varying float v_color;
varying float v_doppler;
void main(){
  vec2 p = a_pos;
  p.x /= u_aspect;
  gl_Position = vec4(p, 0.0, 1.0);
  float dist = length(a_pos);
  float basePx = a_size * u_res.y;
  float bloomScale = u_bloom > 0.5 ? 3.0 : 1.0;

  // Pulse — matches ring particle feel
  float pulse = 1.0 + sin(u_time * 1.2 + a_colorSeed * 50.0) * 0.1;
  gl_PointSize = clamp(basePx * bloomScale * pulse, 0.5, 80.0);

  float radialGlow = 0.4 + 0.6 * pow(clamp(1.0 - dist / 1.2, 0.0, 1.0), 0.5);
  float horizonFade = smoothstep(0.0, 0.05, dist);
  float bloomAlpha = u_bloom > 0.5 ? 0.15 : 1.0;
  v_alpha = a_bright * radialGlow * horizonFade * bloomAlpha * 2.4;

  // Sparkle — bright flashes on random particles
  float sparkleWave = sin(u_time * 0.6 + a_colorSeed * 437.0)
                    * sin(u_time * 0.9 + a_colorSeed * 193.0);
  float sparkleFade = smoothstep(0.92, 1.0, sparkleWave);
  v_alpha += sparkleFade * 1.5;
  gl_PointSize += sparkleFade * 3.0;

  v_alpha *= pulse;
  v_dist = dist;
  v_color = a_colorSeed;
  v_doppler = a_doppler;
}
`;

const BH_FRAG = `
precision mediump float;
uniform sampler2D u_sprite;
varying float v_alpha;
varying float v_dist;
varying float v_color;
varying float v_doppler;
void main(){
  float sprite = texture2D(u_sprite, gl_PointCoord).a;
  if (sprite < 0.002) discard;
  vec3 c;
  float s = v_color;
  if      (s < 0.15) c = vec3(0.2, 0.55, 0.75);
  else if (s < 0.30) c = vec3(0.3, 0.7, 0.9);
  else if (s < 0.48) c = vec3(0.45, 0.85, 1.0);
  else if (s < 0.60) c = vec3(0.25, 0.6, 0.85);
  else if (s < 0.72) c = vec3(0.55, 0.85, 1.0);
  else if (s < 0.82) c = vec3(0.8, 0.45, 0.3);
  else if (s < 0.92) c = vec3(0.35, 0.25, 0.6);
  else               c = vec3(1.0, 0.65, 0.2);
  float inner = clamp(1.0 - v_dist / 0.8, 0.0, 1.0);
  c = mix(c, vec3(0.7, 0.9, 1.0), inner * 0.6);

  // Inner edge brightening — particles near event horizon glow white-blue hot
  float edgeProx = smoothstep(0.2, 0.04, v_dist);
  c = mix(c, vec3(0.85, 0.95, 1.0), edgeProx * 0.85);
  float edgeBrightBoost = 1.0 + edgeProx * 5.5;

  // Time dilation redshift — very close particles redden and dim as they "freeze"
  float redshift = smoothstep(0.06, 0.025, v_dist);
  c = mix(c, vec3(0.9, 0.15, 0.02), redshift * 0.85);
  float dilationDim = 1.0 - redshift * 0.6;

  // Doppler beaming — approaching side brighter, receding side dimmer
  float dopplerShift = 1.0 + v_doppler * 0.45;

  float a = sprite * v_alpha * edgeBrightBoost * dopplerShift * dilationDim;
  gl_FragColor = vec4(c * a, a);
}
`;

const bhVs = createShader(gl.VERTEX_SHADER, BH_VERT);
const bhFs = createShader(gl.FRAGMENT_SHADER, BH_FRAG);
const bhProgram = createProgram(bhVs, bhFs);

const bhAPos       = gl.getAttribLocation(bhProgram, 'a_pos');
const bhASize      = gl.getAttribLocation(bhProgram, 'a_size');
const bhABright    = gl.getAttribLocation(bhProgram, 'a_bright');
const bhAColorSeed = gl.getAttribLocation(bhProgram, 'a_colorSeed');
const bhADoppler   = gl.getAttribLocation(bhProgram, 'a_doppler');
const bhUAspect    = gl.getUniformLocation(bhProgram, 'u_aspect');
const bhURes       = gl.getUniformLocation(bhProgram, 'u_res');
const bhUBloom     = gl.getUniformLocation(bhProgram, 'u_bloom');
const bhUSprite    = gl.getUniformLocation(bhProgram, 'u_sprite');
const bhUTime      = gl.getUniformLocation(bhProgram, 'u_time');

// 96k particles to match standalone blackhole.html density
const BH_N = 72000;
const bhPx = new Float32Array(BH_N);
const bhPy = new Float32Array(BH_N);
const bhVx = new Float32Array(BH_N);
const bhVy = new Float32Array(BH_N);
const bhSizesArr      = new Float32Array(BH_N);
const bhBrightsArr    = new Float32Array(BH_N);
const bhColorSeedsArr = new Float32Array(BH_N);
const bhDopplerArr    = new Float32Array(BH_N);
const bhPosBufArr     = new Float32Array(BH_N * 2);

const bhPosGLBuf       = gl.createBuffer();
const bhSizeGLBuf      = gl.createBuffer();
const bhBrightGLBuf    = gl.createBuffer();
const bhColorSeedGLBuf = gl.createBuffer();
const bhDopplerGLBuf   = gl.createBuffer();

let bhInitialized = false;
let bhTime = 0;
let bhStarving = false;
let bhAliveCount = 0;

// Physics constants
const BH_G_CENTER  = 0.22;
const BH_G_MOUSE   = 0.55;
const BH_SWIRL     = 0.65;
const BH_TURB_STR  = 0.06;
const BH_DAMP      = 0.994;
const BH_CONSUME_R = 0.02376;
const BH_ESCAPE_R  = 1.68;

function turbulence(x, y, t) {
  let fx = 0, fy = 0;
  fx += Math.sin(y * 2.0 + t * 0.18) * 0.5;
  fy += Math.cos(x * 2.0 + t * 0.15) * 0.5;
  fx += Math.sin(y * 5.0 + x * 2.0 + t * 0.4) * 0.3;
  fy += Math.cos(x * 5.0 + y * 2.0 + t * 0.35) * 0.3;
  fx += Math.sin(y * 11.0 + x * 5.0 + t * 0.7) * 0.15;
  fy += Math.cos(x * 11.0 + y * 5.0 + t * 0.65) * 0.15;
  fx += Math.sin(y * 20.0 + x * 10.0 + t * 1.0) * 0.08;
  fy += Math.cos(x * 20.0 + y * 10.0 + t * 0.9) * 0.08;
  return [fx, fy];
}

function fract(v) { return v - Math.floor(v); }

function computeRingPos(i, time, energy) {
  const pi2 = 6.283185;
  const e = energy;
  const breathPeriod = Math.max(0.5, 5.0 - e * 1.5);
  const breathPhaseRaw = (time % breathPeriod) / breathPeriod;
  const breath = Math.sin(breathPhaseRaw * pi2 - 0.4) * 0.5 + 0.5;
  const deepBreath = Math.sin(time * 0.15) * 0.5 + 0.5;
  const combinedBreath = breath * 0.7 + deepBreath * 0.3;
  const orbitSpeed = 0.15 + e * 0.12;
  const orbitAngle = phase[i] * pi2 + time * speed[i] * orbitSpeed;
  const breathRadius = combinedBreath * 0.07;
  const energyExpand = e * 0.04;
  const wobbleAmp = 1.0 + e * 1.0;
  const ringR = 0.45 + breathRadius + energyExpand
    + Math.sin(phase[i] * pi2 * 3.0 + time * 0.4) * 0.03 * wobbleAmp
    + Math.sin(phase[i] * pi2 * 7.0 + time * 0.7) * 0.015 * wobbleAmp
    + Math.sin(phase[i] * pi2 * 13.0 + time * 1.1) * 0.008 * wobbleAmp;
  const depthWobble = Math.sin(orbitAngle * 2.0 + time * 0.3) * (0.015 + e * 0.015);
  let rx = Math.cos(orbitAngle) * ringR;
  let ry = Math.sin(orbitAngle) * ringR + depthWobble;
  const driftPhase2 = phase[i] * pi2 * 2.3;
  const driftAmt = 0.02 + e * 0.025;
  const driftSpd = 0.9 + e * 0.6;
  const particleDrift = Math.sin(time * driftSpd + driftPhase2) * driftAmt * combinedBreath;
  const driftLen = Math.sqrt(rx * rx + ry * ry) + 0.001;
  rx += (rx / driftLen) * particleDrift;
  ry += (ry / driftLen) * particleDrift;
  const haloRand = fract(Math.sin(phase[i] * 7919.0) * 43758.5453);
  const haloThreshold = 0.7 - e * 0.15;
  if (haloRand > haloThreshold) {
    const haloSpread = (haloRand - haloThreshold) / (1.0 - haloThreshold);
    const haloBreath = 1.0 + combinedBreath * 0.4;
    const energyHalo = 1.0 + e * 1.0;
    const haloSpd = 0.5 + e * 0.5;
    rx += Math.sin(phase[i] * 100.0 + time * haloSpd) * haloSpread * 0.12 * haloBreath * energyHalo;
    ry += Math.cos(phase[i] * 80.0 + time * haloSpd * 0.8) * haloSpread * 0.12 * haloBreath * energyHalo;
  }
  return [rx, ry];
}

function spawnBhParticle(i, initial) {
  const angle = Math.random() * Math.PI * 2;
  const minR = initial ? 0.08 : 0.65;
  const spread = 0.52 + (Math.random() - 0.5) * 0.35;
  const r = minR + Math.random() * Math.random() * spread;
  const squash = 0.665 + (Math.random() - 0.5) * 0.15;
  bhPx[i] = Math.cos(angle) * r;
  bhPy[i] = Math.sin(angle) * r * squash;
  const ts2 = 0.015 + Math.random() * 0.025;
  bhVx[i] = -Math.sin(angle) * ts2 + (Math.random() - 0.5) * 0.005;
  bhVy[i] = Math.cos(angle) * ts2 + (Math.random() - 0.5) * 0.005;
}

function initBlackHole(time, energy) {
  // First 60k particles: start at their ring positions
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const [rx, ry] = computeRingPos(i, time, energy);
    bhPx[i] = rx;
    bhPy[i] = ry;
    const dist = Math.sqrt(rx * rx + ry * ry) + 0.001;
    const nx = rx / dist, ny = ry / dist;
    const tangSpeed = 0.015 + Math.random() * 0.025;
    bhVx[i] = -ny * tangSpeed + (Math.random() - 0.5) * 0.005;
    bhVy[i] = nx * tangSpeed + (Math.random() - 0.5) * 0.005;
  }
  // Extra 36k particles: spawn at outer edges (filling to 96k)
  for (let i = PARTICLE_COUNT; i < BH_N; i++) {
    spawnBhParticle(i, true);
  }
  // Sizes and colors for all 96k — matching blackhole.html distribution
  for (let i = 0; i < BH_N; i++) {
    const isLarge = Math.random() < 0.08;
    bhSizesArr[i] = isLarge ? 0.012 + Math.random() * 0.02 : 0.003 + Math.random() * 0.006;
    bhBrightsArr[i] = isLarge ? 0.5 + Math.random() * 0.5 : 0.3 + Math.random() * 0.5;
    const r = Math.random();
    bhColorSeedsArr[i] = r < 0.55 ? Math.random() * 0.58 : Math.random();
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, bhSizeGLBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bhSizesArr, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhBrightGLBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bhBrightsArr, gl.STATIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhColorSeedGLBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bhColorSeedsArr, gl.STATIC_DRAW);
  bhDopplerArr.fill(0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhDopplerGLBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bhDopplerArr, gl.DYNAMIC_DRAW);
  for (let i = 0; i < BH_N; i++) {
    bhPosBufArr[i * 2] = bhPx[i];
    bhPosBufArr[i * 2 + 1] = bhPy[i];
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, bhPosGLBuf);
  gl.bufferData(gl.ARRAY_BUFFER, bhPosBufArr, gl.DYNAMIC_DRAW);
  bhInitialized = true;
  bhTime = 0;
}

let ghostX = 0, ghostY = 0, ghostStrength = 0;
let ghostNextTime = 10 + Math.random() * 4;
const GHOST_DURATION = 3.5;
const GHOST_G = 0.7;

function updateBlackHole(dt) {
  const cappedDt = Math.min(dt, 0.033);
  bhTime += cappedDt;
  const aspect = W / H;
  const idleTime = performance.now() / 1000 - mouseLastMoveTime;
  if (idleTime > 4.0) {
    mouseIdleFade = Math.max(0, mouseIdleFade - cappedDt * 0.5);
  } else {
    mouseIdleFade = Math.min(1, mouseIdleFade + cappedDt * 2.0);
  }

  const starvGravMul = bhStarving ? 4.0 : 1.0;
  const starvConsume = bhStarving ? BH_CONSUME_R * 3.0 : BH_CONSUME_R;
  const starvDamp = bhStarving ? 0.988 : BH_DAMP;
  const gCenter = BH_G_CENTER * starvGravMul;

  if (bhTime > ghostNextTime && ghostStrength === 0) {
    const angle = Math.random() * Math.PI * 2;
    const r = 0.3 + Math.random() * 0.5;
    ghostX = Math.cos(angle) * r;
    ghostY = Math.sin(angle) * r * 0.5;
    ghostStrength = 1.0;
    ghostNextTime = bhTime + 10 + Math.random() * 4;
  }
  if (ghostStrength > 0) {
    ghostStrength -= cappedDt / GHOST_DURATION;
    if (ghostStrength < 0) ghostStrength = 0;
  }
  const ghostFade = ghostStrength * Math.sin(ghostStrength * Math.PI);

  for (let i = 0; i < BH_N; i++) {
    const x = bhPx[i], y = bhPy[i];
    const dx = -x, dy = -y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.0001;
    const nx = dx / dist, ny = dy / dist;
    const gF = gCenter / (dist * dist + 0.08);
    const tngX = -ny, tngY = nx;
    const sF = gF * BH_SWIRL;
    const [tx, ty] = turbulence(x * 2.0, y * 2.0, bhTime);
    let fx = nx * gF + tngX * sF + tx * BH_TURB_STR;
    let fy = ny * gF + tngY * sF + ty * BH_TURB_STR;
    fy -= y * 0.08;
    if (mouseActive) {
      const mxA = mouseNX * aspect;
      const mdx = mxA - x;
      const mdy = mouseNY - y;
      const mDist = Math.sqrt(mdx * mdx + mdy * mdy) + 0.001;
      if (mDist < 0.55) {
        const closeness = 1.0 - mDist / 0.55;
        const mF = BH_G_MOUSE * mouseIdleFade * closeness * closeness / (mDist + 0.03);
        fx += (mdx / mDist) * mF;
        fy += (mdy / mDist) * mF;
      }
    }
    if (ghostFade > 0) {
      const gdx = ghostX - x;
      const gdy = ghostY - y;
      const gDist = Math.sqrt(gdx * gdx + gdy * gdy) + 0.001;
      if (gDist < 0.55) {
        const closeness = 1.0 - gDist / 0.55;
        const gF2 = GHOST_G * ghostFade * closeness * closeness / (gDist + 0.03);
        fx += (gdx / gDist) * gF2;
        fy += (gdy / gDist) * gF2;
      }
    }
    const dilation = dist < 0.06 ? 1.0 - (1.0 - dist / 0.06) * 0.7 : 1.0;
    bhVx[i] = (bhVx[i] + fx * cappedDt) * starvDamp * dilation;
    bhVy[i] = (bhVy[i] + fy * cappedDt) * starvDamp * dilation;
    bhPx[i] += bhVx[i] * cappedDt;
    bhPy[i] += bhVy[i] * cappedDt;
    const ovalDist = Math.sqrt(x * x + (y / 0.665) * (y / 0.665));
    if (dist < starvConsume || ovalDist > BH_ESCAPE_R) {
      if (bhStarving) {
        bhPx[i] = 99; bhPy[i] = 99;
        bhVx[i] = 0; bhVy[i] = 0;
      } else {
        spawnBhParticle(i, false);
      }
    }
  }
  let aliveCount = 0;
  for (let i = 0; i < BH_N; i++) {
    bhPosBufArr[i * 2] = bhPx[i];
    bhPosBufArr[i * 2 + 1] = bhPy[i];
    const x = bhPx[i], y = bhPy[i];
    const dist = Math.sqrt(x * x + y * y) + 0.0001;
    const tangential = (x * bhVy[i] - y * bhVx[i]) / dist;
    bhDopplerArr[i] = Math.max(-1, Math.min(1, tangential * 25.0));
    if (x < 50) aliveCount++;
  }
  bhAliveCount = aliveCount;

  if (bhStarving && !closingShown && !closingScheduled) {
    closingScheduled = true;
    setTimeout(() => {
      showClosingLine();
      setTimeout(() => {
        hideClosingLine();
        breathGlowEl.classList.add('active');
        setTimeout(() => {
          breathGlowEl.classList.remove('active');
          showRestartModal();
        }, 1000);
      }, 10000);
    }, 4000);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, bhPosGLBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, bhPosBufArr);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhDopplerGLBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, bhDopplerArr);
}

function setupBhAttribs() {
  for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhPosGLBuf);
  gl.enableVertexAttribArray(bhAPos);
  gl.vertexAttribPointer(bhAPos, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhSizeGLBuf);
  gl.enableVertexAttribArray(bhASize);
  gl.vertexAttribPointer(bhASize, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhBrightGLBuf);
  gl.enableVertexAttribArray(bhABright);
  gl.vertexAttribPointer(bhABright, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhColorSeedGLBuf);
  gl.enableVertexAttribArray(bhAColorSeed);
  gl.vertexAttribPointer(bhAColorSeed, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bhDopplerGLBuf);
  gl.enableVertexAttribArray(bhADoppler);
  gl.vertexAttribPointer(bhADoppler, 1, gl.FLOAT, false, 0, 0);
}

function setupRingAttribs() {
  for (let i = 0; i < 8; i++) gl.disableVertexAttribArray(i);
  gl.bindBuffer(gl.ARRAY_BUFFER, scatterBuf);
  gl.enableVertexAttribArray(aScatter);
  gl.vertexAttribPointer(aScatter, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, phaseBuf);
  gl.enableVertexAttribArray(aPhase);
  gl.vertexAttribPointer(aPhase, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, speedBuf);
  gl.enableVertexAttribArray(aSpeed);
  gl.vertexAttribPointer(aSpeed, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, sizesBuf);
  gl.enableVertexAttribArray(aSize);
  gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, brightnessBuf);
  gl.enableVertexAttribArray(aBrightness);
  gl.vertexAttribPointer(aBrightness, 1, gl.FLOAT, false, 0, 0);
}

// Background stars — matching blackhole.html
const BH_STARS = 300;
const bhStarData = [];
for (let i = 0; i < BH_STARS; i++) {
  bhStarData.push({
    x: Math.random(), y: Math.random(),
    r: 0.3 + Math.random() * 0.8,
    a: 0.15 + Math.random() * 0.4,
    tw: 0.3 + Math.random() * 1.5
  });
}

function renderBlackHole() {
  gl.useProgram(bhProgram);
  setupBhAttribs();
  gl.uniform1f(bhUAspect, W / H);
  gl.uniform2f(bhURes, canvas.width, canvas.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, bhSpriteTexture);
  gl.uniform1i(bhUSprite, 0);
  gl.uniform1f(bhUTime, bhTime);
  // Pass 1: glow
  gl.uniform1f(bhUBloom, 1.0);
  gl.drawArrays(gl.POINTS, 0, BH_N);
  // Pass 2: core
  gl.uniform1f(bhUBloom, 0.0);
  gl.drawArrays(gl.POINTS, 0, BH_N);
}

// --- Sprite texture ---
const spriteTexture = createSpriteTexture();

// --- GL state ---
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
gl.clearColor(0.051, 0.051, 0.071, 1.0);

// --- Gather timing ---
const SCATTER_WAIT = 6.5;
const GATHER_TIME = 5.0;

function getGather(t) {
  if (t < SCATTER_WAIT) return 0;
  const p = (t - SCATTER_WAIT) / GATHER_TIME;
  const c = Math.min(1, p);
  return c * c * (3 - 2 * c);
}

// --- Landing fade ---
const landingEl = document.getElementById('landing');

// --- Closing lines (rotate after each collapse) ---
const closingLines = [
  "The void holds it now. You don't have to.",
  "Breathe. It's gone.",
  "The universe has already forgotten. So can you.",
  "It no longer belongs to you.",
  "Somewhere in the dark, it dissolved.",
  "That took courage.",
  "The stars don't judge. Neither should you.",
  "You carried that long enough.",
  "It fell into the silence. Let it stay there.",
  "Nothing is heavier than what you refuse to release.",
  "You just made space for something better.",
  "The dark took it gently. You can be gentle too.",
  "Exhale. It's not yours anymore.",
];
let lastClosingIndex = -1;
const closingLineEl = document.getElementById('closingLine');
const breathGlowEl = document.getElementById('breathGlow');
let closingShown = false;
let closingScheduled = false;

function showClosingLine() {
  if (closingShown) return;
  closingShown = true;
  let index;
  do { index = Math.floor(Math.random() * closingLines.length); } while (index === lastClosingIndex);
  lastClosingIndex = index;
  closingLineEl.textContent = closingLines[index];
  // Fade in
  requestAnimationFrame(() => {
    closingLineEl.classList.add('visible');
  });
}

function hideClosingLine() {
  closingLineEl.classList.remove('visible');
  closingLineEl.classList.add('fading');
  closingShown = false;
  setTimeout(() => {
    closingLineEl.classList.remove('fading');
    closingLineEl.textContent = '';
  }, 2200);
}



// ============================================================
// THE COLLAPSE — Gravitational event
// ============================================================
const COLLAPSE_DURATION = 45;

// Overlay canvas for post-particle effects (white light, ember, smoke)
const collapseOverlay = document.createElement('canvas');
collapseOverlay.style.cssText = 'position:fixed;top:0;left:0;z-index:30;pointer-events:none;opacity:0;transition:opacity 0.5s;';
document.body.appendChild(collapseOverlay);
const cCtx = collapseOverlay.getContext('2d');

function initCollapseCanvas() {
  collapseOverlay.width = W * scale;
  collapseOverlay.height = H * scale;
  collapseOverlay.style.width = W + 'px';
  collapseOverlay.style.height = H + 'px';
  cCtx.setTransform(scale, 0, 0, scale, 0, 0);
}
initCollapseCanvas();
window.addEventListener('resize', initCollapseCanvas);

let collapsing = false;
let collapseStart = 0;
let collapseProgress = 0;

// --- Text dissolution system ---
// Each letter becomes a span; at random times during collapse,
// a letter "dissolves" — it goes invisible and spawns particles
// --- Text slow erosion — "Letting go is gradual" ---
let erosionPixels = null;
let erosionW = 0, erosionH = 0;
let erosionOffX = 0, erosionOffY = 0;
let erosionActive = false;
let erosionTime = 0;
let erosionDriftParticles = [];
let erosionCanvas = null;
let erosionCtx = null;
let erosionTotalAlive = 0;
let erosionInitialCount = 0;
let erosionBurstDone = false;
let erosionBurstTime = 0;

const EROSION_DURATION = 37;
const EROSION_DELAY = 8.0;
const EROSION_SCALE = 1.8;

function prepareTextDissolve() {
  const text = ringTextEl.textContent || '';
  if (!text.trim()) { erosionActive = false; return; }

  const el = ringTextEl;

  el.style.transform = `translate(-50%, -50%) scale(${EROSION_SCALE})`;

  requestAnimationFrame(() => {
    const pad = 14;
    // Cap the wrapping width to the viewport so long messages never
    // draw past the screen edges, regardless of the EROSION_SCALE zoom.
    const safeMaxWidth = Math.min(window.innerWidth * 0.86, 760);
    const maxWidth = safeMaxWidth - pad * 2;

    if (!erosionCanvas) {
      erosionCanvas = document.createElement('canvas');
      erosionCtx = erosionCanvas.getContext('2d');
    }
    const ctx = erosionCtx;

    const style = getComputedStyle(el);
    const fontSize = parseFloat(style.fontSize) * EROSION_SCALE;
    ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const lineH = fontSize * 1.6;

    function wrapWord(word) {
      const chunks = [];
      let cur = '';
      for (const ch of word) {
        const test = cur + ch;
        if (ctx.measureText(test).width > maxWidth && cur) {
          chunks.push(cur);
          cur = ch;
        } else {
          cur = test;
        }
      }
      if (cur) chunks.push(cur);
      return chunks;
    }

    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = '';
    for (const word of words) {
      if (ctx.measureText(word).width > maxWidth) {
        if (currentLine) { lines.push(currentLine); currentLine = ''; }
        lines.push(...wrapWord(word));
        continue;
      }
      const testLine = currentLine ? currentLine + ' ' + word : word;
      if (ctx.measureText(testLine).width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);

    const w = Math.ceil(safeMaxWidth);
    const h = Math.ceil(lines.length * lineH) + pad * 2;
    erosionCanvas.width = w;
    erosionCanvas.height = h;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const totalTextH = lines.length * lineH;
    const startY = (h - totalTextH) / 2 + lineH / 2;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], w / 2, startY + i * lineH);
    }

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    erosionW = w;
    erosionH = h;
    erosionOffX = W / 2 - w / 2;
    erosionOffY = H / 2 - h / 2;
    erosionPixels = new Uint8Array(w * h);
    erosionTotalAlive = 0;

    for (let i = 0; i < w * h; i++) {
      if (data[i * 4 + 3] > 40) {
        erosionPixels[i] = 1;
        erosionTotalAlive++;
      }
    }
    erosionInitialCount = erosionTotalAlive;

    erosionDriftParticles = [];
    erosionTime = 0;
    erosionActive = true;

    el.style.opacity = '0';
  });
}

function isEdgePixel(idx) {
  const x = idx % erosionW;
  const y = (idx - x) / erosionW;
  if (x <= 0 || x >= erosionW - 1 || y <= 0 || y >= erosionH - 1) return true;
  if (!erosionPixels[idx - 1]) return true;
  if (!erosionPixels[idx + 1]) return true;
  if (!erosionPixels[idx - erosionW]) return true;
  if (!erosionPixels[idx + erosionW]) return true;
  return false;
}

function updateTextErosion(dt) {
  if (!erosionActive) return;

  erosionTime += dt;
  if (erosionTime < EROSION_DELAY) return;

  const cx = W / 2, cy = H / 2;
  erosionOffX = cx - erosionW / 2;
  erosionOffY = cy - erosionH / 2;

  const elapsed = erosionTime - EROSION_DELAY;
  const progress = Math.min(1, elapsed / EROSION_DURATION);
  const rampRate = 0.5 + progress * 3.0;
  const erodeCount = Math.ceil(erosionTotalAlive * rampRate * dt * 0.06);

  let eroded = 0;
  const tries = erodeCount * 8;

  for (let t = 0; t < tries && eroded < erodeCount && erosionTotalAlive > 0; t++) {
    const idx = Math.floor(Math.random() * erosionW * erosionH);
    if (!erosionPixels[idx]) continue;
    if (!isEdgePixel(idx)) continue;

    erosionPixels[idx] = 0;
    erosionTotalAlive--;
    eroded++;

    const px = idx % erosionW;
    const py = (idx - px) / erosionW;
    const screenX = erosionOffX + px;
    const screenY = erosionOffY + py;

    if (Math.random() < 0.35) {
      const edgeAngle = Math.random() * Math.PI * 2;
      const edgeR = 120 + Math.random() * 180;
      const targetX = cx + Math.cos(edgeAngle) * edgeR;
      const targetY = cy + Math.sin(edgeAngle) * edgeR * 0.6;

      const angle = Math.atan2(targetY - screenY, targetX - screenX) + (Math.random() - 0.5) * 0.6;
      const spd = 0.3 + Math.random() * 0.8;
      const glowing = Math.random() < 0.25;
      const colorType = Math.floor(Math.random() * 4);
      erosionDriftParticles.push({
        x: screenX,
        y: screenY,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: glowing ? 1.5 + Math.random() * 2.5 : 0.8 + Math.random() * 1.5,
        alpha: glowing ? 0.6 + Math.random() * 0.3 : 0.3 + Math.random() * 0.4,
        life: 0,
        phase: 'drift',
        driftTime: 1.5 + Math.random() * 2.0,
        glowing: glowing,
        colorType: colorType,
      });
    }
  }

  if (erosionTime >= 40 && erosionTotalAlive > 0 && !erosionBurstDone) {
    erosionTotalAlive = 0;
    erosionPixels.fill(0);
    erosionBurstDone = true;
    erosionBurstTime = 0;

    const burstCount = 250;
    for (let j = 0; j < burstCount; j++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 0.3 + Math.random() * 3.0;
      const colorType = Math.floor(Math.random() * 4);
      const isFine = Math.random() < 0.65;
      erosionDriftParticles.push({
        x: cx + (Math.random() - 0.5) * 60,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        size: isFine ? 0.4 + Math.random() * 1.0 : 1.8 + Math.random() * 3.0,
        alpha: isFine ? 0.2 + Math.random() * 0.35 : 0.6 + Math.random() * 0.3,
        life: 0,
        phase: 'drift',
        driftTime: 1.2 + Math.random() * 1.8,
        glowing: !isFine,
        colorType: colorType,
      });
    }
  }

  if (erosionBurstDone) {
    erosionBurstTime += dt;
    if (erosionBurstTime >= 4.0 && !bhStarving) {
      bhStarving = true;
    }
  }

  if (erosionTotalAlive <= 0 && !erosionBurstDone) {
    erosionActive = false;
  }
}

function renderTextErosion(dt) {
  if (!erosionActive && !erosionDriftParticles.length) return;
  if (!erosionPixels) return;

  const cx = W / 2, cy = H / 2;
  erosionOffX = cx - erosionW / 2;
  erosionOffY = cy - erosionH / 2;

  // 1. Render surviving text pixels FIRST
  if (erosionTotalAlive > 0) {
    erosionCtx.clearRect(0, 0, erosionW, erosionH);
    const imgData = erosionCtx.createImageData(erosionW, erosionH);
    const data = imgData.data;

    for (let i = 0; i < erosionW * erosionH; i++) {
      if (erosionPixels[i]) {
        data[i * 4] = 255;
        data[i * 4 + 1] = 255;
        data[i * 4 + 2] = 255;
        data[i * 4 + 3] = 220;
      }
    }
    erosionCtx.putImageData(imgData, 0, 0);

    const erosionElapsed = Math.max(0, erosionTime - EROSION_DELAY);
    const shrinkDelay = 8.0;
    if (erosionElapsed > shrinkDelay) {
      const shrinkRaw = (erosionElapsed - shrinkDelay) / (EROSION_DURATION - shrinkDelay);
      const shrinkProgress = Math.min(1, shrinkRaw * shrinkRaw);
      const shrinkScale = 1.0 - shrinkProgress * 0.8;
      const drawW = erosionW * shrinkScale;
      const drawH = erosionH * shrinkScale;
      const drawX = erosionOffX + (erosionW - drawW) / 2;
      const drawY = erosionOffY + (erosionH - drawH) / 2;
      cCtx.drawImage(erosionCanvas, drawX, drawY, drawW, drawH);
    } else {
      cCtx.drawImage(erosionCanvas, erosionOffX, erosionOffY);
    }
  }

  // 2. Render bright nebula burst spot
  if (erosionBurstDone && erosionBurstTime < 2.0) {
    const burstAlpha = erosionBurstTime < 0.3
      ? erosionBurstTime / 0.3
      : Math.max(0, 1 - (erosionBurstTime - 0.3) / 1.7);
    const burstR = 15 + erosionBurstTime * 25;
    const grd = cCtx.createRadialGradient(cx, cy, 0, cx, cy, burstR);
    grd.addColorStop(0, `rgba(200, 230, 255, ${burstAlpha * 0.9})`);
    grd.addColorStop(0.3, `rgba(100, 200, 240, ${burstAlpha * 0.5})`);
    grd.addColorStop(0.6, `rgba(180, 140, 220, ${burstAlpha * 0.25})`);
    grd.addColorStop(1, `rgba(200, 100, 60, 0)`);
    cCtx.fillStyle = grd;
    cCtx.beginPath();
    cCtx.arc(cx, cy, burstR, 0, Math.PI * 2);
    cCtx.fill();
  }

  // 3. Render drift particles ON TOP of text
  let alive = 0;
  for (let i = erosionDriftParticles.length - 1; i >= 0; i--) {
    const p = erosionDriftParticles[i];
    p.life += dt;
    if (p.life > 6.0) continue;
    alive++;

    if (p.phase === 'drift' && p.life > p.driftTime) {
      p.phase = 'pull';
    }

    if (p.phase === 'pull') {
      const dx = cx - p.x;
      const dy = cy - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const pullAge = p.life - p.driftTime;
      const pull = 0.08 + pullAge * 0.12;
      p.vx += (dx / dist) * pull;
      p.vy += (dy / dist) * pull;
    }

    p.vx *= 0.985;
    p.vy *= 0.985;
    p.x += p.vx;
    p.y += p.vy;

    const dx = cx - p.x;
    const dy = cy - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const fadeByDist = Math.min(1, dist / 30);
    const fadeByLife = Math.max(0, 1 - p.life / 6.0);
    const alpha = p.alpha * fadeByDist * fadeByLife;
    if (alpha < 0.01) continue;

    let r, g, b;
    const warmth = Math.max(0, 1 - dist / 150);
    if (p.colorType === 0) {
      r = 160 + warmth * 95; g = 210 + warmth * 45; b = 230 + warmth * 25;
    } else if (p.colorType === 1) {
      r = 100 + warmth * 155; g = 200 + warmth * 55; b = 240 + warmth * 15;
    } else if (p.colorType === 2) {
      r = 200 + warmth * 55; g = 170 + warmth * 60; b = 130 + warmth * 80;
    } else {
      r = 180 + warmth * 75; g = 140 + warmth * 80; b = 220 + warmth * 35;
    }

    cCtx.globalAlpha = alpha;
    if (p.glowing) {
      const glowR = p.size * 3;
      const grd = cCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      grd.addColorStop(0, `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, ${alpha})`);
      grd.addColorStop(0.4, `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, ${alpha * 0.3})`);
      grd.addColorStop(1, `rgba(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)}, 0)`);
      cCtx.fillStyle = grd;
      cCtx.beginPath();
      cCtx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      cCtx.fill();
    }
    cCtx.fillStyle = `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
    cCtx.beginPath();
    cCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    cCtx.fill();
  }
  cCtx.globalAlpha = 1;

  if (alive === 0 && erosionDriftParticles.length > 0) {
    erosionDriftParticles = [];
  }
}


function renderCollapseOverlay(t, dt) {
  if (!collapsing) return;

  const elapsed = t - collapseStart;
  const p = Math.min(1, elapsed / COLLAPSE_DURATION);
  collapseProgress = p;

  cCtx.clearRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H / 2;

  // Background stars — brighten during collapse
  if (bhInitialized) {
    const starBright = Math.min(1, bhTime / 3.0);
    for (const s of bhStarData) {
      const twinkle = 0.5 + 0.5 * Math.sin(bhTime * s.tw + s.x * 80);
      const alpha = s.a * twinkle * (0.3 + starBright * 0.7);
      cCtx.fillStyle = `rgba(180,190,220,${alpha})`;
      cCtx.beginPath();
      cCtx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      cCtx.fill();
    }
  }

  updateTextErosion(dt);
  renderTextErosion(dt);
}


// --- Restart: fade back to ring ---
let restartPending = false;

function restartToRing() {
  // Fade out overlay
  collapseOverlay.style.transition = 'opacity 2s';
  collapseOverlay.style.opacity = '0';

  // Reset collapse state
  collapsing = false;
  collapseStart = 0;
  collapseProgress = 0;
  erosionPixels = null;
  erosionActive = false;
  erosionTime = 0;
  erosionDriftParticles = [];
  erosionTotalAlive = 0;
  erosionBurstDone = false;
  erosionBurstTime = 0;
  restartPending = false;
  bhInitialized = false;
  bhTime = 0;
  bhStarving = false;
  bhAliveCount = 0;
  closingScheduled = false;
  closingShown = false;

  // Reset ring text transform
  ringTextEl.style.transform = 'translate(-50%, -50%)';
  ringTextEl.style.opacity = '';
  ringTextEl.style.transition = '';

  // Reset energy/UI and audio state
  if (window.VoidEnergy) window.VoidEnergy.reset();
  if (window.VoidAudio) window.VoidAudio.reset();

  uiRevealed = false;

  // Reset animation timeline so scatter → ring replays
  t0 = 0;
  lastTs = 0;
  landingFadedIn = false;
  landingEl.classList.remove('visible', 'fading');

  // After overlay fades, clean up and show UI fresh
  setTimeout(() => {
    collapseOverlay.style.transition = '';
    cCtx.clearRect(0, 0, W, H);
  }, 2200);
}


// --- Restart modal ---
const restartOverlay = document.getElementById('restartOverlay');
const againBtn = document.getElementById('againBtn');
const feedbackOptions = document.getElementById('feedbackOptions');
const feedbackNoteBtn = document.getElementById('feedbackNoteBtn');
const feedbackNoteBox = document.getElementById('feedbackNoteBox');
const feedbackNoteInput = document.getElementById('feedbackNoteInput');
const feedbackNoteSubmit = document.getElementById('feedbackNoteSubmit');

let feedbackResponses = [];

feedbackOptions.addEventListener('click', (e) => {
  const btn = e.target.closest('.feedback-btn');
  if (!btn || btn.classList.contains('selected')) return;
  feedbackOptions.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  feedbackResponses.push({
    feeling: btn.dataset.feeling,
    timestamp: Date.now()
  });
  if (window.VoidFeedback) window.VoidFeedback.recordFeeling(btn.dataset.feeling);
});

feedbackNoteBtn.addEventListener('click', () => {
  feedbackNoteBtn.classList.add('hidden');
  feedbackNoteBox.classList.add('visible');
  feedbackNoteInput.focus();
});

const FEEDBACK_NOTE_LABEL = 'Give feedback';
let feedbackNoteRevertTimer = null;

feedbackNoteSubmit.addEventListener('click', () => {
  const text = feedbackNoteInput.value.trim();
  if (!text) return;
  if (window.VoidFeedback) window.VoidFeedback.recordNote(text);
  feedbackNoteBox.classList.remove('visible');
  feedbackNoteInput.value = '';
  feedbackNoteBtn.classList.remove('hidden');
  feedbackNoteBtn.classList.add('submitted');
  feedbackNoteBtn.textContent = 'Thanks for sharing';
  clearTimeout(feedbackNoteRevertTimer);
  feedbackNoteRevertTimer = setTimeout(() => {
    feedbackNoteBtn.classList.remove('submitted');
    feedbackNoteBtn.textContent = FEEDBACK_NOTE_LABEL;
  }, 2500);
});

function resetFeedback() {
  feedbackOptions.querySelectorAll('.feedback-btn').forEach(b => b.classList.remove('selected'));
  clearTimeout(feedbackNoteRevertTimer);
  feedbackNoteBtn.classList.remove('hidden');
  feedbackNoteBtn.classList.remove('submitted');
  feedbackNoteBtn.textContent = FEEDBACK_NOTE_LABEL;
  feedbackNoteBox.classList.remove('visible');
  feedbackNoteInput.value = '';
}

function showRestartModal() {
  resetFeedback();
  restartOverlay.classList.add('visible');
}

// --- Share ---
const shareBtn = document.getElementById('shareBtn');
const SHARE_URL = 'https://www.letitgo.in';

function showShareConfirmation() {
  const original = shareBtn.innerHTML;
  shareBtn.classList.add('copied');
  shareBtn.innerHTML = '<span class="material-icons-outlined">check</span> Link copied';
  setTimeout(() => {
    shareBtn.classList.remove('copied');
    shareBtn.innerHTML = original;
  }, 2000);
}

function legacyCopyFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showShareConfirmation();
  } catch (err) {
    console.warn('Share failed:', err);
  }
  document.body.removeChild(textarea);
}

shareBtn.addEventListener('click', async () => {
  if (navigator.share) {
    try {
      await navigator.share({ url: SHARE_URL });
    } catch (err) {
      // User cancelled the share sheet — no action needed
    }
    return;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      showShareConfirmation();
      return;
    } catch (err) {
      // Falls through to the legacy copy method below
    }
  }
  legacyCopyFallback(SHARE_URL);
});

againBtn.addEventListener('click', () => {
  restartOverlay.classList.remove('visible');
  restartToRing();
});

// --- Collapse trigger ---
const ringTextEl = document.getElementById('ringText');

window.VoidCollapse = function () {
  if (collapsing) return;
  collapsing = true;
  collapseStart = -1;

  prepareTextDissolve();

  // Show overlay
  collapseOverlay.style.opacity = '1';
};


// --- Render ---
let t0 = 0;
let lastTs = 0;
let uiRevealed = false;
let landingFadedIn = false;

function render(ts) {
  if (!t0) t0 = ts;
  const t = (ts - t0) / 1000;
  const dt = lastTs > 0 ? (ts - lastTs) / 1000 : 0.016;
  lastTs = ts;
  const gather = getGather(t);

  // Fade in landing during scatter
  if (t > 0.5 && !landingFadedIn && !collapsing) {
    landingFadedIn = true;
    landingEl.classList.add('visible');
    const tag1 = document.getElementById('tag1');
    const tag2 = document.getElementById('tag2');
    const tag3 = document.getElementById('tag3');
    setTimeout(() => tag1.classList.add('visible'), 800);
    setTimeout(() => tag2.classList.add('visible'), 2000);
    setTimeout(() => tag3.classList.add('visible'), 3200);
  }

  // Fade out landing as ring starts forming
  if (landingFadedIn && gather > 0.05 && !landingEl.classList.contains('fading')) {
    landingEl.classList.remove('visible');
    landingEl.classList.add('fading');
  }

  // Show input UI once ring is mostly formed
  if (!uiRevealed && gather > 0.85) {
    uiRevealed = true;
    window.VoidEnergy.showUI();
  }

  // --- Collapse progress ---
  let collapse = 0;
  if (collapsing) {
    if (collapseStart < 0) collapseStart = t;

    if (!bhInitialized) {
      const energyAtCollapse = window.VoidEnergy ? window.VoidEnergy.getEnergy() : 0;
      initBlackHole(t, energyAtCollapse);
    }

    const elapsed = t - collapseStart;
    collapse = Math.min(1, elapsed / COLLAPSE_DURATION);

  }

  const energy = (window.VoidEnergy && !collapsing) ? window.VoidEnergy.getEnergy() : 0;

  if (canvas.width !== W * scale || canvas.height !== H * scale) resize();

  gl.clear(gl.COLOR_BUFFER_BIT);

  // Cross-fade duration between ring and black hole (seconds)
  const BH_CROSSFADE = 2.5;

  if (collapsing && bhInitialized) {
    const bhElapsed = bhTime;
    const crossfade = Math.min(1, bhElapsed / BH_CROSSFADE);

    // During cross-fade, render ring particles fading out underneath
    if (crossfade < 1) {
      gl.useProgram(program);
      setupRingAttribs();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, spriteTexture);
      gl.uniform1i(uSprite, 0);
      gl.uniform1f(uTime, t);
      gl.uniform1f(uGather, 1.0);
      gl.uniform1f(uEnergy, energy);
      gl.uniform1f(uAspect, W / H);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform2f(uMouse, mouseNX * (W / H), mouseNY);
      gl.uniform1f(uMouseActive, 0.0);
      gl.uniform1f(uCollapse, crossfade);
      gl.uniform2f(uShake, 0, 0);
      gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
    }

    updateBlackHole(dt);
    renderBlackHole();
  } else {
    gl.useProgram(program);
    setupRingAttribs();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, spriteTexture);
    gl.uniform1i(uSprite, 0);

    // Energy shake — at high energy, the ring trembles
    if (energy > 0.7) {
      const shakeAmt = (energy - 0.7) / 0.3;
      const intensity = shakeAmt * shakeAmt * 0.012;
      shakeX = (Math.random() - 0.5) * 2 * intensity;
      shakeY = (Math.random() - 0.5) * 2 * intensity;
    } else {
      shakeX *= 0.9;
      shakeY *= 0.9;
    }

    gl.uniform1f(uTime, t);
    gl.uniform1f(uGather, gather);
    gl.uniform1f(uEnergy, energy);
    gl.uniform1f(uAspect, W / H);
    gl.uniform2f(uResolution, canvas.width, canvas.height);
    gl.uniform2f(uMouse, mouseNX * (W / H), mouseNY);
    gl.uniform1f(uMouseActive, mouseActive ? 1.0 : 0.0);
    gl.uniform1f(uCollapse, 0);
    gl.uniform2f(uShake, shakeX, shakeY);

    gl.drawArrays(gl.POINTS, 0, PARTICLE_COUNT);
  }

  // Background stars — always visible, even before collapse
  if (!collapsing && gather > 0.3) {
    collapseOverlay.style.opacity = '1';
    cCtx.clearRect(0, 0, W, H);
    const starAlpha = Math.min(1, (gather - 0.3) * 1.5);
    for (const s of bhStarData) {
      const twinkle = 0.5 + 0.5 * Math.sin(t * s.tw + s.x * 80);
      const alpha = s.a * twinkle * starAlpha * 0.25;
      cCtx.fillStyle = `rgba(180,190,220,${alpha})`;
      cCtx.beginPath();
      cCtx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      cCtx.fill();
    }
  }

  renderCollapseOverlay(t, dt);

  // Update audio engine every frame
  if (window.VoidAudio) window.VoidAudio.update(t, gather, energy, collapse);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
