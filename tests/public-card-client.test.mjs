import test from 'node:test';
import assert from 'node:assert/strict';
import {publicCardPath,publicCardId,legacyPublicCardPath,snapshotPlayPath,publicPlaySignInPath,publicCardRemixSignInPath,publicCardBackPath,publicCoverPath} from '../public/public-card-links.js';
import {renderPublicCard,fetchPublicCard} from '../public/public-card.js';
import {safeAuthReturnTo} from '../public/auth-client.js';

const cardId='71160f2c-1946-4d96-a85c-bfdaf5940fe8',workId='93a13b22-388e-4fe6-9873-4a6c47096043';
const origin='https://funtrack.test',cover=`/api/public/cards/${cardId}/works/${workId}/cover`;
const card={id:cardId,template:'wall',name:'A <script>alert(1)</script>',bio:'A & B',headline:'Developer',signature:'Thanks',website:'javascript:alert(1)',works:[{id:workId,name:'Rain <img src=x onerror=alert(1)>',desc:'Line one\nLine two',coverUrl:cover,source:'html',version:'v0.1.0'}]};

test('public and legacy links accept only a complete card route and keep private routes private',()=>{
  assert.equal(publicCardPath(cardId),'/c/'+cardId);assert.equal(publicCardId('/c/'+cardId.toUpperCase()),cardId);
  assert.equal(legacyPublicCardPath('#/card/'+cardId+'?saved=1'),'/c/'+cardId);
  for(const hash of ['#/cards/me','#/cards/me/preview','#/work/'+workId+'?card='+cardId,'#/card/'+cardId+'/edit','#/card/'+cardId+'#extra','#/card/../../api/me','#/card/%2f'+cardId])assert.equal(legacyPublicCardPath(hash),null,hash);
  assert.equal(publicCardPath('//evil.test'),null);assert.equal(publicCardId('/c/'+cardId+'/extra'),null);
});

test('play signs in to the selected immutable card snapshot while cancel goes back to the public card',()=>{
  const href=new URL(publicPlaySignInPath(cardId,workId),origin),returnTo=href.searchParams.get('return_to');
  assert.equal(href.pathname,'/auth/sign-in.html');assert.equal(returnTo,snapshotPlayPath(cardId,workId));
  assert.equal(safeAuthReturnTo(returnTo,origin),returnTo);
  const route=new URL(returnTo,origin).hash.slice(1),params=new URLSearchParams(route.split('?')[1]);
  assert.equal(route.split('?')[0],'/work/'+workId);assert.equal(params.get('card'),cardId);assert.equal(params.get('from'),'/card/'+cardId);assert.equal(params.get('play'),'1');
  assert.equal(publicCardBackPath(returnTo),'/c/'+cardId);
  assert.equal(publicCardBackPath('https://evil.test'+returnTo),null);
  assert.equal(publicCardBackPath(returnTo.replace(encodeURIComponent('/card/'+cardId),'https%3A%2F%2Fevil.test')),null);
  assert.equal(publicPlaySignInPath(cardId,'../game'),null);
  assert.ok(publicPlaySignInPath(cardId,'legacy_work-01'),'Saved cards can retain older safe work IDs');
});

test('public covers never fall back to private media or arbitrary same-origin resources',()=>{
  assert.equal(publicCoverPath(cover,cardId,workId,origin),cover);
  assert.equal(publicCoverPath(origin+cover,cardId,workId,origin),cover);
  for(const path of ['/media/'+workId,'/game/'+workId,cover+'?redirect=1','https://evil.test'+cover,cover.replace(workId,cardId)])assert.equal(publicCoverPath(path,cardId,workId,origin),'',path);
});

test('all five real templates render escaped creator content and only public cover/renderer resources',()=>{
  for(const template of ['wall','editorial','filmstrip','fold','collection']){
    const html=renderPublicCard({...card,template},origin);
    assert.ok(html.length>100);assert.doesNotMatch(html,/<script|<img src=x|href="javascript:|\/game\/|\/media\//);
    if(['fold','collection'].includes(template)){
      assert.match(html,new RegExp(`src="/${template==='fold'?'gallery':'collection'}/\\?lang=`));assert.match(html,/public-gallery-frame/);
    }else{assert.ok(html.includes(cover));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('#work='+workId));}
  }
  assert.doesNotMatch(renderPublicCard({...card,works:[{...card.works[0],coverUrl:'/api/me'}]},origin),/src="\/api\/me"/);
});

test('anonymous loading makes one public GET without cookies, auth initialization, or write requests',async()=>{
  const calls=[];
  const result=await fetchPublicCard(cardId,{fetchImpl:async(path,options)=>{calls.push({path,options});return {ok:true,json:async()=>({card})};}});
  assert.equal(result,card);assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/public/cards/'+cardId);
  assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.method,undefined);assert.equal(calls[0].options.headers,undefined);
});

test('invalid IDs, missing cards, and malformed responses fail instead of exposing a partial play target',async()=>{
  await assert.rejects(fetchPublicCard('bad',{fetchImpl:()=>assert.fail('Must not request an invalid ID')}),error=>error.status===404);
  await assert.rejects(fetchPublicCard(cardId,{fetchImpl:async()=>({ok:false,status:404})}),error=>error.status===404);
  await assert.rejects(fetchPublicCard(cardId,{fetchImpl:async()=>({ok:true,json:async()=>({card:{...card,works:[{id:'../../game'}]}})})}));
});


test('same-template public links preserve the template source through sign in without an external redirect',()=>{
  const link=new URL(publicCardRemixSignInPath(cardId.toUpperCase()),origin);
  const target='/site.html#/cards/me?templateFrom='+cardId;
  assert.equal(link.pathname,'/auth/sign-in.html');
  assert.equal(link.searchParams.get('return_to'),target);
  assert.equal(safeAuthReturnTo(target,origin),target);
  assert.equal(publicCardBackPath(target),'/c/'+cardId);
  assert.equal(publicCardBackPath('https://evil.test'+target),null);
  for(const value of ['../secret',cardId+'&redirect=https://evil.test','//evil.test',null])assert.equal(publicCardRemixSignInPath(value),null);
});
