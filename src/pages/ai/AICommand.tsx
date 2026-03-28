import { useState, useRef, useEffect, useCallback, type KeyboardEvent, type FormEvent, type JSX } from 'react'
import {
  MessageSquarePlus,
  Send,
  Search,
  Bot,
  User,
  Loader2,
  Sparkles,
  BarChart3,
  AlertCircle,
  FolderKanban,
  UserPlus,
  Trash2,
  Wrench,
} from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '../../components/ui/Button'
import Badge from '../../components/ui/Badge'
import {
  sendMessage,
  createChatSession,
  fetchChatSessions,
  fetchSessionMessages,
  updateSessionTitle,
  type ConversationMessage,
  type ToolUseEvent,
} from '../../lib/anthropic'
import type { ChatMessage } from '../../types'

// ── Types ───────────────────────────────────────────────────
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

// ── Quick Commands ──────────────────────────────────────────
const quickCommands = [
  {
    label: 'Riepilogo finanziario',
    message: "Dammi un riepilogo finanziario dell'azienda",
    icon: BarChart3,
  },
  {
    label: 'Fatture scadute',
    message: 'Quali fatture sono scadute?',
    icon: AlertCircle,
  },
  {
    label: 'Stato pipeline',
    message: "Qual è lo stato della pipeline commerciale?",
    icon: Sparkles,
  },
  {
    label: 'Stato progetti',
    message: 'Qual è lo stato dei progetti in corso?',
    icon: FolderKanban,
  },
  {
    label: 'Crea lead',
    message: 'Crea un nuovo lead per ',
    icon: UserPlus,
  },
]

// ── Tool Name Map ───────────────────────────────────────────
const toolNameMap: Record<string, string> = {
  get_financial_summary: 'Riepilogo finanziario',
  get_overdue_invoices: 'Fatture scadute',
  get_pipeline: 'Pipeline commerciale',
  get_projects: 'Progetti',
  create_lead: 'Creazione lead',
  approve_expense: 'Approvazione rimborso',
}

