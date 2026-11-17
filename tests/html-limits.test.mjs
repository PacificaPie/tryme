import test from 'node:test';
import assert from 'node:assert/strict';
import {HTML_MAX_BYTES,COVER_MAX_BYTES,PUBLICATION_MAX_BYTES} from '../lib/funtrack/limits.mjs';
import {htmlSource} from '../lib/funtrack/rules.mjs';
import {BUILD_MAX_BYTES,builtHTML} from '../lib/funtrack/build-rules.mjs';
import {publicationArtifact} from '../lib/funtrack/publication-artifact.mjs';
const documentBytes=size=>{const prefix='<!doctype html><html>',suffix='</html>';return new TextEncoder().encode(prefix+'x'.repeat(size-prefix.length-suffix.length)+suffix);};
const code=expected=>error=>error.code===expected;

test('HTML validators share an inclusive 16 MiB limit for local uploads, versions and builds',()=>{
  assert.equal(HTML_MAX_BYTES,16777216);assert.equal(BUILD_MAX_BYTES,HTML_MAX_BYTES);
  const bytes=documentBytes(HTML_MAX_BYTES);assert.equal(bytes.byteLength,HTML_MAX_BYTES);
  assert.equal(htmlSource(bytes,'text/html','game.html').length,HTML_MAX_BYTES);
  assert.equal(builtHTML(bytes,'text/html','game.html').length,HTML_MAX_BYTES);
  assert.throws(()=>htmlSource(documentBytes(HTML_MAX_BYTES+1),'text/html','game.html'),code('HTML_TOO_LARGE'));
  assert.throws(()=>builtHTML(documentBytes(HTML_MAX_BYTES+1),'text/html','game.html'),code('BUILD_ARTIFACT_TOO_LARGE'));
  const utf8=new TextEncoder().encode('<!doctype html><html>'+'界'.repeat(Math.ceil(HTML_MAX_BYTES/3))+'</html>');
  assert.throws(()=>htmlSource(utf8,'text/html','game.html'),code('HTML_TOO_LARGE'));
});
test('publication validates file size before buffering it and preserves the independent cover limit',async()=>{
  let read=false;
  const form=new Map([['file',{name:'game.html',type:'text/html',size:HTML_MAX_BYTES+1,arrayBuffer(){read=true;throw new Error('must not read');}}]]);
  await assert.rejects(publicationArtifact(form,'html','owner',()=>{}),code('HTML_TOO_LARGE'));assert.equal(read,false);
  const coverForm=new FormData();coverForm.set('file',new File(['<!doctype html><html></html>'],'game.html',{type:'text/html'}));coverForm.set('cover',new File([new Uint8Array(COVER_MAX_BYTES+1)],'cover.png',{type:'image/png'}));
  await assert.rejects(publicationArtifact(coverForm,'html','owner',()=>{}),code('COVER_TOO_LARGE'));
});
test('multipart envelope accommodates exact-limit HTML and cover plus ordinary publication fields',async()=>{
  const html=documentBytes(HTML_MAX_BYTES),cover=new Uint8Array(COVER_MAX_BYTES);cover.set([137,80,78,71,13,10,26,10]);
  const form=new FormData();form.set('name','game');form.set('desc','test');form.set('source','html');form.set('releaseNotes','version');form.set('expectedRevision','1');form.set('file',new File([html],'game.html',{type:'text/html'}));form.set('cover',new File([cover],'cover.png',{type:'image/png'}));
  const encoded=new Uint8Array(await new Request('https://example.test/api/works',{method:'POST',body:form}).arrayBuffer());
  assert(encoded.length>HTML_MAX_BYTES+COVER_MAX_BYTES);assert(encoded.length<PUBLICATION_MAX_BYTES);
  const result=await publicationArtifact(form,'html','owner',()=>{});
  assert.equal(result.gameBytes.length,HTML_MAX_BYTES);assert.equal(result.coverBytes.length,COVER_MAX_BYTES);
});
