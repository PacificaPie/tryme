import test from 'node:test';
import assert from 'node:assert/strict';
import {renderCardWorkspace} from '../public/card-workspace.js';
import {CARD_TEMPLATES} from '../public/card-templates.js';
import {setLocale,getLocale} from '../public/i18n.js';

const user={id:'me',name:'My live profile'};
const card={id:'71160f2c-1946-4d96-a85c-bfdaf5940fe8',authorId:user.id,name:'My saved card',headline:'Small things I made',bio:'Saved introduction',avatarUrl:'/avatars/sprout.svg',template:'fold',backStyle:'ivory',works:[{id:'work-one',name:'First work',coverUrl:'/media/version-one'}]};
const shareURL='https://funtrack.test/c/'+card.id;

test('workspace displays only the current own card and exposes its view/share/remake/delete controls',()=>{
  const before=structuredClone(card),html=renderCardWorkspace({card,user,shareURL,shareText:'Take a look at my card!'});
  assert.match(html,/<h1>名片<\/h1>/);assert.match(html,/当前名片/);assert.match(html,/My saved card/);assert.match(html,/Small things I made/);
  assert.match(html,new RegExp(`href="#/card/${card.id}"`));assert(html.includes(`href="#/cards/me?editCard=${card.id}">更新名片</a>`));
  assert(html.includes(`data-share-url="${shareURL}"`));assert.match(html,/data-share-title="My saved card"/);assert.match(html,/data-share-text="Take a look at my card!"/);
  assert(html.includes(`data-delete-card="${card.id}"`));assert.match(html,/data-card-name="My saved card"/);
  assert.match(html,/src="\/media\/version-one"/);assert.match(html,/名片中有 1 件作品/);assert.deepEqual(card,before);
  assert.doesNotMatch(html,/#\/author\/|data-creator-follow|data-feed-scope|data-collect/);
});

test('foreign cards and ambiguous ownership never render identity, covers, share data or destructive controls',()=>{
  for(const options of [{user:{id:'someone-else'},card},{user,card:{...card,authorId:undefined}},{user:undefined,card:{...card,authorId:undefined}},{user:{id:''},card:{...card,authorId:''}},{user,card:{...card,id:''}}]){
    const html=renderCardWorkspace({...options,shareURL,shareText:'FOREIGN SHARE'});
    assert.match(html,/制作你的第一张名片/);assert.doesNotMatch(html,/My saved card|Small things I made|FOREIGN SHARE|data-delete-card|data-share-url|\/media\/version-one/);
    assert.equal((html.match(/card-workspace-template-link/g)||[]).length,CARD_TEMPLATES.length);
  }
});

test('empty workspace explains own-card creation and offers every template as a separate experience route',()=>{
  const html=renderCardWorkspace({user,card:null});
  assert.match(html,/选几件自己的作品/);assert.match(html,/保存后，你的名片就会出现在这里/);assert.match(html,/href="#\/cards\/me">制作名片/);
  assert.equal((html.match(/class="card-workspace-template-link"/g)||[]).length,CARD_TEMPLATES.length);
  for(const template of CARD_TEMPLATES){
    assert(html.includes(`href="#/cards/templates/${template.id}"`));assert(html.includes(`card-workspace-schematic-${template.id}`));
    assert(html.includes(`aria-label="体验 ${template.name} 模板"`));assert(html.includes(template.description));
  }
  assert.doesNotMatch(html,/<iframe|data-delete-card|data-share-url|\/api\/cards|\/api\/creators|收藏名片|购买|付费/);
});

test('draft continuation is explicit without replacing the saved card or exposing a second create button in an empty state',()=>{
  const saved=renderCardWorkspace({card,user,hasDraft:true}),empty=renderCardWorkspace({user,hasDraft:true});
  assert.match(saved,/继续你的草稿/);assert.match(saved,/制作中的草稿不会改变这张已保存的名片/);assert.match(saved,/href="#\/cards\/me">继续草稿<\/a>/);assert.match(saved,/My saved card/);
  assert.match(empty,/你有一份未完成的名片草稿/);assert.match(empty,/href="#\/cards\/me">继续草稿/);
  assert.equal((empty.match(/href="#\/cards\/me"/g)||[]).length,1);
  assert.doesNotMatch(renderCardWorkspace({card,user}),/继续你的草稿|继续草稿/);
});

test('saved-card and sharing values are escaped, while cover resolution uses the supplied helper',()=>{
  const seen=[],hostile={...card,id:'a/b?c',name:'<img src=x onerror="bad">',headline:'<script>bad</script>',works:[{name:'<b>work</b>',coverUrl:'reference'}]};
  const html=renderCardWorkspace({card:hostile,user,shareURL:'https://funtrack.test/" onmouseover="bad',shareText:'<script>share</script>',safeCover:value=>{seen.push(value);return '/media/escaped" onerror="bad';}});
  assert.deepEqual(seen,['reference']);assert.match(html,/href="#\/card\/a%2Fb%3Fc"/);
  assert.match(html,/&lt;img src=x onerror=&quot;bad&quot;&gt;/);assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);assert.match(html,/data-share-text="&lt;script&gt;share&lt;\/script&gt;"/);
  assert.match(html,/src="\/media\/escaped&quot; onerror=&quot;bad"/);assert.doesNotMatch(html,/<script|<img src=x| onmouseover="| onerror="/);
});

test('workspace actions stay accessible and do not reuse the legacy hover-only creator-card class',()=>{
  const html=renderCardWorkspace({card,user,shareURL}),classes=[...html.matchAll(/class="([^"]*)"/g)].flatMap(match=>match[1].split(/\s+/));
  assert(classes.includes('card-workspace-actions'));assert(!classes.includes('creator-card-actions'));
  assert.equal((html.match(/<h1>/g)||[]).length,1);assert.match(html,/aria-labelledby="card-workspace-current-title"/);assert.match(html,/id="card-workspace-current-title"/);
  assert.match(html,/role="group" aria-label="名片操作"/);assert.match(html,/<ul class="card-workspace-template-grid">/);assert.equal((html.match(/<h3>/g)||[]).length,CARD_TEMPLATES.length);
  for(const button of html.matchAll(/<button([^>]*)>/g))assert.match(button[1],/type="button"/);
  for(const link of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g))assert.doesNotMatch(link[1],/<button|<a\b/);
  for(const schematic of html.matchAll(/<span class="card-workspace-schematic[^>]*>/g))assert.match(schematic[0],/aria-hidden="true"/);
});

test('workspace and all five template choices localize while the user’s saved identity stays literal',()=>{
  const previous=getLocale();setLocale('en');
  try{
    const empty=renderCardWorkspace({user}),saved=renderCardWorkspace({user,card:{...card,name:'制作名片 {name}'},shareURL,hasDraft:true});
    assert.match(empty,/<h1>Cards<\/h1>/);assert.match(empty,/Explore templates/);assert.match(empty,/Make your first card/);assert.doesNotMatch(empty,/[\u3400-\u9fff]/);
    assert.match(saved,/制作名片 \{name\}/);assert.match(saved,/Continue draft/);assert.match(saved,/Share card/);assert.match(saved,/Try the Gallery card template/);
  }finally{setLocale(previous);}
});
