import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateSelfContainedHTML} from '../scripts/build-toolkit/self-contained.mjs';

const document=code=>`<!doctype html><html><body><script>${code}</script></body></html>`;
const bundled=readFileSync(new URL('./fixtures/prebuilt-loader.html',import.meta.url),'utf8');

test('bundled loaders and diagnostic strings do not prove an external dependency',()=>{
  assert.equal(validateSelfContainedHTML(bundled),bundled);
  for(const code of [
    'function load(url) { return fetch(url); }',
    'class Loader { load(url) { return fetch(url, {}); } }',
    'const warning = "fetch(\" + "url) is unavailable";',
    'const help = `import "./game.js"; fetch("./level.json")`;',
    '// fetch("https://example.invalid/x")\n/* import "./absent.js" */',
    'const pattern = /fetch\("missing.json"\)/;',
    'const supported = typeof XMLHttpRequest !== "undefined";',
    'function request(url) { const xhr = new XMLHttpRequest(); xhr.open("GET", url); }',
    'function sound(url) { return new Audio(url); }',
    'const client = { fetch(value) { return value; } }; client.fetch("not-a-resource");',
    'globalThis.__validatorMustNotExecute = true; fetch(dynamicURL);',
  ])assert.doesNotThrow(()=>validateSelfContainedHTML(document(code)),code);
  assert.equal(globalThis.__validatorMustNotExecute,undefined);
});

test('explicit external resource literals still fail, including decoded JS escapes',()=>{
  for(const code of [
    'fetch("./level.json")',
    'fetch(`https://example.invalid/data`)',
    'fetch(/* comment */ "./level.json", {})',
    'window.fetch("./level.json")',
    'globalThis.fetch?.("./level.json")',
    'self.importScripts("./worker.js")',
    'new Worker("./worker.js")',
    'new SharedWorker("./worker.js")',
    'new Audio("./sound.wav")',
    'new EventSource("https://example.invalid/events")',
    'new WebSocket("wss://example.invalid/events")',
    'fetch(new Request("./level.json"))',
    'require("./module.js")',
    'import "./module.js";',
    'import thing from "./module.js";',
    'export {thing} from "./module.js";',
    'import("./module.js")',
    'image.src="./sprite.png";',
    'video.poster=`./poster.png`;',
    String.raw`fetch("\x2e/level.json")`,
    String.raw`fetch("\u0068ttps://example.invalid/level.json")`,
    'importScripts("data:text/javascript,", "data:text/javascript,", "./third.js")',
    'importScripts("data:text/javascript,", loader(dynamicURL), "./third.js")',
  ])assert.throws(()=>validateSelfContainedHTML(document(code)),/external resources/,code);
});

test('data URL literals and computed arguments keep their source bytes unchanged',()=>{
  for(const code of [
    'fetch("data:application/json,{}")',
    'importScripts("data:text/javascript,", "data:text/javascript,")',
    'image.src="data:image/png;base64,AAAA";',
    'fetch("data:application/json," + payload)',
    'function load(url) { return import(url); }',
    'function load(url) { return fetch(`${url}`); }',
    'new Audio()',
  ]){const source=document(code);assert.equal(validateSelfContainedHTML(source),source);}
});

test('JSON/shader blocks are data, while import maps retain explicit dependency checks',()=>{
  for(const type of ['application/json','application/ld+json','x-shader/x-fragment']){
    const source=`<html><script type="${type}">fetch("./unused") # shader syntax</script></html>`;
    assert.equal(validateSelfContainedHTML(source),source);
  }
  for(const attrs of ['type="module"','type=module','type="text/javascript"','type="application/javascript"','type="text/javascript1.5"','type="text/jscript"','data-type="application/json"','type="text/jav&#97;script"']){
    assert.throws(()=>validateSelfContainedHTML(`<html><script ${attrs}>fetch("./level.json")</script></html>`));
  }
  for(const map of [{imports:{three:'./three.js'}},{scopes:{'/':{three:'https://example.invalid/three.js'}}}]){
    assert.throws(()=>validateSelfContainedHTML(`<html><script type="importmap">${JSON.stringify(map)}</script></html>`));
  }
  const source='<html><script type="importmap">{"imports":{"game":"data:text/javascript,export default 1"}}</script></html>';
  assert.equal(validateSelfContainedHTML(source),source);
  assert.throws(()=>validateSelfContainedHTML('<html><script>"unterminated</script></html>'));
});
