// Account-bound state; no storage, telemetry, polling or optimistic read writes.
export function createNotificationState({api,owner,onChange=()=>{},onSessionChanged=()=>{},timeoutMs=12000,now=()=>Date.now()}){
  const state={owner,items:[],filter:'all',work:'',nextCursor:null,snapshot:0,hasUnread:false,summaryKnown:false,
    loaded:false,loading:false,pending:false,error:'',summaryError:false,members:new Map()};
  let alive=true,listToken=0,summaryToken=0,revision=0,lastSummary=-Infinity,summaryOrder=0,acceptedSummaryOrder=0;
  const controllers=new Set();
  const emit=()=>{if(alive)onChange(state);};
  const url=(path,params={})=>path+'?'+new URLSearchParams({expectedRecipientId:owner,...params});
  function invalidate(){alive=false;listToken++;summaryToken++;for(const controller of controllers)controller.abort();controllers.clear();}
  function sessionFailure(error){
    if(error?.status===401||error?.code==='AUTH_SESSION_CHANGED'){
      state.items=[];state.members.clear();state.hasUnread=false;state.summaryKnown=false;
      invalidate();onSessionChanged();return true;
    }return false;
  }
  async function request(path,options={}){
    const controller=new AbortController();controllers.add(controller);let timer;
    try{
      const result=await Promise.race([api(path,{...options,signal:controller.signal}),new Promise((_,reject)=>{
        timer=setTimeout(()=>{controller.abort();reject(new Error('加载超时，请重试。'));},timeoutMs);
      })]);
      if(result?.recipientId!==owner)throw Object.assign(new Error('登录账号已变化，请刷新页面后重试。'),{code:'AUTH_SESSION_CHANGED'});
      return result;
    }finally{clearTimeout(timer);controllers.delete(controller);}
  }
  function acceptSummary(data,order){
    if(typeof data.hasUnread!=='boolean'||!Number.isSafeInteger(data.snapshot)||data.snapshot<0)throw new Error('暂时无法加载互动');
    // Lists and badge requests share this state. Request order also protects
    // same-snapshot read changes from another tab; event sequence alone cannot.
    if(order<acceptedSummaryOrder)return;
    acceptedSummaryOrder=order;
    state.hasUnread=data.hasUnread;state.summaryKnown=true;state.summaryError=false;
  }
  async function refreshSummary(force=false){
    if(!alive||state.pending||(!force&&now()-lastSummary<15000))return;
    lastSummary=now();const token=++summaryToken,rev=revision,order=++summaryOrder;
    try{
      const data=await request(url('/api/notifications/summary'));
      if(!alive||token!==summaryToken||rev!==revision)return;
      acceptSummary(data,order);emit();
    }catch(error){if(alive&&token===summaryToken&&rev===revision&&!sessionFailure(error)&&order>=acceptedSummaryOrder){state.summaryError=true;emit();}}
  }
  async function load({filter=state.filter,work=state.work,more=false}={}){
    if(!alive||state.pending)return;
    if(more&&(!state.nextCursor||state.loading))return;
    const token=++listToken,rev=revision,order=++summaryOrder,changed=filter!==state.filter||work!==state.work;
    if(changed){state.items=[];state.nextCursor=null;state.loaded=false;state.members.clear();}
    state.filter=filter;state.work=work;state.loading=true;state.error='';emit();
    const cursor=more?state.nextCursor:null;
    try{
      const data=await request(url('/api/notifications',{filter,...work?{work}:{},...cursor?{cursor}:{}}));
      if(!alive||token!==listToken||rev!==revision)return;
      if(!Array.isArray(data.items)||(data.nextCursor!==null&&typeof data.nextCursor!=='string')||data.items.some(item=>!Number.isSafeInteger(item.id)||!item.actor||!['work_like','comment_like','comment','reply','follow'].includes(item.kind)))throw new Error('暂时无法加载互动');
      acceptSummary(data,order);
      const existing=new Set(state.items.map(item=>item.id));
      state.items=more?[...state.items,...data.items.filter(item=>!existing.has(item.id))]:data.items;
      state.nextCursor=data.nextCursor;state.snapshot=data.snapshot;state.loaded=true;
      if(!more)state.members.clear();
    }catch(error){if(alive&&token===listToken&&rev===revision&&!sessionFailure(error))state.error=error.message||'暂时无法加载互动';}
    finally{if(alive&&token===listToken){state.loading=false;emit();}}
  }
  async function mark(id=null){
    if(!alive||state.pending||!state.loaded)return false;
    const through=state.snapshot,order=++summaryOrder;
    state.pending=true;state.error='';revision++;listToken++;summaryToken++;state.loading=false;emit();
    try{
      const data=await request('/api/notifications/'+(id===null?'read-all':id+'/read'),{method:'POST',body:{expectedRecipientId:owner,...id===null?{through}:{}}});
      if(!alive)return false;acceptSummary(data,order);
      state.items=state.items.map(item=>id===null||item.id===id?{...item,unread:false}:item);
      return true;
    }catch(error){if(alive&&!sessionFailure(error))state.error=error.message||'暂时没能保存已读状态，请重试。';return false;}
    finally{if(alive){state.pending=false;emit();}}
  }
  async function loadMembers(id,more=false){
    if(!alive)return;
    const previous=state.members.get(id)||{actors:[],nextCursor:null,loading:false,error:''};
    if(previous.loading||(more&&!previous.nextCursor))return;
    const current={...previous,loading:true,error:''};state.members.set(id,current);emit();
    try{
      const data=await request(url('/api/notifications/'+id+'/actors',more?{cursor:previous.nextCursor}:{}));
      if(!alive||state.members.get(id)!==current)return;
      if(data.id!==id||!Array.isArray(data.actors))throw new Error('暂时无法加载互动');
      const seen=new Set(previous.actors.map(actor=>actor.id));
      current.actors=more?[...previous.actors,...data.actors.filter(actor=>!seen.has(actor.id))]:data.actors;current.nextCursor=data.nextCursor;
    }catch(error){if(alive&&state.members.get(id)===current&&!sessionFailure(error))current.error=error.message||'暂时无法加载互动';}
    finally{if(alive&&state.members.get(id)===current){current.loading=false;emit();}}
  }
  return {state,load,refreshSummary,mark,loadMembers,dispose:invalidate};
}
