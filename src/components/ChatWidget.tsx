import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type FormEvent, type JSX } from 'react'
import {
  Bot,
  User,
  Send,
  Loader2,
  Sparkles,
  BarChart3,
  AlertCircle,
  FolderKanban,
  UserPlus,
  Wrench,
  X,
  MessageSquarePlus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Badge from './ui/Badge'
import {
  sendMessage,
  createChatSession,
  fetchChatSessions,
  fetchSessionMessages,
  updateSessionTitle,
  type ConversationMessage,
  type ToolUseEvent,
} from '../lib/anthropic'
import type { ChatMessage } from '../types'

// ── Types ───────────────────────────────────────────────
interface SessionItem {
  id: string
  titolo: string
  created_at: string
  updated_at: string
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: Record<string, unknown>[]
  timestamp: string
}

// ── Quick Commands ──────────────────────────────────────
const quickCommands = [
  { label: 'Riepilogo finanziario', message: "Dammi un riepilogo finanziario dell'azienda", icon: BarChart3 },
  { label: 'Fatture scadute', message: 'Quali fatture sono scadute?', icon: AlertCircle },
  { label: 'Stato pipeline', message: "Qual è lo stato della pipeline commerciale?", icon: Sparkles },
  { label: 'Stato progetti', message: 'Qual è lo stato dei progetti in corso?', icon: FolderKanban },
  { label: 'Crea lead', message: 'Crea un nuovo lead per ', icon: UserPlus },
]

// ── Tool Name Map ───────────────────────────────────────
const toolNameMap: Record<string, string> = {
  get_financial_summary: 'Riepilogo finanziario',
  get_overdue_invoices: 'Fatture scadute',
  get_pipeline: 'Pipeline commerciale',
  get_projects: 'Progetti',
  create_lead: 'Creazione lead',
  approve_expense: 'Approvazione rimborso',
}

// ── Markdown-like Renderer ──────────────────────────────
function formatInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|_(.+?)_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[2]) {
      parts.push(<strong key={`b-${key++}`} className="font-semibold text-text">{match[2]}</strong>)
    } else if (match[3]) {
      parts.push(<code key={`ic-${key++}`} className="bg-bg rounded px-1.5 py-0.5 text-xs font-mono text-gold-l">{match[3]}</code>)
    } else if (match[4]) {
      parts.push(<em key={`i-${key++}`} className="italic">{match[4]}</em>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts.length > 0 ? parts : [text]
}

function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeKey = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="bg-bg rounded-lg p-2 my-1 overflow-x-auto text-xs font-mono text-text2 border border-border">
            <code>{codeLines.join('\n')}</code>
          </pre>
        )
        codeLines = []
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) { codeLines.push(line); continue }

    if (line.trim() === '') { elements.push(<div key={`br-${i}`} className="h-1.5" />); continue }

    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h3-${i}`} className="text-xs font-bold text-text mt-2 mb-0.5">{formatInline(line.slice(4))}</h4>)
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={`h2-${i}`} className="text-sm font-bold text-text mt-2 mb-0.5">{formatInline(line.slice(3))}</h3>)
      continue
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={`h1-${i}`} className="text-base font-bold text-text mt-2 mb-0.5">{formatInline(line.slice(2))}</h2>)
      continue
    }

    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-1.5 ml-1">
          <span className="text-gold mt-0.5 shrink-0">&bull;</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      )
      continue
    }

    const olMatch = line.match(/^(\d+)\.\s(.*)/)
    if (olMatch) {
      elements.push(
        <div key={`ol-${i}`} className="flex gap-1.5 ml-1">
          <span className="text-gold shrink-0">{olMatch[1]}.</span>
          <span>{formatInline(olMatch[2])}</span>
        </div>
      )
      continue
    }

    elements.push(<p key={`p-${i}`} className="leading-relaxed">{formatInline(line)}</p>)
  }

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key={`code-${codeKey}`} className="bg-bg rounded-lg p-2 my-1 overflow-x-auto text-xs font-mono text-text2 border border-border">
        <code>{codeLines.join('\n')}</code>
      </pre>
    )
  }

  return elements
}

// ── Message Bubble (compact) ────────────────────────────
function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? 'bg-gold/20 border border-gold/30' : 'bg-gold/10 border border-gold/20'
        }`}
      >
        {isUser ? <User className="w-3 h-3 text-gold" /> : <Bot className="w-3 h-3 text-gold" />}
      </div>

      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          isUser
            ? 'bg-bg3 border border-border2 rounded-tr-sm'
            : 'bg-bg2 border-l-2 border-gold/30 border border-border rounded-tl-sm'
        }`}
      >
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex gap-1 flex-wrap mb-1.5">
            {message.toolCalls.map((tc, idx) => (
              <Badge key={idx} color="amber">
                <span className="flex items-center gap-1 text-[10px]">
                  <Wrench className="w-2.5 h-2.5" />
                  {toolNameMap[(tc as { tool: string }).tool] ?? (tc as { tool: string }).tool}
                </span>
              </Badge>
            ))}
          </div>
        )}

        <div className={`text-xs ${isUser ? 'text-text' : 'text-text2'}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="space-y-0.5">{renderMarkdown(message.content)}</div>
          )}
        </div>

        <p className={`text-[9px] mt-1 ${isUser ? 'text-text3 text-right' : 'text-text3'}`}>
          {new Date(message.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

// ── Chat Widget ─────────────────────────────────────────
export default function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [hasUnread, setHasUnread] = useState(false)

  // Session state
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Message state
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeTools, setActiveTools] = useState<ToolUseEvent[]>([])

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Load Sessions ────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchChatSessions()
      setSessions(data)
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // ── Load Session Messages ───────────────────────────
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const data = await fetchSessionMessages(sessionId)
      const displayMsgs: DisplayMessage[] = data.map((m: ChatMessage) => ({
        id: m.id,
        role: m.ruolo,
        content: m.contenuto,
        toolCalls: m.tool_calls ?? undefined,
        timestamp: m.created_at,
      }))
      setMessages(displayMsgs)
      const history: ConversationMessage[] = data.map((m: ChatMessage) => ({
        role: m.ruolo,
        content: m.contenuto,
      }))
      setConversationHistory(history)
    } catch {
      toast.error('Errore nel caricamento dei messaggi')
    }
  }, [])

  // ── New Session ──────────────────────────────────────
  const createNewSession = useCallback(async () => {
    const id = await createChatSession('Nuova conversazione')
    if (id) {
      setActiveSessionId(id)
      setMessages([])
      setConversationHistory([])
      await loadSessions()
    }
  }, [loadSessions])

  // ── Auto-scroll ──────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTools])

  // ── Focus input when opened ──────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  // ── Send Message ─────────────────────────────────────
  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text ?? inputValue).trim()
      if (!content || isLoading) return

      let sessionId = activeSessionId
      if (!sessionId) {
        const id = await createChatSession(
          content.length > 50 ? content.slice(0, 50) + '...' : content
        )
        if (!id) {
          toast.error('Errore nella creazione della sessione')
          return
        }
        sessionId = id
        setActiveSessionId(id)
        await loadSessions()
      }

      if (messages.length === 0) {
        const title = content.length > 50 ? content.slice(0, 50) + '...' : content
        await updateSessionTitle(sessionId, title)
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, titolo: title } : s))
        )
      }

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInputValue('')

      const newHistory: ConversationMessage[] = [
        ...conversationHistory,
        { role: 'user', content },
      ]
      setConversationHistory(newHistory)
      setIsLoading(true)
      setActiveTools([])

      try {
        const result = await sendMessage(newHistory, sessionId, (event) => {
          setActiveTools((prev) => {
            const existing = prev.findIndex((t) => t.toolName === event.toolName)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = event
              return updated
            }
            return [...prev, event]
          })
        })

        const assistantMsg: DisplayMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.text,
          toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, assistantMsg])
        setConversationHistory((prev) => [
          ...prev,
          { role: 'assistant', content: result.text },
        ])

        // Set unread badge if widget is closed
        if (!isOpen) setHasUnread(true)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Errore sconosciuto'
        toast.error(`Errore AI: ${errorMessage}`)

        const errorMsg: DisplayMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: 'Mi dispiace, si è verificato un errore. Riprova tra qualche istante.',
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, errorMsg])
      } finally {
        setIsLoading(false)
        setActiveTools([])
      }
    },
    [inputValue, isLoading, activeSessionId, messages.length, conversationHistory, loadSessions, isOpen]
  )

  // ── Keyboard Handler ─────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Quick Command ────────────────────────────────────
  const handleQuickCommand = (message: string) => {
    if (message.endsWith(' ')) {
      setInputValue(message)
      inputRef.current?.focus()
    } else {
      handleSend(message)
    }
  }

  // ── Toggle ───────────────────────────────────────────
  const toggleOpen = () => {
    setIsOpen((prev) => !prev)
    if (!isOpen) setHasUnread(false)
  }

  // ── Select a recent session ──────────────────────────
  const selectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId)
      await loadSessionMessages(sessionId)
    },
    [loadSessionMessages]
  )

  // ── Render ───────────────────────────────────────────
  return (
    <>
      {/* ── Expanded Panel ── */}
      <div
        className={`fixed right-6 bottom-24 z-50 w-[420px] flex flex-col bg-bg2 border border-border rounded-2xl shadow-2xl transition-all duration-300 origin-bottom-right ${
          isOpen
            ? 'opacity-100 scale-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 scale-95 translate-y-4 pointer-events-none'
        }`}
        style={{ height: '600px', maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center">
              <Bot className="w-4 h-4 text-gold" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-text">FIAI AI</h3>
              <p className="text-[10px] text-text3">Assistente intelligente</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={createNewSession}
              className="p-1.5 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
              title="Nuova conversazione"
            >
              <MessageSquarePlus className="w-4 h-4" />
            </button>
            <button
              onClick={toggleOpen}
              className="p-1.5 rounded-lg text-text3 hover:text-text hover:bg-bg3 transition-colors"
              title="Chiudi"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sessions bar (compact) */}
        {sessions.length > 0 && messages.length === 0 && !activeSessionId && (
          <div className="px-3 py-2 border-b border-border shrink-0 max-h-[120px] overflow-y-auto">
            <p className="text-[10px] text-text3 uppercase tracking-wider mb-1.5">Conversazioni recenti</p>
            {sessions.slice(0, 5).map((s) => (
              <button
                key={s.id}
                onClick={() => selectSession(s.id)}
                className="w-full text-left px-2 py-1.5 rounded-lg text-xs text-text2 hover:text-text hover:bg-bg3 transition-colors truncate"
              >
                {s.titolo}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-3 min-h-0">
          {messages.length === 0 && !isLoading ? (
            /* Empty state with quick commands */
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-12 h-12 rounded-xl bg-gold/10 border border-gold/20 flex items-center justify-center mb-4">
                <Sparkles className="w-6 h-6 text-gold" />
              </div>
              <h4 className="font-display text-base text-text mb-1">Ciao! Come posso aiutarti?</h4>
              <p className="text-text3 text-xs mb-4">
                Chiedimi informazioni sull&apos;azienda o esegui azioni rapide.
              </p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    onClick={() => handleQuickCommand(cmd.message)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] bg-bg3 border border-border rounded-full text-text2 hover:text-text hover:border-gold/30 transition-colors"
                  >
                    <cmd.icon className="w-3 h-3" />
                    {cmd.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}

              {/* Tool use indicators */}
              {isLoading && activeTools.length > 0 && (
                <div className="flex gap-1.5 flex-wrap ml-8">
                  {activeTools.map((tool) => (
                    <Badge key={tool.toolName} color={tool.status === 'running' ? 'amber' : 'green'}>
                      <span className="flex items-center gap-1 text-[10px]">
                        {tool.status === 'running' ? (
                          <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Wrench className="w-2.5 h-2.5" />
                        )}
                        {tool.status === 'running' ? 'Consultando: ' : 'Completato: '}
                        {toolNameMap[tool.toolName] ?? tool.toolName}
                      </span>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Typing indicator */}
              {isLoading && (
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
                    <Bot className="w-3 h-3 text-gold" />
                  </div>
                  <div className="bg-bg2 border border-border rounded-2xl rounded-tl-sm px-3 py-2">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-text3 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 bg-text3 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 bg-text3 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Quick commands pills (when messages exist) */}
        {messages.length > 0 && !isLoading && (
          <div className="px-3 pb-1 shrink-0">
            <div className="flex gap-1 overflow-x-auto no-scrollbar">
              {quickCommands.slice(0, 3).map((cmd) => (
                <button
                  key={cmd.label}
                  onClick={() => handleQuickCommand(cmd.message)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-[10px] bg-bg3 border border-border rounded-full text-text3 hover:text-text hover:border-gold/30 transition-colors whitespace-nowrap shrink-0"
                >
                  <cmd.icon className="w-2.5 h-2.5" />
                  {cmd.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="border-t border-border px-3 py-2.5 shrink-0">
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex items-end gap-2"
          >
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Scrivi un messaggio..."
                disabled={isLoading}
                rows={1}
                className="w-full bg-bg3 border border-border rounded-xl px-3 py-2 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/50 resize-none max-h-24 disabled:opacity-50"
                style={{ minHeight: '36px' }}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = Math.min(target.scrollHeight, 96) + 'px'
                }}
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="shrink-0 w-9 h-9 rounded-xl bg-gold hover:bg-gold-l text-bg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </form>
          <p className="text-center text-[9px] text-text3 mt-1.5">
            FIAI AI &middot; Le risposte possono contenere errori
          </p>
        </div>
      </div>

      {/* ── FAB Button ── */}
      <button
        onClick={toggleOpen}
        className={`fixed right-6 bottom-6 z-50 w-14 h-14 rounded-full bg-gold hover:bg-gold-l text-bg flex items-center justify-center shadow-lg hover:shadow-xl transition-all duration-300 ${
          isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'
        }`}
        title="Apri assistente FIAI AI"
      >
        <Bot className="w-6 h-6" />

        {/* Unread badge */}
        {hasUnread && (
          <span className="absolute top-0 right-0 w-3.5 h-3.5 bg-red rounded-full border-2 border-bg animate-pulse" />
        )}
      </button>
    </>
  )
}
