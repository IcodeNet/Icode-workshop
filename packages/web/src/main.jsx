import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
const api = async (path, options) => { const response=await fetch('/api'+path,{...options,headers:{'content-type':'application/json',...options?.headers}}); const data=await response.json(); if(!response.ok) throw new Error(data.error ?? 'Request failed'); return data }
function App() {
  const [ids,setIds]=useState([])
  const [selected,setSelected]=useState(null)
  const [exercise,setExercise]=useState(null)
  const [tab,setTab]=useState('playground')
  const [draft,setDraft]=useState('')
  const [dirty,setDirty]=useState(false)
  const [result,setResult]=useState('')
  const [dark,setDark]=useState(false)
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api('/exercises').then(({ids})=>setIds(ids)).catch(e=>setResult(e.message))},[])
  async function choose(id) {
    if(dirty && !window.confirm('Your changes are not saved. Switch exercise and discard them?')) return
    setBusy(true);setResult('')
    try {const item=await api('/exercise?id='+encodeURIComponent(id)); const data=await api('/select',{method:'POST',body:JSON.stringify({id})});setSelected(id);setExercise(item);setDraft(data.code);setDirty(false);setTab('playground');if(data.backup)setResult('Previous playground backed up locally.')}
    catch(e){setResult(e.message)}finally{setBusy(false)}
  }
  async function save() {
    setBusy(true)
    try{await api('/playground',{method:'PUT',body:JSON.stringify({code:draft})});setDirty(false);setResult('Saved to the local playground file.')}
    catch(e){setResult(e.message)}finally{setBusy(false)}
  }
  async function test() {
    setBusy(true)
    try{if(dirty){await api('/playground',{method:'PUT',body:JSON.stringify({code:draft})});setDirty(false)}const outcome=await api('/test',{method:'POST'});setResult((outcome.passed?'PASS':'FAIL')+'\n'+outcome.output)}
    catch(e){setResult(e.message)}finally{setBusy(false)}
  }
  return <div className={dark?'app dark':'app'}><header className="topbar"><div className="brand"><span className="brand-mark">I</span><div><strong>Icode Workshop</strong><small>Learn by building</small></div></div><div className="top-actions"><span className="mode">Local learning environment</span><button onClick={()=>setDark(!dark)}>{dark?'Light':'Dark'} mode</button></div></header><div className="shell"><aside className="sidebar"><div className="eyebrow">COURSE</div><h2>AI Engineering</h2><p>Practical, testable exercises</p><div className="eyebrow section-label">EXERCISES</div>{ids.map(id=><button disabled={busy} key={id} className={id===selected?'exercise active':'exercise'} onClick={()=>choose(id)}><span className="number">{id}</span><span>{id==='01'?'Approved documents only':'Exercise '+id}<small>AI engineering</small></span></button>)}<div className="sidebar-footer">Select an exercise to create its playground. Switching creates a filesystem backup.</div></aside><main className="content">{exercise?<><div className="heading"><span className="pill">{exercise.topic}</span><h1>{exercise.title}</h1><p>{exercise.description}</p></div><section className="workbench"><div className="workbench-head"><div><h2>Code workbench</h2><p>Write code, save it locally, then run the exercise tests.</p></div><div className="top-actions"><button disabled={busy||!dirty} onClick={save}>Save</button><button disabled={busy} className="primary" onClick={test}>Run tests</button></div></div><div className="tabs" role="tablist" aria-label="Code view">{['problem','playground','solution','diff'].map(item=><button key={item} role="tab" aria-selected={tab===item} className={tab===item?'tab selected':'tab'} onClick={()=>setTab(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div><div className="editor-head"><span>index.mjs</span><span>{tab==='playground'?'Editable playground':tab==='diff'?'Side-by-side comparison':'Read-only reference'}</span></div>{tab==='playground'?<textarea spellCheck="false" aria-label="Playground code editor" value={draft} onChange={e=>{setDraft(e.target.value);setDirty(true)}}/>:tab==='diff'?<div className="comparison"><pre className="code">{'PLAYGROUND\n'+draft}</pre><pre className="code">{'SOLUTION\n'+exercise.solution}</pre></div>:<pre className="code">{tab==='problem'?exercise.problem:exercise.solution}</pre>}<div className="editor-footer"><span>{dirty?'Unsaved changes':'Saved / reference'}</span><span>Node.js · JavaScript</span></div></section><section className="hint"><span className="hint-icon">i</span><div><strong>Playground workflow</strong><p>The problem and solution remain unchanged. Save edits to your playground. Run tests against the saved files. Switching exercises backs up the current playground.</p></div></section></>:<div className="heading"><span className="pill">Get started</span><h1>Choose an exercise</h1><p>Select an exercise on the left to create an editable playground.</p></div>}{result&&<pre className="notice" role="status">{result}</pre>}</main></div></div>
}
createRoot(document.getElementById('root')).render(<App />)
