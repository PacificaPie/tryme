import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const profiles = sqliteTable('ft_profiles', {
  id: text('id').primaryKey(), name: text('name').notNull(), bio: text('bio').notNull().default(''),
  signature: text('signature').notNull().default(''), headline: text('headline').notNull().default(''),
  website: text('website').notNull().default(''), backStyle: text('back_style').notNull().default('ink'),
});
export const works = sqliteTable('ft_works', {
  id: text('id').primaryKey(), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  name: text('name').notNull(), description: text('description').notNull(), source: text('source').notNull(),
  currentVersionId: text('current_version_id').notNull(), url: text('url'), createdAt: text('created_at').notNull(),
  currentMetadataId: text('current_metadata_id'), initialMetadataId: text('initial_metadata_id'),
  revision: integer('revision').notNull().default(1), updatedAt: text('updated_at').notNull().default(''),
  idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
}, t => [uniqueIndex('ft_works_owner_key').on(t.authorId, t.idempotencyKey), index('ft_works_owner_created').on(t.authorId,t.createdAt,t.id),
  index('ft_works_created_id').on(t.createdAt,t.id),index('ft_works_source_created').on(t.source,t.createdAt,t.id)]);
export const workMetadata = sqliteTable('ft_work_metadata', {
  id: text('id').primaryKey(), workId: text('work_id').notNull().references(()=>works.id),
  name: text('name').notNull(), description: text('description').notNull(), coverKey: text('cover_key'), coverMime: text('cover_mime'),
  createdAt: text('created_at').notNull(), createdBy: text('created_by').notNull(),
}, t=>[index('ft_work_metadata_work').on(t.workId)]);
export const workEditOperations = sqliteTable('ft_work_edit_operations', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), workId: text('work_id').notNull().references(()=>works.id),
  idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(), metadataId: text('metadata_id'),
  previousRevision: integer('previous_revision').notNull(), revision: integer('revision').notNull(), changed: integer('changed').notNull(),
  responseJson: text('response_json').notNull(), createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('ft_work_edits_owner_key').on(t.ownerId,t.idempotencyKey),index('ft_work_edits_work').on(t.workId,t.createdAt)]);
export const workLikes = sqliteTable('ft_work_likes', {
  workId: text('work_id').notNull().references(()=>works.id), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
}, t => [primaryKey({columns:[t.workId,t.actorId]}),index('ft_work_likes_work_created').on(t.workId,t.createdAt)]);
export const versions = sqliteTable('ft_work_versions', {
  id: text('id').primaryKey(), workId: text('work_id').notNull().references(()=>works.id), version: text('version').notNull(),
  gameKey: text('game_key'), provenanceJson: text('provenance_json'), coverKey: text('cover_key'), coverMime: text('cover_mime'), createdAt: text('created_at').notNull(),
  ordinal: integer('ordinal').notNull().default(1), releaseNotes: text('release_notes').notNull().default(''),
  contentHash: text('content_hash'), createdBy: text('created_by'),
}, t => [index('ft_versions_work').on(t.workId),uniqueIndex('ft_versions_work_ordinal').on(t.workId,t.ordinal)]);
export const versionOperations = sqliteTable('ft_version_operations', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), workId: text('work_id').notNull().references(()=>works.id),
  action: text('action').notNull(), idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
  fromVersionId: text('from_version_id').notNull().references(()=>versions.id), toVersionId: text('to_version_id').notNull().references(()=>versions.id),
  previousRevision: integer('previous_revision').notNull(), revision: integer('revision').notNull(), changed: integer('changed').notNull(),
  createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('ft_version_operations_owner_key').on(t.ownerId,t.idempotencyKey),index('ft_version_operations_work_created').on(t.workId,t.createdAt)]);
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

// Public-to-the-site discussion is separate from legacy private feedback.
// The monotonic sequence gives stable root/reply pagination even within one ms.
export const comments = sqliteTable('ft_comments', {
  seq: integer('seq').primaryKey({autoIncrement:true}), id: text('id').notNull().unique(),
  workId: text('work_id').notNull().references(()=>works.id), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  body: text('body').notNull(), parentId: text('parent_id').references(():AnySQLiteColumn=>comments.id), createdAt: text('created_at').notNull(),
  idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
}, t=>[uniqueIndex('ft_comments_author_key').on(t.authorId,t.idempotencyKey),index('ft_comments_work_seq').on(t.workId,t.seq),
  index('ft_comments_parent_seq').on(t.parentId,t.seq),index('ft_comments_author_created').on(t.authorId,t.createdAt),index('ft_comments_work_created').on(t.workId,t.createdAt)]);
export const commentLikes = sqliteTable('ft_comment_likes', {
  commentId: text('comment_id').notNull().references(()=>comments.id), actorId: text('actor_id').notNull(), createdAt: text('created_at').notNull(),
}, t=>[primaryKey({columns:[t.commentId,t.actorId]})]);

export const buildWorkers = sqliteTable('ft_build_workers', {
  id: text('id').primaryKey(), lastSeenAt: text('last_seen_at').notNull(),
}, t=>[index('ft_build_workers_seen').on(t.lastSeenAt)]);
export const buildJobs = sqliteTable('ft_build_jobs', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
  sourceUrl: text('source_url').notNull(), repository: text('repository').notNull(), commitSha: text('commit_sha').notNull(),
  status: text('status').notNull(), logs: text('logs').notNull().default(''), error: text('error'), metadataJson: text('metadata_json'),
  artifactKey: text('artifact_key'), artifactBytes: integer('artifact_bytes'), artifactHash: text('artifact_hash'),
  workerId: text('worker_id'), leaseId: text('lease_id'), leaseExpiresAt: text('lease_expires_at'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[uniqueIndex('ft_build_jobs_owner_key').on(t.ownerId,t.idempotencyKey),index('ft_build_jobs_owner_created').on(t.ownerId,t.createdAt),
  index('ft_build_jobs_queue').on(t.status,t.createdAt),index('ft_build_jobs_lease').on(t.workerId,t.status,t.leaseExpiresAt)]);
