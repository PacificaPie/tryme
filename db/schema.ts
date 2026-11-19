import { sqliteTable, text, integer, index, uniqueIndex, primaryKey, check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const profiles = sqliteTable('ft_profiles', {
  id: text('id').primaryKey(), name: text('name').notNull(), bio: text('bio').notNull().default(''),
  signature: text('signature').notNull().default(''), headline: text('headline').notNull().default(''),
  website: text('website').notNull().default(''), backStyle: text('back_style').notNull().default('ink'),
  avatarUrl: text('avatar_url').notNull().default(''),
});
export const onboardingRollout = sqliteTable('ft_onboarding_rollout', {
  id: integer('id').primaryKey(), startedAt: integer('started_at').notNull(),
}, t=>[check('ft_onboarding_rollout_singleton',sql`${t.id} = 1`)]);
export const onboarding = sqliteTable('ft_onboarding', {
  ownerId: text('owner_id').primaryKey(), intent: text('intent').notNull(),
  creatorStartedAt: text('creator_started_at'), completedAt: text('completed_at').notNull(),
}, t=>[check('ft_onboarding_intent',sql`${t.intent} IN ('discover','create')`)]);
export const creatorFollows = sqliteTable('ft_creator_follows', {
  followerId: text('follower_id').notNull(), creatorId: text('creator_id').notNull(), createdAt: text('created_at').notNull(),
}, t=>[primaryKey({columns:[t.followerId,t.creatorId]}),check('ft_creator_follows_not_self',sql`${t.followerId} <> ${t.creatorId}`),index('ft_creator_follows_creator').on(t.creatorId,t.createdAt,t.followerId),index('ft_creator_follows_follower').on(t.followerId,t.createdAt,t.creatorId)]);
// Recipient-scoped inbox facts. Target IDs stay independent of source lifetime;
// missing/deleted content is projected as unavailable, without cached body text.
export const notifications = sqliteTable('ft_notifications', {
  seq: integer('seq').primaryKey({autoIncrement:true}), recipientId: text('recipient_id').notNull(),
  actorId: text('actor_id').notNull(), kind: text('kind').notNull(), targetId: text('target_id').notNull(),
  workId: text('work_id'), createdAt: text('created_at').notNull(), readAt: text('read_at'),
  active: integer('active').notNull().default(1),
}, t=>[uniqueIndex('ft_notifications_event').on(t.recipientId,t.kind,t.actorId,t.targetId),
  index('ft_notifications_inbox').on(t.recipientId,t.active,t.seq),index('ft_notifications_unread').on(t.recipientId,t.active,t.readAt,t.seq),
  index('ft_notifications_group').on(t.recipientId,t.kind,t.targetId,t.seq),
  check('ft_notifications_not_self',sql`${t.recipientId} <> ${t.actorId}`),
  check('ft_notifications_kind',sql`${t.kind} IN ('work_like','comment_like','comment','reply','follow')`),
  check('ft_notifications_active',sql`${t.active} IN (0,1)`)]);
export const profileAvatars = sqliteTable('ft_profile_avatars', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), objectKey: text('object_key').notNull(), mime: text('mime').notNull(),
  byteSize: integer('byte_size').notNull(), createdAt: text('created_at').notNull(),
}, t=>[index('ft_profile_avatars_owner').on(t.ownerId,t.createdAt)]);
export const works = sqliteTable('ft_works', {
  id: text('id').primaryKey(), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  name: text('name').notNull(), description: text('description').notNull(), source: text('source').notNull(),
  currentVersionId: text('current_version_id').notNull(), url: text('url'), createdAt: text('created_at').notNull(),
  currentMetadataId: text('current_metadata_id'), initialMetadataId: text('initial_metadata_id'),
  revision: integer('revision').notNull().default(1), updatedAt: text('updated_at').notNull().default(''),
  archivedAt: text('archived_at'),
  idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
}, t => [uniqueIndex('ft_works_owner_key').on(t.authorId, t.idempotencyKey), index('ft_works_owner_created').on(t.authorId,t.createdAt,t.id),
  index('ft_works_created_id').on(t.createdAt,t.id),index('ft_works_source_created').on(t.source,t.createdAt,t.id),
  index('ft_works_owner_archived_created').on(t.authorId,t.archivedAt,t.createdAt,t.id)]);
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
// Identity claims deduplicate new uploads without merging legacy works.
export const workFingerprints = sqliteTable('ft_work_fingerprints', {
  ownerId: text('owner_id').notNull(), kind: text('kind').notNull(), fingerprint: text('fingerprint').notNull(),
  workId: text('work_id').notNull().references(()=>works.id), versionId: text('version_id').notNull().references(()=>versions.id),
  createdAt: text('created_at').notNull(),
}, t=>[primaryKey({columns:[t.ownerId,t.kind,t.fingerprint]}),index('ft_work_fingerprints_work').on(t.workId)]);
// Discovery eligibility is independent of direct links, immutable cards and
// ownership. Listed visibility alone controls discovery; review fields remain
// historical. Publication explicitly lists new work via the 0008 trigger.
export const workDiscovery = sqliteTable('ft_work_discovery', {
  workId: text('work_id').primaryKey().references(()=>works.id), visibility: text('visibility').notNull().default('unlisted'),
  category: text('category').notNull().default('other'),
  reviewStatus: text('review_status').notNull().default('unsubmitted'), kind: text('kind').notNull().default('unspecified'),
  playDescription: text('play_description').notNull().default(''), submittedVersionId: text('submitted_version_id').references(()=>versions.id),
  approvedVersionId: text('approved_version_id').references(()=>versions.id), reviewNote: text('review_note').notNull().default(''),
  reviewedBy: text('reviewed_by'), revision: integer('revision').notNull().default(1), updatedAt: text('updated_at').notNull(),
}, t=>[index('ft_work_discovery_category').on(t.category,t.visibility),index('ft_work_discovery_review').on(t.reviewStatus,t.updatedAt),index('ft_work_discovery_visibility').on(t.visibility,t.reviewStatus)]);
export const versionOperations = sqliteTable('ft_version_operations', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), workId: text('work_id').notNull().references(()=>works.id),
  action: text('action').notNull(), idempotencyKey: text('idempotency_key').notNull(), requestHash: text('request_hash').notNull(),
  fromVersionId: text('from_version_id').notNull().references(()=>versions.id), toVersionId: text('to_version_id').notNull().references(()=>versions.id),
  previousRevision: integer('previous_revision').notNull(), revision: integer('revision').notNull(), changed: integer('changed').notNull(),
  createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('ft_version_operations_owner_key').on(t.ownerId,t.idempotencyKey),index('ft_version_operations_work_created').on(t.workId,t.createdAt)]);
