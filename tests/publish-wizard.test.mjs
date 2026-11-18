import test from 'node:test';
import assert from 'node:assert/strict';
import {publishStepIssue} from '../public/publish-wizard.js';
test('source step cannot pass until an upload, completed build or website is present',()=>{
 assert.equal(publishStepIssue(0,{source:'html'}).field,'game-file');
 assert.equal(publishStepIssue(0,{source:'html',file:{name:'game.html'}}),null);
 assert.equal(publishStepIssue(0,{source:'github',ready:false}).field,'github-url');
 assert.equal(publishStepIssue(0,{source:'github',ready:true}),null);
 for(const url of ['','example.com','javascript:alert(1)','https://github.com/owner/repo'])assert.equal(publishStepIssue(0,{source:'url',url}).field,'publish-url');
 assert.equal(publishStepIssue(0,{source:'url',url:'https://bingosun.vercel.app/'}),null);
});
test('details step requires a meaningful title, introduction and category before cover selection',()=>{
 const good={name:'作品',desc:'介绍',category:'game'};assert.equal(publishStepIssue(1,good),null);
 for(const [key,field] of [['name','publish-name'],['desc','publish-desc'],['category','publish-category']])assert.equal(publishStepIssue(1,{...good,[key]:' '}).field,field);
});
