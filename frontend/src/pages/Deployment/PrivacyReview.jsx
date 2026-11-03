import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Checkbox, Select, Space } from 'antd';
import api from '../../services/api';
import { getImageUrl } from '../../utils/getImageUrl';

export default function PrivacyReview({ projectId, assetId, onReady }) {
  const [items, setItems] = useState([]);
  const [id, choose] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelSize,setModelSize] = useState('s');
  const [checked, confirm] = useState(false);
  const [selected, select] = useState(-1);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState(null);
  const drag = useRef(null);
  const viewport = useRef(null);
  const plane = useRef(null);
  const item = items.find(a => a.id === id);
  useEffect(() => {
    let live = true;
    onReady?.(false);
    api.get(assetId ? '/api/privacy/'+assetId : '/api/projects/'+projectId+'/privacy').then(({data}) => {
      if (!live) return;
      const list=assetId ? [data.data] : data.data;
      setItems(list); choose((list.find(a=>!a.approved) || list[0])?.id);
      onReady?.(list.every(a=>a.approved));
    }).catch(e=>live && setError(e.message));
    return () => { live=false; };
  }, [projectId,assetId,onReady]);
  function update(changes) {
    const next=items.map(a=>a.id===id?{...a,...changes}:a);
    setItems(next); onReady?.(next.every(a=>a.approved)); confirm(false);
  }
  async function run(kind) {
    setBusy(true); setError('');
    try {
      const {data}=await api.post('/api/privacy/'+id+'/'+kind,kind==='approve'?{masks:item.masks}:{modelSize},{timeout:300000});
      if(kind==='approve') update({approved:true});
      else {update({...data.data,scanned:true,approved:false});select(-1);}
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }
  function point(event) {
    const rect=plane.current.getBoundingClientRect();
    const clamp=v=>Math.max(0,Math.min(1,v));
    return {x:clamp((event.clientX-rect.left)/rect.width),y:clamp((event.clientY-rect.top)/rect.height)};
  }
  function box(a,b) {
    return {x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(a.x-b.x),h:Math.abs(a.y-b.y)};
  }
  function focus(x,y) {
    setZoom(3);
    requestAnimationFrame(()=>viewport.current?.scrollTo({
      left:x*plane.current.offsetWidth-viewport.current.clientWidth/2,
      top:y*plane.current.offsetHeight-viewport.current.clientHeight/2
    }));
  }
  function resize(key,value) {
    const masks=item.masks.map((m,i)=>i===selected?{...m,[key]:Math.min(value,1-(key==='w'?m.x:m.y))}:m);
    update({masks,approved:false});
  }
  return <Card size="small" title={assetId ? "Face blurring for this panorama" : "Privacy review before publishing"} style={{marginBottom:16}}>
    {error && <Alert type="error" title={error} />}
    {assetId && item && <p role="status">{item.approved ? 'Approved public copy saved.' : 'Review now or finish later in Deployment.'}</p>}
    {!assetId && items.length>0 && <Select aria-label="Image to review" disabled={busy} style={{width:'100%'}} value={id}
      options={items.map(a=>({value:a.id,label:(a.approved?'Approved · ':'Review · ')+a.name}))}
      onChange={v=>{choose(v);select(-1);setZoom(1);confirm(false);setError('');}} />}
    {item && <>
      <p>Scan for faces, then inspect the whole image. Drag over a missed face to add a blur. Select a blur to resize or remove it.</p>
      <Space wrap><Select aria-label="Face detector for next scan" disabled={busy} value={modelSize} onChange={setModelSize}
        options={[{value:'s',label:'YOLO11s-Face · Small'},{value:'n',label:'YOLO11n-Face · Nano'}]}/>
        <Button loading={busy} disabled={busy} onClick={()=>run('scan')}>{item.scanned?'Rescan image':'Scan image'}</Button>
        <Button onClick={()=>setZoom(zoom===1?3:1)}>{zoom===1?'Zoom in':'Fit image'}</Button></Space>
      <div ref={viewport} style={{overflow:'auto',maxHeight:440,margin:'12px 0'}}>
        <div ref={plane} style={{position:'relative',width:zoom*100+'%',touchAction:'none',cursor:'crosshair'}}
          onPointerDown={e=>{if(busy || !item.scanned)return;drag.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}}
          onPointerMove={e=>{if(drag.current)setDraft(box(drag.current,point(e)));}}
          onPointerCancel={()=>{drag.current=null;setDraft(null);}}
          onPointerUp={e=>{if(!drag.current)return;const m=box(drag.current,point(e));drag.current=null;setDraft(null);
            if(m.w>.001 && m.h>.001){select(item.masks.length);update({masks:[...item.masks,m],approved:false});}}}>
          <img draggable={false} src={getImageUrl(item.path)} alt={'Privacy review of '+item.name} style={{width:'100%',display:'block',pointerEvents:'none'}}/>
          {[...item.masks,...(draft?[draft]:[])].map((m,i)=><button key={i} type="button" aria-label={'Blur '+(i+1)}
            disabled={busy} onPointerDown={e=>e.stopPropagation()} onClick={()=>select(i)}
            style={{position:'absolute',left:m.x*100+'%',top:m.y*100+'%',width:m.w*100+'%',height:m.h*100+'%',padding:0,
              border:'2px solid '+(selected===i?'orange':'white'),background:'#ddd4',backdropFilter:'blur(14px)'}}/>)}
        </div>
      </div>
      {item.scanned && <fieldset disabled={busy}><legend>{item.masks.length} blur regions</legend>
        <Space wrap>{item.masks.map((m,i)=><Button key={i} size="small" onClick={()=>{select(i);focus(m.x+m.w/2,m.y+m.h/2);}}>Blur {i+1}</Button>)}
        {item.people.map((p,i)=><Button key={'p'+i} size="small" onClick={()=>focus(p.x,p.y)}>Check person {i+1}</Button>)}</Space>
        {item.masks[selected] && <p>{['w','h'].map(k=><label key={k}>{k==='w'?'Width':'Height'} <input type="range" min=".001" max={1-item.masks[selected][k==='w'?'x':'y']} step=".001" value={item.masks[selected][k]} onChange={e=>resize(k,+e.target.value)}/></label>)}
          <Button size="small" onClick={()=>{update({masks:item.masks.filter((_,i)=>i!==selected),approved:false});select(-1);}}>Remove blur</Button></p>}
        <p><Checkbox checked={checked} onChange={e=>confirm(e.target.checked)}>I inspected the entire image, including flagged people and the edges.</Checkbox></p>
        <Button disabled={!checked || busy} onClick={()=>run('approve')}>Approve and bake public copy</Button>
      </fieldset>}
    </>}
  </Card>;
}
