import {fail,requiredText,safeURL,cardSnapshot} from './rules.mjs';
import {DISCOVERY_ELIGIBLE,DISCOVERY_JOIN} from './discovery-service.mjs';
import {AVATAR_MAX_BYTES,AVATAR_PRESETS,avatarReadRoute,avatarImage,safeAvatarURL} from './avatar-rules.mjs';

export function createCreatorService({db,bucket,bodyJSON,readForm,json}){
  const sql=(query,...values)=>db().prepare(query).bind(...values);
  const first=(query,...values)=>sql(query,...values).first();
  const rows=async(query,...values)=>(await sql(query,...values).all()).results;
  const iso=()=>new Date().toISOString();
  const identityID=value=>{if(typeof value!=='string'||!value.trim()||value.length>256)fail(404,'CREATOR_NOT_FOUND','创作者不存在');return value;};
  const profileJSON=(id,row,fallback='创作者')=>({id,name:row?.name||fallback,bio:row?.bio||'',signature:row?.signature||'',headline:row?.headline||'',website:row?.website||'',backStyle:row?.back_style||'ink',avatarUrl:safeAvatarURL(row?.avatar_url)});
  async function me(user){return profileJSON(user.id,await first('SELECT * FROM ft_profiles WHERE id=?',user.id),user.name);}
  async function exists(id,user){
    if(id===user.id)return true;
    return Boolean(await first(`SELECT id FROM ft_profiles WHERE id=? UNION ALL SELECT author_id FROM ft_works WHERE author_id=? UNION ALL SELECT author_id FROM ft_cards WHERE author_id=? UNION ALL SELECT author_id FROM ft_comments WHERE author_id=? LIMIT 1`,id,id,id,id));
  }
  async function creator(id,user){
    identityID(id);if(!await exists(id,user))fail(404,'CREATOR_NOT_FOUND','创作者不存在');
    const row=await first(`SELECT p.*,
      COALESCE(p.name,(SELECT author_name FROM ft_works WHERE author_id=? ORDER BY created_at DESC LIMIT 1),(SELECT author_name FROM ft_comments WHERE author_id=? ORDER BY seq DESC LIMIT 1)) AS name
      FROM (SELECT ? AS creator_id) owner LEFT JOIN ft_profiles p ON p.id=owner.creator_id`,id,id,id);
    const value=profileJSON(id,row,id===user.id?user.name:'创作者');
    const counts=await first(`SELECT
      (SELECT COUNT(*) FROM ft_works w${DISCOVERY_JOIN} WHERE w.author_id=? AND ${DISCOVERY_ELIGIBLE}) AS works_count,
      (SELECT COUNT(*) FROM ft_creator_follows WHERE creator_id=?) AS followers_count,
      (SELECT COUNT(*) FROM ft_creator_follows WHERE follower_id=?) AS following_count,
      EXISTS(SELECT 1 FROM ft_creator_follows WHERE follower_id=? AND creator_id=?) AS followed`,id,id,id,user.id,id);
    return {...value,worksCount:Number(counts.works_count),followersCount:Number(counts.followers_count),followingCount:Number(counts.following_count),followedByMe:Boolean(counts.followed)};
  }
  async function currentCard(id){
    // Deleting the current card must not silently republish a previous edition.
    const row=await first('SELECT snapshot_json,deleted_at FROM ft_cards WHERE author_id=? ORDER BY rowid DESC LIMIT 1',id);
    return row&&!row.deleted_at?cardSnapshot(JSON.parse(row.snapshot_json)):null;
  }
  async function detail(id,user){return {creator:await creator(id,user),card:await currentCard(id)};}
  async function follow(id,user,following){
    identityID(id);if(typeof following!=='boolean')fail(422,'INVALID_FOLLOWING','following 必须明确为 true 或 false');
    if(id===user.id)fail(422,'SELF_FOLLOW','不能关注自己');
    if(!await exists(id,user))fail(404,'CREATOR_NOT_FOUND','创作者不存在');
    const change=following?sql('INSERT OR IGNORE INTO ft_creator_follows (follower_id,creator_id,created_at) VALUES (?,?,?)',user.id,id,iso()):sql('DELETE FROM ft_creator_follows WHERE follower_id=? AND creator_id=?',user.id,id);
    const result=await db().batch([sql('INSERT OR IGNORE INTO ft_profiles (id,name) VALUES (?,?)',user.id,user.name),change,sql('SELECT COUNT(*) n FROM ft_creator_follows WHERE creator_id=?',id)]);
    return {creatorId:id,following,followersCount:Number(result[2].results[0].n)};
  }
  async function list(url,user){
    const following=url.searchParams.get('following');if(following!==null&&!['0','1'].includes(following))fail(422,'INVALID_FOLLOWING','关注筛选无效');
    const limit=Number(url.searchParams.get('limit')||48);if(!Number.isInteger(limit)||limit<1||limit>100)fail(422,'INVALID_LIMIT','每页数量须为 1–100');
    const after=url.searchParams.get('after')||'';if(after.length>256)fail(422,'INVALID_CURSOR','创作者分页无效');
    const entries=await rows(`WITH identities AS (SELECT id FROM ft_profiles UNION SELECT author_id id FROM ft_works UNION SELECT author_id id FROM ft_cards UNION SELECT author_id id FROM ft_comments)
      SELECT owner.id creator_id,p.*,
        COALESCE(p.name,(SELECT author_name FROM ft_works WHERE author_id=owner.id ORDER BY created_at DESC LIMIT 1),(SELECT author_name FROM ft_comments WHERE author_id=owner.id ORDER BY seq DESC LIMIT 1),'创作者') display_name,
        (SELECT COUNT(*) FROM ft_works w${DISCOVERY_JOIN} WHERE w.author_id=owner.id AND ${DISCOVERY_ELIGIBLE}) works_count,
        (SELECT COUNT(*) FROM ft_creator_follows WHERE creator_id=owner.id) followers_count,
        (SELECT COUNT(*) FROM ft_creator_follows WHERE follower_id=owner.id) following_count,
        EXISTS(SELECT 1 FROM ft_creator_follows WHERE follower_id=? AND creator_id=owner.id) followed
      FROM identities owner LEFT JOIN ft_profiles p ON p.id=owner.id WHERE owner.id>?${following==='1'?' AND EXISTS(SELECT 1 FROM ft_creator_follows WHERE follower_id=? AND creator_id=owner.id)':''} ORDER BY owner.id LIMIT ?`,user.id,after,...following==='1'?[user.id]:[],limit+1);
    const page=entries.slice(0,limit),creators=page.map(row=>({...profileJSON(row.creator_id,{...row,name:row.display_name}),worksCount:Number(row.works_count),followersCount:Number(row.followers_count),followingCount:Number(row.following_count),followedByMe:Boolean(row.followed)}));
    return {creators,nextAfter:entries.length>limit?page.at(-1).creator_id:null};
  }
  async function updateProfile(user,input){
    const before=await me(user),value={...before};
    for(const [key,label,max,min] of [['name','名字',80,1],['bio','简介',500,0],['headline','身份 / 角色',120,0]])if(Object.hasOwn(input,key))value[key]=requiredText(input[key],label,max,min);
    if(Object.hasOwn(input,'website')){const text=requiredText(input.website,'个人网址',2000,0);value.website=text?safeURL(text):'';}
    if(Object.hasOwn(input,'avatarPreset')){
      if(input.avatarPreset===null)value.avatarUrl='';
      else if(AVATAR_PRESETS.includes(input.avatarPreset))value.avatarUrl='/avatars/'+input.avatarPreset+'.svg';
      else fail(422,'INVALID_AVATAR_PRESET','请选择现有插画头像');
    }
    // Update only supplied fields so an avatar-only/partial save cannot replay
    // stale profile text read before another request committed its changes.
    const updates=['name','bio','headline','website'].filter(key=>Object.hasOwn(input,key)).map(key=>`${key}=excluded.${key}`);
    if(Object.hasOwn(input,'avatarPreset'))updates.push('avatar_url=excluded.avatar_url');
    const changes=[
      sql(`INSERT INTO ft_profiles (id,name,bio,headline,website,signature,back_style,avatar_url) VALUES (?,?,?,?,?,?,?,?)
        ON CONFLICT(id) ${updates.length?'DO UPDATE SET '+updates.join(','):'DO NOTHING'}`,user.id,value.name,value.bio,value.headline,value.website,value.signature,value.backStyle,value.avatarUrl),
    ];
    if(Object.hasOwn(input,'name'))changes.push(sql('UPDATE ft_works SET author_name=? WHERE author_id=?',value.name,user.id));
    await db().batch(changes);
    return {user:await me(user)};
  }
  async function upload(request,user){
    const form=await readForm(request,AVATAR_MAX_BYTES+65536),file=form.get('avatar');
    if(!file||typeof file==='string'||typeof file.arrayBuffer!=='function')fail(422,'AVATAR_REQUIRED','请选择头像图片');
    if(file.size>AVATAR_MAX_BYTES)fail(413,'AVATAR_TOO_LARGE','头像须在 2 MiB 以内');
    const bytes=new Uint8Array(await file.arrayBuffer()),{mime}=avatarImage(bytes,file.type),id=crypto.randomUUID(),key='avatars/'+id;
    const profile=await me(user),avatarUrl='/api/public/avatars/'+id;
    await bucket().put(key,bytes,{httpMetadata:{contentType:mime}});
    try{
      await db().batch([
        sql('INSERT INTO ft_profile_avatars (id,owner_id,object_key,mime,byte_size,created_at) VALUES (?,?,?,?,?,?)',id,user.id,key,mime,bytes.length,iso()),
        sql(`INSERT INTO ft_profiles (id,name,bio,signature,headline,website,back_style,avatar_url) VALUES (?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET avatar_url=excluded.avatar_url`,user.id,profile.name,profile.bio,profile.signature,profile.headline,profile.website,profile.backStyle,avatarUrl),
      ]);
    }catch(error){
      // A lost commit acknowledgement must not remove an image already referenced.
      const committed=await first('SELECT id FROM ft_profile_avatars WHERE id=?',id).catch(()=>null);
      if(committed)return {user:await me(user)};
      // Keep uncertain storage writes for later cleanup; never delete a possibly committed snapshot asset.
      throw error;
    }
    return {user:await me(user)};
  }
  async function publicAvatar(request){
    const id=avatarReadRoute(request);if(!id)return null;
    const row=await first('SELECT object_key,mime FROM ft_profile_avatars WHERE id=?',id);
    if(!row||!['image/png','image/jpeg','image/webp'].includes(row.mime))fail(404,'AVATAR_NOT_FOUND','头像不存在');
    const object=await bucket().get(row.object_key);if(!object)fail(404,'AVATAR_NOT_FOUND','头像不存在');
    return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':row.mime,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Referrer-Policy':'no-referrer'}});
  }
  async function handle(request,user){
    const url=new URL(request.url);let parts;try{parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent);}catch{fail(404,'CREATOR_NOT_FOUND','创作者不存在');}
    if(request.method==='GET'&&parts[1]==='creators'){
      if(parts.length===2)return json(await list(url,user));
      if(parts.length===3)return json(await detail(parts[2],user));
    }
    if(request.method==='POST'){
      if(parts.length===4&&parts[1]==='creators'&&parts[3]==='follow')return json(await follow(parts[2],user,(await bodyJSON(request)).following));
      if(parts.length===3&&parts[1]==='me'&&parts[2]==='profile')return json(await updateProfile(user,await bodyJSON(request)));
      if(parts.length===3&&parts[1]==='me'&&parts[2]==='avatar')return json(await upload(request,user));
    }
    return null;
  }
  return {me,detail,handle,publicAvatar};
}
