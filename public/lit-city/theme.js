// Material values from the approved opening study (2026-11-18).
// Reapply from the original shaders so switching themes never stacks patches.
export function createCityTheme(scene) {
  const base = Object.fromEntries(['COL', 'LINE', 'LIGHT', 'POST'].map(key => [key, structuredClone(scene.CFG[key])]));
  const shaders = { floorF: scene.GLSL.floorF, modelF: scene.GLSL.modelF };
  return theme => {
    for (const key of Object.keys(base)) Object.assign(scene.CFG[key], structuredClone(base[key]));
    Object.assign(scene.GLSL, shaders);
    const { COL, LINE, LIGHT, POST } = scene.CFG;
    if (theme !== 'light') {
      COL.bg = [21 / 255, 25 / 255, 30 / 255];
      return;
    }
    Object.assign(COL, {
      bg: [252 / 255, 252 / 255, 253 / 255],
      cardTop: [0.84, 0.86, 0.89], cardSide: [0.59, 0.64, 0.70],
      wallTop: [0.92, 0.94, 0.96], wallSide: [0.73, 0.77, 0.82],
      edge: [0.12, 0.17, 0.23], warm: [0.70, 0.46, 0.21], warmLight: [0.60, 0.44, 0.25],
    });
    Object.assign(LINE, { edge: 0.34, fill: 0.18, rim: 0.48, trace: 0.32, traceCard: 0.40, padCard: 0.22, nameDim: 0.64, sign: 0.90 });
    Object.assign(LIGHT, { moon: 1, spill: 0.08, halo: 0.025, gloss: 0.08, lamp: 0.12, window: 0.10, sheen: 0.018, rimGlow: 0.01 });
    Object.assign(POST, { bloom: 0, bloomThresh: 0.98 });
    scene.GLSL.floorF = shaders.floorF.replace('uBg+vec3(0.032,0.035,0.044)*g*uA', 'uBg-vec3(0.10,0.11,0.12)*g*uA');
    scene.GLSL.modelF = shaders.modelF.replace(
      'base=mix(uWallSide,uWallTop,max(up,0.0)*uMoon);',
      'base=mix(uWallSide,uWallTop,max(up,0.0)*uMoon);base*=0.82+0.18*max(dot(N,normalize(vec3(-0.55,0.8,0.35))),0.0);',
    ).replace('base*=0.93+0.09*n21(vP.xz*7.0)+0.05*n21(vP.xz*29.0);', 'base*=0.986+0.009*n21(vP.xz*7.0)+0.005*n21(vP.xz*29.0);');
  };
}
