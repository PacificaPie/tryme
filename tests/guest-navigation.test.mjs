import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {safeAuthReturnTo} from '../public/auth-client.js';

const source=ts.createSourceFile('site.js',readFileSync(new URL('../public/site.js',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=name=>source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(source);
test('public Feed fetch is independent of Clerk availability and sends neither session credentials nor Bearer tokens',async()=>{
  const calls=[];let authCalls=0;
  const context=vm.createContext({FormData,ApiError:Error,authHeaders:async()=>{authCalls++;throw Error('Clerk unavailable');},fetch:async(path,options)=>{calls.push({path,options});return Response.json({works:[]});}});
  vm.runInContext(declaration('api'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.api('/api/public/discover?q=rain'))),{works:[]});
  assert.equal(authCalls,0);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.headers.Authorization,undefined);
  await assert.rejects(context.api('/api/works'),/Clerk unavailable/);assert.equal(authCalls,1);assert.equal(calls.length,1);
});

function routeFixture(path,{authFailure=false}={}){
  const rendered=[],discovered=[],r={path:path.split('?')[0],raw:path,params:new URLSearchParams(path.split('?')[1]||'')};
  const context=vm.createContext({
    me:null,authChecked:false,routeNumber:0,location:{hash:'#'+path,replace(){throw Error('Unexpected redirect');}},legacyPublicCardPath:()=>null,visitRecorded:false,
    route:()=>r,publishedAutoCover:null,publishedAutoPreview:null,publishedVideos:null,publishAvailability:null,analyticsPanel:null,discoveryPanel:null,creatorPanel:null,templateExperiencePanel:null,
    currentRoute:'',currentGallery:null,scrolls:new Map(),finishRouteLoading:null,main:{},
    stopBuildPolling(){},disposeVersioning(){},disposeWorkEdit(){},disposePublicationControls(){},endSession(){},$$:()=>[],syncNavigation(){},identity(){},
    beginRouteLoading:()=>()=>{},pageSkeleton:()=>'',t:x=>x,ApiError:class extends Error{constructor(message,status){super(message);this.status=status;}},
    loadMe:async()=>{if(authFailure)throw Object.assign(Error('Auth service unavailable'),{status:503});context.authChecked=true;},
    applyHTML:html=>rendered.push(html),pageError:error=>'error:'+error.status,
    renderDiscover:async()=>discovered.push(r),
    renderWork:()=>{throw Error('Private work must not be read by a guest');},renderPublish:()=>{throw Error('Publishing must stay gated');},renderCards:()=>{throw Error('Card workspace must stay gated');},
  });
  vm.runInContext(declaration('renderRoute'),context);return {context,rendered,discovered};
}
test('signed-out Feed renders while publishing, cards, work play and followed Feed keep their login gate and return context',async()=>{
  const feed=routeFixture('/feed?q=rain&sort=newest');await feed.context.renderRoute();assert.equal(feed.discovered.length,1);assert.deepEqual(feed.rendered,[]);
  for(const path of ['/publish','/cards','/cards/me','/work/game-1234?from=%2Ffeed%3Fq%3Drain','/feed?following=1','/studio/works']){
    const f=routeFixture(path);await f.context.renderRoute();assert.deepEqual(f.rendered,['error:401'],path);assert.deepEqual(f.discovered,[]);
    const target='/site.html#'+path;assert.equal(safeAuthReturnTo(target,'https://site.test'),target);
  }
});
test('an auth outage does not block public Feed, and does not open private pages',async()=>{
  const feed=routeFixture('/feed',{authFailure:true});await feed.context.renderRoute();assert.equal(feed.discovered.length,1);
  const privatePage=routeFixture('/publish',{authFailure:true});await privatePage.context.renderRoute();assert.deepEqual(privatePage.rendered,['error:503']);
});
