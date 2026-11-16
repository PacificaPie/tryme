export const STORAGE_KEY = 'funtrack.prototype.v1';
export const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const emptyDraft = () => ({id:uid(),title:'',url:'',description:'',cover:''});
export function initialState() {
  return {version:1,signedIn:false,profile:{id:'local-creator',name:'',bio:''},works:[],feedback:[],draft:emptyDraft(),feedbackDrafts:{},cardGenerated:false,cardOpen:false,lastPublished:null};
}
export function escapeHTML(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
export function validURL(value) {
  try {const u=new URL(value); return ['https:','http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;} catch {return null;}
}
export function normalizeState(raw) {
  const base=initialState();
  if(!raw || raw.version!==1) return base;
  return {...base,...raw,profile:{...base.profile,...raw.profile},works:Array.isArray(raw.works)?raw.works:[],feedback:Array.isArray(raw.feedback)?raw.feedback:[],draft:{...base.draft,...raw.draft},feedbackDrafts:raw.feedbackDrafts && typeof raw.feedbackDrafts==='object'?raw.feedbackDrafts:{}};
}
export function createStore(storage) {
  let state=initialState(),readError=null;
  try {const saved=storage.getItem(STORAGE_KEY);if(saved)state=normalizeState(JSON.parse(saved));} catch(error) {readError=error;}
  return {
    get:()=>state,
    readError,
    commit(update) {
      const next=typeof update==='function'?update(structuredClone(state)):{...state,...update};
      storage.setItem(STORAGE_KEY,JSON.stringify(next));
      state=next;
      return state;
    }
  };
}
export function publishDraft(state) {
  if(!state.signedIn) throw new Error('请先登录');
  const d=state.draft;
  const existing=state.works.find(w=>w.id===d.id);
  if(existing) return {state,work:existing};
  if(!d.title.trim())throw new Error('填写作品名称');
  const url=validURL(d.url.trim());
  if(!url)throw new Error('填写有效的 http 或 https 链接');
  if(!d.description.trim())throw new Error('用一句话说明怎么玩');
  const work={id:d.id,title:d.title.trim(),description:d.description.trim(),url,cover:d.cover||'assets/tiles.svg',kind:'external',author:state.profile.name,authorId:state.profile.id,createdAt:new Date().toISOString(),version:1};
  return {state:{...state,works:[work,...state.works],draft:emptyDraft(),lastPublished:work.id},work};
}
