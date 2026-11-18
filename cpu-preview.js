/* Interactive orthographic preview for devices without WebGL. This file also runs as a worker. */
(() => {
  const FACE_LIMIT = 160000;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  function encode(linear) {
    const v = clamp(linear, 0, 1);
    return Math.round(255 * (v <= .0031308 ? 12.92*v : 1.055*Math.pow(v, 1/2.4)-.055));
  }

  function render({vertices, colours, bounds}, {width, height, yaw, pitch, zoom}) {
    let w = width, h = height;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const centre = [0,1,2].map(i => (bounds[i] + bounds[i+3]) / 2);
    const radius = Math.hypot(...centre.map((v,i) => v-bounds[i])) || 1;
    const projected = new Float32Array(vertices.length);
    let scale = .46 * Math.min(w,h) * zoom / radius;
    for (let i=0; i<vertices.length; i+=3) {
      const x=vertices[i]-centre[0], y=vertices[i+1]-centre[1], z=vertices[i+2]-centre[2];
      projected[i]=w/2+scale*(cy*x-sy*z);
      projected[i+1]=h/2-scale*(cp*y-sp*(sy*x+cy*z));
      projected[i+2]=(sp*y+cp*(sy*x+cy*z))/radius;
    }
    // Bound fill work for many overlapping triangles and extreme zoom.
    let tests=0;
    for(let i=0;i<projected.length;i+=9) {
      const xs=[projected[i],projected[i+3],projected[i+6]], ys=[projected[i+1],projected[i+4],projected[i+7]];
      tests+=Math.max(0,clamp(Math.max(...xs),0,w)-clamp(Math.min(...xs),0,w)+1)*
             Math.max(0,clamp(Math.max(...ys),0,h)-clamp(Math.min(...ys),0,h)+1);
    }
    if(tests>14000000) {
      const f=Math.sqrt(14000000/tests); w=Math.max(1,Math.ceil(w*f)); h=Math.max(1,Math.ceil(h*f));
      for(let i=0;i<projected.length;i+=3) {projected[i]*=w/width;projected[i+1]*=h/height;}
    }
    const pixels=new Uint8ClampedArray(w*h*4), depths=new Float32Array(w*h).fill(-Infinity);
    for(let p=0;p<pixels.length;p+=4){pixels[p]=237;pixels[p+1]=240;pixels[p+2]=235;pixels[p+3]=255;}
    function draw(face, blend) {
      const i=face*9, ci=face*4;
      const ax=projected[i], ay=projected[i+1], az=projected[i+2];
      const bx=projected[i+3], by=projected[i+4], bz=projected[i+5];
      const cx=projected[i+6], cyp=projected[i+7], cz=projected[i+8];
      const den=(by-cyp)*(ax-cx)+(cx-bx)*(ay-cyp);
      if(Math.abs(den)<.000001) return;
      const x0=Math.max(0,Math.ceil(Math.min(ax,bx,cx)-.5)), x1=Math.min(w-1,Math.floor(Math.max(ax,bx,cx)-.5));
      const y0=Math.max(0,Math.ceil(Math.min(ay,by,cyp)-.5)), y1=Math.min(h-1,Math.floor(Math.max(ay,by,cyp)-.5));
      const a=colours[ci+3]/255;
      for(let y=y0;y<=y1;y++) {
        for(let x=x0;x<=x1;x++) {
          const px=x+.5-cx, py=y+.5-cyp;
          const u=((by-cyp)*px+(cx-bx)*py)/den, v=((cyp-ay)*px+(ax-cx)*py)/den, t=1-u-v;
          if(u < 0 || v < 0 || t < 0) continue;
          const depth=u*az+v*bz+t*cz, pos=y*w+x;
          if(depth<depths[pos])continue;
          const pi=4*pos;
          if(blend) {
            for(let channel=0;channel<3;channel++) pixels[pi+channel]=colours[ci+channel]*a+pixels[pi+channel]*(1-a);
          } else {
            depths[pos]=depth;
            for(let channel=0;channel<3;channel++)pixels[pi+channel]=colours[ci+channel];
          }
        }
      }
    }
    const translucent=[];
    for(let f=0;f<colours.length/4;f++) {
      if(colours[4*f+3]===255)draw(f,false);
      else if(colours[4*f+3]>0)translucent.push(f);
    }
    const z=f=>projected[f*9+2]+projected[f*9+5]+projected[f*9+8];
    translucent.sort((a,b)=>z(a)-z(b)).forEach(f=>draw(f,true));
    return {pixels,w,h};
  }

  if(typeof document==='undefined') {
    let scene;
    self.onmessage=({data})=>{
      if(data.scene){scene=data.scene;return;}
      const frame=render(scene,data.view);
      self.postMessage(frame,[frame.pixels.buffer]);
    };
    return;
  }
  const workerURL=document.currentScript?.src || new URL('cpu-preview.js',location.href).href;

  function mount(container,root,{up='Y',label='Interactive pavilion preview',THREE}={}) {
    root.updateMatrixWorld(true);
    const batches=[]; let total=0;
    root.traverseVisible(mesh=>{
      if(!mesh.isMesh)return;
      const geom=mesh.geometry, pos=geom.getAttribute('position');
      if(!pos) return;
      if(mesh.isInstancedMesh||mesh.isSkinnedMesh||mesh.morphTargetInfluences?.some(n=>n!==0))
        throw new Error('This animated or instanced model needs a WebGL device. Open the submitted image or download the model.');
      const count=geom.index?.count ?? pos.count;
      const groups=Array.isArray(mesh.material)?geom.groups:[{start:0,count,materialIndex:0}];
      for(const g of groups) {
        const mat=Array.isArray(mesh.material)?mesh.material[g.materialIndex]:mesh.material;
        if(!mat || !mat.visible || mat.opacity===0)continue;
        const start=Math.max(g.start,geom.drawRange.start), end=Math.min(g.start+g.count,geom.drawRange.start+geom.drawRange.count,count);
        const n=Math.max(0,Math.floor((end-start)/3));
        if(n){batches.push({n,pos,idx:geom.index,start,mat,matrix:mesh.matrixWorld.elements.slice()});total+=n;}
      }
    });
    if(!total) throw new Error('This model contains no visible triangles.');
    if(total>FACE_LIMIT)throw new Error('This model exceeds the 160,000-triangle limit for devices without WebGL. View the submitted image or download the full model.');
    const canvas=document.createElement('canvas'), context=canvas.getContext('2d',{alpha:false});
    if(!context)throw new Error('This browser cannot draw the 3D preview. Open the submitted image or download the full model.');
    canvas.setAttribute('role','img');canvas.setAttribute('aria-label',label+'. Drag to rotate, use the arrow keys to orbit, plus or minus to zoom, and Home to reset.');
    Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none',cursor:'grab'});
    container.replaceChildren(canvas);container.hidden=false;
    const vertices=new Float32Array(total*9), colours=new Uint8Array(total*4), bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    let dead=false, frame=0, prep=0, worker, scene, busy=false, dirty=false, ready=false, yaw=.76,pitch=.47,zoomValue=1;
    let batch=0,offset=0,face=0,drag;
    const events=new AbortController(), opts={signal:events.signal};
    function display({pixels,w,h}) {
      if(dead)return;
      canvas.width=w;canvas.height=h;context.putImageData(new ImageData(pixels,w,h),0,0);
      busy=false;if(dirty)request();
    }
    function paint() {
      frame=0;if(!ready||dead||busy)return;
      const rect=container.getBoundingClientRect();if(!rect.width||!rect.height)return;
      const factor=Math.min(1,800/rect.width,580/rect.height);
      const view={width:Math.max(1,Math.round(rect.width*factor)),height:Math.max(1,Math.round(rect.height*factor)),yaw,pitch,zoom:zoomValue};
      busy=true;dirty=false;worker.postMessage({view});
    }
    function request(){dirty=true;if(!dead&&!busy&&!frame&&ready)frame=requestAnimationFrame(paint);}
    function reset(){yaw=.76;pitch=.47;zoomValue=1;request();}
    function zoom(n){zoomValue=clamp(zoomValue*n,.15,16);request();}
    function orbit(dx,dy){yaw+=dx;pitch=clamp(pitch+dy,-1.52,1.52);request();}
    function dispose(){dead=true;events.abort();observer.disconnect();cancelAnimationFrame(frame);cancelAnimationFrame(prep);worker?.terminate();canvas.remove();}
    const observer=new ResizeObserver(request);observer.observe(container);
    const errorMessage=()=>{if(dead)return;dispose();container.textContent='The software preview could not start. Open the submitted image or download the model.';};
    try {worker=new Worker(workerURL);} catch(error){dispose();throw new Error('This device does not support the software preview. Open the submitted image or download the model.');}
    worker.onmessage=({data})=>display(data);worker.onerror=errorMessage;
    function prepare(){
      const until=performance.now()+7;
      while(batch<batches.length) {
        const b=batches[batch], e=b.matrix;
        while(offset<b.n){
          const i=face*9;
          for(let k=0;k<3;k++){
            const key=b.start+offset*3+k, ix=b.idx?b.idx.getX(key):key;
            const x=b.pos.getX(ix),y=b.pos.getY(ix),z=b.pos.getZ(ix);
            const wx=e[0]*x+e[4]*y+e[8]*z+e[12],wy=e[1]*x+e[5]*y+e[9]*z+e[13],wz=e[2]*x+e[6]*y+e[10]*z+e[14];
            const p=up.toUpperCase()==='Z'?[wx,wz,-wy]:[wx,wy,wz];
            for(let c=0;c<3;c++){vertices[i+3*k+c]=p[c];bounds[c]=Math.min(bounds[c],p[c]);bounds[c+3]=Math.max(bounds[c+3],p[c]);}
          }
          const ax=vertices[i+3]-vertices[i],ay=vertices[i+4]-vertices[i+1],az=vertices[i+5]-vertices[i+2];
          const bx=vertices[i+6]-vertices[i],by=vertices[i+7]-vertices[i+1],bz=vertices[i+8]-vertices[i+2];
          const nx=ay*bz-az*by,ny=az*bx-ax*bz,nz=ax*by-ay*bx;
          const lit=.57+.43*Math.max(0,(.38*nx+.83*ny+.40*nz)/(Math.hypot(nx,ny,nz)||1));
          const color=b.mat.color || {r:.6,g:.6,b:.6};
          colours[face*4]=encode(color.r*lit);colours[face*4+1]=encode(color.g*lit);colours[face*4+2]=encode(color.b*lit);colours[face*4+3]=Math.round(clamp(b.mat.opacity??1,0,1)*255);
          offset++;face++;
          if(face%256===0 && performance.now()>until){prep=requestAnimationFrame(prepare);return;}
        }
        offset=0;batch++;
      }
      if(!bounds.every(Number.isFinite)){errorMessage();return;}
      scene={vertices,colours,bounds};
      worker.postMessage({scene},[vertices.buffer,colours.buffer]);ready=true;request();
    }
    prep=requestAnimationFrame(prepare);
    canvas.addEventListener('pointerdown',e=>{canvas.setPointerCapture(e.pointerId);container.focus({preventScroll:true});drag=[e.pointerId,e.clientX,e.clientY];canvas.style.cursor='grabbing';},opts);
    canvas.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag[0])return;orbit(-(e.clientX-drag[1])*.009,(e.clientY-drag[2])*.009);drag=[e.pointerId,e.clientX,e.clientY];},opts);
    canvas.addEventListener('lostpointercapture',()=>{drag=null;canvas.style.cursor='grab';},opts);
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-clamp(e.deltaY,-100,100)*.004));},{...opts,passive:false});
    container.addEventListener('keydown',e=>{
      const keys={'ArrowLeft':()=>orbit(-.13,0),'ArrowRight':()=>orbit(.13,0),'ArrowUp':()=>orbit(0,.12),'ArrowDown':()=>orbit(0,-.12),'+':()=>zoom(1.2),'=':()=>zoom(1.2),'-':()=>zoom(1/1.2),'_':()=>zoom(1/1.2),'Home':reset};
      if(keys[e.key]){e.preventDefault();keys[e.key]();}
    },opts);
    return {dispose,reset,zoom,orbit};
  }
  window.PavilionCanvasPreview={mount};
})();
