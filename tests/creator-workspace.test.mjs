import test from 'node:test';
import assert from 'node:assert/strict';
import {creatorWorkspace, workspaceSection, publishResumeMarkup} from '../public/creator-workspace.js';
import {setLocale} from '../public/i18n.js';

test('workspace contains management subroutes, preserves work context and excludes public/guest views',()=>{
  for(const [path,section] of [['/studio','works'],['/studio/works','works'],['/studio/works/id/edit','works'],['/studio/works/id/versions/v1','works'],['/publish','works'],['/published/id','works'],['/cards','cards'],['/cards/me/preview','cards'],['/cards/templates/city','cards'],['/cards/covers/id','cards'],['/studio/data','data'],['/studio/feedback','feedback']]){
    const route={path,params:new URLSearchParams('work=retained')};
    assert.equal(workspaceSection(route),section);
    const html=creatorWorkspace('<h1>Current content</h1>',{route,user:{id:'owner/with?chars'}});
    assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
    assert.match(html,/#\/author\/owner%2Fwith%3Fchars/);
    assert.match(html,/#\/studio\/feedback\?tab=history/);
    assert.match(html,/<h1>Current content<\/h1>/);
    assert.equal(route.params.get('work'),'retained');
    assert.equal(creatorWorkspace('sign in',{route}), 'sign in');
  }
  for(const path of ['/feed','/following','/card/someone','/author/me','/welcome','/notifications','/studio-unknown']){
    assert.equal(creatorWorkspace('content',{route:{path},user:{id:'me'}}),'content');
  }
  assert.equal(workspaceSection({path:'/cards',params:new URLSearchParams('following=1')}),null);
});

test('resuming publishing ignores default metadata and does not expose or modify draft content',()=>{
  const defaults={key:'key',source:'html',step:0,name:' ',desc:'',url:''};
  assert.equal(publishResumeMarkup(defaults),'');
  for(const draft of [{...defaults,name:'<script>private draft</script>'},{...defaults,githubURL:'https://github.com/owner/repo'},{...defaults,url:'https://example.com'}]){
    const before=structuredClone(draft),html=publishResumeMarkup(draft);
    assert.match(html,/href="#\/publish"/);assert.doesNotMatch(html,/script|private draft|github.com|example.com/);
    assert.deepEqual(draft,before);
  }
  assert.match(publishResumeMarkup(defaults,{name:'selected.html'}),/href="#\/publish"/);
});

test('workspace navigation and draft continuation localize together',()=>{
  setLocale('en');
  try{
    const html=creatorWorkspace(publishResumeMarkup({name:'Draft'}),{route:{path:'/studio/works'},user:{id:'me'}});
    assert.match(html,/Public profile/);assert.match(html,/Browse Feed/);assert.match(html,/Continue draft/);
    assert.doesNotMatch(html,/[\u3400-\u9fff]/);
  }finally{setLocale('zh-CN');}
});
