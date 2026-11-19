/* The opening represents TryMe, not a sample person's profile or statistics.
   Real creator cards continue to use the saved profile in the card renderer. */
(function(){
'use strict';
var LC=window.LC=window.LC||{};
LC.PROFILE={name:'TryMe',no:'',latin:''};
LC.backGlyphs=function(){return '作品就是名片发现灵感亲手试玩认识创作者让作品被看见';};
LC.cardBack=function(W,H){
  var cv=document.createElement('canvas');cv.width=W;cv.height=H;
  var g=cv.getContext('2d'),light=window.OpeningTheme&&window.OpeningTheme.card==='light';
  var ink=light?'#252c34':'#ebeff3',paper=light?'#e8ecf1':'#10151b';
  var mono='ui-monospace,Menlo,monospace',sans='"Jost",system-ui,sans-serif';
  var serif='"Noto Serif SC","Songti SC",serif';
  g.scale(W/1280,H/800);g.fillStyle=paper;g.fillRect(0,0,1280,800);
  // A quiet printed grid recalls the city streets on the front.
  g.fillStyle=ink;g.globalAlpha=.12;
  for(var x=40;x<1280;x+=24)for(var y=36;y<800;y+=24)g.fillRect(x,y,1.5,1.5);
  g.globalAlpha=1;g.textBaseline='alphabetic';
  g.font='500 24px '+mono;g.fillText('TRYME / A PLACE FOR YOUR WORK',64,80);
  g.globalAlpha=.25;g.fillRect(64,108,1152,1.5);g.fillRect(64,690,1152,1.5);g.globalAlpha=1;
  g.fillStyle='#db6049';g.beginPath();g.arc(83,202,14,0,Math.PI*2);g.fill();
  g.fillStyle=ink;g.font='600 150px '+sans;g.fillText('TryMe',64,383);
  g.font='600 44px '+serif;g.fillText('让作品，被看见。',70,476);
  g.globalAlpha=.2;g.fillRect(596,190,1.5,412);g.globalAlpha=1;
  g.font='900 58px '+serif;g.fillText('作品就是名片',662,268);
  g.font='400 42px '+serif;
  ['发现灵感','亲手试玩','认识创作者'].forEach(function(line,i){
    var y=386+i*86;
    g.globalAlpha=.45;g.font='400 25px '+mono;g.fillText('0'+(i+1),664,y-3);
    g.globalAlpha=1;g.font='400 42px '+serif;g.fillText(line,734,y);
  });
  g.globalAlpha=.65;g.font='400 25px '+mono;g.fillText('trymecard.com',64,748);
  g.textAlign='right';g.fillText('DISCOVER · PLAY · CONNECT',1216,748);g.globalAlpha=1;
  return cv;
};
})();
