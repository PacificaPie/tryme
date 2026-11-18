export const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
export async function readLimited(message,max,binary=false,limitError=null){
  const tooLarge=size=>Object.assign(Error(limitError?`${limitError.label} 大小至少为 ${Math.ceil(size/1048576*100)/100} MiB，超过 ${max/1048576} MiB 上限。`:'Response exceeds limit'),{code:limitError?.code||'BUILD_FAILED'});
  const declared=Number(message.headers.get('content-length')||0);
  if(declared>max){await message.body?.cancel();throw tooLarge(declared);}
  if(!message.body)return binary?new Uint8Array():'';
  const reader=message.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw tooLarge(size);}chunks.push(value);}}finally{reader.releaseLock();}
  const result=new Uint8Array(size);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}
  return binary?result:new TextDecoder('utf-8',{fatal:true}).decode(result);
}
export function safeError(error,secrets=[]){let message=String(error?.message||'Cloud build failed');for(const secret of secrets)if(secret)message=message.split(secret).join('[redacted]');return Object.assign(Error(message.slice(0,2000)),{code:error?.code||'BUILD_FAILED'});}
export async function api(env,path,body,{attempts=1}={}){
  if(!env.FUNTRACK_SITE||typeof env.FUNTRACK_BUILD_RUNNER_TOKEN!=='string')throw Error('Cloud builder is not configured');
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const form=body instanceof FormData;
      const response=await env.FUNTRACK_SITE.fetch(`${env.FUNTRACK_SITE_ORIGIN}/api/build-worker/${path}`,{method:'POST',headers:{Authorization:`Bearer ${env.FUNTRACK_BUILD_RUNNER_TOKEN}`,...(form?{}:{'Content-Type':'application/json'})},body:form?body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(30000)});
      const data=JSON.parse(await readLimited(response,128*1024));
      if(!response.ok){const error=Object.assign(Error(data.error?.message||'Build service unavailable'),{code:data.error?.code,status:response.status});if(response.status<500)throw Object.assign(error,{terminal:true});throw error;}
      return data;
    }catch(error){last=error;if(error.terminal||i+1===attempts)throw error;await new Promise(resolve=>setTimeout(resolve,500*(i+1)));}
  }throw last;
}
export async function enqueue(env,buildId){return env.JOBS.getByName(buildId).fetch('https://job/enqueue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buildId})});}
export function allowOutbound(request,fetchImpl=fetch){
  const url=new URL(request.url);
  if(request.method!=='GET'||!['https:','http:'].includes(url.protocol)||!['registry.npmjs.org','codeload.github.com'].includes(url.hostname)||url.username||url.password||(url.port&&url.port!=='443'&&url.port!=='80'))return new Response('Forbidden',{status:403});
  // The forwarded request has no platform authorization, cookies or user headers.
  url.protocol='https:';url.port='';
  return fetchImpl(url.href,{method:'GET',headers:{'User-Agent':'Funtrack-Cloud-Builder',Accept:request.headers.get('accept')||'*/*'},redirect:'manual'});
}
