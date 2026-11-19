import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareRepository,prebuiltMetadata,LIMITS} from '../scripts/repo-builder.mjs';

const job={repository:'PacificaPie/rain-between-rooms',commitSha:'0f15da7b9965af440a4e7bac348d30834c5667cf'};
const html='<!doctype html><html><head><style>body{background:url(data:image/png;base64,eA==)}</style></head><body><img src="data:image/png;base64,eA=="><script>document.body.dataset.ready="yes";</script></body></html>';
const file=(path,body)=>({path,bytes:Buffer.from(body)});
test('prebuilt Three.js-style loaders preserve the original game and skip build execution',()=>{
  const source=readFileSync(new URL('./fixtures/prebuilt-loader.html',import.meta.url),'utf8');
  const prepared=prepareRepository([file('index.html',source)],job);
  assert.equal(prepared.kind,'prebuilt');assert.equal(prepared.sourcePath,'index.html');
  assert.equal(prepared.html.replace(/\n<!--\nSource:[\s\S]*?-->\n/,''),source);
  assert.equal(prebuiltMetadata(prepared,job).execution.projectScriptsExecuted,false);
});
const project=()=>[
  file('package.json',JSON.stringify({scripts:{build:'vite build'},devDependencies:{vite:'7.1.7'}})),
  file('package-lock.json',JSON.stringify({lockfileVersion:3,packages:{'':{},'node_modules/vite':{version:'7.1.7',resolved:'https://registry.npmjs.org/vite/-/vite-7.1.7.tgz',integrity:'sha512-YWJj'}}})),
  file('LICENSE','MIT License\nCopyright (c) Example'),
];

test('a plain repository can import its self-contained dist HTML without executing a custom build script',()=>{
  const files=[file('build.mjs','throw Error("This script must never execute");'),file('dist/index.html',html),file('template.html','unbuilt template')];
  const before=Buffer.from(files[1].bytes),result=prepareRepository(files,job);
  assert.equal(result.kind,'prebuilt');assert.equal(result.sourcePath,'dist/index.html');
  assert(result.html.includes('document.body.dataset.ready="yes"'));
  assert(result.sourceUrl.includes(job.commitSha));assert(result.sourceUrl.includes('dist/index.html'));
  assert.equal(result.license??null,null);assert.deepEqual(files[1].bytes,before);
});

test('prebuilt selection uses a root index only when no dist entry is present',()=>{
  const root=prepareRepository([file('index.html',html)],job);
  assert.equal(root.kind,'prebuilt');assert.equal(root.sourcePath,'index.html');
  const dist=prepareRepository([file('index.html',html.replace('ready','root')),file('dist/index.html',html)],job);
  assert.equal(dist.sourcePath,'dist/index.html');
  assert.throws(()=>prepareRepository([file('dist/index.html','<html><img src="missing.png"></html>'),file('index.html',html)],job),{code:'EXTERNAL_ASSET'});
});

test('valid Vite source keeps the build path instead of silently using an old checked-in dist',()=>{
  const result=prepareRepository([...project(),file('dist/index.html',html)],job);
  assert.equal(result.kind,'vite');assert.equal(result.project.pkg.scripts.build,'vite build');
  for(const missing of ['package-lock.json','LICENSE']){
    const files=project().filter(entry=>entry.path!==missing);
    assert.throws(()=>prepareRepository([...files,file('dist/index.html',html)],job));
  }
});

test('prebuilt validation rejects broken UTF-8, oversized HTML and non-inline assets',()=>{
  assert.throws(()=>prepareRepository([{path:'dist/index.html',bytes:Buffer.from([0xff,0xfe,0x00])}],job));
  assert.throws(()=>prepareRepository([file('dist/index.html','<html>'+'x'.repeat(LIMITS.html)+'</html>')],job),{code:'OUTPUT_TOO_LARGE'});
  for(const markup of [
    '<html><img src=missing.png></html>',
    '<html><style>body{background:url("https://example.com/image.png")}</style></html>',
    '<html><style>@import "theme.css";</style></html>',
    '<html><script type="module">import "./game.js";</script></html>',
  ])assert.throws(()=>prepareRepository([file('dist/index.html',markup)],job),{code:'EXTERNAL_ASSET'});
});

test('prebuilt provenance describes an import, records final bytes and preserves any supplied license',()=>{
  const prepared=prepareRepository([file('dist/index.html',html),file('LICENSE','MIT License\nAuthor -- notice')],job);
  assert.equal(prepared.kind,'prebuilt');assert.equal(prepared.license.path,'LICENSE');
  assert(prepared.html.includes('MIT License'));assert(!prepared.html.includes('Author -- notice'));
  const metadata=prebuiltMetadata(prepared,job,{sourceFiles:2,archiveBytes:1234,timingsMs:{fetching:10,total:12}});
  assert.equal(metadata.framework,'prebuilt-html');assert.equal(metadata.buildCommand,null);assert.deepEqual(metadata.buildCommands,[]);
  assert.equal(metadata.sourcePath,'dist/index.html');assert.equal(metadata.commitSha,job.commitSha);
  assert.equal(metadata.outputBytes,Buffer.byteLength(prepared.html));
  assert.equal(metadata.outputSha256,createHash('sha256').update(prepared.html).digest('hex'));
  assert.equal(metadata.archiveBytes,1234);assert.equal(metadata.sourceFiles,2);
});
