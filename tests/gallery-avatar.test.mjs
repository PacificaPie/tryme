import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function gallery(avatarUrl, cover = '') {
  const images = [], textures = [];
  function canvas() {
    const result = {width: 1, height: 1, draws: []};
    const ctx = new Proxy({}, {
      get(target, key) {
        if (key === 'drawImage') return (...args) => result.draws.push(args);
        if (key === 'measureText') return value => ({width: String(value).length * 10});
        if (String(key).startsWith('create')) return () => ({addColorStop() {}});
        return target[key] ?? (() => {});
      },
      set(target, key, value) {target[key] = value; return true;}
    });
    result.getContext = () => ctx;
    return result;
  }
  const scope = {console, document: {createElement: canvas}, Image: class {
    constructor() {images.push(this);}
    removeAttribute(name) {if (name === 'src') this.src = '';}
  }};
  scope.window = scope;
  vm.createContext(scope);
  for (const name of ['vendor/three.min.js', 'core.js', 'prints.js', 'popup.js']) {
    vm.runInContext(fs.readFileSync(new URL('../public/gallery/' + name, import.meta.url), 'utf8'), scope, {filename: name});
  }
  const {THREE: T, SP} = scope;
  function material(options = {}) {
    const result = new T.MeshBasicMaterial();
    result.uniforms = new Proxy({}, {get(target, key) {return target[key] ||= {value: new T.Vector4()};}});
    if (options.isTexture) result.uniforms.tMap.value = options;
    for (const key of ['tA', 'tB']) if (options[key]) result.uniforms[key].value = options[key];
    return result;
  }
  const paper = {board: material, art: material, ground: material, white: new T.Texture(), PAPER: 0xffffff, INK: 0,
    tex(source) {
      const result = new T.Texture(source);
      result.addEventListener('dispose', () => {result.wasDisposed = true;});
      textures.push(result);
      return result;
    }
  };
  SP.configurePrints({id: 'author', name: 'Creator', avatarUrl}, [{id: 'work', name: 'Saved work', cover}], 1, 0);
  let renderCount = 0;
  const popup = SP.createPopup({T, scene: new T.Scene()}, paper, () => {renderCount++;});
  return {popup, images, textures, SP, get renderCount() {return renderCount;}};
}

test('saved avatar replaces all front texture references and preserves full-color cover/navigation', () => {
  const scene = gallery('/api/public/avatars/12345678-1234-1234-1234-123456789abc', '/media/work');
  const {popup, images, SP} = scene;
  assert.equal(images.length, 2);
  const original = popup.body.material.uniforms.tA.value;
  const originalCoverBounds = popup.body.material.uniforms.uStipR.value.clone();
  const image = images.find(item => item.src.startsWith('/api/public/avatars/'));
  image.naturalWidth = 800; image.naturalHeight = 600; image.onload();
  const replacement = popup.body.material.uniforms.tA.value;
  assert.notEqual(replacement, original);
  assert.equal(original.wasDisposed, true);
  const draw = replacement.image.draws.find(call => call[0] === image);
  assert.deepEqual(Array.from(draw.slice(1, 5)), [100, 0, 600, 600], 'Only a centered square source crop is used');
  assert.equal(draw[7], draw[8], 'The avatar is not stretched');
  let references = 0;
  popup.root.traverse(node => {if (node.material?.uniforms?.tA?.value === replacement) references++;});
  assert.equal(references, 3, 'Body and both folding faces share the replacement');
  const colorBounds = popup.body.material.uniforms.uStipR.value;
  assert.equal(colorBounds.x, originalCoverBounds.x);
  assert.equal(colorBounds.z, originalCoverBounds.z);
  assert.equal(colorBounds.w, originalCoverBounds.w);
  assert(colorBounds.y <= (SP.prints.AVATAR.y - SP.prints.AVATAR.r) / SP.prints.H + .5);
  const workImage = images[0]; workImage.naturalWidth = 4000; workImage.naturalHeight = 1000; workImage.onload();
  assert.equal(popup.body.material.uniforms.tA.value, replacement, 'Later cover loading does not remove the avatar');
  assert.equal(popup.targets.length, 1);
  assert.equal(popup.works[0].w.id, 'work');
  assert.equal(scene.renderCount, 2);
  popup.dispose();
  assert.equal(replacement.wasDisposed, true);
});

test('legacy cards and rejected avatar paths allocate no portrait load', () => {
  for (const path of [undefined, '', 'https://foreign.test/avatar.png', '//foreign.test/avatar.png', '/avatars/sun.svg?remote=1', '/avatars/../../private']) {
    const {popup, images, SP} = gallery(path);
    assert.equal(images.length, 0);
    assert.equal(SP.prints.PEOPLE[0].avatarUrl, '');
    assert.equal(popup.body.material.uniforms.tA.value.image.draws.length, 0, 'The original synthetic portrait remains');
    popup.dispose();
  }
});

test('unavailable or malformed portrait keeps the initial scene usable', () => {
  const scene = gallery('/avatars/sprout.svg');
  const {popup, images} = scene, original = popup.body.material.uniforms.tA.value;
  assert.equal(popup.targets.length, 1, 'Work navigation exists before the avatar resolves');
  images[0].onerror();
  images[0].naturalWidth = 0; images[0].naturalHeight = 0; images[0].onload();
  assert.equal(popup.body.material.uniforms.tA.value, original);
  assert.equal(original.wasDisposed, undefined);
  assert.equal(scene.renderCount, 0);
  popup.dispose();
});

test('avatar cleanup cancels image callbacks and ignores an already queued late load', () => {
  const scene = gallery('/avatars/moon.svg');
  const {popup, images, textures} = scene, image = images[0], queued = image.onload;
  popup.dispose();
  assert.equal(image.onload, null);
  assert.equal(image.onerror, null);
  assert.equal(image.src, '');
  const textureCount = textures.length;
  image.naturalWidth = 128; image.naturalHeight = 128; queued();
  assert.equal(textures.length, textureCount);
  assert.equal(scene.renderCount, 0);
});
