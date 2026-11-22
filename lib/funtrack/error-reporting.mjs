const OPERATIONS = new Set(['api', 'public_card', 'media', 'game', 'cleanup_cover', 'cleanup_media', 'scheduled_cover', 'scheduled_external', 'scheduled_video']);
const TYPES = new Set(['Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError']);

// Raw exceptions may contain SQL values, provider responses or user content.
// Log a bounded classification and correlate it with the generic HTTP failure.
export function reportUnexpectedError(error, operation = 'api', logger = console) {
  const requestId = crypto.randomUUID();
  try {
    logger.error(JSON.stringify({
      event: 'application_error', requestId,
      operation: OPERATIONS.has(operation) ? operation : 'api',
      errorType: TYPES.has(error?.name) ? error.name : 'Error',
    }));
  } catch { /* A logging failure must not replace the original HTTP response. */ }
  return requestId;
}

const JOB_OPERATIONS = new Set(['scheduled_cover', 'scheduled_external', 'scheduled_video']);
const JOB_REASONS = new Set(['CAPTURE_TIMEOUT', 'CAPTURE_EMPTY', 'CAPTURE_TOO_LARGE', 'BROWSER_UNAVAILABLE', 'INVALID_CAPTURE_HTML', 'CONTENT_CHANGED', 'DEMO_INCOMPLETE', 'CAPTURE_NOT_READY', 'UNSAFE_URL', 'RESOURCE_LIMIT', 'CAPTURE_FAILED']);
// Media workers normally return a failed outcome instead of throwing. Preserve
// that signal without logging arbitrary provider strings or content identifiers.
export function reportJobOutcome(result, operation, logger = console) {
  if (!result?.processed || result.status !== 'failed' || !JOB_OPERATIONS.has(operation)) return;
  try { logger.error(JSON.stringify({event:'scheduled_job_failed',operation,reason:JOB_REASONS.has(result.reason)?result.reason:'CAPTURE_FAILED'})); }
  catch { /* Reporting must not change job state or scheduling. */ }
}
