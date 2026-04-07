import { useState, useEffect, useCallback } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, ChevronUp, ChevronDown } from 'lucide-react'
import { getAuthToken } from '../lib/supabase'

interface Job {
  id: string
  display_name: string
  stato: string
  action: string
  created_at: string
  updated_at: string
  result?: string
  error?: string
  retry_count?: number
}

const ACTION_LABELS: Record<string, string> = {
  process_document: 'Elaborazione documento',
  generate_embeddings: 'Generazione embedding',
  tag_chunks: 'Tagging chunk',
  run_autonomous_agent: 'Agente autonomo',
  run_workflow: 'Workflow',
}

function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s fa`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m fa`
  return `${Math.floor(seconds / 3600)}h fa`
}

export default function JobMonitor() {
  const [jobs, setJobs] = useState<{ active: Job[]; recent: Job[] }>({ active: [], recent: [] })
  const [expanded, setExpanded] = useState(false)
  const [hasActive, setHasActive] = useState(false)

  const fetchJobs = useCallback(async () => {
    try {
      const token = getAuthToken()
      const res = await fetch('/api/chat/jobs/active', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setJobs(data)
        setHasActive(data.active.length > 0)
      }
    } catch {}
  }, [])

  // Poll every 3s when active, every 15s otherwise
  useEffect(() => {
    fetchJobs()
    const interval = setInterval(fetchJobs, hasActive ? 3000 : 15000)
    return () => clearInterval(interval)
  }, [fetchJobs, hasActive])

  const allJobs = [...jobs.active, ...jobs.recent]
  if (allJobs.length === 0) return null

  const activeCount = jobs.active.length

  return (
    <div className="fixed bottom-4 right-4 z-40">
      {/* Expanded panel */}
      {expanded && (
        <div className="mb-2 bg-bg2 border border-border rounded-xl shadow-2xl w-80 max-h-80 overflow-hidden">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-xs font-semibold text-text">Processi in background</span>
            <button onClick={() => setExpanded(false)} className="p-0.5 rounded hover:bg-bg3 text-text3">
              <ChevronDown size={14} />
            </button>
          </div>
          <div className="overflow-y-auto max-h-64 divide-y divide-border">
            {allJobs.map(job => (
              <div key={job.id} className="px-3 py-2.5 flex items-start gap-2.5">
                {/* Status icon */}
                <div className="mt-0.5 shrink-0">
                  {job.stato === 'running' && <Loader2 size={14} className="animate-spin text-gold" />}
                  {job.stato === 'queued' && <Clock size={14} className="text-text3" />}
                  {job.stato === 'completed' && <CheckCircle2 size={14} className="text-green" />}
                  {(job.stato === 'failed' || job.stato === 'dead') && <XCircle size={14} className="text-red" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-text truncate">
                    {ACTION_LABELS[job.action] || job.display_name}
                  </p>
                  <p className="text-[10px] text-text3 truncate">
                    {job.display_name.replace(/^(Job: |Processa: )/, '')}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium ${
                      job.stato === 'running' ? 'bg-gold/10 text-gold' :
                      job.stato === 'queued' ? 'bg-bg3 text-text3' :
                      job.stato === 'completed' ? 'bg-green/10 text-green' :
                      'bg-red/10 text-red'
                    }`}>
                      {job.stato === 'running' ? 'In corso' :
                       job.stato === 'queued' ? 'In coda' :
                       job.stato === 'completed' ? 'Completato' :
                       'Errore'}
                    </span>
                    <span className="text-[9px] text-text3">{timeAgo(job.updated_at || job.created_at)}</span>
                  </div>
                  {job.error && (
                    <p className="text-[9px] text-red mt-0.5 truncate">{job.error}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Badge button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-2 rounded-full shadow-lg border transition-all ${
          activeCount > 0
            ? 'bg-gold text-white border-gold-d animate-pulse'
            : 'bg-bg2 text-text2 border-border hover:border-gold/40'
        }`}
      >
        {activeCount > 0 ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs font-medium">{activeCount} job attiv{activeCount === 1 ? 'o' : 'i'}</span>
          </>
        ) : (
          <>
            <CheckCircle2 size={14} className="text-green" />
            <span className="text-xs">{jobs.recent.length} completat{jobs.recent.length === 1 ? 'o' : 'i'}</span>
          </>
        )}
        {expanded ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
      </button>
    </div>
  )
}
