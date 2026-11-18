import { t, registerMessages } from './i18n.js';
import { LIMIT_DETAIL_MESSAGES } from './import-status.messages.js';
import './archive.messages.js';

export const HTML_MAX_BYTES = 16 * 1024 * 1024;
export const HTML_RECOMMENDED_BYTES = 8 * 1024 * 1024;
export const HTML_UPLOAD_HINT = '单个 HTML，最大 16 MiB；图片、样式和脚本需包含在文件里。';
const OFFLINE = '仓库构建暂不可用。可上传已打包的 HTML，或直接导入独立 HTML 链接。';
const OVERSIZE = 'HTML 超过 16 MiB。请压缩图片、音频等资源，重新打包后再上传。';
const messages = {
  WORK_ARCHIVED: '这件作品已归档，请先恢复再继续。',
  BUILD_RUNNER_OFFLINE: OFFLINE,
  BUILD_RUNNER_UNCONFIGURED: OFFLINE,
  BUILD_FAILED: '构建失败。请查看构建记录并修复项目，也可在本地打包后上传 HTML。',
  INVALID_GITHUB_URL: '请输入公开仓库根链接，或独立 HTML 文件的 GitHub blob/raw 链接。',
  INVALID_GITHUB_REPOSITORY: '请输入公开仓库根链接，或独立 HTML 文件的 GitHub blob/raw 链接。',
  INVALID_HTML: '请选择 UTF-8 编码的完整 HTML 文档，并将所需资源打包在文件内。',
  GITHUB_AMBIGUOUS_REF: '此分支或标签链接有歧义。请使用包含完整 commit SHA 的 HTML 文件链接。',
  GITHUB_PRIVATE_REPOSITORY: '只能导入公开仓库。私有项目可在本地打包后上传 HTML。',
  GITHUB_NOT_FOUND: '找不到可公开读取的仓库或文件。请确认链接，也可在本地打包后上传 HTML。',
  GITHUB_INACCESSIBLE: 'GitHub 不允许匿名读取此地址。请确认访问权限，或在本地打包后上传 HTML。',
  GITHUB_DISABLED_REPOSITORY: '此仓库已被 GitHub 停用。请使用可公开访问的仓库，或上传有权使用的 HTML。',
  GITHUB_EMPTY_REPOSITORY: '仓库还没有可构建的提交。请先提交项目文件。',
  GITHUB_MULTIFILE_PROJECT: '这个 HTML 还依赖其他文件。请改填受支持的仓库根链接，或将资源打包为独立 HTML 后上传。',
  UNSUPPORTED_PROJECT: '支持已有独立 dist/index.html 或 index.html 的公开仓库，或根目录带 build 脚本、npm 锁文件和 LICENSE 的 Vite 静态项目。其他项目请先打包为独立 HTML。',
  UNSUPPORTED_LOCKFILE: '仓库需要 npm v2 或 v3 格式的 package-lock.json。请更新锁文件，或在本地打包后上传 HTML。',
  UNSUPPORTED_DEPENDENCY: '项目含当前不支持的依赖。请使用锁定的 npm registry 依赖，或在本地打包后上传 HTML。',
  LICENSE_REQUIRED: '仓库根目录需要有效的 LICENSE 文件。请补充你有权使用的授权声明后重新导入。',
  EXTERNAL_ASSET: '构建产物仍依赖外部资源。请将图片、样式和脚本内联到 HTML 后上传。',
  HTML_TOO_LARGE: OVERSIZE,
  GITHUB_FILE_TOO_LARGE: OVERSIZE,
  BUILD_ARTIFACT_TOO_LARGE: OVERSIZE,
  OUTPUT_TOO_LARGE: '构建产物超过大小或数量限制。请查看构建记录；最终独立 HTML 须在 16 MiB 以内。',
  ARCHIVE_TOO_LARGE: '仓库压缩包超过 64 MiB。请移除不参与构建的大文件后重试，或上传已打包的 HTML。',
  ARCHIVE_UNPACKED_TOO_LARGE: '仓库解压后超过 256 MiB。请精简源码和素材后重试，或上传已打包的 HTML。',
  ARCHIVE_FILE_TOO_LARGE: '仓库内有单个文件超过 32 MiB。请精简该文件后重试，或上传已打包的 HTML。',
  ARCHIVE_TOO_MANY_FILES: '仓库文件数量超过 5000 项。请移除不参与构建的文件后重试。',
  INVALID_ARCHIVE: '仓库压缩包损坏或格式无效。请检查仓库归档后重试，或上传已打包的 HTML。',
  BODY_TOO_LARGE: '提交总大小超限。请缩小游戏文件或封面后重试。',
  GITHUB_RATE_LIMITED: 'GitHub 的匿名读取额度暂时用尽。可上传本地 HTML，或稍后重新导入。',
  GITHUB_TIMEOUT: '读取 GitHub 超时。请重试，也可上传已打包的本地 HTML。',
  GITHUB_UNAVAILABLE: '暂时无法读取 GitHub。请重试，也可上传已打包的本地 HTML。',
  GITHUB_REDIRECT: 'GitHub 地址已变更。请使用仓库或文件当前的正式链接。',
  GITHUB_RESPONSE_TOO_LARGE: 'GitHub 返回的仓库信息过大。请使用独立 HTML 链接，或上传本地 HTML。',
  GITHUB_RESPONSE_INVALID: '未能读取有效的 GitHub 信息。请确认链接后重试，或上传本地 HTML。',
};

