// Reservations survive temporary object cleanup and publication. Adoption of a
// prepared video never charges a second browser reservation.
export const COVER_RESERVATIONS = `(SELECT created_at,reserved_seconds FROM ft_auto_cover_attempts UNION ALL SELECT created_at,reserved_seconds FROM ft_cover_review_attempts UNION ALL SELECT created_at,reserved_seconds FROM ft_cover_drafts UNION ALL SELECT created_at,reserved_seconds FROM ft_publish_captures WHERE kind='cover')`;
export const VIDEO_RESERVATIONS = `(SELECT created_at,reserved_seconds FROM ft_video_preview_attempts UNION ALL SELECT created_at,reserved_seconds FROM ft_publish_captures WHERE kind='video')`;

// All browser consumers use one global lease pool, including legacy jobs.
export const BROWSER_LEASES = `(SELECT status,lease_until FROM ft_auto_cover_jobs UNION ALL SELECT status,lease_until FROM ft_cover_review_jobs UNION ALL SELECT status,lease_until FROM ft_cover_drafts UNION ALL SELECT status,lease_until FROM ft_video_preview_jobs UNION ALL SELECT status,lease_until FROM ft_publish_captures)`;
