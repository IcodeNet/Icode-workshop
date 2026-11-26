import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

const initial = `export const approvedOnly = (documents) => documents
// TODO: return only documents with approved status`
const solved = `export const approvedOnly = (documents) =>
  documents.filter((document) => document.status === 'approved')`
const exercises = [
  { id: '01', title: 'Approved documents only', topic: 'RAG security', description: 'Ensure only approved documents are returned to users. Implement the approvedOnly function without modifying the original reference files.', problem: initial, solution: solved }
]
function App() {
  const [selected, setSelected] = useState('01')
  const [tab, setTab] = useState('playground')
  const [drafts, setDrafts] = useState({ '01': initial })
  const [result, setResult] = useState(null)
  const [dark, setDark] = useState(false)
  const exercise = exercises.find((item) => item.id === selected)
  const draft = drafts[selected] ?? exercise.problem
  function runCheck() {
    // This is a static preview: actual tests must execute in the local CLI.
    setResult('Preview only. Run pnpm workshop test --content ./examples to execute the real exercise tests.')
  }
  return <div className={dark ? 'app dark' : 'app'}>
    <header className="topbar"><div className="brand"><span className="brand-mark">I</span><div><strong>Icode Workshop</strong><small>Learn by building</small></div></div><div className="top-actions"><span className="mode">Local learning environment</span><button onClick={() => setDark(!dark)} aria-label="Toggle colour theme">{dark ? 'Light' : 'Dark'} mode</button></div></header>
    <div className="shell"><aside className="sidebar"><div className="eyebrow">COURSE</div><h2>AI Engineering</h2><p>Practical, testable exercises</p><div className="eyebrow section-label">EXERCISES</div>{exercises.map((item) => <button key={item.id} className={item.id === selected ? 'exercise active' : 'exercise'} onClick={() => { setSelected(item.id); setResult(null) }}><span className="number">{item.id}</span><span>{item.title}<small>{item.topic}</small></span></button>)}<div className="sidebar-footer">Your playground edits stay in this browser session. Persistent filesystem saving is planned.</div></aside>
    <main className="content"><div className="heading"><span className="pill">{exercise.topic}</span><h1>{exercise.title}</h1><p>{exercise.description}</p></div><section className="workbench"><div className="workbench-head"><div><h2>Code workbench</h2><p>Explore the starting point, write your answer and compare the reference.</p></div><button className="primary" onClick={runCheck}>Run tests</button></div><div className="tabs" role="tablist" aria-label="Code view">{['problem','playground','solution','diff'].map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'tab selected' : 'tab'} onClick={() => setTab(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div><div className="editor-head"><span>index.mjs</span><span>{tab === 'playground' ? 'Editable draft' : tab === 'diff' ? 'Comparison preview' : 'Read-only reference'}</span></div>{tab === 'playground' ? <textarea spellCheck="false" aria-label="Playground code editor" value={draft} onChange={(e) => { setDrafts({...drafts,[selected]:e.target.value}); setResult(null) }}/> : <pre className="code">{tab === 'problem' ? exercise.problem : tab === 'solution' ? exercise.solution : 'YOUR PLAYGROUND\n'+draft+'\n\nREFERENCE SOLUTION\n'+exercise.solution}</pre>}{result && <div className="notice" role="status">{result}</div>}<div className="editor-footer"><span>{tab === 'playground' ? 'Unsaved browser-session draft' : 'Reference view'}</span><span>Node.js · JavaScript</span></div></section><section className="hint"><span className="hint-icon">i</span><div><strong>How the playground works</strong><p>Problem is the starter. Playground is your editable copy. Solution is the reference. The CLI currently provides real test execution and filesystem backups; this interface is a visual prototype.</p></div></section></main></div>
  </div>
}
createRoot(document.getElementById('root')).render(<App />)