// Read only the builder's known, bounded limit messages. Reconstruct the UI
// sentence locally so paths/sizes are useful without displaying raw logs.
const limitDetails = {
  ARCHIVE_TOO_LARGE: [
    [/^仓库压缩包大小为 ([0-9]+(?:\.[0-9]{1,2})?) MiB，超过 ([0-9]+(?:\.[0-9]{1,2})?) MiB 上限。$/, '仓库压缩包大小为 {size} MiB，超过 {limit} MiB 上限。', ['size','limit']],
    [/^仓库压缩包大小至少为 ([0-9]+(?:\.[0-9]{1,2})?) MiB，超过 ([0-9]+(?:\.[0-9]{1,2})?) MiB 上限。$/, '仓库压缩包大小至少为 {size} MiB，超过 {limit} MiB 上限。', ['size','limit']],
  ],
  ARCHIVE_UNPACKED_TOO_LARGE: [
    [/^仓库解压后大小超过 ([0-9]+(?:\.[0-9]{1,2})?) MiB 上限（已停止解压）。$/, '仓库解压后大小超过 {limit} MiB 上限（已停止解压）。', ['limit']],
  ],
  ARCHIVE_FILE_TOO_LARGE: [
    [/^仓库文件「([^「」\u0000-\u001f\u007f]{1,200})」大小为 ([0-9]+(?:\.[0-9]{1,2})?) MiB，超过 ([0-9]+(?:\.[0-9]{1,2})?) MiB 上限。$/, '仓库文件「{path}」大小为 {size} MiB，超过 {limit} MiB 上限。', ['path','size','limit']],
  ],
  ARCHIVE_TOO_MANY_FILES: [
    [/^仓库文件数量至少为 ([0-9]+) 项，超过 ([0-9]+) 项上限。$/, '仓库文件数量至少为 {count} 项，超过 {limit} 项上限。', ['count','limit']],
  ],
  OUTPUT_TOO_LARGE: [
    [/^最终 HTML 大小为 ([0-9]+(?:\.[0-9]{1,2})?) MiB，超过 ([0-9]+(?:\.[0-9]{1,2})?) MiB 上限。$/, '最终 HTML 大小为 {size} MiB，超过 {limit} MiB 上限。', ['size','limit']],
    [/^最终 HTML 大小至少为 ([0-9]+(?:\.[0-9]{1,2})?) MiB，超过 ([0-9]+(?:\.[0-9]{1,2})?) MiB 上限。$/, '最终 HTML 大小至少为 {size} MiB，超过 {limit} MiB 上限。', ['size','limit']],
  ],
};
export function importErrorText(error) {
  const code=error?.code||error?.errorCode, detail=error?.message||error?.error;
  if(typeof detail==='string'&&detail.length<=400){
    for(const [pattern,message,keys] of limitDetails[code]||[]){
      const match=detail.match(pattern);if(!match)continue;
      const values=Object.fromEntries(keys.map((key,index)=>[key,match[index+1]]));
      const format=template=>template.replace(/\{([A-Za-z]+)\}/g,(_,key)=>values[key]);
      const source=format(message);
      // Errors can remain in the draft while the locale changes. Keep their
      // Chinese key stable, with its exact safe detail translated on render.
      registerMessages({[source]:format(LIMIT_DETAIL_MESSAGES[message])});return source;
    }
  }
  return messages[code] || error?.message || error?.error || '导入失败，请查看构建记录。';
}
export function htmlFileError(file) {
  if (!file || !/\.html?$/i.test(file.name || '')) return '请选择 HTML 文件。';
  if (file.size > HTML_MAX_BYTES) return OVERSIZE;
  if (file.size === 0) return 'HTML 文件为空，请选择已打包的游戏文件。';
  return '';
}
export function htmlImportSizeNotice({source,file,build,ready=false,pending=false}={}) {
  if(pending||!['html','github'].includes(source))return '';
  const bytes=source==='html'?file?.size:ready?(build?.status==='ready'?build.artifactBytes:file?.size):0;
  if(!Number.isFinite(bytes)||bytes<=HTML_RECOMMENDED_BYTES||bytes>HTML_MAX_BYTES)return '';
  const size=(Math.ceil(bytes/1048576*100)/100).toFixed(2).replace(/\.00$/,'');
  return t('当前 HTML 约 {size} MiB，超过建议的 8 MiB。仍可发布，但移动网络加载可能较慢，建议压缩图片和音频。',{size});
}
export function isGithubHTMLURL(value) {
  try { const url = new URL(value); return url.hostname === 'raw.githubusercontent.com' || url.hostname === 'github.com' && /\/blob\/.+\.html?$/i.test(url.pathname); }
  catch { return false; }
}
export function repositoryImportBlocked(state, url) {
  return !isGithubHTMLURL(url) && ['checking', 'offline', 'unconfigured'].includes(state?.status);
}
export function buildAvailabilityMarkup(state, { selected = false, directFile = false, ready = false, disabled = false } = {}) {
  const status = state?.status || 'checking';
  const label = status === 'online' ? 'GitHub 仓库构建可用' : status === 'offline' || status === 'unconfigured' ? 'GitHub 仓库构建离线' : status === 'checking' ? '正在检查仓库构建状态…' : '暂未确认仓库构建状态';
  if (!selected) return '';
  if (directFile) return `<p class="import-availability-summary">${t('独立 HTML 可直接导入，无需构建器。')}</p>`;
  if (ready) return `<p class="import-availability-summary">${t(label)}</p>`;
  const offline = status === 'offline' || status === 'unconfigured';
  return `<div class="import-availability-panel${offline ? ' is-offline' : ''}"><p role="status">${t(label)}</p>${offline ? `<p class="import-availability-next">${t('可上传已打包的独立 HTML，最大 16 MiB。')}</p>` : ''}<div class="import-availability-actions">${offline ? `<button type="button" class="button primary small" data-import-local ${disabled ? 'disabled' : ''}>${t('改用本地 HTML')}</button>` : ''}${offline || status === 'unknown' ? `<button type="button" class="button quiet small" data-import-check ${state?.checking || disabled ? 'disabled' : ''}>${t(state?.checking ? '正在检查…' : '刷新状态')}</button>` : ''}</div><details class="import-requirements"><summary>${t('支持的项目')}</summary><p>${t('公开仓库可直接导入已打包的 dist/index.html 或 index.html；Vite 静态项目需在根目录提供 build 脚本、package-lock.json（v2/v3）和 LICENSE。暂不支持后端服务、工作区或私有依赖。')}</p><p>${t('本地上传和 HTML 链接均需是已打包的独立 HTML；仅有 index.html 而资源仍在其他文件中，无法直接运行。')}</p></details></div>`;
}