export const cards = sqliteTable('ft_cards', {
  deletedAt: text('deleted_at'),
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
  uniqueIndex('ft_events_session_type').on(t.sessionId,t.type),index('ft_events_work_received').on(t.workId,t.receivedAt),index('ft_events_actor_received').on(t.actorId,t.receivedAt),
  index('ft_events_play_work_received').on(t.workId,t.receivedAt,t.actorId).where(sql`${t.type} = 'play_start'`),
  index('ft_events_play_actor_work_received').on(t.actorId,t.workId,t.receivedAt).where(sql`${t.type} = 'play_start'`)]);
export const feedback = sqliteTable('ft_feedback', {
  id: text('id').primaryKey(), clientEventId: text('client_event_id').notNull(), workId: text('work_id').notNull().references(()=>works.id),
  versionId: text('version_id').notNull().references(()=>versions.id), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  text: text('text').notNull(), type: text('type').notNull(), createdAt: text('created_at').notNull(),
}, t=>[uniqueIndex('ft_feedback_author_client').on(t.authorId,t.clientEventId),index('ft_feedback_work_created').on(t.workId,t.createdAt)]);

// Feed exposure counts one authenticated viewer per work per UTC day. Self
// exposure remains inspectable but is excluded from recommendation ranking.
export const feedImpressions = sqliteTable('ft_feed_impressions', {
  id: text('id').primaryKey(), clientEventId: text('client_event_id').notNull(), actorId: text('actor_id').notNull(),
  workId: text('work_id').notNull().references(()=>works.id), sort: text('sort').notNull(),
  exposureDay: text('exposure_day').notNull(), receivedAt: text('received_at').notNull(),
}, t=>[uniqueIndex('ft_feed_impressions_actor_client').on(t.actorId,t.clientEventId),uniqueIndex('ft_feed_impressions_actor_work_day').on(t.actorId,t.workId,t.exposureDay),
  index('ft_feed_impressions_work_received').on(t.workId,t.receivedAt,t.actorId),index('ft_feed_impressions_actor_received').on(t.actorId,t.receivedAt)]);
