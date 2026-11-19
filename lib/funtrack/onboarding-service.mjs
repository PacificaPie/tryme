import { fail, requiredText } from './rules.mjs';

// createdAt comes only from the server-side Clerk user lookup. Never accept a
// browser's signup flag, local storage or request body as account age evidence.
export function createOnboardingService({ db, creators, bodyJSON, json }) {
  const sql = (query, ...values) => db().prepare(query).bind(...values);
  async function status(user, createdAt) {
    const row = await sql(`SELECT o.intent,o.creator_started_at,o.completed_at,r.started_at,
      EXISTS(SELECT 1 FROM ft_works WHERE author_id=?) AS has_works,
      EXISTS(SELECT 1 FROM ft_cards WHERE author_id=? AND deleted_at IS NULL) AS has_card
      FROM ft_onboarding_rollout r LEFT JOIN ft_onboarding o ON o.owner_id=? WHERE r.id=1`, user.id, user.id, user.id).first();
    const created = Number(createdAt);
    const eligible = user.id.startsWith('clerk:') && Number.isSafeInteger(created) && created > 0 && created >= row.started_at && created <= Date.now() + 60000;
    const hasWorks = Boolean(row.has_works), hasCard = Boolean(row.has_card);
    return {
      intent: row.intent || null, required: eligible && !row.completed_at && !hasWorks && !hasCard,
      creatorReady: Boolean(row.creator_started_at) || hasWorks || hasCard,
      needsCreatorProfile: (eligible || Boolean(row.intent)) && !row.creator_started_at && !hasWorks && !hasCard,
      hasWorks, hasCard,
    };
  }
  async function handle(request, user) {
    if (new URL(request.url).pathname !== '/api/me/onboarding' || request.method !== 'POST') return null;
    const input = await bodyJSON(request);
    if (!['discover', 'create'].includes(input.intent)) fail(422, 'INVALID_INTENT', '请选择浏览作品或发布作品');
    const time = new Date().toISOString(), changes = [];
    if (input.intent === 'create') {
      const name = requiredText(input.name, '公开昵称', 80, 1);
      // Nickname and preference commit together. Partial profile fields and
      // immutable card/work snapshots retain their existing semantics.
      changes.push(sql('INSERT INTO ft_profiles (id,name) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', user.id, name));
      changes.push(sql('UPDATE ft_works SET author_name=? WHERE author_id=?', name, user.id));
    }
    changes.push(sql(`INSERT INTO ft_onboarding (owner_id,intent,creator_started_at,completed_at) VALUES (?,?,?,?)
      ON CONFLICT(owner_id) DO UPDATE SET intent=excluded.intent,
      creator_started_at=COALESCE(ft_onboarding.creator_started_at,excluded.creator_started_at),completed_at=excluded.completed_at`,
    user.id, input.intent, input.intent === 'create' ? time : null, time));
    await db().batch(changes);
    return json({ user: await creators.me(user), onboarding: await status(user, request.headers.get('oai-authenticated-user-created-at')) });
  }
  return { status, handle };
}