// Each mounted form owns its check; leaving it aborts the read and prevents stale UI writes.
export function createBuildAvailability(api, onChange = () => {}) {
  let state = { status: 'checking', checking: false }, pending = null, controller = null, revision = 0, disposed = false;
  const update = next => { state = next; if (!disposed) onChange(state); };
  return {
    get state() { return state; },
    refresh() {
      if (disposed) return Promise.resolve(state);
      if (pending) return pending;
      const version = ++revision;
      controller = new AbortController();
      update({ ...state, checking: true });
      pending = (async () => {
        try {
          const result = await api('/api/builds/capabilities', { signal: controller.signal });
          if (!disposed && version === revision) {
            const status = result.online === true ? 'online' : result.status === 'unconfigured' ? 'unconfigured' : result.online === false ? 'offline' : 'unknown';
            update({ status, checking: false });
          }
        } catch {
          if (!disposed && version === revision) update({ status: 'unknown', checking: false });
        } finally { if (version === revision) pending = null; }
        return state;
      })();
      return pending;
    },
    markUnavailable(code) {
      revision++; controller?.abort(); pending = null;
      update({ status: code === 'BUILD_RUNNER_UNCONFIGURED' ? 'unconfigured' : 'offline', checking: false });
    },
    dispose() { disposed = true; revision++; controller?.abort(); pending = null; },
  };
}
