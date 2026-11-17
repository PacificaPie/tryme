import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, readdir, lstat, chown, chmod, open, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { BuildError, BUILD_IMAGE, LIMITS, validateJob, unpackTar, validateNpmProject, validatePackedHTML } from '../../scripts/repo-builder.mjs';

const WORK = '/work';
const TOOLKIT = '/toolkit';
const TOTAL_MS = 8 * 60 * 1000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, code) => { throw new BuildError(message, code); };

export function childEnvironment(certificateAvailable = false) {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp/build-home', TMPDIR: '/tmp',
    LANG: 'C.UTF-8', npm_config_cache: '/tmp/npm', npm_config_update_notifier: 'false',
    ...(certificateAvailable ? { NODE_EXTRA_CA_CERTS: '/etc/cloudflare/certs/cloudflare-containers-ca.crt' } : {}),
  };
}

export function validatePrepareInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['repository', 'commitSha'].includes(key))) fail('准备请求只接受 repository 和 commitSha。', 'INVALID_REPOSITORY');
  return validateJob(input);
}

// All commands run as a distinct unprivileged user. The default Cloudflare
// scheduling policy is required: durable_object policy grants root capabilities
// to all users and must never be used with this control-server design.
export const childPrefix = Object.freeze([
  '--reuid=1000', '--regid=1000', '--clear-groups', '--no-new-privs',
  '--inh-caps=-all', '--ambient-caps=-all', '--bounding-set=-all', '--',
  '/usr/bin/prlimit', '--nproc=128:128', '--nofile=1024:1024',
  '--fsize=67108864:67108864', '--cpu=240:240', '--',
]);

async function killBuildProcesses() {
  // A repository can detach descendants from the initial process group. Kill
  // every process of the build UID in this per-job container before reading
  // output or beginning another phase; the root control service is excluded.
  for (let pass = 0; pass < 3; pass++) {
    for (const pid of await readdir('/proc')) {
      if (!/^\d+$/.test(pid)) continue;
      try {
        const status = await readFile(`/proc/${pid}/status`, 'utf8');
        if (/^Uid:\s+1000\s/m.test(status)) process.kill(Number(pid), 'SIGKILL');
      } catch (error) { if (!['ENOENT', 'ESRCH', 'EACCES'].includes(error.code)) throw error; }
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function command(args, { signal, timeoutMs, maxBytes = LIMITS.logs } = {}) {
  if (signal?.aborted) fail('构建已取消或超过总时限。', 'BUILD_TIMEOUT');
  const certificateAvailable = await stat('/etc/cloudflare/certs/cloudflare-containers-ca.crt').then(() => true, () => false);
  let child;
  try {
    return await new Promise((resolve, reject) => {
      let output = '', bytes = 0, settled = false;
      const finish = (error, value) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (error) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} reject(error); } else resolve(value);
      };
      const abort = () => finish(new BuildError('构建已取消或超过总时限。', 'BUILD_TIMEOUT'));
      child = spawn('/usr/bin/setpriv', [...childPrefix, ...args], {
        cwd: WORK, env: childEnvironment(certificateAvailable), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      const timer = setTimeout(() => finish(new BuildError('构建阶段超过时间限制。', 'BUILD_TIMEOUT')), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const collect = chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) return finish(new BuildError('构建日志超过上限。', 'BUILD_LOG_LIMIT'));
        output += chunk.toString();
      };
      child.stdout.on('data', collect); child.stderr.on('data', collect);
      child.on('error', error => finish(new BuildError(`无法启动构建工具：${error.code}`, 'BUILD_TOOL_UNAVAILABLE')));
      child.on('exit', code => code === 0 ? finish(null, output) : finish(new BuildError(`构建命令失败（${code}）：${output.slice(-2500).replace(/\x1b\[[0-9;]*m/g, '')}`, 'BUILD_COMMAND_FAILED')));
    });
  } finally { await killBuildProcesses(); }
}

export async function verifyBuildNetwork(job, { fetchImpl = fetch, signal } = {}) {
  const targets = [`https://registry.npmjs.org/vite`, `https://codeload.github.com/${job.repository}/tar.gz/${job.commitSha}`];
  return await Promise.all(targets.map(async url => {
    let response;
    try {
      response = await fetchImpl(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000) });
    } catch {
      if (signal?.aborted) fail('构建已取消或超过总时限。', 'BUILD_TIMEOUT');
      return { host: new URL(url).hostname, blocked: true, evidence: 'network-unreachable' };
    }
    await response.body?.cancel();
    if (response.status !== 403 || response.headers.get('X-Funtrack-Egress') !== 'denied') fail('构建阶段网络未被可信策略关闭。', 'ISOLATION_FAILED');
    return { host: new URL(url).hostname, blocked: true, evidence: 'cloudflare-deny', status: 403 };
  }));
}