// These are immutable participation receipts, not spendable points. One work
// can qualify once across all versions, with additional per-author/day caps.
export const contributionCredits = sqliteTable('ft_contribution_credits', {
  actorId: text('actor_id').notNull(), targetWorkId: text('target_work_id').notNull().references(()=>works.id),
  targetAuthorId: text('target_author_id').notNull(), sourceKind: text('source_kind').notNull(), sourceId: text('source_id').notNull(),
  earnedDay: text('earned_day').notNull(), createdAt: text('created_at').notNull(),
}, t=>[primaryKey({columns:[t.actorId,t.targetWorkId]}),uniqueIndex('ft_contribution_credits_actor_author_day').on(t.actorId,t.targetAuthorId,t.earnedDay),
  index('ft_contribution_credits_actor_day').on(t.actorId,t.earnedDay),index('ft_contribution_credits_actor_created').on(t.actorId,t.createdAt)]);

// Public-to-the-site discussion is separate from legacy private feedback.
// The monotonic sequence gives stable root/reply pagination even within one ms.
export const comments = sqliteTable('ft_comments', {
  seq: integer('seq').primaryKey({autoIncrement:true}), id: text('id').notNull().unique(),
  workId: text('work_id').notNull().references(()=>works.id), authorId: text('author_id').notNull(), authorName: text('author_name').notNull(),
  // Page context only: a version association does not prove a completed play.
  versionId: text('version_id').references(()=>versions.id),
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

export const autoCoverJobs = sqliteTable('ft_auto_cover_jobs', {
  id: text('id').primaryKey(), workId: text('work_id').notNull().references(()=>works.id), versionId: text('version_id').notNull().references(()=>versions.id), ownerId: text('owner_id').notNull(),
  status: text('status').notNull().default('queued'), attempts: integer('attempts').notNull().default(0), leaseId: text('lease_id'), leaseUntil: text('lease_until'), reason: text('reason'), metadataId: text('metadata_id'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[uniqueIndex('ft_auto_cover_work_version').on(t.workId,t.versionId),index('ft_auto_cover_queue').on(t.status,t.createdAt)]);
export const autoCoverAttempts = sqliteTable('ft_auto_cover_attempts', {
  id: text('id').primaryKey(), jobId: text('job_id').notNull().references(()=>autoCoverJobs.id), reservedSeconds: integer('reserved_seconds').notNull(), elapsedMs: integer('elapsed_ms'), outcome: text('outcome'), createdAt: text('created_at').notNull(),
}, t=>[index('ft_auto_cover_budget_time').on(t.createdAt)]);

// Optional, version-pinned derived media; never part of card snapshots.
export const videoPreviewJobs = sqliteTable('ft_video_preview_jobs', {
  id: text('id').primaryKey(), workId: text('work_id').notNull().references(()=>works.id), versionId: text('version_id').notNull().references(()=>versions.id), ownerId: text('owner_id').notNull(), contentHash: text('content_hash').notNull(),
  status: text('status').notNull().default('queued'), attempts: integer('attempts').notNull().default(0), leaseId: text('lease_id'), leaseUntil: text('lease_until'), reason: text('reason'), objectKey: text('object_key'), byteSize: integer('byte_size'), durationMs: integer('duration_ms'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[uniqueIndex('ft_video_preview_work_version').on(t.workId,t.versionId),index('ft_video_preview_queue').on(t.status,t.createdAt)]);
export const videoPreviewAttempts = sqliteTable('ft_video_preview_attempts', {
  id: text('id').primaryKey(), jobId: text('job_id').notNull().references(()=>videoPreviewJobs.id), reservedSeconds: integer('reserved_seconds').notNull(), elapsedMs: integer('elapsed_ms'), outcome: text('outcome'), createdAt: text('created_at').notNull(),
}, t=>[index('ft_video_preview_budget_time').on(t.createdAt)]);

export const coverReviewJobs = sqliteTable('ft_cover_review_jobs', {
  id: text('id').primaryKey(), workId: text('work_id').notNull().references(()=>works.id), versionId: text('version_id').notNull().references(()=>versions.id), ownerId: text('owner_id').notNull(),
  status: text('status').notNull().default('queued'), attempts: integer('attempts').notNull().default(0), leaseId: text('lease_id'), leaseUntil: text('lease_until'), reason: text('reason'), metadataId: text('metadata_id'), baseRevision: integer('base_revision').notNull(), waitMs: integer('wait_ms').notNull().default(5000), candidateKey: text('candidate_key'), candidateId: text('candidate_id'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t=>[uniqueIndex('ft_cover_review_work_version').on(t.workId,t.versionId),index('ft_cover_review_queue').on(t.status,t.createdAt)]);
export const coverReviewAttempts = sqliteTable('ft_cover_review_attempts', {
  id: text('id').primaryKey(), jobId: text('job_id').notNull().references(()=>coverReviewJobs.id), reservedSeconds: integer('reserved_seconds').notNull(), elapsedMs: integer('elapsed_ms'), outcome: text('outcome'), createdAt: text('created_at').notNull(),
}, t=>[index('ft_cover_review_budget_time').on(t.createdAt)]);

export const coverDrafts = sqliteTable('ft_cover_drafts', {
 id:text('id').primaryKey(), ownerId:text('owner_id').notNull(), url:text('url').notNull(), waitMs:integer('wait_ms').notNull(),
 status:text('status').notNull(), objectKey:text('object_key'), reason:text('reason'), reservedSeconds:integer('reserved_seconds').notNull(),
 elapsedMs:integer('elapsed_ms'), createdAt:text('created_at').notNull(), expiresAt:text('expires_at').notNull(), leaseUntil:text('lease_until').notNull(),
},t=>[index('ft_cover_drafts_owner_url').on(t.ownerId,t.url,t.createdAt),index('ft_cover_drafts_budget').on(t.createdAt)]);

export const publishDrafts = sqliteTable('ft_publish_drafts', {
 id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),source:text('source').notNull(),url:text('url'),contentHash:text('content_hash').notNull(),gameKey:text('game_key'),createdAt:text('created_at').notNull(),expiresAt:text('expires_at').notNull(),
},t=>[index('ft_publish_drafts_owner').on(t.ownerId,t.createdAt)]);
export const publishCaptures = sqliteTable('ft_publish_captures', {
 id:text('id').primaryKey(),draftId:text('draft_id').notNull().references(()=>publishDrafts.id),kind:text('kind').notNull(),status:text('status').notNull(),waitMs:integer('wait_ms').notNull(),reservedSeconds:integer('reserved_seconds').notNull(),leaseUntil:text('lease_until').notNull(),objectKey:text('object_key'),byteSize:integer('byte_size'),durationMs:integer('duration_ms'),reason:text('reason'),elapsedMs:integer('elapsed_ms'),createdAt:text('created_at').notNull(),
},t=>[index('ft_publish_captures_draft').on(t.draftId,t.kind,t.createdAt),index('ft_publish_captures_budget').on(t.kind,t.createdAt)]);
