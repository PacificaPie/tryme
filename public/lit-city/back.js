// A printed reverse on the same physical slab. The geometry/UV orientation is
// adapted from opening/card/world.js; all content comes from the cleaned author.
export function wrapText(ctx, text, width, maxLines) {
  const lines=[];let line='';
  for(const char of Array.from(text||'')) {
    if(char==='\n'||(line&&ctx.measureText(line+char).width>width)) {
      lines.push(line);line='';
      if(lines.length===maxLines){let last=lines.pop();while(last&&ctx.measureText(last+'…').width>width)last=Array.from(last).slice(0,-1).join('');lines.push(last+'…');return lines;}
      if(char==='\n')continue;
    }
    line+=char;
  }
  if(line)lines.push(line);
  return lines;
}
export function createCardBack(core, group, author, theme, wake) {
  const T=core.T,C=window.SP.CFG,{w,d,r,th}=C.CARD;
  const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=Math.round(2048*d/w);
  const texture=new T.CanvasTexture(canvas);texture.minFilter=T.LinearMipmapLinearFilter;texture.anisotropy=Math.min(8,core.renderer.capabilities.getMaxAnisotropy());
  const uniforms={tMap:{value:texture},uHalf:{value:new T.Vector2(w/2,d/2)},uR:{value:r},uSheen:{value:.5}};
  const geometry=new T.BufferGeometry(),y=-th-.003;
  geometry.setAttribute('position',new T.Float32BufferAttribute([-w/2,y,-d/2,w/2,y,-d/2,w/2,y,d/2,-w/2,y,d/2],3));
  // Winding faces down; printed left points toward -x when flipped around z.
  geometry.setAttribute('uv',new T.Float32BufferAttribute([1,1,0,1,0,0,1,0],2));geometry.setIndex([0,1,2,0,2,3]);
  const material=new T.ShaderMaterial({uniforms,extensions:{derivatives:true},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:`uniform sampler2D tMap;uniform vec2 uHalf;uniform float uR;uniform float uSheen;varying vec2 vUv;
      void main(){vec2 p=(vUv-.5)*uHalf*2.;vec2 q=abs(p)-(uHalf-uR);float sd=length(max(q,0.))+min(max(q.x,q.y),0.)-uR;if(sd>0.)discard;
      vec3 col=texture2D(tMap,vUv).rgb;float b=vUv.x*.92+vUv.y*.38-uSheen;
      col+=vec3(.8,.84,.92)*(.018*exp(-b*b/.022)+.008*exp(-b*b/.26));gl_FragColor=vec4(col,1.);}`});
  const mesh=new T.Mesh(geometry,material);mesh.name='creator-card-back';group.add(mesh);
  let disposed=false,avatar=null,compact=null,websiteBox=null;
  const palettes={ivory:['#ebe6dc','#29282a','#735b37','#67635d'],cobalt:['#15264b','#eef2fa','#bfcee8','#b6c1d8'],ink:theme==='light'?['#e8ecf1','#25303d','#485e75','#56616d']:['#10151b','#e9e6de','#e6c98e','#b7b8bd']};
  function draw() {
    const g=canvas.getContext('2d'),[paper,ink,accent,muted]=palettes[author.backStyle]||palettes.ink;
    g.setTransform(canvas.width/1280,0,0,canvas.height/810,0,0);g.fillStyle=paper;g.fillRect(0,0,1280,810);
    g.fillStyle=ink;g.globalAlpha=.10;for(let x=40;x<1280;x+=24)for(let yy=36;yy<810;yy+=24)g.fillRect(x,yy,1.5,1.5);g.globalAlpha=1;
    g.textBaseline='alphabetic';g.textAlign='left';g.fillStyle=accent;g.font='500 24px ui-monospace,Menlo,monospace';g.fillText('TRYME / CREATOR',64,81);
    g.fillStyle=ink;g.globalAlpha=.22;g.fillRect(64,109,1152,1.5);g.fillRect(64,694,1152,1.5);g.globalAlpha=1;
    const sans='"PingFang SC","Hiragino Sans GB",system-ui,sans-serif';
    let nameSize=compact?90:102;g.font='600 '+nameSize+'px '+sans;
    while(nameSize>64&&wrapText(g,author.name,1010,3).length>2){nameSize-=4;g.font='600 '+nameSize+'px '+sans;}
    const names=wrapText(g,author.name,1010,2);g.fillStyle=ink;
    names.forEach((line,i)=>g.fillText(line,64,235+i*(nameSize+12)));
    if(avatar?.complete&&avatar.naturalWidth){g.save();g.beginPath();g.arc(1162,204,48,0,Math.PI*2);g.clip();const size=Math.min(avatar.naturalWidth,avatar.naturalHeight);g.drawImage(avatar,(avatar.naturalWidth-size)/2,(avatar.naturalHeight-size)/2,size,size,1114,156,96,96);g.restore();}
    let yy=235+Math.max(0,names.length-1)*(nameSize+12)+72;
    g.fillStyle=accent;g.font='500 '+(compact?42:38)+'px '+sans;
    const headlines=wrapText(g,author.headline,1152,2);headlines.forEach(line=>{g.fillText(line,64,yy);yy+=54;});
    if(headlines.length)yy+=12;
    g.fillStyle=muted;g.font='400 '+(compact?37:32)+'px '+sans;
    const lineHeight=compact?49:44,bioLines=Math.max(1,Math.floor((658-yy)/lineHeight)+1);
    wrapText(g,author.bio,1152,bioLines).forEach(line=>{g.fillText(line,64,yy);yy+=lineHeight;});
    g.fillStyle=muted;g.font='400 '+(compact?32:28)+'px '+sans;
    const domain=author.website?new URL(author.website).hostname+' ↗':'',domainWidth=Math.min(560,g.measureText(domain).width);
    const footerWidth=domain?Math.max(420,1088-domainWidth):1152;
    wrapText(g,author.signature,footerWidth,1).forEach(line=>g.fillText(line,64,758));
    websiteBox=null;
    if(domain){const label=wrapText(g,domain,560,1)[0],width=g.measureText(label).width;g.fillStyle=accent;g.fillText(label,1216-width,758);g.globalAlpha=.45;g.fillRect(1216-width,768,width,1.5);g.globalAlpha=1;websiteBox={x:1216-width-18,y:711,w:width+36,h:78};}
    texture.needsUpdate=true;wake();
  }
  function resize(){const next=core.size().w<600;if(next!==compact){compact=next;draw();}}
  resize();
  if(author.avatarUrl){avatar=new Image();avatar.onload=()=>{if(!disposed)draw();};avatar.onerror=()=>{avatar=null;};avatar.src=author.avatarUrl;}
  document.fonts?.ready.then(()=>{if(!disposed)draw();});
  return {mesh,resize,update(angle){uniforms.uSheen.value=.55+.35*Math.cos(angle);},
    websiteHit(ray){if(!websiteBox||ray.direction.y<=0)return false;const t=(y-ray.origin.y)/ray.direction.y;if(t<0)return false;const px=(.5-(ray.origin.x+t*ray.direction.x)/w)*1280,py=(.5+(ray.origin.z+t*ray.direction.z)/d)*810;return px>=websiteBox.x&&px<=websiteBox.x+websiteBox.w&&py>=websiteBox.y&&py<=websiteBox.y+websiteBox.h;},
    dispose(){disposed=true;if(avatar){avatar.onload=avatar.onerror=null;avatar.src='';}group.remove(mesh);geometry.dispose();material.dispose();texture.dispose();}
  };
}
