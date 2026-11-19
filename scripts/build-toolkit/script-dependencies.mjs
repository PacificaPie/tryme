import {tokenizer} from 'acorn';

const URL_CALLS=new Set(['import','fetch','require','importScripts','Worker','SharedWorker','EventSource','WebSocket','Audio','Request']);
const GLOBALS=new Set(['window','self','globalThis']);
const RESOURCE_PROPERTIES=new Set(['src','srcset','poster']);

// Compatibility inspection, not execution or a security boundary. A variable
// argument is unknown: libraries retain loaders that a game may never call.
// Only explicit URL literals are checked here. sandbox/CSP still deny network
// access, including computed URLs and APIs this inspection does not recognize.
// Stream tokens with bounded lookahead rather than retaining a full AST for a
// potentially 16 MiB bundle. Acorn skips comments and decodes JS string escapes.
export function validateScriptDependencies(code,checkURL){
  const tokens=tokenizer(code,{ecmaVersion:'latest',sourceType:'module'}),buffer=[];
  const peek=(offset=0)=>{
    while(buffer.length<=offset)buffer.push(tokens.getToken());
    return buffer[offset];
  };
  const take=()=>{const token=peek();buffer.shift();return token;};
  const literal=(offset=0)=>{
    const token=peek(offset);
    if(token.type.label==='string')return {value:token.value,end:offset+1};
    if(token.type.label==='`'&&peek(offset+1).type.label==='template'&&peek(offset+2).type.label==='`')return {value:peek(offset+1).value,end:offset+3};
    return null;
  };
  const argument=()=>{
    const value=literal();
    // Concatenation, substitutions and other computed expressions are unknown.
    if(value&&[')',','].includes(peek(value.end).type.label))checkURL(value.value);
  };
  const recent=[],frames=[];
  const previous=(n=1)=>recent.at(-n);
  const isGlobalCall=(offset)=>{
    if(!['.','?.'].includes(previous(offset+1)?.type.label))return true;
    return GLOBALS.has(previous(offset+2)?.value)&&!['.','?.'].includes(previous(offset+3)?.type.label);
  };
  for(let token=take();token.type.label!=='eof';token=take()){
    const label=token.type.label;
    // Static imports/re-exports always declare a dependency. Strings/comments
    // mentioning "import" or "from" arrive as one token and cannot match.
    if(label==='import'||(label==='name'&&token.value==='from')){
      if(!['.','?.'].includes(previous()?.type.label)&&peek().type.label==='string')checkURL(peek().value);
    }
    if(label==='('){
      const offset=previous()?.type.label==='?.'?2:1,name=previous(offset)?.value;
      const api=URL_CALLS.has(name)&&['name','import'].includes(previous(offset)?.type.label)&&isGlobalCall(offset)?name:null;
      frames.push({label,api});
      if(api)argument();
    }else if(['[','{','${'].includes(label))frames.push({label});
    else if([')',']','}'].includes(label))frames.pop();
    else if(label===','&&frames.at(-1)?.api==='importScripts')argument();
    if(label==='='&&RESOURCE_PROPERTIES.has(previous()?.value)&&previous(2)?.type.label==='.'){
      const value=literal();
      if(value&&!['+','?','.','?.','[','`'].includes(peek(value.end).type.label))checkURL(value.value);
    }
    recent.push(token);if(recent.length>5)recent.shift();
  }
}
