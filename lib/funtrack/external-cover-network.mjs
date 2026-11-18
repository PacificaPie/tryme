const fail=code=>Object.assign(new Error(code),{code});
export function externalURL(value){
  let url;try{url=new URL(value);}catch{throw fail('UNSAFE_URL');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.href.length>2048||!host.includes('.')||host.endsWith('.')||host.includes(':')||/^[\d.]+$/.test(host)||/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion|home|lan)$/.test(host)||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(host))throw fail('UNSAFE_URL');
  return url;
}
export function publicAddress(ip){
  if(/^\d+\.\d+\.\d+\.\d+$/.test(ip)){
    const a=ip.split('.').map(Number);if(a.some(n=>n>255))return false;const [x,y,z]=a;
    return !(x===0||x===10||x===127||x>=224||x===100&&y>=64&&y<=127||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&(y===168||y===0||y===2)||x===198&&(y===18||y===19||y===51&&z===100)||x===203&&y===0&&z===113);
  }
  // Only global unicast IPv6; reject mapped, translation, tunnel and documentation prefixes.
  const parts=ip.toLowerCase().split(':');
  return /^[23][0-9a-f]{3}:/i.test(ip)&&parts[0]!=='2002'&&parts[0]!=='3fff'&&!(parts[0]==='2001'&&(parseInt(parts[1]||'0',16)<0x200||parts[1]==='db8'));
}
export async function readBounded(response,max,onChunk=()=>{}){
  if(Number(response.headers.get('content-length'))>max){void response.body?.cancel();throw fail('RESOURCE_LIMIT');}
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();const chunks=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;onChunk(value.length);if(size>max){void reader.cancel();throw fail('RESOURCE_LIMIT');}chunks.push(value);}}catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const value of chunks){bytes.set(value,offset);offset+=value.length;}return bytes;
}
// Browser networking is denied at the provider. Requests are fulfilled through
// the Worker's public Internet fetch (no private bindings, headers or cookies).
// DNS checks reject private/mixed answers; redirects go through this same gate.
export function createCaptureNetwork({fetcher=fetch,signal,maxRequests=160,maxBytes=40*1024*1024}={}){
  let count=0,total=0;const hosts=new Map();
  async function check(host){
    if(!hosts.has(host)){
      if(hosts.size>=24)throw fail('RESOURCE_LIMIT');
      hosts.set(host,(async()=>{
        const results=await Promise.all(['A','AAAA'].map(async type=>{
          const response=await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,{headers:{accept:'application/dns-json'},redirect:'manual',signal});
          if(!response.ok)throw fail('UNSAFE_URL');const data=JSON.parse(new TextDecoder().decode(await readBounded(response,16384)));
          if(data.Status!==0)throw fail('UNSAFE_URL');return (data.Answer||[]).filter(r=>r.type===1||r.type===28).map(r=>r.data);
        }));
        const addresses=results.flat();if(!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw fail('UNSAFE_URL');
      })());
    }
    await hosts.get(host);
  }
  async function resource(value,requestHeaders={}){
    if(++count>maxRequests)throw fail('RESOURCE_LIMIT');const url=externalURL(value);await check(url.hostname);
    const forwarded={};
    for(const name of ['accept','rsc','next-router-prefetch','next-router-state-tree','next-url']){const value=requestHeaders[name];if(typeof value==='string'&&value.length<16384)forwarded[name]=value;}
    const response=await fetcher(url.href,{method:'GET',redirect:'manual',credentials:'omit',headers:{'User-Agent':'TryMe-Cover/1.0 (+https://trymecard.com)','Accept':'*/*',...forwarded},signal});
    const headers={};for(const name of ['content-type','access-control-allow-origin','access-control-allow-credentials','cross-origin-resource-policy']){const value=response.headers.get(name);if(value)headers[name]=value;}
    if(response.status>=300&&response.status<400){
      const next=externalURL(new URL(response.headers.get('location')||'',url.href).href);await check(next.hostname);headers.location=next.href;void response.body?.cancel();return {status:response.status,headers,body:new Uint8Array()};
    }
    const bytes=await readBounded(response,Math.min(4*1024*1024,maxBytes-total),size=>{total+=size;if(total>maxBytes)throw fail('RESOURCE_LIMIT');});if(total>maxBytes)throw fail('RESOURCE_LIMIT');
    return {status:response.status,headers,body:bytes};
  }
  return {resource,check:async value=>{const url=externalURL(value);await check(url.hostname);return url;}};
}
