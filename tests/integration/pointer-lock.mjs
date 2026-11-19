// Browser regression harness: node tests/integration/pointer-lock.mjs
// Open http://127.0.0.1:8799. Click inside each case; Escape releases a lock.
// Use a foreground window and native mouse input: a background automation click
// can fail with WrongDocumentError independently of sandbox permissions.
// Uses the application's actual iframe permissions and document policies.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { GAME_CSP, gameDocument } from '../../lib/funtrack/rules.mjs';
import { localPreviewHTML } from '../../public/versioning-state.js';

const origin = 'http://127.0.0.1:8799';
const source = name => readFileSync(new URL('../../public/' + name, import.meta.url), 'utf8');
const playerSandbox = source('site.js').match(/<iframe id="game-frame"[^>]*sandbox="([^"]+)"/)[1];
const previewSandbox = source('versioning.js').match(/<iframe title="\$\{t\('新版本预览'\)\}"[^>]*sandbox="([^"]+)"/)[1];
const legacySandbox = 'allow-scripts';
const legacyCSP = GAME_CSP.replace(' allow-pointer-lock', '');
const cases = {
  legacy: [legacySandbox, legacyCSP],
  'iframe-only': [playerSandbox, legacyCSP],
  'csp-only': [legacySandbox, GAME_CSP],
  current: [playerSandbox, GAME_CSP],
  preview: [previewSandbox, null],
};
const game = `<!doctype html><meta charset="utf-8"><style>
body{font:18px system-ui;padding:20px}button{font:inherit;padding:18px}
</style><button id="lock">Lock mouse</button><p id="status">READY</p>
<p id="isolation"></p><p id="movement">Movement: 0</p><script>
const target=document.getElementById('lock'),status=document.getElementById('status');
target.onclick=async()=>{try{await target.requestPointerLock();}catch(e){status.textContent='ERROR '+e.name;}};
document.addEventListener('pointerlockchange',()=>{status.textContent=document.pointerLockElement?'LOCKED':'UNLOCKED';});
document.addEventListener('pointerlockerror',()=>{if(!status.textContent.startsWith('ERROR'))status.textContent='ERROR pointerlockerror';});
let movement=0;document.addEventListener('mousemove',e=>{if(document.pointerLockElement){movement+=Math.abs(e.movementX)+Math.abs(e.movementY);document.getElementById('movement').textContent='Movement: '+movement;}});
let parentBlocked=false,storageBlocked=false;
try{parent.document.body;}catch{parentBlocked=true;}
try{localStorage.getItem('probe');}catch{storageBlocked=true;}
document.getElementById('isolation').textContent='Parent blocked: '+parentBlocked+'; storage blocked: '+storageBlocked;
</script>`;
const attr = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
createServer((request, response) => {
  const url = new URL(request.url, origin), name = url.searchParams.get('case') || 'current';
  if (!Object.hasOwn(cases, name)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  const [sandbox, policy] = cases[name];
  if (url.pathname === '/game') {
    response.setHeader('Content-Security-Policy', policy || GAME_CSP);
    response.end(gameDocument(game, origin)); return;
  }
  const frameSource = name === 'preview' ? 'srcdoc="' + attr(localPreviewHTML(game)) + '"' : 'src="/game?case=' + name + '"';
  response.end('<!doctype html><title>Pointer lock regression</title><h1>' + name + '</h1><p>' + Object.keys(cases).map(key => '<a href="/?case=' + key + '">' + key + '</a>').join(' · ') + '</p><p>Expected: legacy and either single-layer fix fail. Current and preview lock on click; Escape unlocks. Parent and storage stay blocked.</p><iframe id="probe" title="Mouse test" sandbox="' + sandbox + '" ' + frameSource + ' style="width:700px;height:300px"></iframe>');
}).listen(8799, '127.0.0.1', () => console.log('Pointer lock regression: ' + origin));
