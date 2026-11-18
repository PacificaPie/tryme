export const PAGE_SIZE=9;
const text=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
export function localMedia(value,origin){try{const u=new URL(value,origin);return u.origin===origin&&['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}}
export function cleanCityCard(payload,origin){
  if(!payload?.author||!Array.isArray(payload.works)||payload.works.length>30)return null;
  const seen=new Set(),works=[];
  for(const work of payload.works){if(!work||!text(work.id,160)||seen.has(work.id))return null;seen.add(work.id);works.push({id:work.id,name:text(work.name,140),desc:text(work.desc,1000),cover:work.cover?localMedia(work.cover,origin):'',kind:text(work.kind,80),version:text(work.version,40)});}
  const a=payload.author;let website='';try{const u=new URL(a.website);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)website=u.href;}catch{}
  return {author:{name:text(a.name,140),headline:text(a.headline,120),bio:text(a.bio,500),signature:text(a.signature,80),avatarUrl:a.avatarUrl?localMedia(a.avatarUrl,origin):'',website,backStyle:['ink','ivory','cobalt'].includes(a.backStyle)?a.backStyle:'ink'},works};
}
export function cityView(payload,works){
  const index=works.findIndex(w=>w.id===payload.focusWorkId),pages=Math.max(1,Math.ceil(works.length/PAGE_SIZE));
  return {face:payload.face==='back'?'back':'front',page:index>=0?Math.floor(index/PAGE_SIZE):Math.min(pages-1,Math.max(0,Number.isInteger(payload.page)?payload.page:0)),focusWorkId:index>=0?works[index].id:null};
}
