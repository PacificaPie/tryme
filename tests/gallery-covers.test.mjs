import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup(files) {
  const canvases = [], images = [];
  function canvas() {
    const node = { width: 1, height: 1, draws: [] };
    const context = new Proxy({}, {
      get(object, key) {
        if (key === 'drawImage') return (...args) => node.draws.push(args);
        if (key === 'measureText') return value => ({ width: String(value).length * 10 });
        if (String(key).startsWith('create')) return () => ({ addColorStop() {} });
        return object[key] ?? (() => {});
      },
      set(object, key, value) { object[key] = value; return true; }
    });
    node.getContext = () => context;
    canvases.push(node);
    return node;
  }
  const scope = { console, document: { createElement: canvas }, Image: class {
    constructor() { images.push(this); }
    removeAttribute() {}
  } };
  scope.window = scope;
  vm.createContext(scope);
  for (const file of files) vm.runInContext(fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8'), scope, { filename: file });
  return { scope, canvases, images };
}

function assertContained(draw, width, height, sourceWidth, sourceHeight, x = 0, y = 0) {
  assert.equal(draw.length, 5, 'Use the whole source image, not a source crop');
  const [, dx, dy, dw, dh] = draw;
  assert(dx >= x - 1e-9 && dy >= y - 1e-9, 'Image starts inside its frame');
  assert(dx + dw <= x + width + 1e-9 && dy + dh <= y + height + 1e-9, 'All four source edges remain visible');
  assert(Math.abs(dw / dh - sourceWidth / sourceHeight) < 1e-9, 'Source proportions are preserved');
  assert(Math.abs(dx - x - (width - dw) / 2) < 1e-9 && Math.abs(dy - y - (height - dh) / 2) < 1e-9, 'Letterboxing is centered');
}

for (const [label, width, height] of [['wide', 4000, 1000], ['portrait', 600, 1600]]) {
  test(`${label} gallery cover and card-back representative keep all four edges`, () => {
    const { scope, canvases, images } = setup(['gallery/vendor/three.min.js', 'gallery/core.js', 'gallery/prints.js', 'gallery/popup.js']);
    const { THREE: T, SP } = scope;
    function material() {
      const value = new T.MeshBasicMaterial();
      value.uniforms = new Proxy({}, { get(object, key) { return object[key] ||= { value: new T.Vector4() }; } });
      return value;
    }
    const paper = { board: material, art: material, ground: material, tex: canvas => new T.Texture(canvas), white: new T.Texture(), PAPER: 0xffffff, INK: 0 };
    SP.configurePrints({ id: 'author', name: 'Creator' }, [{ id: 'work', name: 'Actual work', cover: '/media/actual' }], 1, 0);
    const popup = SP.createPopup({ T, scene: new T.Scene() }, paper);
    const image = images[0];
    image.naturalWidth = width;
    image.naturalHeight = height;
    image.onload();
    const cover = canvases.find(canvas => canvas.width === 1024 && canvas.height === 640 && canvas.draws.some(draw => draw[0] === image));
    assert(cover, 'Loaded image creates the actual wall texture');
    assertContained(cover.draws.find(draw => draw[0] === image), 1024, 640, width, height);
    const back = canvases.find(canvas => canvas.draws.some(draw => draw[0] === cover));
    assert(back, 'Actual cover is also used on the back');
    assertContained(back.draws.find(draw => draw[0] === cover), 2.54 * 512, 1.55 * 512, 1024, 640, .23 * 512, 1.18 * 512);
    popup.dispose();
  });

  test(`${label} collection cover is fully contained in its physical card`, () => {
    const { scope, canvases, images } = setup(['collection/assets.js']);
    scope.SP.loadCollectionMedia([{ id: 'work', name: 'Actual work', cover: '/media/actual' }], () => {});
    const image = images[0];
    image.naturalWidth = width;
    image.naturalHeight = height;
    image.onload();
    const cover = canvases.find(canvas => canvas.draws.some(draw => draw[0] === image));
    assertContained(cover.draws[0], 512, 320, width, height);
    scope.SP.disposeCollectionMedia();
  });

  for (const count of [2, 3]) test(`${label} covers retain their real proportions in every closed ${count}-work slot`, () => {
    const { scope, images } = setup(['gallery/vendor/three.min.js', 'gallery/core.js', 'gallery/prints.js', 'gallery/popup.js']);
    const { THREE: T, SP } = scope;
    function material(texture) {
      const value = new T.MeshBasicMaterial();
      value.uniforms = new Proxy({}, { get(object, key) { return object[key] ||= { value: new T.Vector4() }; } });
      if (texture?.isTexture) value.uniforms.tMap.value = texture;
      return value;
    }
    const paper = { board: material, art: material, ground: material, tex: canvas => new T.Texture(canvas), white: new T.Texture(), PAPER: 0xffffff, INK: 0 };
    const works = Array.from({ length: count }, (_,index) => ({ id: `work-${index}`, name: `Actual work ${index}`, cover: `/media/actual-${index}` }));
    SP.configurePrints({ id: 'author', name: 'Creator' }, works, count, 0);
    const popup = SP.createPopup({ T, scene: new T.Scene() }, paper);
    const toDispose = [];
    images.forEach((image, index) => {
      const slot = SP.prints.SLOTS[index], work = popup.works[index], original = work.thumbTex;
      let oldDisposed = false;
      original.addEventListener('dispose', () => { oldDisposed = true; });
      image.naturalWidth = width;
      image.naturalHeight = height;
      image.onload();
      assert(oldDisposed, 'The replaced thumbnail placeholder texture is disposed');
      assert.notEqual(work.tex, work.thumbTex, 'Wall and thumbnail textures have independent target ratios');
      const canvas = work.thumbTex.image, draw = canvas.draws.find(call => call[0] === image);
      assert(draw, 'The thumbnail uses the original image, not an already letterboxed wall texture');
      const mapped = [image, draw[1] / canvas.width * slot.w, draw[2] / canvas.height * slot.h, draw[3] / canvas.width * slot.w, draw[4] / canvas.height * slot.h];
      assertContained(mapped, slot.w, slot.h, width, height);
      const pieces = [];
      popup.root.traverse(node => { if (node.material?.uniforms?.tMap?.value === work.thumbTex) pieces.push(node); });
      assert.equal(pieces.length, slot.x === 0 ? 2 : 1, 'The original folding-seam pieces remain intact');
      for (const mesh of pieces) {
        const uv = mesh.material.uniforms.uRect.value;
        assert(Math.abs(mesh.geometry.parameters.width / uv.z - slot.w) < 1e-9, 'Physical geometry and sampled UV width use the same slot scale');
        assert(Math.abs(mesh.geometry.parameters.height / uv.w - slot.h) < 1e-9, 'Physical geometry and sampled UV height use the same slot scale');
      }
      const disposed = { value: false };
      work.thumbTex.addEventListener('dispose', () => { disposed.value = true; });
      toDispose.push(disposed);
    });
    assert.equal(popup.targets.length, count, 'Every selected work retains its original navigation target');
    popup.dispose();
    assert(toDispose.every(texture => texture.value), 'All separate thumbnail textures are disposed on teardown');
  });
}
