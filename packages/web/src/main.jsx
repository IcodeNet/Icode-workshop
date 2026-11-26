import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
const api = async (path, options) => { const response=await fetch('/api'+path,{...options,headers:{'content-type':'application/json',...options?.headers}}); const data=await response.json(); if(!response.ok) throw new Error(data.error ?? 'Request failed'); return data }

function diffLines(before,after){
  const a=before.split('\n'),b=after.split('\n'),n=a.length,m=b.length
  if(n*m>150000)return [{kind:'note',text:'Files are too large for inline comparison.'}]
  const dp=Array.from({length:n+1},()=>new Uint32Array(m+1))
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)dp[i][j]=a[i]===b[j]?1+dp[i+1][j+1]:Math.max(dp[i+1][j],dp[i][j+1])
  const lines=[];let i=0,j=0
  while(i<n||j<m){if(i<n&&j<m&&a[i]===b[j]){lines.push({kind:'same',text:'  '+a[i]});i++;j++}
  else if(j<m&&(i===n||dp[i][j+1]>=dp[i+1][j])){lines.push({kind:'added',text:'+ '+b[j++]})}
  else{lines.push({kind:'removed',text:'- '+a[i++]})}}
  return lines
}
function App() {
  const [ids,setIds]=useState([])
  const [selected,setSelected]=useState(null)
  const [exercise,setExercise]=useState(null)
  const [tab,setTab]=useState('playground')
  const [draft,setDraft]=useState('')
  const [dirty,setDirty]=useState(false)
  const [result,setResult]=useState('')
  const [panel,setPanel]=useState('console')
  const [busy,setBusy]=useState(false)
  useEffect(()=>{api('/exercises').then(({ids})=>setIds(ids)).catch(e=>setResult(e.message))},[])
  async function choose(id) {
    if(dirty && !window.confirm('Your changes are not saved. Switch exercise and discard them?')) return
    setBusy(true);setResult('')
    try {const item=await api('/exercise?id='+encodeURIComponent(id)); const data=await api('/select',{method:'POST',body:JSON.stringify({id})});setSelected(id);setExercise(item);setDraft(data.code);setDirty(false);setTab('description');setResult('Your exercise workspace is ready. Previous edits are preserved.')}
    catch(e){setResult(e.message)}finally{setBusy(false)}
  }
  async function save() {
    setBusy(true)
    try{await api('/playground',{method:'PUT',body:JSON.stringify({id:selected,code:draft})});setDirty(false);setResult('Saved to the exercise-specific local playground file.')}
    catch(e){setResult(e.message)}finally{setBusy(false)}
  }
  async function test() {
    setBusy(true)
    try{if(dirty){await api('/playground',{method:'PUT',body:JSON.stringify({id:selected,code:draft})});setDirty(false)}const outcome=await api('/test',{method:'POST',body:JSON.stringify({id:selected})});setPanel('tests');setResult((outcome.passed?'PASS':'FAIL')+'\n'+outcome.output)}
    catch(e){setResult(e.message)}finally{setBusy(false)}
  }
  return <div className="app dark"><header className="topbar"><div className="brand"><span className="brand-mark">I</span><div><strong>Icode Workshop</strong><small>Learn by building</small></div></div><div className="top-actions"><span className="mode">Local learning environment</span><span className="mode">AI Engineering Labs</span></div></header><div className="shell"><aside className="sidebar"><div className="eyebrow">COURSE</div><h2>Labs</h2><p>Practical, testable labs</p><div className="eyebrow section-label">EXERCISES</div>{ids.map(id=><button disabled={busy} key={id} className={id===selected?'exercise active':'exercise'} onClick={()=>choose(id)}><span className="number">{id}</span><span>{id==='01'?'Approved documents only':'Exercise '+id}<small>AI engineering</small></span></button>)}<div className="sidebar-footer">Select an exercise to create its playground. Each lab has a persistent, separate playground.</div></aside><main className="content">{exercise?<><div className="heading"><span className="pill">{exercise.topic}</span><h1>{exercise.title}</h1><p>{exercise.description}</p></div><section className="workbench"><div className="workbench-head"><div><h2>Code workbench</h2><p>Write code, save it locally, then run the exercise tests.</p></div><div className="top-actions"><button disabled={busy||!dirty} onClick={save}>Save</button><button disabled={busy} className="primary" onClick={test}>Run tests</button></div></div><div className="tabs" role="tablist" aria-label="Code view">{['description','playground','solution','diff'].map(item=><button key={item} role="tab" aria-selected={tab===item} className={tab===item?'tab selected':'tab'} onClick={()=>setTab(item)}>{item==='description'?'Lab description':item==='playground'?'Playground':item==='diff'?'Compare':item[0].toUpperCase()+item.slice(1)}</button>)}</div><div className="editor-head"><span>index.mjs</span><span>{tab==='playground'?'Editable playground':tab==='diff'?'Side-by-side comparison':'Read-only reference'}</span></div>{tab==='playground'?<textarea spellCheck="false" aria-label="Playground code editor" value={draft} onChange={e=>{setDraft(e.target.value);setDirty(true)}}/>:tab==='diff'?<div className="diff-lines" aria-label="Playground versus solution changes">{diffLines(draft,exercise.solution).map((line,i)=><div key={i} className={'diff-line '+line.kind}>{line.text||' '}</div>)}</div>:<pre className="code">{tab==='description'?exercise.description+'\n\nSTARTING CODE\n'+exercise.problem:exercise.solution}</pre>}<div className="editor-footer"><span>{dirty?'Unsaved changes':'Saved / reference'}</span><span>Node.js · JavaScript</span></div></section><section className="output-panel"><div className="tabs" role="tablist" aria-label="Output panels">{['preview','console','tests'].map(item=><button key={item} role="tab" aria-selected={panel===item} className={panel===item?'tab selected':'tab'} onClick={()=>setPanel(item)}>{item==='tests'?'Test results':item[0].toUpperCase()+item.slice(1)}</button>)}</div><pre className="notice" role="status">{panel==='preview'?'Preview is available for labs that provide a browser application. This JavaScript lab uses the console and test runner.':result||'Run tests to view output here.'}</pre></section><section className="hint"><span className="hint-icon">i</span><div><strong>Playground workflow</strong><p>The problem and solution remain unchanged. Save edits to your playground. Run tests against the saved files. Each exercise keeps its own playground, so you can return to earlier work.</p></div></section></>:<div className="heading"><span className="pill">Get started</span><h1>Choose a lab</h1><p>Select a lab on the left to create an editable playground.</p></div>}{result&&<pre className="notice" role="status">{result}</pre>}</main></div></div>
}
createRoot(document.getElementById('root')).render(<App />)
