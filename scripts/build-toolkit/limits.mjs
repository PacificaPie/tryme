// Shared by the trusted host, cloud runner and offline packaging toolkit.
const MiB = 1024 * 1024;
export const REPOSITORY_LIMITS = Object.freeze({
  archive: 64 * MiB,
  unpacked: 256 * MiB,
  files: 5000,
  file: 32 * MiB,
  html: 16 * MiB,
});
export const sizeMiB = bytes => String(Math.ceil(bytes / MiB * 100) / 100);
export const archiveSizeMessage = (bytes, atLeast = false) => `仓库压缩包大小${atLeast ? '至少' : ''}为 ${sizeMiB(bytes)} MiB，超过 ${sizeMiB(REPOSITORY_LIMITS.archive)} MiB 上限。`;
export const unpackedSizeMessage = () => `仓库解压后大小超过 ${sizeMiB(REPOSITORY_LIMITS.unpacked)} MiB 上限（已停止解压）。`;
const pathLabel = value => String(value).replace(/[\x00-\x1f\x7f]/g, '?').replaceAll('「', '(').replaceAll('」', ')').slice(0, 200);
export const archiveFileMessage = (path, bytes) => `仓库文件「${pathLabel(path)}」大小为 ${sizeMiB(bytes)} MiB，超过 ${sizeMiB(REPOSITORY_LIMITS.file)} MiB 上限。`;
export const archiveCountMessage = count => `仓库文件数量至少为 ${count} 项，超过 ${REPOSITORY_LIMITS.files} 项上限。`;
export const htmlSizeMessage = bytes => `最终 HTML 大小为 ${sizeMiB(bytes)} MiB，超过 ${sizeMiB(REPOSITORY_LIMITS.html)} MiB 上限。`;
