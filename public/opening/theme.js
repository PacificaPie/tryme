(() => {
  const cfg = window.LC.CFG;
  if (window.OpeningTheme.theme === 'light') {
    // Keep artwork textures in their original colors; adapt materials and light.
    cfg.COL.bg = [252 / 255, 252 / 255, 253 / 255];
    cfg.COL.cardTop = [0.10, 0.12, 0.15];
    cfg.COL.cardSide = [0.06, 0.07, 0.09];
    cfg.COL.wallTop = [0.19, 0.22, 0.26];
    cfg.COL.wallSide = [0.075, 0.09, 0.115];
    cfg.LIGHT.moon = 1.1;
    cfg.LIGHT.spill = 0.23; cfg.LIGHT.halo = 0.10;
    cfg.LIGHT.gloss = 0.40; cfg.LIGHT.lamp = 0.50;
    cfg.POST.bloom = 0.06; cfg.POST.bloomThresh = 0.98;
    window.LC.GLSL.floorF = window.LC.GLSL.floorF.replace(
      'uBg+vec3(0.032,0.035,0.044)*g*uA',
      'uBg-vec3(0.10,0.11,0.12)*g*uA'
    );
    if (window.OpeningTheme.card === 'light') {
      // A silver-grey model with printed graphite details. Lighting is restrained
      // so the original artwork remains the strongest color in the scene.
      cfg.COL.cardTop = [0.84, 0.86, 0.89];
      cfg.COL.cardSide = [0.59, 0.64, 0.70];
      cfg.COL.wallTop = [0.92, 0.94, 0.96];
      cfg.COL.wallSide = [0.73, 0.77, 0.82];
      cfg.COL.edge = [0.12, 0.17, 0.23];
      cfg.COL.warm = [0.70, 0.46, 0.21];
      cfg.COL.warmLight = [0.60, 0.44, 0.25];
      cfg.LINE.edge = 0.34; cfg.LINE.fill = 0.18;
      cfg.LINE.rim = 0.48; cfg.LINE.trace = 0.32; cfg.LINE.traceCard = 0.40;
      cfg.LINE.padCard = 0.22; cfg.LINE.nameDim = 0.64; cfg.LINE.sign = 0.90;
      cfg.LIGHT.moon = 1.0; cfg.LIGHT.spill = 0.08; cfg.LIGHT.halo = 0.025;
      cfg.LIGHT.gloss = 0.08; cfg.LIGHT.lamp = 0.12; cfg.LIGHT.window = 0.10;
      cfg.LIGHT.sheen = 0.018; cfg.LIGHT.rimGlow = 0.01;
      cfg.POST.bloom = 0;
      // Gentle directional shading gives the pale side faces readable volume.
      window.LC.GLSL.modelF = window.LC.GLSL.modelF.replace(
        'base=mix(uWallSide,uWallTop,max(up,0.0)*uMoon);',
        'base=mix(uWallSide,uWallTop,max(up,0.0)*uMoon);base*=0.82+0.18*max(dot(N,normalize(vec3(-0.55,0.8,0.35))),0.0);'
      ).replace(
        'base*=0.93+0.09*n21(vP.xz*7.0)+0.05*n21(vP.xz*29.0);',
        'base*=0.986+0.009*n21(vP.xz*7.0)+0.005*n21(vP.xz*29.0);'
      );
    }
  } else {
    cfg.COL.bg = [21 / 255, 25 / 255, 30 / 255];
  }
})();
