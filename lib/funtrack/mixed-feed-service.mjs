import {fail,discoverQuery,encodeDiscoverCursor,decodeDiscoverCursor} from './rules.mjs';

const invalid=()=>fail(400,'INVALID_CURSOR','发现页游标与当前筛选不符或已无效，请重新加载');
export function createMixedFeedService({db,readWorks,cardFeed,json}){
  return async function discover(url,user){
    const params=new URLSearchParams(url.searchParams),type=params.get('type')||'works';params.delete('type');
    if(!['all','works','cards'].includes(type))fail(422,'INVALID_FEED_TYPE','请选择全部、作品或创作者名片。');
    if(type==='works')return readWorks(new URL(url.origin+url.pathname+'?'+params),user);
    for(const key of params.keys())if(!['q','source','category','sort','limit','cursor',...(user?['following']:[])].includes(key))fail(422,'INVALID_QUERY','发现页不支持此筛选。');
    const query=discoverQuery(params);
    if(query.category||query.source!=='all'||!['recommended','newest'].includes(query.sort))fail(422,'WORK_FILTER_ONLY','作品分类及互动排序请使用作品视图。');
    const scope=user?(query.following?'following:':'signed:')+user.id:'guest';
    const filters={type,q:query.q,sort:query.sort,following:Boolean(query.following)};
    let cursor=null;
    const raw=params.get('cursor');
    if(raw){
      try{
        if(raw.length>8192||!/^[A-Za-z0-9_-]+$/.test(raw))return invalid();
        cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
        if(cursor.v!==2||cursor.scope!==scope||JSON.stringify(cursor.filters)!==JSON.stringify(filters))return invalid();
        if(typeof cursor.asOf!=='string'||new Date(cursor.asOf).toISOString()!==cursor.asOf||Date.parse(cursor.asOf)>Date.now())return invalid();
        if(!cursor.snapshot||['works','events','impressions','credits','cards'].some(k=>!Number.isSafeInteger(cursor.snapshot[k])||cursor.snapshot[k]<0))return invalid();
        if(!Number.isInteger(cursor.turn)||cursor.turn<0||cursor.turn>3||!Number.isSafeInteger(cursor.lastCard)||cursor.lastCard<0||cursor.lastCard>cursor.snapshot.cards)return invalid();
        if(cursor.workCursor!==null){
          const work=decodeDiscoverCursor(cursor.workCursor,query);
          if(!work||work.asOf!==cursor.asOf||JSON.stringify(work.snapshot)!==JSON.stringify(cursor.snapshot))return invalid();
        }
      }catch{return invalid();}
    }
    const asOf=cursor?.asOf||new Date().toISOString();
    const snapshot=cursor?.snapshot||await db().prepare(`SELECT
      (SELECT COALESCE(MAX(rowid),0) FROM ft_works) works,
      (SELECT COALESCE(MAX(rowid),0) FROM ft_events) events,
      (SELECT COALESCE(MAX(rowid),0) FROM ft_feed_impressions) impressions,
      (SELECT COALESCE(MAX(rowid),0) FROM ft_contribution_credits) credits,
      (SELECT COALESCE(MAX(seq),0) FROM ft_card_feed_selections) cards`).first();
    const workURL=new URL(url);workURL.searchParams.delete('type');workURL.searchParams.delete('cursor');
    if(cursor?.workCursor)workURL.searchParams.set('cursor',cursor.workCursor);
    const [workPage,cardPage]=await Promise.all([
      type==='cards'?{works:[],positions:[],nextCursor:null,total:0}:readWorks(workURL,user,false,{asOf,snapshot}),
      cardFeed.page({query,asOf,snapshot,lastCard:cursor?.lastCard||0,user}),
    ]);
    let wi=0,ci=0,turn=cursor?.turn||0,lastCard=cursor?.lastCard||0,workCursor=cursor?.workCursor||null;
    const items=[];
    // Two keyset streams, never offsets: removing a row cannot shift a later
    // page. When both streams have results, every fourth item is a creator card.
    while(items.length<query.limit&&(wi<workPage.works.length||ci<cardPage.cards.length)){
      if(ci<cardPage.cards.length&&(type==='cards'||turn===3||wi>=workPage.works.length)){
        items.push(cardPage.cards[ci]);lastCard=cardPage.positions[ci++];
      }else{
        items.push({type:'work',...workPage.works[wi]});workCursor=workPage.positions[wi++];
      }
      turn=(turn+1)%4;
    }
    const hasMore=wi<workPage.works.length||Boolean(workPage.nextCursor)||ci<cardPage.cards.length;
    return json({items,works:items.filter(item=>item.type==='work'),total:workPage.total+cardPage.total,sort:query.sort,asOf,
      nextCursor:hasMore?encodeDiscoverCursor({v:2,scope,filters,asOf,snapshot,turn,lastCard,workCursor}):null});
  };
}
