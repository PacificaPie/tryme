// Shared compatibility checks for direct GitHub HTML and prebuilt repositories.
// Games still run under the platform sandbox/CSP; this is not a JavaScript security boundary.
export function validateSelfContainedHTML(html,errorFactory=()=>new Error('HTML still depends on external resources.')){
  const multifile=errorFactory;
function entities(value){return value.replace(/&#(x[0-9a-f]+|\d+);?/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&(colon|tab|newline|quot|apos|amp);/gi,(_,name)=>({colon:':',tab:'\t',newline:'\n',quot:'"',apos:"'",amp:'&'})[name.toLowerCase()]);}
function inlineURL(value){const url=entities(value).trim();if(!url||url.startsWith('#')||/^data:/i.test(url))return;throw multifile();}
function cssDependencies(css){
  const decoded=css.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,(_,hex,char)=>hex?String.fromCodePoint(Math.min(parseInt(hex,16),0x10ffff)):char);
  for(const match of decoded.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))inlineURL(match[1]??match[2]??match[3]);
  for(const match of decoded.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi))inlineURL(match[1]??match[2]);
}
// These compatibility checks are intentionally conservative, not a JS security
// boundary. Imported games must still be served with the existing sandbox/CSP.
function selfContained(html){
  const clean=html.replace(/<!--[\s\S]*?-->/g,'');
  for(const style of clean.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi))cssDependencies(style[1]);
  const markup=clean.replace(/(<(?:script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>)[\s\S]*?<\/(?:script|style)\s*>/gi,'$1');
  for(const tag of markup.matchAll(/<([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)){
    const name=tag[1].toLowerCase();if(name==='base')throw multifile();
    for(const attr of tag[2].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)){
      const key=attr[1].toLowerCase(),value=attr[2]??attr[3]??attr[4];
      if(key==='style')cssDependencies(entities(value));
      if(key==='srcdoc')throw multifile();
      if(key==='srcset'||key==='imagesrcset'){
        if(!/^data:\S+(?:\s+[\d.]+[wx])?$/i.test(entities(value).trim()))throw multifile();
      }else if(['src','poster'].includes(key)||(key==='data'&&name==='object')||(['href','xlink:href'].includes(key)&&['link','image','use','feimage'].includes(name)))inlineURL(value);
      if(name==='meta'&&key==='http-equiv'&&value.toLowerCase()==='refresh')throw multifile();
    }
  }
  for(const script of clean.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)){
    const code=script[1];
    for(const match of code.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\bfrom\s*)?(['"])([^'"]+)\1/g))inlineURL(match[2]);
    for(const match of code.matchAll(/\b(?:import|fetch|require|importScripts|Worker|SharedWorker|EventSource|WebSocket|Audio)\s*\(/g)){
      const rest=code.slice(match.index+match[0].length).trimStart();
      if(rest.startsWith(')'))continue;
      const literal=rest.match(/^(['"`])([^'"`]*?)\1/);if(!literal||literal[2].includes('${'))throw multifile();inlineURL(literal[2]);
      if(/importScripts/.test(match[0])&&!/^\s*\)/.test(rest.slice(literal[0].length)))throw multifile();
    }
    if(/\bXMLHttpRequest\b/.test(code))throw multifile();
    for(const match of code.matchAll(/\.(?:src|srcset|poster)\s*=\s*(['"`])([^'"`]*?)\1/g)){if(match[2].includes('${'))throw multifile();inlineURL(match[2]);}
  }
}

  selfContained(html);return html;
}
