import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Upload, Download, Trash2, Eye, FileText, X, Loader2, MessageSquare, ChevronRight } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'

interface Document {
  id: string
  nome: string
  categoria: string
  tipo_file: string
  dimensione: string
  chunkato: string
  data: string
  file_url?: string
}

interface SearchResult {
  chunk_text: string
  heading_path: string
  score: number
  doc_name: string
}

export default function DocumentManager() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [docContent, setDocContent] = useState<any>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [activeTab, setActiveTab] = useState<'list' | 'search'>('list')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const headers = useCallback(() => {
    const token = getAuthToken()
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) h['Authorization'] = `Bearer ${token}`
    return h
  }, [])

  // Load documents
  const loadDocuments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/chat/tool-data', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ tool: 'list_documents', params: {} }),
      })
      if (res.ok) {
        const data = await res.json()
        setDocuments(Array.isArray(data) ? data : [])
      }
    } catch {} finally { setLoading(false) }
  }, [headers])

  useEffect(() => { loadDocuments() }, [loadDocuments])

  // Search within documents
  const searchDocuments = async () => {
    if (!searchQuery.trim()) return
    setSearching(true)
    setActiveTab('search')
    try {
      const res = await fetch('/api/chat/tool-data', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ tool: 'retrieve', params: { query: searchQuery, limit: 10 } }),
      })
      if (res.ok) {
        const data = await res.json()
        setSearchResults(Array.isArray(data) ? data : data.results || data.chunks || [])
      }
    } catch {} finally { setSearching(false) }
  }

  // Explore document structure
  const exploreDocument = async (doc: Document) => {
    setSelectedDoc(doc)
    setDocContent(null)
    try {
      const res = await fetch('/api/chat/tool-data', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ tool: 'explore_document', params: { doc_id: doc.id, limit: 50 } }),
      })
      if (res.ok) setDocContent(await res.json())
    } catch {}
  }

  // Upload document
  const handleUpload = async (file: File) => {
    setUploading(true)
    setUploadStatus('Analisi in corso...')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', 'full')

      const token = getAuthToken()
      const uploadHeaders: Record<string, string> = {}
      if (token) uploadHeaders['Authorization'] = `Bearer ${token}`

      const res = await fetch('/api/upload/smart', { method: 'POST', headers: uploadHeaders, body: formData })
      if (!res.ok) throw new Error('Upload fallito')
      const result = await res.json()

      setUploadStatus('Conferma indicizzazione...')
      // Auto-confirm
      const confirmRes = await fetch('/api/upload/confirm', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ upload_id: result.upload_id }),
      })
      if (confirmRes.ok) {
        setUploadStatus(`"${result.display_name}" caricato e in indicizzazione`)
        setTimeout(() => { setUploadStatus(''); loadDocuments() }, 2000)
      }
    } catch (err: any) {
      setUploadStatus(`Errore: ${err.message}`)
    } finally { setUploading(false) }
  }

  // Delete document
  const deleteDocument = async (docId: string, docName: string) => {
    if (!confirm(`Eliminare "${docName}" e tutti i suoi chunk?`)) return
    try {
      await fetch('/api/chat/tool-data', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ tool: 'delete_record', params: { id: docId } }),
      })
      loadDocuments()
    } catch {}
  }

  // Download document
  const downloadDocument = (doc: Document) => {
    if (!doc.file_url) return
    const token = getAuthToken()
    const url = doc.file_url + (token ? `?token=${token}` : '')
    window.open(url, '_blank')
  }

  // Ask AI about document
  const askAboutDoc = (doc: Document) => {
    // Navigate back to chat with a pre-filled question
    const event = new CustomEvent('fiai-chat-message', { detail: `Cerca nel documento "${doc.nome}" e fammi un riassunto` })
    window.dispatchEvent(event)
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg2">
        {/* Search */}
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchDocuments()}
              placeholder="Cerca nel contenuto dei documenti..."
              className="w-full pl-9 pr-3 py-2 bg-bg3 border border-border rounded-lg text-sm text-text placeholder:text-text3 focus:border-gold/50 focus:outline-none" />
          </div>
          <button onClick={searchDocuments} disabled={searching || !searchQuery.trim()}
            className="px-3 py-2 bg-gold/10 text-gold border border-gold/20 rounded-lg text-xs font-medium hover:bg-gold/20 disabled:opacity-30">
            {searching ? <Loader2 size={14} className="animate-spin" /> : 'Cerca'}
          </button>
        </div>

        {/* Upload */}
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
          className="flex items-center gap-1.5 px-3 py-2 bg-green/10 text-green border border-green/20 rounded-lg text-xs font-medium hover:bg-green/20 disabled:opacity-50">
          <Upload size={14} />
          {uploading ? 'Caricamento...' : 'Carica'}
        </button>
        <input ref={fileInputRef} type="file" className="hidden"
          accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.pptx"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = '' }} />

        {/* Tab toggle */}
        <div className="flex bg-bg3 rounded-lg p-0.5">
          <button onClick={() => setActiveTab('list')}
            className={`px-3 py-1 rounded text-xs ${activeTab === 'list' ? 'bg-bg2 text-text shadow-sm' : 'text-text3'}`}>
            Archivio
          </button>
          <button onClick={() => setActiveTab('search')}
            className={`px-3 py-1 rounded text-xs ${activeTab === 'search' ? 'bg-bg2 text-text shadow-sm' : 'text-text3'}`}>
            Risultati ({searchResults.length})
          </button>
        </div>
      </div>

      {/* Upload status */}
      {uploadStatus && (
        <div className="px-4 py-2 bg-green/5 border-b border-green/20 text-green text-xs flex items-center gap-2">
          {uploading && <Loader2 size={12} className="animate-spin" />}
          {uploadStatus}
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-auto flex">
        {/* Main panel */}
        <div className={`flex-1 overflow-auto ${selectedDoc ? 'border-r border-border' : ''}`}>
          {/* Document list */}
          {activeTab === 'list' && (
            loading ? (
              <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
            ) : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text3">
                <FileText size={40} className="mb-3 opacity-30" />
                <p className="text-sm">Nessun documento</p>
                <p className="text-xs mt-1">Carica il primo documento con il bottone "Carica"</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {documents.map(doc => (
                  <div key={doc.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-bg3/50 cursor-pointer transition-colors ${selectedDoc?.id === doc.id ? 'bg-bg3' : ''}`}
                    onClick={() => exploreDocument(doc)}>
                    <div className="w-10 h-10 bg-gold/10 rounded-lg flex items-center justify-center shrink-0">
                      <FileText size={18} className="text-gold" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-text truncate">{doc.nome}</h4>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] bg-gold/10 text-gold px-1.5 py-0.5 rounded">{doc.categoria}</span>
                        <span className="text-[10px] text-text3">{doc.dimensione}</span>
                        <span className="text-[10px] text-text3">{doc.chunkato}</span>
                        <span className="text-[10px] text-text3">{doc.data}</span>
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={e => { e.stopPropagation(); downloadDocument(doc) }} title="Scarica"
                        className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-blue"><Download size={14} /></button>
                      <button onClick={e => { e.stopPropagation(); askAboutDoc(doc) }} title="Interroga con AI"
                        className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-gold"><MessageSquare size={14} /></button>
                      <button onClick={e => { e.stopPropagation(); deleteDocument(doc.id, doc.nome) }} title="Elimina"
                        className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-red"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Search results */}
          {activeTab === 'search' && (
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text3">
                <Search size={40} className="mb-3 opacity-30" />
                <p className="text-sm">{searchQuery ? 'Nessun risultato' : 'Cerca nel contenuto dei documenti'}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {searchResults.map((r, i) => (
                  <div key={i} className="px-4 py-3 hover:bg-bg3/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] bg-gold/10 text-gold px-1.5 py-0.5 rounded">{(r as any).doc_name || (r as any).documento || ''}</span>
                      {(r as any).heading_path && <span className="text-[10px] text-text3">{(r as any).heading_path}</span>}
                      {(r as any).score && <span className="text-[10px] text-text3">score: {((r as any).score * 100).toFixed(0)}%</span>}
                    </div>
                    <p className="text-xs text-text2 leading-relaxed">
                      {((r as any).chunk_text || (r as any).text || (r as any).contenuto || JSON.stringify(r)).substring(0, 300)}
                      {((r as any).chunk_text || '').length > 300 ? '...' : ''}
                    </p>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Document detail panel */}
        {selectedDoc && (
          <div className="w-96 overflow-auto bg-bg2">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-medium text-sm text-text truncate">{selectedDoc.nome}</h3>
              <button onClick={() => setSelectedDoc(null)} className="p-1 rounded hover:bg-bg3 text-text3"><X size={14} /></button>
            </div>

            {/* Doc info */}
            <div className="px-4 py-3 border-b border-border space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-text3">Categoria</span><span className="text-text">{selectedDoc.categoria}</span></div>
              <div className="flex justify-between"><span className="text-text3">Dimensione</span><span className="text-text">{selectedDoc.dimensione}</span></div>
              <div className="flex justify-between"><span className="text-text3">Indicizzazione</span><span className="text-text">{selectedDoc.chunkato}</span></div>
              <div className="flex justify-between"><span className="text-text3">Caricato</span><span className="text-text">{selectedDoc.data}</span></div>
            </div>

            {/* Actions */}
            <div className="px-4 py-3 border-b border-border flex gap-2">
              <button onClick={() => downloadDocument(selectedDoc)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue/10 text-blue border border-blue/20 rounded-lg text-xs hover:bg-blue/20">
                <Download size={12} /> Scarica
              </button>
              <button onClick={() => askAboutDoc(selectedDoc)}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gold/10 text-gold border border-gold/20 rounded-lg text-xs hover:bg-gold/20">
                <MessageSquare size={12} /> Interroga
              </button>
            </div>

            {/* Document structure (chunks) */}
            <div className="px-4 py-3">
              <h4 className="text-xs font-medium text-text3 mb-2">Struttura documento</h4>
              {!docContent ? (
                <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-text3" /></div>
              ) : (
                <div className="space-y-1">
                  {(docContent.chunks || docContent.sections || []).map((chunk: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] py-1 hover:bg-bg3 rounded px-1">
                      <ChevronRight size={10} className="text-text3 mt-0.5 shrink-0" />
                      <div>
                        <span className="text-text2">{chunk.heading || chunk.display_name || `Sezione ${i + 1}`}</span>
                        {chunk.idx !== undefined && <span className="text-text3 ml-1">#{chunk.idx}</span>}
                      </div>
                    </div>
                  ))}
                  {(docContent.chunks || docContent.sections || []).length === 0 && (
                    <p className="text-text3 text-[11px]">Nessuna sezione trovata</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
