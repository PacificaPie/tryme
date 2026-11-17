// Explicit local Docker integration. No Cloudflare credentials or cloud writes.
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const container = 'funtrack-cloud-check-' + randomUUID();
const token = randomBytes(32).toString('hex');
const docker = (args, options = {}) => execFileSync('docker', args, { maxBuffer: 10 * 1024 * 1024, timeout: 300000, ...options });
const script = code => docker(['exec', '-i', container, 'node', '--input-type=module'], { input: code });
function request(route, method = 'GET', body, authenticated = true) {
  return JSON.parse(script(`const r=await fetch('http://127.0.0.1:8080'+${JSON.stringify(route)},{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json',...( ${authenticated} ? {Authorization:'Bearer '+process.env.FUNTRACK_CONTAINER_CONTROL_TOKEN}:{} )},${body === undefined ? '' : `body:JSON.stringify(${JSON.stringify(body)}),`}signal:AbortSignal.timeout(260000)});console.log(JSON.stringify({status:r.status,body:await r.json()}));`));
}
const report = { provider: 'local-docker-only', checks: [], repository: 'yuss-raa/Snake-Game', commitSha: '1f76427453c48f6f0a02d09a12e0469451c0d1e3' };
try {
  docker(['run', '--detach', '--init', '--name', container, '--read-only', '--memory=1g', '--memory-swap=1g', '--cpus=2', '--pids-limit=128', '--network=bridge', '--tmpfs', '/work:rw,exec,nosuid,nodev,size=768m,mode=0755', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m,mode=1777', '--env', 'FUNTRACK_CONTAINER_CONTROL_TOKEN', 'funtrack-cloud-builder:local-check'], { env: { ...process.env, FUNTRACK_CONTAINER_CONTROL_TOKEN: token } });
  for (let i = 0; i < 30; i++) { try { if (request('/health').status === 200) break; } catch {} await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.equal(request('/build', 'POST', {}, false).status, 401); report.checks.push('unauthenticated control denied');
  const boundary = JSON.parse(script(`import {spawnSync} from 'node:child_process';import {childPrefix,childEnvironment} from '/app/cloud-builder/runner/build.mjs';
const code=${JSON.stringify(String.raw`const fs=require('fs');(async()=>{let rootProcReadable=true,toolWritable=true,toolkitWritable=true,canBecomeRoot=true;try{fs.readFileSync('/proc/1/environ')}catch{rootProcReadable=false}try{fs.appendFileSync('/app/cloud-builder/runner/server.mjs','bad')}catch{toolWritable=false}try{fs.appendFileSync('/toolkit/bundle.mjs','bad')}catch{toolkitWritable=false}try{process.setuid(0)}catch{canBecomeRoot=false}const localControlStatus=(await fetch('http://127.0.0.1:8080/build',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status;console.log(JSON.stringify({uid:process.getuid(),gid:process.getgid(),groups:process.getgroups(),hasControlToken:!!process.env.FUNTRACK_CONTAINER_CONTROL_TOKEN,rootProcReadable,toolWritable,toolkitWritable,canBecomeRoot,localControlStatus,capEff:fs.readFileSync('/proc/self/status','utf8').match(/^CapEff:\s+(\S+)/m)[1]}));})();`)};
const r=spawnSync('/usr/bin/setpriv',[...childPrefix,'node','-e',code],{env:childEnvironment(),encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);console.log(r.stdout);`));
  assert.equal(boundary.uid, 1000); assert.equal(boundary.gid, 1000); assert.equal(boundary.hasControlToken, false); assert.equal(boundary.rootProcReadable, false); assert.equal(boundary.toolWritable, false); assert.equal(boundary.toolkitWritable, false); assert.equal(boundary.canBecomeRoot, false); assert.equal(boundary.localControlStatus, 401); assert.equal(BigInt('0x' + boundary.capEff), 0n); report.checks.push('unprivileged code cannot read control environment, modify tools, escalate UID, or call control API'); report.boundary = boundary;
  const prepare = request('/prepare', 'POST', { repository: report.repository, commitSha: report.commitSha }); assert.equal(prepare.status, 200, JSON.stringify(prepare)); report.checks.push('fixed SHA validated and installed with scripts disabled');
  assert.equal(request('/prepare', 'POST', { repository: report.repository, commitSha: report.commitSha }).status, 409); report.checks.push('second preparation rejected');
  docker(['network', 'disconnect', 'bridge', container]); const networks = JSON.parse(docker(['inspect', '--format', '{{json .NetworkSettings.Networks}}', container])); assert.equal(Object.keys(networks).length, 0); report.checks.push('container network disconnected before project execution');
  const built = request('/build', 'POST', {}); assert.equal(built.status, 200, JSON.stringify(built)); report.metadata = built.body.metadata;
  const html = script(`const r=await fetch('http://127.0.0.1:8080/artifact',{headers:{Authorization:'Bearer '+process.env.FUNTRACK_CONTAINER_CONTROL_TOKEN}});if(!r.ok)throw Error('Artifact unavailable');process.stdout.write(Buffer.from(await r.arrayBuffer()));`);
  report.bytes = html.length; report.sha256 = createHash('sha256').update(html).digest('hex'); assert.equal(report.bytes, 229573); assert.equal(report.sha256, '47c025db71bd8c6aea689e2427a82b7f8351df6059ff295887c93b696528e48b'); report.checks.push('real Snake builds and reproduces prior exact HTML hash');
  assert.equal(request('/build', 'POST', {}).status, 409); report.checks.push('second build rejected');
  await mkdir('.preview/cloud-builder', { recursive: true }); await writeFile('.preview/cloud-builder/local-snake.html', html);
  report.success = true;
} finally {
  try { docker(['rm', '-f', container]); report.containerRemoved = true; } catch { report.containerRemoved = false; }
  await mkdir('.preview/cloud-builder', { recursive: true }); await writeFile('.preview/cloud-builder/local-runner-test.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify(report, null, 2));