// ── Markdown-like Renderer ──────────────────────────────────
function renderMarkdown(text: string): JSX.Element[] {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeKey = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block toggle
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`code-${codeKey++}`}
            className="bg-bg rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono text-text2 border border-border"
          >
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

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={`br-${i}`} className="h-2" />)
      continue
    }

    // Headers
    if (line.startsWith('### ')) {
      elements.push(
        <h4 key={`h3-${i}`} className="text-sm font-bold text-text mt-3 mb-1">
          {formatInline(line.slice(4))}
        </h4>
      )
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h3 key={`h2-${i}`} className="text-base font-bold text-text mt-3 mb-1">
          {formatInline(line.slice(3))}
        </h3>
      )
      continue
    }
    if (line.startsWith('# ')) {
      elements.push(
        <h2 key={`h1-${i}`} className="text-lg font-bold text-text mt-3 mb-1">
          {formatInline(line.slice(2))}
        </h2>
      )
      continue
    }

    // Unordered list
    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-2 ml-2">
          <span className="text-gold mt-0.5 shrink-0">&bull;</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      )
      continue
    }

    // Ordered list
    const olMatch = line.match(/^(\d+)\.\s(.*)/)
    if (olMatch) {
      elements.push(
        <div key={`ol-${i}`} className="flex gap-2 ml-2">
          <span className="text-gold shrink-0">{olMatch[1]}.</span>
          <span>{formatInline(olMatch[2])}</span>
        </div>
      )
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${i}`} className="leading-relaxed">
        {formatInline(line)}
      </p>
    )
  }

  // Flush remaining code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre
        key={`code-${codeKey}`}
        className="bg-bg rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono text-text2 border border-border"
      >
        <code>{codeLines.join('\n')}</code>
      </pre>
    )
  }

  return elements
}

function formatInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  // Process bold, inline code, and italic
  const regex = /(\*\*(.+?)\*\*|`([^`]+)`|_(.+?)_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    if (match[2]) {
      // Bold
      parts.push(
        <strong key={`b-${key++}`} className="font-semibold text-text">
          {match[2]}
        </strong>
      )
    } else if (match[3]) {
      // Inline code
      parts.push(
        <code
          key={`ic-${key++}`}
          className="bg-bg rounded px-1.5 py-0.5 text-xs font-mono text-gold-l"
        >
          {match[3]}
        </code>
      )
    } else if (match[4]) {
      // Italic
      parts.push(
        <em key={`i-${key++}`} className="italic">
          {match[4]}
        </em>
      )
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [text]
}

// ── Component ───────────────────────────────────────────────
export default function AICommand() {
  // Session state
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionSearch, setSessionSearch] = useState('')
  const [loadingSessions, setLoadingSessions] = useState(true)

  // Message state
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeTools, setActiveTools] = useState<ToolUseEvent[]>([])

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Load Sessions ───────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true)
    try {
      const data = await fetchChatSessions()
      setSessions(data)
    } catch {
      toast.error('Errore nel caricamento delle sessioni')
    } finally {
      setLoadingSessions(false)
    }
  }, [])

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  // ── Load Session Messages ─────────────────────────────
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

      // Rebuild conversation history
      const history: ConversationMessage[] = data.map((m: ChatMessage) => ({
        role: m.ruolo,
        content: m.contenuto,
      }))
      setConversationHistory(history)
    } catch {
      toast.error('Errore nel caricamento dei messaggi')
    }
  }, [])

  // ── Select Session ──────────────────────────────────────
  const selectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId)
      await loadSessionMessages(sessionId)
    },
    [loadSessionMessages]
  )

  // ── New Session ─────────────────────────────────────────
  const createNewSession = useCallback(async () => {
    const id = await createChatSession('Nuova conversazione')
    if (id) {
      setActiveSessionId(id)
      setMessages([])
      setConversationHistory([])
      await loadSessions()
    } else {
      toast.error('Errore nella creazione della sessione')
    }
  }, [loadSessions])

  // ── Auto-scroll ─────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeTools])

  // ── Send Message ────────────────────────────────────────
  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text ?? inputValue).trim()
      if (!content || isLoading) return

      // Create session if none active
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

      // Update session title if first message
      if (messages.length === 0) {
        const title = content.length > 50 ? content.slice(0, 50) + '...' : content
        await updateSessionTitle(sessionId, title)
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionId ? { ...s, titolo: title } : s))
        )
      }

      // Add user message to display
      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, userMsg])
      setInputValue('')

      // Build conversation
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
      } catch (err) {
        const errorMessage =
          err instanceof Error ? err.message : 'Errore sconosciuto'
        toast.error(`Errore AI: ${errorMessage}`)

        const errorMsg: DisplayMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content:
            'Mi dispiace, si è verificato un errore nella comunicazione. Riprova tra qualche istante.',
          timestamp: new Date().toISOString(),
        }
        setMessages((prev) => [...prev, errorMsg])
      } finally {
        setIsLoading(false)
        setActiveTools([])
      }
    },
    [inputValue, isLoading, activeSessionId, messages.length, conversationHistory, loadSessions]
  )

  // ── Keyboard Handler ────────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Quick Command ───────────────────────────────────────
  const handleQuickCommand = (message: string) => {
    if (message.endsWith(' ')) {
      // Partial command like "Crea lead", focus input with prefix
      setInputValue(message)
      inputRef.current?.focus()
    } else {
      handleSend(message)
    }
  }

  // ── Delete Session ──────────────────────────────────────
  const deleteSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      // We import supabase inline to avoid circular dependency issues at module level
      const { supabase } = await import('../../lib/supabase')
      await supabase.from('chat_messages').delete().eq('session_id', sessionId)
      await supabase.from('chat_sessions').delete().eq('id', sessionId)

      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
        setConversationHistory([])
      }
      await loadSessions()
    },
    [activeSessionId, loadSessions]
  )

  // ── Filter Sessions ─────────────────────────────────────
  const filteredSessions = sessions.filter((s) =>
    s.titolo.toLowerCase().includes(sessionSearch.toLowerCase())
  )

  // ── Format Date ─────────────────────────────────────────
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return date.toLocaleTimeString('it-IT', {
        hour: '2-digit',
        minute: '2-digit',
      })
    }
    if (days === 1) return 'Ieri'
    if (days < 7) return `${days} giorni fa`
    return date.toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
    })
  }

  // ── Render ──────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ── Left Sidebar: Sessions ── */}
      <div className="w-[280px] shrink-0 border-r border-border bg-bg2 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={createNewSession}
          >
            <MessageSquarePlus className="w-4 h-4" />
            Nuova Chat
          </Button>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text3" />
            <input
              type="text"
              value={sessionSearch}
              onChange={(e) => setSessionSearch(e.target.value)}
              placeholder="Cerca conversazioni..."
              className="w-full bg-bg3 border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text placeholder:text-text3 focus:outline-none focus:border-gold/50"
            />
          </div>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {loadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 text-text3 animate-spin" />
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-8 text-text3 text-sm">
              {sessions.length === 0
                ? 'Nessuna conversazione'
                : 'Nessun risultato'}
            </div>
          ) : (
            filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => selectSession(session.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 group transition-colors ${
                  activeSessionId === session.id
                    ? 'bg-bg4 border border-gold/20'
                    : 'hover:bg-bg3 border border-transparent'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-text truncate">
                      {session.titolo}
                    </p>
                    <p className="text-xs text-text3 mt-0.5">
                      {formatDate(session.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red text-text3 transition-opacity shrink-0"
                    title="Elimina"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Main Chat Area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {messages.length === 0 && !isLoading ? (
            <EmptyState onQuickCommand={handleQuickCommand} />
          ) : (
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}

              {/* Tool use indicators */}
              {isLoading && activeTools.length > 0 && (
                <div className="flex gap-2 flex-wrap ml-10">
                  {activeTools.map((tool) => (
                    <Badge
                      key={tool.toolName}
                      color={tool.status === 'running' ? 'amber' : 'green'}
                    >
                      <span className="flex items-center gap-1.5">
                        {tool.status === 'running' ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Wrench className="w-3 h-3" />
                        )}
                        {tool.status === 'running'
                          ? 'Consultando: '
                          : 'Completato: '}
                        {toolNameMap[tool.toolName] ?? tool.toolName}
                      </span>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Typing indicator */}
              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-gold" />
                  </div>
                  <div className="bg-bg2 border border-border rounded-2xl rounded-tl-sm px-4 py-3">
                    <div className="flex gap-1.5">
                      <span className="w-2 h-2 bg-text3 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-text3 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-text3 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* ── Input Area ── */}
        <div className="border-t border-border bg-bg2 px-6 py-4">
          <div className="max-w-3xl mx-auto">
            {/* Quick Commands */}
            {messages.length === 0 ? null : (
              <div className="flex gap-2 flex-wrap mb-3">
                {quickCommands.map((cmd) => (
                  <button
                    key={cmd.label}
                    onClick={() => handleQuickCommand(cmd.message)}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg3 border border-border rounded-full text-text2 hover:text-text hover:border-gold/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <cmd.icon className="w-3 h-3" />
                    {cmd.label}
                  </button>
                ))}
              </div>
            )}

            {/* Input Form */}
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault()
                handleSend()
              }}
              className="flex items-end gap-3"
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
                  className="w-full bg-bg3 border border-border rounded-xl px-4 py-3 text-sm text-text placeholder:text-text3 focus:outline-none focus:border-gold/50 resize-none max-h-32 disabled:opacity-50"
                  style={{ minHeight: '44px' }}
                  onInput={(e) => {
                    const target = e.target as HTMLTextAreaElement
                    target.style.height = 'auto'
                    target.style.height = Math.min(target.scrollHeight, 128) + 'px'
                  }}
                />
              </div>
              <Button
                type="submit"
                variant="primary"
                size="md"
                disabled={isLoading || !inputValue.trim()}
                className="shrink-0 h-[44px] w-[44px] !p-0"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </form>

            <p className="text-center text-xs text-text3 mt-2">
              AI Command Center &middot; Le risposte possono contenere errori
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Empty State ───────────────────────────────────────────
function EmptyState({
  onQuickCommand,
}: {
  onQuickCommand: (msg: string) => void
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <div className="w-16 h-16 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center mb-6">
        <Sparkles className="w-8 h-8 text-gold" />
      </div>
      <h2 className="font-display text-2xl text-text mb-2">
        AI Command Center
      </h2>
      <p className="text-text2 text-sm mb-8 max-w-md">
        Il tuo assistente intelligente per gestire l&apos;azienda. Chiedi informazioni
        finanziarie, stato dei progetti, pipeline commerciale o esegui azioni
        concrete.
      </p>

      <div className="grid grid-cols-2 gap-3 max-w-lg">
        {quickCommands.map((cmd) => (
          <button
            key={cmd.label}
            onClick={() => onQuickCommand(cmd.message)}
            className="flex items-center gap-3 px-4 py-3 bg-bg2 border border-border rounded-xl text-left hover:border-gold/30 hover:bg-bg3 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg bg-gold/10 flex items-center justify-center shrink-0 group-hover:bg-gold/20 transition-colors">
              <cmd.icon className="w-4 h-4 text-gold" />
            </div>
            <span className="text-sm text-text2 group-hover:text-text transition-colors">
              {cmd.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Message Bubble ────────────────────────────────────────
function MessageBubble({ message }: { message: DisplayMessage }) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser
            ? 'bg-gold/20 border border-gold/30'
            : 'bg-gold/10 border border-gold/20'
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-gold" />
        ) : (
          <Bot className="w-4 h-4 text-gold" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-bg3 border border-border2 rounded-tr-sm'
            : 'bg-bg2 border-l-2 border-gold/30 border border-border rounded-tl-sm'
        }`}
      >
        {/* Tool calls info */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex gap-1.5 flex-wrap mb-2">
            {message.toolCalls.map((tc, idx) => (
              <Badge key={idx} color="amber">
                <span className="flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  {toolNameMap[(tc as { tool: string }).tool] ?? (tc as { tool: string }).tool}
                </span>
              </Badge>
            ))}
          </div>
        )}

        {/* Content */}
        <div className={`text-sm ${isUser ? 'text-text' : 'text-text2'}`}>
          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="space-y-1">{renderMarkdown(message.content)}</div>
          )}
        </div>

        {/* Timestamp */}
        <p className={`text-[10px] mt-1.5 ${isUser ? 'text-text3 text-right' : 'text-text3'}`}>
          {new Date(message.timestamp).toLocaleTimeString('it-IT', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
      </div>
    </div>
  )
}
