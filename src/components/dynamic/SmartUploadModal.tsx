/**
 * SmartUploadModal — AI-powered document upload with classification
 *
 * Handles: file upload → AI analysis → user review (name, author, category, chunking, OCR) → confirm
 */
import { useState, useRef } from 'react'
import { Upload, Loader2, X } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'
import type { SmartUploadResult } from '../../lib/upload'

interface SmartUploadState {
  status: 'idle' | 'analyzing' | 'done'
  phase?: string
  fileName?: string
  fileSize?: number
  result?: SmartUploadResult
  editNome?: string
  editAutore?: string
  editCategoria?: string
  editChunkStrategy?: string
  useOcr?: boolean
  needsOcr?: boolean
  newCategoria?: string
  newCategoriaDesc?: string
  suggestingDesc?: boolean
}

const CATEGORIES = ['legale', 'amministrazione', 'commerciale', 'hr', 'marketing', 'produzione', 'documentazione_tecnica', 'normative', 'contratti', 'letteratura', 'religione', 'datasheet', 'manuale', 'altro']

export default function SmartUploadModal({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => void }) {
  const [state, setState] = useState<SmartUploadState>({ status: 'idle' })
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const headers = () => {
    const token = getAuthToken()
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }

  const startUpload = async (file: File) => {
    setError('')
    setState({ status: 'analyzing', fileName: file.name, fileSize: file.size, phase: 'Caricamento file...' })

    try {
      const token = getAuthToken()
      const h: Record<string, string> = {}
      if (token) h['Authorization'] = `Bearer ${token}`

      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', 'full')

      // Phase updates
      setTimeout(() => setState(s => s.status === 'analyzing' ? { ...s, phase: 'Estrazione testo...' } : s), 2000)
      setTimeout(() => setState(s => s.status === 'analyzing' ? { ...s, phase: 'Analisi AI in corso...' } : s), 4000)
      setTimeout(() => setState(s => s.status === 'analyzing' ? { ...s, phase: 'Classificazione...' } : s), 6000)

      const res = await fetch('/api/upload/smart', { method: 'POST', headers: h, body: formData })
      if (!res.ok) throw new Error('Upload fallito')
      const result: SmartUploadResult = await res.json()

      setState({
        status: 'done', fileName: file.name, fileSize: file.size, result,
        needsOcr: result.needs_ocr, useOcr: result.needs_ocr || false,
      })
    } catch (err: any) {
      setError(err.message)
      setState({ status: 'idle' })
    }
  }

  const confirm = async () => {
    if (!state.result) return
    setState(s => ({ ...s, phase: 'Indicizzazione...' }))
    try {
      const r = state.result
      const finalCat = state.editCategoria || r.categoria
      const finalNome = state.editNome || r.display_name
      const finalAutore = state.editAutore || (r.extracted_data as any)?.autore || undefined
      const finalChunk = state.editChunkStrategy || r.chunk_strategy || undefined

      const { confirmUpload } = await import('../../lib/upload')
      await confirmUpload(r.upload_id, finalCat, finalNome, finalAutore, finalChunk, state.useOcr)

      // Save custom category template if created
      if (state.newCategoria && state.newCategoriaDesc) {
        await fetch('/api/chat/tool-data', {
          method: 'POST', headers: headers(),
          body: JSON.stringify({ tool: 'create', params: {
            type: 'category_template', display_name: state.newCategoria,
            metadata: { descrizione: state.newCategoriaDesc, keywords: [state.newCategoria] },
          }}),
        })
      }

      onUploaded()
      onClose()
    } catch (err: any) { setError(err.message) }
  }

  const suggestCategoryDesc = async () => {
    if (!state.newCategoria) return
    setState(s => ({ ...s, suggestingDesc: true }))
    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
          message: `Genera una breve descrizione (max 2 frasi) per la categoria "${state.newCategoria}" per il riconoscimento automatico di documenti simili. Rispondi SOLO con la descrizione.`,
          sessionId: 'system-suggest',
        }),
      })
      const data = await res.json()
      if (data.text) setState(s => ({ ...s, newCategoriaDesc: data.text.substring(0, 300), suggestingDesc: false }))
      else setState(s => ({ ...s, suggestingDesc: false }))
    } catch { setState(s => ({ ...s, suggestingDesc: false })) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg2 border border-border rounded-2xl shadow-2xl w-full max-w-md p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text">Carica Documento</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg3 text-text3"><X size={16} /></button>
        </div>

        {error && <div className="mb-4 p-3 bg-red/10 border border-red/20 rounded-lg text-red text-xs">{error}</div>}

        {/* IDLE — File picker */}
        {state.status === 'idle' && (
          <div className="space-y-4">
            <div onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-gold/50 hover:bg-gold/5 transition-colors">
              <Upload size={32} className="mx-auto mb-3 text-text3" />
              <p className="text-sm text-text">Trascina un file o clicca per selezionare</p>
              <p className="text-xs text-text3 mt-1">PDF, DOC, DOCX, TXT, CSV, XLSX, immagini</p>
            </div>
            <input ref={fileInputRef} type="file" className="hidden"
              accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.pptx,.png,.jpg,.jpeg,.webp"
              onChange={e => { const f = e.target.files?.[0]; if (f) startUpload(f); e.target.value = '' }} />
          </div>
        )}

        {/* ANALYZING — Progress */}
        {state.status === 'analyzing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="w-10 h-10 animate-spin text-gold" />
            <p className="text-sm text-text font-medium">{state.phase}</p>
            <p className="text-xs text-text3">{state.fileName}</p>
            <div className="flex gap-1.5 mt-1">
              {['Caricamento', 'Estrazione', 'Analisi', 'Classificazione'].map((phase, i) => {
                const phases = ['Caricamento file...', 'Estrazione testo...', 'Analisi AI in corso...', 'Classificazione...']
                const currentIdx = phases.findIndex(p => p === state.phase)
                return <div key={phase} className={`w-2 h-2 rounded-full ${i <= currentIdx ? 'bg-gold' : 'bg-bg3'}`} />
              })}
            </div>
          </div>
        )}

        {/* DONE — Review & Confirm */}
        {state.status === 'done' && state.result && (() => {
          const r = state.result!
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text3">{state.fileName} · {state.fileSize ? `${(state.fileSize / 1024).toFixed(0)} KB` : ''}</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gold/10 text-gold">{r.entity_type}</span>
              </div>

              {/* Preview */}
              {r.entity_type === 'foto' && r.file_url && <img src={r.file_url} alt="Preview" className="w-full max-h-48 object-contain rounded-lg bg-bg3" />}

              <div className="bg-bg3 rounded-lg p-3 space-y-2.5">
                {/* Nome */}
                <div className="flex items-center gap-2">
                  <span className="text-text3 text-xs shrink-0 w-16">Nome:</span>
                  <input type="text" value={state.editNome ?? r.display_name}
                    onChange={e => setState(s => ({ ...s, editNome: e.target.value }))}
                    className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text focus:outline-none focus:border-gold/40 font-medium" />
                </div>

                {/* Autore */}
                <div className="flex items-center gap-2">
                  <span className="text-text3 text-xs shrink-0 w-16">Autore:</span>
                  <input type="text" value={state.editAutore ?? (r.extracted_data as any)?.autore ?? ''}
                    onChange={e => setState(s => ({ ...s, editAutore: e.target.value }))}
                    placeholder="Autore..." className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text placeholder:text-text3 focus:outline-none focus:border-gold/40" />
                </div>

                {/* Categoria */}
                <div className="flex items-center gap-2">
                  <span className="text-text3 text-xs shrink-0 w-16">Categoria:</span>
                  <select value={state.editCategoria ?? r.categoria}
                    onChange={e => setState(s => ({ ...s, editCategoria: e.target.value, newCategoria: e.target.value === '__new__' ? '' : undefined }))}
                    className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text focus:outline-none focus:border-gold/40">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    {!CATEGORIES.includes(r.categoria) && <option value={r.categoria}>{r.categoria} (suggerita)</option>}
                    <option value="__new__">+ Nuova categoria...</option>
                  </select>
                </div>

                {/* New category form */}
                {(state.editCategoria === '__new__' || state.newCategoria !== undefined) && (
                  <div className="space-y-2 bg-bg2 rounded-lg p-2.5 border border-border">
                    <div className="flex gap-2">
                      <input type="text" value={state.newCategoria || ''} autoFocus
                        onChange={e => setState(s => ({ ...s, newCategoria: e.target.value }))}
                        placeholder="Nome nuova categoria..."
                        className="flex-1 px-2 py-1.5 text-xs bg-bg3 border border-border rounded text-text placeholder:text-text3" />
                      {state.newCategoria && state.newCategoria.length > 2 && !state.newCategoriaDesc && (
                        <button onClick={suggestCategoryDesc} disabled={state.suggestingDesc}
                          className="px-3 py-1.5 text-[10px] bg-gold/10 text-gold rounded border border-gold/20 disabled:opacity-50">
                          {state.suggestingDesc ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Suggerisci'}
                        </button>
                      )}
                    </div>
                    <textarea value={state.newCategoriaDesc || ''} rows={2}
                      onChange={e => setState(s => ({ ...s, newCategoriaDesc: e.target.value }))}
                      placeholder="Descrizione per riconoscimento automatico..."
                      className="w-full px-2 py-1.5 text-xs bg-bg3 border border-border rounded text-text placeholder:text-text3 resize-none" />
                  </div>
                )}

                {/* Chunk strategy */}
                {!['foto', 'audio'].includes(r.entity_type) && (
                  <div className="flex items-center gap-2">
                    <span className="text-text3 text-xs shrink-0 w-16">Chunking:</span>
                    <select value={state.editChunkStrategy ?? r.chunk_strategy ?? 'auto'}
                      onChange={e => setState(s => ({ ...s, editChunkStrategy: e.target.value }))}
                      className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text focus:outline-none focus:border-gold/40">
                      <option value="auto">Auto (rilevamento automatico)</option>
                      <option value="by_article">Per articolo (leggi, codici)</option>
                      <option value="by_chapter">Per capitolo (libri)</option>
                      <option value="by_section">Per sezione (contratti, manuali)</option>
                      <option value="by_paragraph">Per paragrafo (narrativa)</option>
                      <option value="by_page">Per pagina (report)</option>
                      <option value="by_heading">Per heading (tecnica)</option>
                      <option value="none">Non dividere</option>
                    </select>
                  </div>
                )}

                {/* OCR toggle */}
                {state.needsOcr && (
                  <label className="flex items-center gap-2 bg-amber/10 border border-amber/30 rounded-lg px-3 py-2 cursor-pointer">
                    <input type="checkbox" checked={state.useOcr || false}
                      onChange={e => setState(s => ({ ...s, useOcr: e.target.checked }))}
                      className="rounded border-border accent-gold" />
                    <div>
                      <span className="text-xs font-medium text-amber">Riconoscitore OCR</span>
                      <p className="text-[10px] text-text3">PDF scannerizzato — estrai testo con AI</p>
                    </div>
                  </label>
                )}

                {/* Description */}
                {r.descrizione && <p className="text-[10px] text-text3 italic">{r.descrizione}</p>}
              </div>

              {/* Buttons */}
              <div className="flex gap-2">
                <button onClick={confirm} className="flex-1 py-2.5 bg-gold hover:bg-gold-d text-white rounded-lg text-sm font-medium">
                  Conferma e Indicizza
                </button>
                <button onClick={() => { setState({ status: 'idle' }); setError('') }}
                  className="px-4 py-2.5 bg-bg3 text-text3 rounded-lg text-sm hover:bg-bg4">Annulla</button>
              </div>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
