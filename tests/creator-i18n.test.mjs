import test from 'node:test';
import assert from 'node:assert/strict';
import {createI18n,getLocale,setLocale} from '../public/i18n.js';
import {creatorMessages} from '../public/creator-module.messages.js';
import {galleryMessages,applyGalleryLocale} from '../public/gallery/i18n.js';

test('creator interface interpolation leaves names, notes and placeholder-like user text literal',()=>{
  const i18n=createI18n({storage:()=>null,events:()=>null});i18n.registerMessages(creatorMessages);i18n.registerMessages(galleryMessages);
  i18n.setLocale('en');
  assert.equal(i18n.t('发布'),'Post');assert.equal(i18n.t('发布新版本'),'Publish new version');
  assert.equal(i18n.t('更新 {name}',{name:'发布 {version} <b>作品</b>'}),'Update 发布 {version} <b>作品</b>');
  assert.equal(i18n.t('回复 {name}',{name:'创作者'}),'Replying to 创作者');
  assert.equal(i18n.t('查看作品：{name}',{name:'未命名作品'}),'View work: 未命名作品');
  assert.equal(i18n.t('已选 {count} 件作品',{count:3}),'Selected: 3');
  i18n.setLocale('zh-CN');assert.equal(i18n.t('更新 {name}',{name:'My Game'}),'更新 My Game');
});

test('iframe localization changes only declared interface nodes and keeps creator content intact',()=>{
  const previous={document:globalThis.document,window:globalThis.window,locale:getLocale()};
  const nodes=new Map();const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{textContent:'',attributes:{},setAttribute(name,value){this.attributes[name]=value;}});return nodes.get(selector);};
  node('#name').textContent='作品';node('#bio').textContent='发布';node('#works').textContent='创作者写的原文';
  const document={documentElement:{lang:'zh-CN'},title:'',querySelector:selector=>node(selector),getElementById:id=>node('#'+id)};
  globalThis.document=document;globalThis.window={FuntrackGallery:{pageSize:6}};
  try{
    applyGalleryLocale('gallery','en',{first:true});
    assert.equal(document.documentElement.lang,'en');assert.equal(node('#enter').textContent,'Enter gallery ↗');assert.equal(node('#left').attributes['aria-label'],'Previous work');
    assert.equal(node('#flip').title,'Show back');assert.equal(globalThis.window.FuntrackGallery.t('试玩 ↗'),'Play ↗');
    applyGalleryLocale('collection','en',{first:true});assert.equal(node('#details summary').textContent,'Work list');assert.equal(node('#fallback-title').textContent,'Preparing works');
    assert.equal(node('#name').textContent,'作品');assert.equal(node('#bio').textContent,'发布');assert.equal(node('#works').textContent,'创作者写的原文');
    applyGalleryLocale('gallery','zh-CN',{first:true});assert.equal(node('#enter').textContent,'走进展厅 ↗');assert.equal(node('#left').attributes['aria-label'],'上一件作品');
  }finally{globalThis.document=previous.document;globalThis.window=previous.window;setLocale(previous.locale);}
});
