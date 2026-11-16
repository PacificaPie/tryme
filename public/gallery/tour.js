/* Camera poses for the actual unfolded picture planes; no DOM or renderer. */
(function(){
'use strict';
var SP=window.SP=window.SP||{};

SP.tourOrder=function(works,pageSize){
  if(!Array.isArray(works))return [];
  var configured=window.FuntrackGallery&&window.FuntrackGallery.pageSize;
  var defaultSize=Number.isInteger(configured)&&configured>0?configured:6;
  pageSize=Number.isInteger(pageSize)&&pageSize>0?pageSize:defaultSize;
  var order=[],seen=new Set();
  function add(work){if(work&&typeof work.id==='string'&&work.id&&!seen.has(work.id)){seen.add(work.id);order.push(work.id);}}
  for(var at=0;at<works.length;at+=pageSize){
    var page=works.slice(at,at+pageSize);
    if(page.length<=2)page.forEach(add);
    else [0,2,1].forEach(function(wall){page.forEach(function(work,i){if(i%3===wall)add(work);});});
  }
  return order;
};

SP.tourPose=function(T,targetMesh,aspect){
  if(!targetMesh||!targetMesh.geometry)return null;
  aspect=Number.isFinite(aspect)&&aspect>0?aspect:1;
  targetMesh.updateWorldMatrix(true,false);
  var look=targetMesh.getWorldPosition(new T.Vector3());
  var normal=new T.Vector3(0,0,1).transformDirection(targetMesh.matrixWorld);
  if(!Number.isFinite(normal.x+normal.y+normal.z)||normal.lengthSq()<.5)return null;

  // Camera.lookAt uses world +Y as up. Project the real transformed box onto
  // those camera axes instead of assuming that a side wall has a fixed yaw.
  var right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),normal);
  if(right.lengthSq()<1e-10)return null; // Tour poses are for upright, unfolded walls.
  right.normalize();
  var up=new T.Vector3().crossVectors(normal,right).normalize();
  var geometry=targetMesh.geometry;
  if(!geometry.boundingBox)geometry.computeBoundingBox();
  var box=geometry.boundingBox;
  if(!box||box.isEmpty())return null;
  var halfW=0,halfH=0,halfDepth=0;
  [box.min.x,box.max.x].forEach(function(x){[box.min.y,box.max.y].forEach(function(y){[box.min.z,box.max.z].forEach(function(z){
    var offset=new T.Vector3(x,y,z).applyMatrix4(targetMesh.matrixWorld).sub(look);
    halfW=Math.max(halfW,Math.abs(offset.dot(right)));
    halfH=Math.max(halfH,Math.abs(offset.dot(up)));
    halfDepth=Math.max(halfDepth,Math.abs(offset.dot(normal)));
  });});});

  // An explicit root marker survives additional groups in the popup hierarchy.
  // The current popup is otherwise the highest group immediately below Scene.
  var root=targetMesh,marked=null;
  for(var node=targetMesh;node&&!node.isScene;node=node.parent){root=node;if(node.userData&&node.userData.tourRoom){marked=node;break;}}
  root=marked||root;
  var pr=SP.prints||{},room=marked?marked.userData.tourRoom:{minX:-(pr.FX||1.3),maxX:pr.FX||1.3,minY:Number.isFinite(pr.Y0)?pr.Y0:-.55,maxY:Number.isFinite(pr.Y1)?pr.Y1:1.85};
  if(![room.minX,room.maxX,room.minY,room.maxY].every(Number.isFinite)||room.minX>=room.maxX||room.minY>=room.maxY)return null;
  root.updateWorldMatrix(true,false);
  var inverse=new T.Matrix4().copy(root.matrixWorld).invert();
  var localLook=look.clone().applyMatrix4(inverse);
  // Unlike transformDirection, this preserves root scale: t remains world units.
  var localStep=look.clone().add(normal).applyMatrix4(inverse).sub(localLook);
  var minDistance=.06,maxDistance=Infinity,wallMargin=.08;
  function clip(origin,step,min,max){
    min+=wallMargin;max-=wallMargin;
    if(min>=max)return false;
    if(Math.abs(step)<1e-10)return origin>=min&&origin<=max;
    var a=(min-origin)/step,b=(max-origin)/step;
    minDistance=Math.max(minDistance,Math.min(a,b));maxDistance=Math.min(maxDistance,Math.max(a,b));return true;
  }
  if(!clip(localLook.x,localStep.x,room.minX,room.maxX)||!clip(localLook.y,localStep.y,room.minY,room.maxY)||maxDistance<minDistance||!Number.isFinite(maxDistance))return null;

  // .66 leaves 34% of the viewport for the return bar and bottom dock, including
  // their breathing room (about 83px per edge at a 490px viewport). Keep the eye inside
  // the physical footprint; on narrow screens widen FOV instead of crossing a wall.
  var padding=.66,fov=66,fit=Math.max(halfW/(aspect*padding),halfH/padding);
  var distance=Math.max(minDistance,.50,halfDepth+fit/Math.tan(fov*Math.PI/360));
  if(distance>maxDistance){
    distance=maxDistance;
    var usable=distance-halfDepth;if(usable<=0)return null;
    fov=Math.max(fov,2*Math.atan(fit/usable)*180/Math.PI);
  }
  if(!Number.isFinite(fov)||fov>=175)return null;
  return {eye:look.clone().addScaledVector(normal,distance),look:look,fov:fov};
};
})();
