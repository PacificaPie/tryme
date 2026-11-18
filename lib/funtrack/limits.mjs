// Shared binary limits for initial uploads, version updates and imported HTML.
export const HTML_MAX_BYTES = 16 * 1024 * 1024;
export const COVER_MAX_BYTES = 2 * 1024 * 1024;
export const MULTIPART_OVERHEAD_BYTES = 128 * 1024;
export const PUBLICATION_MAX_BYTES = HTML_MAX_BYTES + COVER_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
