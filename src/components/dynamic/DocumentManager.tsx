import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { Search, Upload, Download, Trash2, Eye, FileText, X, Loader2, MessageSquare, ChevronRight, Send } from 'lucide-react'
import { getAuthToken } from '../../lib/supabase'

const SmartUploadModal = lazy(() => import('./SmartUploadModal'))

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

export default function DocumentManager() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null)
  const [docContent, setDocContent] = useState<any>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab, setActiveTab] = useState<'list' | 'search'>('list')

  // Modals
  const [viewerDoc, setViewerDoc] = useState<Document | null>(null)
  const [chatDoc, setChatDoc] = useState<Document | null>(null)
  const [chatQuery, setChatQuery] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; text: string }[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)

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
    setSearching(true); setActiveTab('search')
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
    setSelectedDoc(doc); setDocContent(null)
    try {
      const res = await fetch('/api/chat/tool-data', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({ tool: 'explore_document', params: { doc_id: doc.id, limit: 50 } }),
      })
      if (res.ok) setDocContent(await res.json())
    } catch {}
  }

  // Delete document
  const deleteDocument = async (docId: string, docName: string) => {
    if (!confirm(`Eliminare "${docName}" e tutti i suoi chunk?`)) return
    await fetch('/api/chat/tool-data', { method: 'POST', headers: headers(), body: JSON.stringify({ tool: 'delete_record', params: { id: docId } }) })
    loadDocuments(); if (selectedDoc?.id === docId) setSelectedDoc(null)
  }

  // Download document (with auth)
  const downloadDocument = async (doc: Document) => {
    if (!doc.file_url) return
    try {
      const token = getAuthToken()
      const res = await fetch(doc.file_url, { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = doc.nome + (doc.tipo_file?.includes('pdf') ? '.pdf' : ''); a.click()
      URL.revokeObjectURL(url)
    } catch { window.open(doc.file_url, '_blank') }
  }

  // AI Chat about document
  const askAI = async () => {
    if (!chatQuery.trim() || !chatDoc) return
    const question = chatQuery; setChatQuery('')
    setChatMessages(prev => [...prev, { role: 'user', text: question }])
    setChatLoading(true)
    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST', headers: headers(),
        body: JSON.stringify({
          message: `Nel documento "${chatDoc.nome}": ${question}`,
          sessionId: `doc-chat-${chatDoc.id}`,
          history: chatMessages.map(m => ({ role: m.role, content: m.text })),
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setChatMessages(prev => [...prev, { role: 'assistant', text: data.text || 'Nessuna risposta' }])
      }
    } catch { setChatMessages(prev => [...prev, { role: 'assistant', text: 'Errore nella richiesta' }]) }
    finally { setChatLoading(false); chatInputRef.current?.focus() }
  }

  // Get file extension for viewer
  const getFileExt = (doc: Document) => {
    const tipo = (doc.tipo_file || '').toLowerCase()
    if (tipo.includes('pdf')) return 'pdf'
    if (tipo.includes('image') || tipo.includes('png') || tipo.includes('jpg') || tipo.includes('jpeg')) return 'image'
    return 'text'
  }

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-bg2">
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
        <button onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-green/10 text-green border border-green/20 rounded-lg text-xs font-medium hover:bg-green/20">
          <Upload size={14} /> Carica
        </button>
        <div className="flex bg-bg3 rounded-lg p-0.5">
          <button onClick={() => setActiveTab('list')} className={`px-3 py-1 rounded text-xs ${activeTab === 'list' ? 'bg-bg2 text-text shadow-sm' : 'text-text3'}`}>Archivio</button>
          <button onClick={() => setActiveTab('search')} className={`px-3 py-1 rounded text-xs ${activeTab === 'search' ? 'bg-bg2 text-text shadow-sm' : 'text-text3'}`}>Risultati ({searchResults.length})</button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto flex">
        <div className={`flex-1 overflow-auto ${selectedDoc ? 'border-r border-border' : ''}`}>
          {activeTab === 'list' && (
            loading ? <div className="flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin text-gold" /></div>
            : documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text3">
                <FileText size={40} className="mb-3 opacity-30" /><p className="text-sm">Nessun documento</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {documents.map(doc => (
                  <div key={doc.id} className={`flex items-center gap-3 px-4 py-3 hover:bg-bg3/50 cursor-pointer ${selectedDoc?.id === doc.id ? 'bg-bg3' : ''}`}
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
                      </div>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={e => { e.stopPropagation(); setViewerDoc(doc) }} title="Visualizza" className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-purple"><Eye size={14} /></button>
                      <button onClick={e => { e.stopPropagation(); downloadDocument(doc) }} title="Scarica" className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-blue"><Download size={14} /></button>
                      <button onClick={e => { e.stopPropagation(); setChatDoc(doc); setChatMessages([]) }} title="Interroga AI" className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-gold"><MessageSquare size={14} /></button>
                      <button onClick={e => { e.stopPropagation(); deleteDocument(doc.id, doc.nome) }} title="Elimina" className="p-1.5 rounded hover:bg-bg4 text-text3 hover:text-red"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {activeTab === 'search' && (
            searchResults.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text3">
                <Search size={40} className="mb-3 opacity-30" /><p className="text-sm">{searchQuery ? 'Nessun risultato' : 'Cerca nei documenti'}</p>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {searchResults.map((r, i) => (
                  <div key={i} className="px-4 py-3 hover:bg-bg3/50">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] bg-gold/10 text-gold px-1.5 py-0.5 rounded">{r.doc_name || r.documento || ''}</span>
                      {r.heading_path && <span className="text-[10px] text-text3">{r.heading_path}</span>}
                    </div>
                    <p className="text-xs text-text2 leading-relaxed">{(r.chunk_text || r.text || r.contenuto || JSON.stringify(r)).substring(0, 400)}</p>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Detail panel */}
        {selectedDoc && (
          <div className="w-96 overflow-auto bg-bg2">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="font-medium text-sm text-text truncate">{selectedDoc.nome}</h3>
              <button onClick={() => setSelectedDoc(null)} className="p-1 rounded hover:bg-bg3 text-text3"><X size={14} /></button>
            </div>
            <div className="px-4 py-3 border-b border-border space-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-text3">Categoria</span><span className="text-text">{selectedDoc.categoria}</span></div>
              <div className="flex justify-between"><span className="text-text3">Dimensione</span><span className="text-text">{selectedDoc.dimensione}</span></div>
              <div className="flex justify-between"><span className="text-text3">Indicizzazione</span><span className="text-text">{selectedDoc.chunkato}</span></div>
              <div className="flex justify-between"><span className="text-text3">Caricato</span><span className="text-text">{selectedDoc.data}</span></div>
            </div>
            <div className="px-4 py-3 border-b border-border flex gap-2">
              <button onClick={() => setViewerDoc(selectedDoc)} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-purple/10 text-purple border border-purple/20 rounded-lg text-xs hover:bg-purple/20"><Eye size={12} /> Visualizza</button>
              <button onClick={() => downloadDocument(selectedDoc)} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-blue/10 text-blue border border-blue/20 rounded-lg text-xs hover:bg-blue/20"><Download size={12} /> Scarica</button>
              <button onClick={() => { setChatDoc(selectedDoc); setChatMessages([]) }} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-gold/10 text-gold border border-gold/20 rounded-lg text-xs hover:bg-gold/20"><MessageSquare size={12} /> Interroga</button>
            </div>
            <div className="px-4 py-3">
              <h4 className="text-xs font-medium text-text3 mb-2">Struttura</h4>
              {!docContent ? <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-text3" /></div>
              : (
                <div className="space-y-1">
                  {(docContent.chunks || docContent.sections || []).map((chunk: any, i: number) => (
                    <div key={i} className="flex items-start gap-2 text-[11px] py-1 hover:bg-bg3 rounded px-1">
                      <ChevronRight size={10} className="text-text3 mt-0.5 shrink-0" />
                      <span className="text-text2">{chunk.heading || chunk.display_name || `Sezione ${i + 1}`}</span>
                    </div>
                  ))}
                  {(docContent.chunks || docContent.sections || []).length === 0 && <p className="text-text3 text-[11px]">Nessuna sezione</p>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══ DOCUMENT VIEWER MODAL ═══ */}
      {viewerDoc && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 rounded-2xl w-full max-w-5xl h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div className="flex items-center gap-3">
                <FileText size={18} className="text-gold" />
                <h3 className="font-semibold text-text">{viewerDoc.nome}</h3>
                <span className="text-[10px] bg-gold/10 text-gold px-2 py-0.5 rounded">{viewerDoc.categoria}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => downloadDocument(viewerDoc)} className="flex items-center gap-1.5 px-3 py-1.5 bg-blue/10 text-blue border border-blue/20 rounded-lg text-xs hover:bg-blue/20"><Download size={12} /> Scarica</button>
                <button onClick={() => { setChatDoc(viewerDoc); setChatMessages([]) }} className="flex items-center gap-1.5 px-3 py-1.5 bg-gold/10 text-gold border border-gold/20 rounded-lg text-xs hover:bg-gold/20"><MessageSquare size={12} /> Interroga AI</button>
                <button onClick={() => setViewerDoc(null)} className="p-1.5 rounded hover:bg-bg3 text-text3"><X size={18} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-bg3">
              {getFileExt(viewerDoc) === 'pdf' && viewerDoc.file_url ? (
                <iframe src={viewerDoc.file_url} className="w-full h-full border-0" title={viewerDoc.nome} />
              ) : getFileExt(viewerDoc) === 'image' && viewerDoc.file_url ? (
                <div className="flex items-center justify-center h-full p-8">
                  <img src={viewerDoc.file_url} alt={viewerDoc.nome} className="max-w-full max-h-full object-contain rounded-lg shadow-lg" />
                </div>
              ) : (
                <div className="p-6">
                  <p className="text-text3 text-sm mb-4">Anteprima testo estratto dal documento:</p>
                  <div className="bg-bg2 border border-border rounded-xl p-4 max-h-[70vh] overflow-auto">
                    {docContent?.body ? (
                      <pre className="text-xs text-text2 whitespace-pre-wrap font-sans leading-relaxed">{docContent.body}</pre>
                    ) : (
                      <div className="space-y-2">
                        {(docContent?.chunks || docContent?.sections || []).map((c: any, i: number) => (
                          <div key={i} className="border-b border-border/30 pb-2">
                            {c.heading && <h4 className="text-xs font-semibold text-text mb-1">{c.heading}</h4>}
                            <p className="text-xs text-text2">{c.display_name || c.text || ''}</p>
                          </div>
                        ))}
                        {!docContent && <p className="text-text3 text-xs">Caricamento contenuto...</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ AI CHAT POPUP ═══ */}
      {chatDoc && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-bg2 rounded-2xl w-full max-w-2xl h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <h3 className="font-semibold text-text text-sm">Interroga Documento</h3>
                <p className="text-[10px] text-text3 mt-0.5">{chatDoc.nome}</p>
              </div>
              <button onClick={() => setChatDoc(null)} className="p-1.5 rounded hover:bg-bg3 text-text3"><X size={18} /></button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-auto p-4 space-y-3">
              {chatMessages.length === 0 && (
                <div className="text-center text-text3 py-8">
                  <MessageSquare size={32} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Fai una domanda su "{chatDoc.nome}"</p>
                  <div className="mt-4 flex flex-wrap gap-2 justify-center">
                    {['Riassumi il documento', 'Punti chiave', 'Di cosa tratta?'].map(q => (
                      <button key={q} onClick={() => { setChatQuery(q); setTimeout(askAI, 0) }}
                        className="text-xs bg-bg3 text-text2 px-3 py-1.5 rounded-lg hover:bg-bg4">{q}</button>
                    ))}
                  </div>
                </div>
              )}
              {chatMessages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${m.role === 'user' ? 'bg-gold text-white rounded-br-md' : 'bg-bg3 text-text rounded-bl-md'}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-bg3 px-4 py-2.5 rounded-2xl rounded-bl-md">
                    <Loader2 size={16} className="animate-spin text-text3" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="px-4 py-3 border-t border-border">
              <div className="flex gap-2">
                <input ref={chatInputRef} value={chatQuery} onChange={e => setChatQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && askAI()}
                  placeholder="Fai una domanda sul documento..."
                  className="flex-1 px-4 py-2.5 bg-bg3 border border-border rounded-xl text-sm text-text placeholder:text-text3 focus:border-gold/50 focus:outline-none" />
                <button onClick={askAI} disabled={chatLoading || !chatQuery.trim()}
                  className="p-2.5 bg-gold text-white rounded-xl hover:bg-gold-d disabled:opacity-30">
                  <Send size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ SMART UPLOAD MODAL ═══ */}
      {showUpload && (
        <Suspense fallback={null}>
          <SmartUploadModal onClose={() => setShowUpload(false)} onUploaded={loadDocuments} />
        </Suspense>
      )}
    </div>
  )
}
