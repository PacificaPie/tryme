import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('ft_profiles', {
  id: text('id').primaryKey(), name: text('name').notNull(), bio: text('bio').notNull().default(''),
});
export const works = sqliteTable('ft_works', {
  id: text('id').primaryKey(), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  name: text('name').notNull(), description: text('description').notNull(), source: text('source').notNull(),
  currentVersionId: text('current_version_id').notNull(), url: text('url'), createdAt: text('created_at').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
}, t => [uniqueIndex('ft_works_owner_key').on(t.authorId, t.idempotencyKey), index('ft_works_owner_created').on(t.authorId,t.createdAt)]);
export const versions = sqliteTable('ft_work_versions', {
  id: text('id').primaryKey(), workId: text('work_id').notNull().references(()=>works.id), version: text('version').notNull(),
  gameKey: text('game_key'), coverKey: text('cover_key'), coverMime: text('cover_mime'), createdAt: text('created_at').notNull(),
}, t => [index('ft_versions_work').on(t.workId)]);
export const cards = sqliteTable('ft_cards', {
  id: text('id').primaryKey(), authorId: text('author_id').notNull(), snapshotJson: text('snapshot_json').notNull(), createdAt: text('created_at').notNull(),
  idempotencyKey: text('idempotency_key'), requestHash: text('request_hash'),
}, t => [index('ft_cards_owner_created').on(t.authorId,t.createdAt),uniqueIndex('ft_cards_owner_key').on(t.authorId,t.idempotencyKey)]);
export const sessions = sqliteTable('ft_play_sessions', {
  id: text('id').primaryKey(), actorId: text('actor_id').notNull(), workId: text('work_id').notNull().references(()=>works.id),
  versionId: text('version_id').notNull().references(()=>versions.id), tokenHash: text('token_hash').notNull(),
  createdAt: text('created_at').notNull(), expiresAt: text('expires_at').notNull(),
}, t => [index('ft_sessions_actor_created').on(t.actorId,t.createdAt)]);
export const events = sqliteTable('ft_events', {
  id: text('id').primaryKey(), clientEventId: text('client_event_id').notNull(), actorId: text('actor_id').notNull(),
  workId: text('work_id').references(()=>works.id), versionId: text('version_id').references(()=>versions.id),
  cardId: text('card_id').references(()=>cards.id), sessionId: text('session_id').references(()=>sessions.id),
  type: text('event_type').notNull(), seq: integer('seq'), elapsedMs: integer('elapsed_ms'), resultJson: text('result_json'), receivedAt: text('received_at').notNull(),
}, t => [uniqueIndex('ft_events_actor_client').on(t.actorId,t.clientEventId), uniqueIndex('ft_events_session_seq').on(t.sessionId,t.seq),
  uniqueIndex('ft_events_session_type').on(t.sessionId,t.type),index('ft_events_work_received').on(t.workId,t.receivedAt),index('ft_events_actor_received').on(t.actorId,t.receivedAt)]);
export const feedback = sqliteTable('ft_feedback', {
  id: text('id').primaryKey(), clientEventId: text('client_event_id').notNull(), workId: text('work_id').notNull().references(()=>works.id),
  versionId: text('version_id').notNull().references(()=>versions.id), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  text: text('text').notNull(), type: text('type').notNull(), createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('ft_feedback_author_client').on(t.authorId,t.clientEventId),index('ft_feedback_work_created').on(t.workId,t.createdAt)]);
