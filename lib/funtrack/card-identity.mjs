import {cardSnapshot} from './rules.mjs';
import {safeAvatarURL} from './avatar-rules.mjs';

// A saved card freezes its design and selected works, but identifies the
// current person. A present profile is authoritative even for cleared fields.
export function cardWithProfile(snapshot,profile){
  const card=cardSnapshot(snapshot);
  if(!profile)return card;
  const name=profile.name??'',avatarUrl=safeAvatarURL(profile.avatar_url);
  return {...card,name,bio:profile.bio??'',headline:profile.headline??'',website:profile.website??'',avatarUrl,
    works:Array.isArray(card.works)?card.works.map(work=>work&&(work.authorId??card.authorId)===card.authorId?{...work,authorName:name,authorAvatarUrl:avatarUrl}:work):card.works};
}

export async function cardIdentity(db,snapshot,authorId=snapshot.authorId){
  const profile=await db.prepare('SELECT * FROM ft_profiles WHERE id=?').bind(authorId).first();
  return cardWithProfile({...snapshot,authorId},profile);
}

// Directory reads are bounded batches rather than a profile query per card.
export async function cardRowIdentities(db,rows){
  const ids=[...new Set(rows.map(row=>row.author_id))],profiles=[];
  for(let at=0;at<ids.length;at+=80){
    const batch=ids.slice(at,at+80);
    const result=await db.prepare(`SELECT * FROM ft_profiles WHERE id IN (${batch.map(()=>'?').join(',')})`).bind(...batch).all();
    profiles.push(...result.results);
  }
  const byId=new Map(profiles.map(profile=>[profile.id,profile]));
  return rows.map(row=>cardWithProfile({...JSON.parse(row.snapshot_json),id:row.id,authorId:row.author_id},byId.get(row.author_id)));
}
