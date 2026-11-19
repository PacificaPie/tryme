// Shared compatibility checks for direct GitHub HTML and prebuilt repositories.
// Games still run under the platform sandbox/CSP; this is not a JavaScript security boundary.
import {validateScriptDependencies} from './script-dependencies.mjs';
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
  for(const script of clean.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
    const attributes=[...script[1].matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)];
    const typeAttribute=attributes.find(attribute=>attribute[1].toLowerCase()==='type');
    const type=entities(typeAttribute?(typeAttribute[2]??typeAttribute[3]??typeAttribute[4]):'').trim().toLowerCase();
    // JSON and shader data blocks are not JavaScript. Import maps explicitly
    // declare resource locations and retain the same inline-only requirement.
    if(type==='importmap'){
      let map;try{map=JSON.parse(script[2]);}catch{throw multifile();}
      for(const imports of [map?.imports,...Object.values(map?.scopes||{})])for(const value of Object.values(imports||{}))if(typeof value==='string')inlineURL(value);
    }else if(!type||type==='module'||/^(?:(?:text|application)\/(?:x-)?(?:javascript|ecmascript)|text\/(?:javascript1\.[0-5]|jscript|livescript))(?:;.*)?$/.test(type)){
      try{validateScriptDependencies(script[2],inlineURL);}catch{throw multifile();}
    }
  }
}

  selfContained(html);return html;
}