async function verifyProcessBoundary(signal) {
  // Read-only checks executed under exactly the same UID/capabilities/environment
  // as the repository, before any repository build or Vite config is executed.
  const code = `const fs=require('fs');const status=fs.readFileSync('/proc/self/status','utf8');let rootProcReadable=true,controlWritable=true,toolkitWritable=true;try{fs.readFileSync('/proc/${process.pid}/environ')}catch{rootProcReadable=false}try{fs.accessSync('/app/cloud-builder/runner/server.mjs',fs.constants.W_OK)}catch{controlWritable=false}try{fs.accessSync('/toolkit/bundle.mjs',fs.constants.W_OK)}catch{toolkitWritable=false}console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),capEff:status.split('\\n').find(x=>x.startsWith('CapEff:')).split(':')[1].trim(),noNewPrivileges:status.split('\\n').find(x=>x.startsWith('NoNewPrivs:')).split(':')[1].trim()==='1',hasControlToken:!!process.env.FUNTRACK_CONTAINER_CONTROL_TOKEN,rootProcReadable,controlWritable,toolkitWritable}));`;
  const result = JSON.parse(await command(['node', '-e', code], { signal, timeoutMs: 10000, maxBytes: 12000 }));
  if (result.uid !== 1000 || result.gid !== 1000 || !/^0+$/.test(result.capEff || '') || !result.noNewPrivileges || result.hasControlToken || result.rootProcReadable || result.controlWritable || result.toolkitWritable) fail('容器进程隔离预检查失败。', 'ISOLATION_FAILED');
  return result;
}

async function fetchArchive(job, signal) {
  const url = `https://codeload.github.com/${job.repository}/tar.gz/${job.commitSha}`;
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]), headers: { 'User-Agent': 'Funtrack-Cloud-Builder' } });
  if (!response.ok || response.url !== url) fail(`GitHub 仓库下载失败（${response.status}）。`, 'FETCH_FAILED');
  if (Number(response.headers.get('content-length')) > LIMITS.archive) fail('仓库压缩包超过 16 MiB。', 'ARCHIVE_TOO_LARGE');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length; if (size > LIMITS.archive) fail('仓库压缩包超过 16 MiB。', 'ARCHIVE_TOO_LARGE'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function inspectDirectory(relative) {
  const root = path.join(WORK, relative), files = []; let totalBytes = 0, entries = 0;
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail('构建输出目录无效。', 'UNSAFE_OUTPUT');
  async function walk(directory, prefix = '') {
    for (const name of await readdir(directory)) {
      if (++entries > LIMITS.files) fail('构建产物目录项超过上限。', 'OUTPUT_TOO_LARGE');
      if (/[\x00-\x1f\x7f]/.test(name)) fail('产物文件名无效。', 'UNSAFE_OUTPUT');
      const absolute = path.join(directory, name), info = await lstat(absolute), entry = prefix + name;
      if (info.isSymbolicLink()) fail('构建产物不能包含链接。', 'UNSAFE_OUTPUT');
      if (info.isDirectory()) { if (entry.split('/').length > 32) fail('产物目录过深。', 'OUTPUT_TOO_LARGE'); await walk(absolute, entry + '/'); }
      else if (info.isFile()) {
        totalBytes += info.size;
        if (info.size > LIMITS.file || totalBytes > LIMITS.unpacked || files.length >= LIMITS.files) fail('构建产物超过大小或数量限制。', 'OUTPUT_TOO_LARGE');
        files.push({ path: entry, size: info.size });
      } else fail('构建产物类型不支持。', 'UNSAFE_OUTPUT');
    }
  }
  await walk(root); return { files, totalBytes };
}

async function readPackedHTML() {
  const filename = WORK + '/.funtrack-bundle/index.html';
  if (await realpath(filename) !== filename) fail('产物路径不能含链接。', 'UNSAFE_OUTPUT');
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > LIMITS.html) fail('产物超过 8 MiB。', 'OUTPUT_TOO_LARGE');
    const bytes = await file.readFile(); if (bytes.length > LIMITS.html) fail('产物超过 8 MiB。', 'OUTPUT_TOO_LARGE');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally { await file.close(); }
}

