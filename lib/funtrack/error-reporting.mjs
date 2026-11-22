const OPERATIONS = new Set(['api', 'public_card', 'media', 'game']);
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
