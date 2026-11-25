(function(root){
 function activeCue(segments,time){let low=0,high=segments.length-1;while(low<=high){const mid=(low+high)>>1,cue=segments[mid];if(time<cue.start)high=mid-1;else if(time>=cue.end)low=mid+1;else return cue;}return null;}
 function captionGeometry(videoRect,screenRect,videoWidth,videoHeight){
  if(!(videoWidth>0&&videoHeight>0&&videoRect.width>0&&videoRect.height>0))return null;
  const scale=Math.min(videoRect.width/videoWidth,videoRect.height/videoHeight),renderedWidth=videoWidth*scale,space=(videoRect.width-renderedWidth)/2;
  if(space<80)return null;
  return {left:videoRect.left-screenRect.left+(videoRect.width+renderedWidth)/2,top:videoRect.top-screenRect.top,width:space,height:videoRect.height};
 }
 function attach(video,screen,getCaption){
  const box=document.createElement('div');box.className='tv-captions';box.hidden=true;const text=document.createElement('div');box.append(text);screen.append(box);let shown=null,frame=null;
  function update(){
   const playing=!video.hidden&&!!video.getAttribute('src');screen.classList.toggle('video-active',playing);
   const data=getCaption(),screenRect=screen.getBoundingClientRect(),videoRect=playing?video.getBoundingClientRect():null;
   const sideGeometry=playing?captionGeometry(videoRect,screenRect,video.videoWidth,video.videoHeight):null;
   screen.classList.toggle('has-left-message',!!sideGeometry);
   if(sideGeometry){
    const left={left:videoRect.left-screenRect.left,top:sideGeometry.top,width:sideGeometry.width,height:sideGeometry.height};
    for(const key of ['left','top','width','height'])screen.style.setProperty('--message-'+key,left[key]+'px');
    screen.style.setProperty('--message-title-size',Math.max(16,72*screenRect.width/1920)+'px');
    screen.style.setProperty('--message-label-size',Math.max(10,22*screenRect.width/1920)+'px');
    screen.style.setProperty('--message-padding',Math.max(12,52*screenRect.width/1920)+'px');
   }
   const geometry=data?.enabled?sideGeometry:null;
   const enabled=!!geometry;screen.classList.toggle('has-captions',enabled);box.hidden=!enabled;
   if(!enabled){text.textContent='';shown=null;return;}
   for(const key of ['left','top','width','height'])box.style[key]=geometry[key]+'px';
   const style=data.style||{},baseSize=(style.size||42)*screenRect.width/1920;
   box.style.fontSize=Math.max(12,baseSize)+'px';box.style.fontFamily=style.font||'Arial';box.style.color=style.color||'#ffffff';box.style.textAlign=style.align||'center';box.dataset.position=style.position||'center';
   const cue=activeCue(data.segments||[],video.currentTime||0),value=cue?.text||'';if(shown!==value){text.textContent=value;shown=value;}
   const computed=getComputedStyle(box),available=box.clientHeight-parseFloat(computed.paddingTop)-parseFloat(computed.paddingBottom);
   if(text.scrollHeight>available){const ratio=Math.max(.5,available/text.scrollHeight);box.style.fontSize=Math.max(12,baseSize*ratio*.95)+'px';}
  }
  const events=['timeupdate','seeking','seeked','loadedmetadata','emptied','ended','pause','play','error'];events.forEach(event=>video.addEventListener(event,update));
  function loop(){update();frame=requestAnimationFrame(loop);}frame=requestAnimationFrame(loop);
  return {update,destroy(){cancelAnimationFrame(frame);events.forEach(event=>video.removeEventListener(event,update));screen.classList.remove('has-captions');screen.classList.remove('video-active');screen.classList.remove('has-left-message');box.remove();}};
 }
 root.TVCaptionView={activeCue,captionGeometry,attach};
})(globalThis);