export class BuildEngine {
  phase = 'idle'; metadata = null; artifact = null; failure = null;
  constructor() { this.controller = new AbortController(); this.timings = {}; }
  status() { return { phase: this.phase, ...(this.failure ? { error: this.failure } : {}) }; }
  remaining() { return Math.max(1, TOTAL_MS - (Date.now() - this.started)); }
  async stage(name, task) {
    const started = Date.now(); try { return await task(); } finally { this.timings[name] = Date.now() - started; }
  }
  async failed(error) {
    this.phase = 'failed'; this.controller.abort(); clearTimeout(this.deadline);
    await killBuildProcesses();
    this.failure = { code: error.code || 'BUILD_FAILED', message: String(error.message || '构建失败。').slice(-4000) };
    throw error;
  }
  async prepare(input) {
    if (this.phase !== 'idle') fail('此容器已接受过任务。', 'BUILD_STATE_CHANGED');
    this.job = validatePrepareInput(input); this.phase = 'preparing'; this.started = Date.now();
    this.deadline = setTimeout(() => { this.controller.abort(); this.phase = 'failed'; this.failure = { code: 'BUILD_TIMEOUT', message: '构建超过 8 分钟。' }; void killBuildProcesses().catch(() => {}); }, TOTAL_MS);
    try {
      const archive = await this.stage('fetching', () => fetchArchive(this.job, this.controller.signal));
      const files = unpackTar(archive); this.project = validateNpmProject(files);
      if ((await readdir(WORK)).length) fail('任务工作区必须为空。', 'ISOLATION_FAILED');
      for (const entry of files) {
        const filename = path.join(WORK, entry.path); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, entry.bytes, { mode: 0o644 });
      }
      async function own(directory) { await chown(directory, 1000, 1000); for (const name of await readdir(directory)) { const file = path.join(directory, name); if ((await lstat(file)).isDirectory()) await own(file); else await chown(file, 1000, 1000); } }
      await own(WORK); await chmod(WORK, 0o700);
      this.source = { sourceFiles: files.length, archiveBytes: archive.length };
      await this.stage('installing', () => command(['npm', 'ci', '--ignore-scripts', '--include=dev', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org', '--userconfig=/dev/null', '--globalconfig=/tmp/funtrack-global-npmrc'], { signal: this.controller.signal, timeoutMs: Math.min(LIMITS.installMs, this.remaining()) }));
      if (this.controller.signal.aborted) fail('构建超过 8 分钟。', 'BUILD_TIMEOUT');
      this.phase = 'prepared';
      return { prepared: true, metadata: { ...this.job, ...this.source, framework: 'vite', buildCommand: this.project.pkg.scripts.build, license: { path: this.project.licensePath, sha256: hash(this.project.license) } } };
    } catch (error) { return this.failed(error); }
  }
  async build() {
    if (this.phase !== 'prepared') fail('请先完成准备阶段。', 'BUILD_STATE_CHANGED');
    this.phase = 'building';
    try {
      // The trusted Durable Object must replace BOTH registry/codeload HTTP and
      // HTTPS intercepts with deny handlers before calling this endpoint.
      const networkChecks = await verifyBuildNetwork(this.job, { signal: this.controller.signal });
      const isolationChecks = await verifyProcessBoundary(this.controller.signal);
      await this.stage('building', () => command(['npm', '--ignore-scripts', 'run', 'build'], { signal: this.controller.signal, timeoutMs: Math.min(LIMITS.buildMs, this.remaining()) }));
      const original = await inspectDirectory('dist');
      await this.stage('packaging', () => command(['node', TOOLKIT + '/bundle.mjs'], { signal: this.controller.signal, timeoutMs: Math.min(LIMITS.buildMs, this.remaining()) }));
      await inspectDirectory('.funtrack-bundle');
      let html = await readPackedHTML();
      const notice = `\n<!--\nSource: https://github.com/${this.job.repository}/tree/${this.job.commitSha}\n${this.project.license.replaceAll('--', '- -')}\n-->\n`;
      if (!/<head(?:\s[^>]*)?>/i.test(html)) fail('构建产物缺少 head。', 'OUTPUT_REQUIRED');
      html = html.replace(/<head(\s[^>]*)?>/i, match => match + notice); validatePackedHTML(html);
      this.artifact = Buffer.from(html);
      this.metadata = {
        ...this.job, ...this.source, sourceUrl: `https://github.com/${this.job.repository}/tree/${this.job.commitSha}`,
        framework: 'vite', buildCommand: this.project.pkg.scripts.build,
        buildCommands: ['npm ci --ignore-scripts --include=dev --no-audit --no-fund', 'npm --ignore-scripts run build', 'Vite + vite-plugin-singlefile@2.3.4 + static asset inlining'],
        originalDist: { fileCount: original.files.length, files: original.files.slice(0, 32), totalBytes: original.totalBytes, truncated: original.files.length > 32 },
        outputBytes: this.artifact.length, outputSha256: hash(this.artifact),
        license: { path: this.project.licensePath, sha256: hash(this.project.license), name: this.project.license.split('\n')[0].slice(0, 150), productionDependencyNotices: 'embedded in HTML' },
        baseImage: BUILD_IMAGE, toolkit: { singlefile: '2.3.4', vite: '7.1.7' },
        timingsMs: { ...this.timings, total: Date.now() - this.started },
        execution: { provider: 'cloudflare-containers', schedulingPolicy: 'default', buildUid: 1000, noNewPrivileges: true, processLimit: 128, taskTimeoutMs: TOTAL_MS },
        isolationChecks,
        network: { install: 'codeload.github.com and registry.npmjs.org only; installation scripts disabled', build: 'denied by trusted Durable Object intercepts', packaging: 'denied by trusted Durable Object intercepts', checks: networkChecks },
      };
      if (this.controller.signal.aborted) fail('构建超过 8 分钟。', 'BUILD_TIMEOUT');
      clearTimeout(this.deadline); this.phase = 'ready'; return { metadata: this.metadata };
    } catch (error) { return this.failed(error); }
  }
  async cancel() { this.controller.abort(); clearTimeout(this.deadline); await killBuildProcesses(); }
}
