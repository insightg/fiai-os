import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent, type FormEvent, type JSX } from 'react'
import { NavLink } from 'react-router-dom'
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
  Plus,
  Search,
  Trash2,
  Pencil,
  Check,
  LayoutGrid,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeft,
  Users,
  UserCheck,
  FileText,
  ShoppingCart,
  Receipt,
  RotateCcw,
  FileInput,
  Truck,
  Landmark,
  Wallet,
  Calculator,
  Megaphone,
  UserSearch,
  FolderOpen,
  Settings,
  Paperclip,
  Mic,
  Copy,
  Download,
  X,
  ThumbsUp,
  ThumbsDown,
  Volume2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import VoiceChat from '../VoiceChat'
import ContextPanel from './ContextPanel'
import ArtifactOverlay from './ArtifactOverlay'
import JobMonitor from '../JobMonitor'
import AudioRecorder from '../AudioRecorder'
import Badge from '../ui/Badge'
import { renderToolResult, toolNameMapExtended } from '../ChatToolRenderers'
import InlineCrudForm, { type FormField } from '../InlineCrudForm'
import {
  sendMessage,
  createChatSession,
  fetchChatSessions,
  fetchSessionMessages,
  updateSessionTitle,
  type ConversationMessage,
  type ToolUseEvent,
} from '../../lib/anthropic'
import { supabase } from '../../lib/supabase'
import type { ChatMessage } from '../../types'
import { useAuthStore, useClientiStore, useLeadsStore, useProgettiStore, useCandidatiStore, useRimborsiStore, useDocumentiStore, useFattureStore } from '../../store'
import { uploadGeneric } from '../../lib/upload'
import { getAuthToken } from '../../lib/supabase'

// Rate message via backend API
async function rateMessageFn(messageId: string, sessionId: string, domain: string, rating: 'up' | 'down') {
  try {
    const token = getAuthToken()
    await fetch('/api/signals/rate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
      body: JSON.stringify({ messageId, sessionId, domain, rating }),
    })
  } catch { /* fire-and-forget */ }
}
import UserFilesModal from '../UserFilesModal'
// PanelRouter removed — sidebar is now dynamic
import DocumentArchiveModal from '../DocumentArchiveModal'

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
  agentName?: string
  agentDomain?: string
  agentColor?: string
  imagePreview?: string
  reasoning?: {
    steps: { tool: string; description: string; result_summary: string }[]
    domain: string
    thinking: string
    latencyMs?: number
  }
}

// ── Quick Commands ──────────────────────────────────────
const quickCommands = [
  { label: 'Riepilogo finanziario', message: "Dammi un riepilogo finanziario dell'azienda", icon: BarChart3 },
  { label: 'Fatture scadute', message: 'Quali fatture sono scadute?', icon: AlertCircle },
  { label: 'Stato pipeline', message: "Qual è lo stato della pipeline commerciale?", icon: Sparkles },
  { label: 'Stato progetti', message: 'Qual è lo stato dei progetti in corso?', icon: FolderKanban },
  { label: 'Crea lead', message: 'Crea un nuovo lead per ', icon: UserPlus },
  { label: 'Overview dashboard', message: "Dammi una overview completa dell'azienda", icon: LayoutGrid },
]

const toolNameMap = toolNameMapExtended

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
  let tableRows: string[][] = []
  let tableKey = 0

  function flushTable() {
    if (tableRows.length === 0) return
    const header = tableRows[0]
    const body = tableRows.slice(1).filter(r => !r.every(c => /^[-:]+$/.test(c.trim())))
    elements.push(
      <div key={`tbl-${tableKey++}`} className="overflow-x-auto rounded-lg border border-border my-2">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-bg3">
              {header.map((h, j) => (
                <th key={j} className="px-3 py-2 text-left text-text3 font-semibold">{formatInline(h.trim())}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, ri) => (
              <tr key={ri} className="border-t border-border/50">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-text2">{formatInline(cell.trim())}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
    tableRows = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      flushTable()
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="bg-bg rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono text-text2 border border-border">
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

    // Table row detection
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const cells = line.trim().slice(1, -1).split('|')
      tableRows.push(cells)
      continue
    } else if (tableRows.length > 0) {
      flushTable()
    }

    if (line.trim() === '') { elements.push(<div key={`br-${i}`} className="h-2" />); continue }

    if (line.startsWith('### ')) {
      elements.push(<h4 key={`h3-${i}`} className="text-sm font-bold text-text mt-3 mb-1">{formatInline(line.slice(4))}</h4>)
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h3 key={`h2-${i}`} className="text-base font-bold text-text mt-3 mb-1">{formatInline(line.slice(3))}</h3>)
      continue
    }
    if (line.startsWith('# ')) {
      elements.push(<h2 key={`h1-${i}`} className="text-lg font-bold text-text mt-3 mb-1">{formatInline(line.slice(2))}</h2>)
      continue
    }

    if (line.match(/^[-*]\s/)) {
      elements.push(
        <div key={`li-${i}`} className="flex gap-2 ml-2">
          <span className="text-gold mt-0.5 shrink-0">&bull;</span>
          <span>{formatInline(line.slice(2))}</span>
        </div>
      )
      continue
    }

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

    elements.push(<p key={`p-${i}`} className="leading-relaxed">{formatInline(line)}</p>)
  }

  flushTable()

  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key={`code-${codeKey}`} className="bg-bg rounded-lg p-3 my-2 overflow-x-auto text-sm font-mono text-text2 border border-border">
        <code>{codeLines.join('\n')}</code>
      </pre>
    )
  }

  return elements
}

// ── Reasoning Block (collapsed by default, verbose when expanded) ──
function ReasoningBlock({ reasoning }: { reasoning: NonNullable<DisplayMessage['reasoning']> }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[10px] text-text3 hover:text-text transition-colors group"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="font-medium">Ragionamento</span>
        <span className="text-text3 group-hover:text-text3">
          {reasoning.steps.length} step{reasoning.steps.length > 1 ? '' : ''}
          {reasoning.latencyMs ? ` · ${(reasoning.latencyMs / 1000).toFixed(1)}s` : ''}
          {reasoning.domain && ` · ${reasoning.domain}`}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 ml-4 pl-3 border-l-2 border-gold/20 space-y-2">
          {/* Planner thinking */}
          {reasoning.thinking && (
            <div className="bg-bg3/50 rounded px-2.5 py-1.5">
              <p className="text-[9px] text-text3 font-medium mb-0.5">Pensiero del planner:</p>
              <p className="text-[10px] text-text2 italic">{reasoning.thinking}</p>
            </div>
          )}

          {/* Steps with verbose results */}
          {reasoning.steps.map((step, i) => (
            <div key={i} className="space-y-0.5">
              <div className="flex items-start gap-2 text-[11px]">
                <span className="text-gold font-mono shrink-0 mt-0.5">{i + 1}.</span>
                <div className="min-w-0 flex-1">
                  <p className="text-text2 font-medium">{step.description}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[9px] bg-bg3 px-1.5 py-0.5 rounded text-text3">{step.tool}</span>
                    <span className="text-[10px] text-text3">→</span>
                    <span className="text-[10px] text-text3">{step.result_summary}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}

          {/* Profiling */}
          {reasoning.latencyMs && (
            <div className="text-[9px] text-text3 pt-1 border-t border-border/30 flex gap-3">
              <span>Totale: {(reasoning.latencyMs / 1000).toFixed(1)}s</span>
              {(reasoning as any).plannerMs && <span>Planner: {((reasoning as any).plannerMs / 1000).toFixed(1)}s</span>}
              {(reasoning as any).execMs && <span>Tool: {((reasoning as any).execMs / 1000).toFixed(1)}s</span>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Message Bubble ──────────────────────────────────────
function MessageBubble({ message, activeSessionId, onAction }: { message: DisplayMessage; activeSessionId: string | null; onAction?: (messageId: string, toolName: string, action: string, payload: any) => void }) {
  const isUser = message.role === 'user'

  const copyToClipboard = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      toast.success('Copiato negli appunti')
    })
  }, [message.content])

  const downloadAsText = useCallback(() => {
    const blob = new Blob([message.content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fiai-risposta-${Date.now()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [message.content])

  const handleRate = useCallback((rating: 'up' | 'down') => {
    rateMessageFn(message.id, activeSessionId || '', message.agentDomain || 'general', rating)
    toast.success(rating === 'up' ? 'Grazie per il feedback!' : 'Feedback registrato')
  }, [message.id, activeSessionId, message.agentDomain])

  return (
    <div className={`group flex items-start gap-4 ${isUser ? 'flex-row-reverse' : ''} max-w-3xl mx-auto`}>
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 ${
          isUser ? 'bg-gold/20 border border-gold/30' : 'bg-gold/10 border border-gold/20'
        }`}
      >
        {isUser ? <User className="w-4 h-4 text-gold" /> : <Bot className="w-4 h-4 text-gold" />}
      </div>

      <div className={`flex-1 min-w-0 ${isUser ? 'text-right' : ''}`}>
        <div
          className={`inline-block text-left rounded-2xl px-5 py-3.5 ${
            isUser
              ? 'bg-bg3 border border-border2 rounded-tr-md max-w-[85%]'
              : 'bg-bg2 w-full'
          }`}
        >
          {/* Agent indicator */}
          {!isUser && message.agentName && (
            <div className="flex items-center gap-1.5 mb-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: message.agentColor }} />
              <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: message.agentColor }}>
                {message.agentName}
              </span>
            </div>
          )}

          {/* Reasoning block (collapsed by default, like Claude thinking) */}
          {!isUser && message.reasoning && message.reasoning.steps.length > 0 && (
            <ReasoningBlock reasoning={message.reasoning} />
          )}

          {/* Rich tool result renderers FIRST (data before commentary) */}
          {!isUser && message.toolCalls && message.toolCalls.length > 0 && (
            <div className="space-y-2 mb-3">
              {message.toolCalls.map((tc, idx) => {
                const toolName = (tc as { tool: string }).tool
                const toolResult = (tc as { result?: unknown }).result
                const rendered = toolResult ? renderToolResult(toolName, toolResult, {
                  onAction: onAction ? (action: string, payload: any) => onAction(message.id, toolName, action, payload) : undefined
                }) : null
                if (rendered) return <div key={idx}>{rendered}</div>
                return (
                  <Badge key={idx} color="amber">
                    <span className="flex items-center gap-1 text-xs">
                      <Wrench className="w-3 h-3" />
                      {toolNameMap[toolName] ?? toolName}
                    </span>
                  </Badge>
                )
              })}
            </div>
          )}

          {/* Show attached image preview for user messages */}
          {isUser && message.imagePreview && (
            <img src={message.imagePreview} alt="Allegato" className="max-w-full max-h-48 rounded-lg mb-2" />
          )}

          <div className={`text-sm ${isUser ? 'text-text' : 'text-text2'} leading-relaxed`}>
            {isUser ? (
              <p className="whitespace-pre-wrap">{message.content}</p>
            ) : (
              <div className="space-y-1">{renderMarkdown(message.content)}</div>
            )}
          </div>
        </div>

        {!isUser && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 mt-1">
            <button
              title="Copia"
              onClick={copyToClipboard}
              className="p-1 rounded text-text3 hover:text-gold transition-colors"
            >
              <Copy size={12} />
            </button>
            <button
              title="Scarica come testo"
              onClick={downloadAsText}
              className="p-1 rounded text-text3 hover:text-gold transition-colors"
            >
              <Download size={12} />
            </button>
            <button
              title="Utile"
              onClick={() => handleRate('up')}
              className="p-1 rounded text-text3 hover:text-green transition-colors"
            >
              <ThumbsUp size={12} />
            </button>
            <button
              title="Non utile"
              onClick={() => handleRate('down')}
              className="p-1 rounded text-text3 hover:text-red transition-colors"
            >
              <ThumbsDown size={12} />
            </button>
          </div>
        )}

        <p className={`text-[10px] mt-1.5 px-1 ${isUser ? 'text-text3 text-right' : 'text-text3'}`}>
          {new Date(message.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  )
}

// ── Gestionale Sidebar Components ────────────────────────

function GestionaleSection({ label }: { label: string }) {
  return (
    <div className="pt-3 pb-1 px-3">
      <span className="text-[10px] uppercase tracking-wider text-text3 font-semibold">{label}</span>
    </div>
  )
}

function GestionaleLink({ to, icon: Icon, label }: { to: string; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition-colors ${
          isActive
            ? 'bg-gold/10 text-gold font-medium'
            : 'text-text2 hover:text-text hover:bg-bg3'
        }`
      }
    >
      <Icon size={15} className="shrink-0" />
      <span className="truncate">{label}</span>
    </NavLink>
  )
}

// ── Empty State ─────────────────────────────────────────
function EmptyState({ onQuickCommand }: { onQuickCommand: (msg: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-gold/10 border border-gold/20 flex items-center justify-center mb-6">
        <Sparkles className="w-8 h-8 text-gold" />
      </div>
      <h2 className="font-display text-2xl font-bold text-text mb-2">Ciao! Come posso aiutarti?</h2>
      <p className="text-text3 text-sm mb-8 max-w-md">
        Sono l&apos;assistente AI di FIAI. Posso aiutarti a consultare dati aziendali, creare
        lead e clienti, e molto altro.
      </p>
      <div className="grid grid-cols-2 gap-3 max-w-lg w-full">
        {quickCommands.map((cmd) => (
          <button
            key={cmd.label}
            onClick={() => onQuickCommand(cmd.message)}
            className="flex items-center gap-3 px-4 py-3 bg-bg2 border border-border rounded-xl text-sm text-text2 hover:text-text hover:border-gold/30 hover:bg-bg3 transition-all text-left group"
          >
            <cmd.icon className="w-4 h-4 text-gold/60 group-hover:text-gold shrink-0 transition-colors" />
            <span>{cmd.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Chat Layout ─────────────────────────────────────────
export default function ChatLayout() {
  const user = useAuthStore((s) => s.user)
  const profile = useAuthStore((s) => s.profile)
  const logout = useAuthStore((s) => s.logout)

  // Sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  // activePanel removed — sidebar is now dynamic
  const [filesModalOpen, setFilesModalOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // Agent panel buttons config
  // Quick actions for sidebar
  const quickActions = [
    { label: 'Overview aziendale', command: 'overview aziendale' },
    { label: 'Lista clienti', command: 'lista clienti' },
    { label: 'Pipeline leads', command: 'pipeline leads' },
    { label: 'Fatture scadute', command: 'fatture scadute' },
    { label: 'Stato progetti', command: 'stato progetti' },
    { label: 'Documenti', command: 'lista documenti' },
    { label: 'Utenti sistema', command: 'lista utenti' },
    { label: 'Agenti autonomi', command: 'lista agenti autonomi' },
  ]

  // Context panel state — tracks current agent for right panel
  const [currentAgentDomain, setCurrentAgentDomain] = useState<string | null>(null)
  const [currentAgentName, setCurrentAgentName] = useState<string | null>(null)
  const [currentAgentColor, setCurrentAgentColor] = useState<string | null>(null)
  const [lastToolCalls, setLastToolCalls] = useState<Record<string, unknown>[]>([])
  const [artifactView, setArtifactView] = useState<any>(null)

  // Load autonomous agents for sidebar
  const [sidebarAgents, setSidebarAgents] = useState<any[]>([])
  const [sidebarStats, setSidebarStats] = useState<{ docs: number; chunks: number } | null>(null)

  useEffect(() => {
    if (!user) return
    // Load autonomous agents
    const loadSidebar = async () => {
      try {
        const token = getAuthToken()
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        if (token) headers['Authorization'] = `Bearer ${token}`

        const res = await fetch('/api/chat/message', {
          method: 'POST', headers,
          body: JSON.stringify({ message: 'lista agenti autonomi', sessionId: 'sidebar-load' }),
        })
        const data = await res.json()
        // Extract agent list from tool calls
        const agentResult = data.toolCalls?.find((tc: any) => tc.tool === 'list_autonomous_agents')
        if (agentResult?.result && Array.isArray(agentResult.result)) {
          setSidebarAgents(agentResult.result)
        }
      } catch {}

      // Load doc/chunk counts
      try {
        const { supabase } = await import('../../lib/supabase')
        const { data: docs } = await supabase.from('entity').select('id', { count: 'exact', head: true }).eq('type', 'documento')
        const { data: chunks } = await supabase.from('entity').select('id', { count: 'exact', head: true }).eq('type', 'chunk')
        setSidebarStats({ docs: (docs as any)?.length || 0, chunks: (chunks as any)?.length || 0 })
      } catch {}
    }
    loadSidebar()
  }, [user])

  // Session state
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Message state
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [conversationHistory, setConversationHistory] = useState<ConversationMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [activeTools, setActiveTools] = useState<ToolUseEvent[]>([])
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  // Prompt history state — per session, built from loaded messages
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [savedInput, setSavedInput] = useState('')

  // Rename session state
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  // File attachment state
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [attachedPreview, setAttachedPreview] = useState<string | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [voiceMode, setVoiceMode] = useState(false)
  const lastResponseRef = useRef('')

  // Inline CRUD form state
  const [inlineForm, setInlineForm] = useState<{
    messageId: string
    toolName: string
    data: Record<string, any>
    mode: 'create' | 'edit'
  } | null>(null)

  // Smart upload state
  const [smartUpload, setSmartUpload] = useState<{
    status: 'analyzing' | 'done'
    phase?: string
    fileName: string
    fileSize?: number
    file?: File
    result?: import('../../lib/upload').SmartUploadResult
    editNome?: string
    editAutore?: string
    editCategoria?: string
    newCategoria?: string
    newCategoriaDesc?: string
    suggestingDesc?: boolean
    actionLoading?: boolean
  } | null>(null)

  // Legacy archive modal (kept for backward compat)
  const [archiveModal, setArchiveModal] = useState<{
    open: boolean
    fileUrl: string
    fileName: string
    fileSize: number
    suggestedCategoria: string
    suggestedTags: string[]
    suggestedDescrizione: string
    extractedText: string
  } | null>(null)

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const initials = profile
    ? `${profile.nome.charAt(0)}${profile.cognome.charAt(0)}`.toUpperCase()
    : '??'

  // ── Inline CRUD ─────────────────────────────────────
  const TOOL_FORM_FIELDS: Record<string, FormField[]> = useMemo(() => ({
    get_clients: [
      { name: 'tipo', label: 'Tipo', type: 'select', options: [{ value: 'privato', label: 'Privato' }, { value: 'azienda', label: 'Azienda' }] },
      { name: 'nome', label: 'Nome', type: 'text', required: true },
      { name: 'cognome', label: 'Cognome', type: 'text' },
      { name: 'ragione_sociale', label: 'Ragione Sociale', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'telefono', label: 'Telefono', type: 'text' },
      { name: 'piva', label: 'P.IVA', type: 'text' },
    ],
    get_candidates: [
      { name: 'nome', label: 'Nome', type: 'text', required: true },
      { name: 'cognome', label: 'Cognome', type: 'text', required: true },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'ruolo_candidato', label: 'Ruolo', type: 'text' },
      { name: 'stato', label: 'Stato', type: 'select', options: [
        { value: 'nuovo', label: 'Nuovo' }, { value: 'screening', label: 'Screening' },
        { value: 'colloquio', label: 'Colloquio' }, { value: 'offerta', label: 'Offerta' },
        { value: 'assunto', label: 'Assunto' }, { value: 'scartato', label: 'Scartato' },
      ] },
    ],
    get_pipeline: [
      { name: 'nome', label: 'Nome', type: 'text', required: true },
      { name: 'cognome', label: 'Cognome', type: 'text' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'telefono', label: 'Telefono', type: 'text' },
      { name: 'stato', label: 'Stato', type: 'select', options: [
        { value: 'nuovo', label: 'Nuovo' }, { value: 'contattato', label: 'Contattato' },
        { value: 'qualificato', label: 'Qualificato' }, { value: 'proposta', label: 'Proposta' },
      ] },
      { name: 'valore_stimato', label: 'Valore', type: 'number' },
    ],
    get_projects: [
      { name: 'nome', label: 'Nome', type: 'text', required: true },
      { name: 'descrizione', label: 'Descrizione', type: 'textarea' },
      { name: 'stato', label: 'Stato', type: 'select', options: [
        { value: 'pianificato', label: 'Pianificato' }, { value: 'in_corso', label: 'In corso' },
        { value: 'in_pausa', label: 'In pausa' }, { value: 'completato', label: 'Completato' },
      ] },
    ],
  }), [])

  const executeDirectAction = useCallback(async (toolName: string, action: string, data: any) => {
    switch (toolName) {
      case 'get_clients': {
        const store = useClientiStore.getState()
        if (action === 'delete') await store.remove(data.id)
        if (action === 'edit') { const { id, ...rest } = data; await store.update(id, rest) }
        if (action === 'create') await store.create(data)
        break
      }
      case 'get_pipeline': {
        const store = useLeadsStore.getState()
        if (action === 'delete') await store.remove(data.id)
        if (action === 'edit') { const { id, ...rest } = data; await store.update(id, rest) }
        if (action === 'create') await store.create(data)
        break
      }
      case 'get_projects': {
        const store = useProgettiStore.getState()
        if (action === 'edit') { const { id, ...rest } = data; await store.update(id, rest) }
        break
      }
      case 'get_candidates': {
        const store = useCandidatiStore.getState()
        if (action === 'delete') await store.remove(data.id)
        if (action === 'edit') { const { id, ...rest } = data; await store.update(id, rest) }
        if (action === 'create') await store.create(data)
        break
      }
      case 'get_expenses': {
        const store = useRimborsiStore.getState()
        const userId = useAuthStore.getState().user?.id || ''
        if (action === 'approve') await store.approve(data.id, userId)
        if (action === 'reject') await store.reject(data.id, userId, '')
        break
      }
      case 'get_documents':
      case 'search_documents': {
        const store = useDocumentiStore.getState()
        if (action === 'delete') await store.remove(data.id)
        break
      }
      case 'get_overdue_invoices': {
        if (action === 'mark_paid') {
          const store = useFattureStore.getState()
          await store.update(data.id, { stato: 'pagata', pagata_il: new Date().toISOString().split('T')[0] })
        }
        break
      }
    }
  }, [])

  const handleInlineAction = useCallback(async (messageId: string, toolName: string, action: string, payload: any) => {
    if (action === 'edit') {
      setInlineForm({ messageId, toolName, data: payload, mode: 'edit' })
    } else if (action === 'create') {
      setInlineForm({ messageId, toolName: payload.tool || toolName, data: {}, mode: 'create' })
    } else if (action === 'delete') {
      if (!confirm('Sei sicuro di voler eliminare?')) return
      try {
        await executeDirectAction(toolName, 'delete', payload)
        toast.success('Eliminato')
      } catch { toast.error('Errore durante l\'eliminazione') }
    } else if (action === 'approve') {
      try {
        await executeDirectAction(toolName, 'approve', payload)
        toast.success('Approvato')
      } catch { toast.error('Errore durante l\'approvazione') }
    } else if (action === 'reject') {
      try {
        await executeDirectAction(toolName, 'reject', payload)
        toast.success('Rifiutato')
      } catch { toast.error('Errore durante il rifiuto') }
    } else if (action === 'mark_paid') {
      try {
        await executeDirectAction(toolName, 'mark_paid', payload)
        toast.success('Segnata come pagata')
      } catch { toast.error('Errore nell\'aggiornamento') }
    }
  }, [executeDirectAction])

  // ── Load Sessions ────────────────────────────────────
  const loadSessions = useCallback(async () => {
    try {
      const data = await fetchChatSessions()
      setSessions(data)
      return data
    } catch {
      return []
    }
  }, [])

  // Load sessions and auto-select the most recent one
  useEffect(() => {
    (async () => {
      const data = await loadSessions()
      if (data.length > 0 && !activeSessionId) {
        const mostRecent = data[0] // already sorted by updated_at DESC
        setActiveSessionId(mostRecent.id)
        await loadSessionMessages(mostRecent.id)
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Generate Contextual Suggestions ──────────────────
  const generateSuggestions = useCallback(async (history: ConversationMessage[], agentDomain?: string) => {
    setLoadingSuggestions(true)
    try {
      const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'
      const OPENROUTER_API_KEY = import.meta.env.VITE_OPENROUTER_API_KEY ?? ''

      const lastMessages = history.slice(-4).map(m => {
        const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        return `${m.role}: ${c.substring(0, 200)}`
      }).join('\n')

      const res = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'z-ai/glm-5',
          messages: [
            {
              role: 'system',
              content: `Sei un assistente che suggerisce domande di follow-up pertinenti. Data la conversazione, genera esattamente 4 suggerimenti brevi (max 8 parole ciascuno) in italiano che l'utente potrebbe voler chiedere come prossima domanda. I suggerimenti devono essere specifici e contestuali, non generici.${agentDomain ? ` L'ultimo agente attivo era: ${agentDomain}.` : ''} Rispondi SOLO con un array JSON di 4 stringhe.`,
            },
            { role: 'user', content: lastMessages },
          ],
          max_tokens: 256,
        }),
      })

      if (!res.ok) { setSuggestions([]); return }

      const data = await res.json()
      const text = data.choices?.[0]?.message?.content ?? ''
      const match = text.match(/\[[\s\S]*\]/)
      if (match) {
        const parsed = JSON.parse(match[0]) as string[]
        setSuggestions(parsed.slice(0, 4))
      }
    } catch {
      // silent — suggestions are optional
    } finally {
      setLoadingSuggestions(false)
    }
  }, [])

  // ── Load Prompt History ─────────────────────────────
  useEffect(() => {
    if (!user) return
    supabase
      .from('prompt_history')
      .select('prompt')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(100)
      .then((res: { data: { prompt: string }[] | null }) => {
        if (res.data) {
          setPromptHistory(res.data.map((r) => r.prompt).reverse())
        }
      })
  }, [user])

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
      // Build prompt history from user messages in this session
      const userPrompts = data.filter((m: ChatMessage) => m.ruolo === 'user').map((m: ChatMessage) => m.contenuto)
      setPromptHistory(userPrompts)
      setHistoryIndex(-1)
    } catch {
      toast.error('Errore nel caricamento dei messaggi')
    }
  }, [])

  // ── New Session ──────────────────────────────────────
  const createNewSession = useCallback(async () => {
    setActiveSessionId(null)
    setMessages([])
    setConversationHistory([])
    setPromptHistory([])
    setHistoryIndex(-1)
    setInputValue('')
  }, [])

  // ── Delete Session ───────────────────────────────────
  const deleteSession = useCallback(async (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await supabase.from('chat_messages').delete().eq('session_id', sessionId)
      await supabase.from('chat_sessions').delete().eq('id', sessionId)
      setSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (activeSessionId === sessionId) {
        setActiveSessionId(null)
        setMessages([])
        setConversationHistory([])
      }
    } catch {
      toast.error('Errore nella cancellazione')
    }
  }, [activeSessionId])

  // ── Rename Session ──────────────────────────────────
  const startRename = (sessionId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setRenamingSessionId(sessionId)
    setRenameValue(currentTitle)
  }

  const confirmRename = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!renamingSessionId || !renameValue.trim()) return
    await updateSessionTitle(renamingSessionId, renameValue.trim())
    setSessions((prev) =>
      prev.map((s) => (s.id === renamingSessionId ? { ...s, titolo: renameValue.trim() } : s))
    )
    setRenamingSessionId(null)
    setRenameValue('')
  }

  // ── Auto-scroll + refocus input ──────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    // Always keep focus on input after messages change
    setTimeout(() => inputRef.current?.focus(), 150)
  }, [messages, activeTools])

  // ── Focus input on mount ─────────────────────────────
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300)
  }, [])

  // ── File Attachment ──────────────────────────────────
  const LARGE_FILE_THRESHOLD = 500 * 1024 // 500KB — ask for analysis depth

  const runSmartUpload = useCallback(async (file: File, analysisMode: 'full' | 'compact' | 'none' = 'full') => {
    // Show phases of progress
    setSmartUpload(prev => ({ ...prev!, status: 'analyzing', phase: 'Caricamento file...' }))

    // Simulate phase progression (the actual work is a single API call, but we show progress)
    const phaseTimer = setTimeout(() => {
      setSmartUpload(prev => prev?.status === 'analyzing' ? { ...prev, phase: 'Estrazione testo...' } : prev)
    }, 1500)
    const phaseTimer2 = setTimeout(() => {
      setSmartUpload(prev => prev?.status === 'analyzing' ? { ...prev, phase: analysisMode === 'none' ? 'Salvataggio...' : 'Analisi AI in corso...' } : prev)
    }, 3000)
    const phaseTimer3 = setTimeout(() => {
      setSmartUpload(prev => prev?.status === 'analyzing' ? { ...prev, phase: 'Indicizzazione contenuto...' } : prev)
    }, 6000)

    try {
      const { uploadSmart } = await import('../../lib/upload')
      const result = await uploadSmart(file, analysisMode)
      clearTimeout(phaseTimer); clearTimeout(phaseTimer2); clearTimeout(phaseTimer3)
      setSmartUpload({ status: 'done', fileName: file.name, fileSize: file.size, file, result })

      // For images: also set as attached preview for chat
      if (file.type.startsWith('image/')) {
        setAttachedFile(file)
        const reader = new FileReader()
        reader.onload = (ev) => setAttachedPreview(ev.target?.result as string)
        reader.readAsDataURL(file)
      }

      // For audio: set as attached for voice cloning
      if (file.type.startsWith('audio/')) {
        setAttachedFile(file)
        const reader = new FileReader()
        reader.onload = (ev) => { (file as any).__audioBase64 = ev.target?.result }
        reader.readAsDataURL(file)
      }
    } catch (err: any) {
      toast.error(`Errore analisi: ${err.message}`)
      setSmartUpload(null)
    }
  }, [])

  const processFile = useCallback(async (file: File) => {
    setSmartUpload({ status: 'analyzing', fileName: file.name, fileSize: file.size, file })
    await runSmartUpload(file, 'compact')
  }, [runSmartUpload])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileInputRef.current) fileInputRef.current.value = ''
    await processFile(file)
  }, [processFile])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }, [processFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const removeAttachment = useCallback(() => {
    setAttachedFile(null)
    setAttachedPreview(null)
  }, [])

  const formatFileSize = useCallback((bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }, [])

  // ── Send Message ─────────────────────────────────────
  const handleSend = useCallback(
    async (text?: string) => {
      let content = (text ?? inputValue).trim()
      const fileToUpload = attachedFile
      if ((!content && !fileToUpload) || isLoading) return

      // Handle file upload
      let imageBase64ForAnalysis: string | undefined
      let audioBase64ForCloning: string | undefined
      if (fileToUpload) {
        try {
          const isImage = fileToUpload.type.startsWith('image/')
          const isAudio = fileToUpload.type.startsWith('audio/')

          if (isImage && attachedPreview) {
            // For images: pass the base64 directly to the image agent for analysis
            imageBase64ForAnalysis = attachedPreview
            if (!content) content = `Analizza questa immagine: ${fileToUpload.name}`
          } else if (isAudio) {
            // For audio: read as base64 for TTS voice cloning
            const audioBase64 = (fileToUpload as any).__audioBase64 as string | undefined
            if (audioBase64) {
              audioBase64ForCloning = audioBase64
            } else {
              // Read from file if not already available (e.g. file picker)
              audioBase64ForCloning = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result as string)
                reader.onerror = () => reject(new Error('Errore lettura file audio'))
                reader.readAsDataURL(fileToUpload)
              })
            }
            if (!content) content = `Audio registrato per clonazione voce`
            const attachmentInfo = `[Audio allegato: ${fileToUpload.name}]`
            content = content.includes('[Audio allegato') ? content : `${content}\n${attachmentInfo}`
          } else {
            // Documents already uploaded via smart upload in handleFileSelect
            // This shouldn't happen, but handle gracefully
            if (!content) content = `File allegato: ${fileToUpload.name}`
          }
        } catch {
          toast.error('Errore nel caricamento del file')
          return
        }
        setAttachedFile(null)
        setAttachedPreview(null)
      }

      if (!content) return

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
        imagePreview: imageBase64ForAnalysis,
      }
      setMessages((prev) => [...prev, userMsg])
      setInputValue('')
      setHistoryIndex(-1)
      setSavedInput('')
      setSuggestions([])

      // Save to prompt history (persistent)
      setPromptHistory((prev) => [...prev, content])
      if (user) {
        supabase.from('prompt_history').insert({ user_id: user.id, prompt: content })
      }

      // Reset textarea height
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
      }

      const newHistory: ConversationMessage[] = [
        ...conversationHistory,
        { role: 'user', content },
      ]
      setConversationHistory(newHistory)
      setIsLoading(true)
      setActiveTools([])

      try {
        const assistantMsgId = `assistant-${Date.now()}`
        let streamingMsgAdded = false

        const ensureStreamingMsg = () => {
          if (!streamingMsgAdded) {
            streamingMsgAdded = true
            setMessages((prev) => [...prev, {
              id: assistantMsgId,
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
            }])
          }
        }

        const result = await sendMessage(
          newHistory,
          sessionId,
          // onToolUse callback
          (event) => {
            setActiveTools((prev) => {
              const existing = prev.findIndex((t) => t.toolName === event.toolName)
              if (existing >= 0) {
                const updated = [...prev]
                updated[existing] = event
                return updated
              }
              return [...prev, event]
            })
          },
          // onTextChunk callback — create message on first chunk, then append
          (chunk) => {
            ensureStreamingMsg()
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + chunk }
                  : m
              )
            )
          },
          // attached image base64 for vision analysis
          imageBase64ForAnalysis,
          // attached audio base64 for TTS voice cloning
          audioBase64ForCloning
        )

        // Finalize: add or replace with complete result
        if (streamingMsgAdded) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: result.text,
                    toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
                    agentName: result.agentName,
                    agentDomain: result.agentDomain,
                    agentColor: result.agentColor,
                    reasoning: result.reasoning,
                  }
                : m
            )
          )
        } else {
          // No streaming happened — add the complete message directly
          setMessages((prev) => [...prev, {
            id: assistantMsgId,
            role: 'assistant' as const,
            content: result.text,
            toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
            timestamp: new Date().toISOString(),
            agentName: result.agentName,
            agentDomain: result.agentDomain,
            agentColor: result.agentColor,
            reasoning: result.reasoning,
          }])
        }
        // Update context panel with current agent
        if (result.agentDomain && result.agentDomain !== 'general') {
          setCurrentAgentDomain(result.agentDomain)
          setCurrentAgentName(result.agentName || null)
          setCurrentAgentColor(result.agentColor || null)
        }
        if (result.toolCalls?.length > 0) {
          setLastToolCalls(result.toolCalls)
        }

        // Save response for voice chat
        lastResponseRef.current = result.text

        const updatedHistory = [
          ...newHistory,
          { role: 'assistant' as const, content: result.text },
        ]
        setConversationHistory(updatedHistory)

        // Use rule-based suggestions from orchestrator (instant, no LLM call)
        if (result.suggestions && result.suggestions.length > 0) {
          setSuggestions(result.suggestions)
        } else {
          // Fallback to LLM-generated suggestions
          generateSuggestions(updatedHistory, result.agentDomain)
        }
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
        // Always refocus the input after response
        setTimeout(() => inputRef.current?.focus(), 100)
      }
    },
    [inputValue, isLoading, activeSessionId, messages.length, conversationHistory, loadSessions, attachedFile]
  )

  // ── Keyboard Handler ─────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }

    // Arrow Up: navigate prompt history backwards
    if (e.key === 'ArrowUp' && promptHistory.length > 0) {
      const textarea = e.target as HTMLTextAreaElement
      // Only activate if cursor is at the start or input is single-line
      if (textarea.selectionStart === 0 || !inputValue.includes('\n')) {
        e.preventDefault()
        if (historyIndex === -1) {
          setSavedInput(inputValue)
          const newIdx = promptHistory.length - 1
          setHistoryIndex(newIdx)
          setInputValue(promptHistory[newIdx])
        } else if (historyIndex > 0) {
          const newIdx = historyIndex - 1
          setHistoryIndex(newIdx)
          setInputValue(promptHistory[newIdx])
        }
      }
    }

    // Arrow Down: navigate prompt history forwards
    if (e.key === 'ArrowDown' && historyIndex >= 0) {
      const textarea = e.target as HTMLTextAreaElement
      const atEnd = textarea.selectionStart === textarea.value.length
      if (atEnd || !inputValue.includes('\n')) {
        e.preventDefault()
        if (historyIndex < promptHistory.length - 1) {
          const newIdx = historyIndex + 1
          setHistoryIndex(newIdx)
          setInputValue(promptHistory[newIdx])
        } else {
          setHistoryIndex(-1)
          setInputValue(savedInput)
        }
      }
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

  // ── Select a session ─────────────────────────────────
  const selectSession = useCallback(
    async (sessionId: string) => {
      setActiveSessionId(sessionId)
      await loadSessionMessages(sessionId)
    },
    [loadSessionMessages]
  )

  // ── Filter sessions ──────────────────────────────────
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions
    const q = searchQuery.toLowerCase()
    return sessions.filter((s) => s.titolo.toLowerCase().includes(q))
  }, [sessions, searchQuery])

  // ── Format session date ──────────────────────────────
  const formatSessionDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Oggi'
    if (diffDays === 1) return 'Ieri'
    if (diffDays < 7) return `${diffDays} giorni fa`
    return date.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
  }

  // ── Render ───────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      {/* Top Bar */}
      <header className="h-[52px] bg-bg2 border-b border-border flex items-center justify-between px-4 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen((p) => !p)}
            className="p-1.5 rounded-lg hover:bg-bg3 text-text2 hover:text-text transition-colors"
          >
            {sidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
          </button>
          <span className="font-display text-gold font-bold text-lg tracking-wide">FIAI</span>
          <span className="text-text3 text-xs hidden sm:inline">Fabbrica Italiana Agenti Intelligenti</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilesModalOpen(true)}
            className="p-1.5 rounded-lg text-text2 hover:bg-bg3 hover:text-text transition-colors"
            title="I miei file"
          >
            <FolderOpen size={20} />
          </button>
          {profile && (
            <span className="text-sm text-text2 hidden sm:inline ml-1">
              {profile.nome} {profile.cognome}
            </span>
          )}
          <div className="w-8 h-8 rounded-full bg-gold/20 text-gold text-xs font-semibold flex items-center justify-center">
            {profile?.avatar_url ? (
              <img src={profile.avatar_url} alt="Avatar" className="w-8 h-8 rounded-full object-cover" />
            ) : (
              initials
            )}
          </div>
          <button
            onClick={() => logout()}
            className="p-1.5 rounded-lg text-text3 hover:text-red hover:bg-red/10 transition-colors"
            title="Esci"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Main Area */}
      <div className="flex flex-1 min-h-0">
        {/* Sessions Sidebar */}
        <aside
          className={`bg-bg2 border-r border-border flex flex-col shrink-0 transition-all duration-200 ${
            sidebarOpen ? 'w-[280px]' : 'w-0 overflow-hidden'
          }`}
        >
          {/* New Chat Button */}
          <div className="p-3 shrink-0">
            <button
              onClick={createNewSession}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gold hover:bg-gold-l text-bg rounded-xl text-sm font-semibold transition-colors"
            >
              <Plus size={16} />
              Nuova Chat
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2 shrink-0">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3" />
              <input
                type="text"
                placeholder="Cerca conversazioni..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-bg3 border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-text placeholder:text-text3 focus:outline-none focus:border-gold/40 transition-colors"
              />
            </div>
          </div>

          {/* Sessions List */}
          <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
            {filteredSessions.length === 0 && (
              <p className="text-center text-text3 text-xs py-8">
                {searchQuery ? 'Nessun risultato' : 'Nessuna conversazione'}
              </p>
            )}
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => selectSession(session.id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all group relative ${
                  activeSessionId === session.id
                    ? 'bg-gold/10 text-gold border border-gold/20'
                    : 'text-text2 hover:text-text hover:bg-bg3 border border-transparent'
                }`}
              >
                <div className="flex items-start gap-2">
                  <MessageSquare size={14} className="shrink-0 mt-0.5 opacity-50" />
                  <div className="flex-1 min-w-0">
                    {renamingSessionId === session.id ? (
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
                          if (e.key === 'Escape') { setRenamingSessionId(null) }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="w-full bg-bg3 border border-gold/40 rounded px-1.5 py-0.5 text-xs text-text focus:outline-none"
                      />
                    ) : (
                      <p className="truncate text-xs font-medium">{session.titolo}</p>
                    )}
                    <p className="text-[10px] text-text3 mt-0.5">{formatSessionDate(session.updated_at)}</p>
                  </div>
                </div>
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {renamingSessionId === session.id ? (
                    <button
                      onClick={(e) => confirmRename(e)}
                      className="p-1 rounded-md text-green hover:bg-green/10 transition-colors"
                      title="Conferma"
                    >
                      <Check size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={(e) => startRename(session.id, session.titolo, e)}
                      className="p-1 rounded-md text-text3 hover:text-gold hover:bg-gold/10 transition-colors"
                      title="Rinomina"
                    >
                      <Pencil size={11} />
                    </button>
                  )}
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="p-1 rounded-md text-text3 hover:text-red hover:bg-red/10 transition-colors"
                    title="Elimina"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </button>
            ))}
          </nav>

        </aside>

        {/* Chat Area - shrinks when panel is open */}
        <div
          className="flex-1 flex flex-col min-w-0 relative"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          {/* Drag overlay */}
          {isDragging && (
            <div className="absolute inset-0 z-40 bg-gold/10 border-2 border-dashed border-gold rounded-xl flex items-center justify-center pointer-events-none">
              <div className="bg-bg2 px-6 py-4 rounded-xl shadow-lg text-center">
                <p className="text-sm font-medium text-gold">Rilascia il file qui</p>
                <p className="text-xs text-text3 mt-1">Verrà analizzato automaticamente</p>
              </div>
            </div>
          )}
          {messages.length === 0 && !isLoading ? (
            <EmptyState onQuickCommand={handleQuickCommand} />
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-6">
                <div className="space-y-6">
                  {messages.map((msg) => (
                    <div key={msg.id}>
                      <MessageBubble message={msg} activeSessionId={activeSessionId} onAction={handleInlineAction} />
                      {inlineForm && inlineForm.messageId === msg.id && TOOL_FORM_FIELDS[inlineForm.toolName] && (
                        <div className="max-w-3xl mx-auto ml-12 mt-2">
                          <InlineCrudForm
                            fields={TOOL_FORM_FIELDS[inlineForm.toolName]}
                            data={inlineForm.data}
                            onSubmit={async (formData) => {
                              try {
                                const aziendaId = useAuthStore.getState().profile?.azienda_id
                                const fullData = { ...formData, azienda_id: aziendaId }
                                if (inlineForm.mode === 'edit') {
                                  await executeDirectAction(inlineForm.toolName, 'edit', { ...fullData, id: inlineForm.data.id })
                                  toast.success('Aggiornato')
                                } else {
                                  await executeDirectAction(inlineForm.toolName, 'create', fullData)
                                  toast.success('Creato')
                                }
                                setInlineForm(null)
                              } catch {
                                toast.error('Errore durante il salvataggio')
                              }
                            }}
                            onCancel={() => setInlineForm(null)}
                            submitLabel={inlineForm.mode === 'edit' ? 'Aggiorna' : 'Crea'}
                          />
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Tool use indicators */}
                  {isLoading && activeTools.length > 0 && (
                    <div className="flex gap-2 flex-wrap max-w-3xl mx-auto pl-12">
                      {activeTools.map((tool) => (
                        <Badge key={tool.toolName} color={tool.status === 'running' ? 'amber' : 'green'}>
                          <span className="flex items-center gap-1.5 text-xs">
                            {tool.status === 'running' ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Wrench className="w-3 h-3" />
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
                    <div className="flex items-start gap-4 max-w-3xl mx-auto">
                      <div className="w-8 h-8 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center shrink-0">
                        <Bot className="w-4 h-4 text-gold" />
                      </div>
                      <div className="bg-bg2 border border-border rounded-2xl rounded-tl-md px-5 py-3.5">
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
              </div>

              {/* Contextual suggestions (generated after each response) */}
              {messages.length > 0 && !isLoading && suggestions.length > 0 && (
                <div className="px-4 pb-2 shrink-0">
                  <div className="flex gap-2 overflow-x-auto no-scrollbar max-w-3xl mx-auto">
                    {suggestions.map((s, i) => (
                      <button
                        key={i}
                        onClick={() => handleSend(s)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-bg2 border border-border rounded-full text-text3 hover:text-text hover:border-gold/30 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Sparkles className="w-3 h-3 text-gold/50" />
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Input Area */}
          <div className="shrink-0 px-4 pb-4 pt-2">
            <div className="max-w-3xl mx-auto">
              <form
                onSubmit={(e: FormEvent) => {
                  e.preventDefault()
                  handleSend()
                }}
                className="relative"
              >
                {isRecording && (
                  <AudioRecorder
                    onRecordingComplete={(blob, base64) => {
                      setIsRecording(false)
                      const file = new File([blob], `recording-${Date.now()}.webm`, { type: 'audio/webm' })
                      setAttachedFile(file)
                      setAttachedPreview(null)
                      // Store base64 in a data attribute on the file for TTS cloning
                      ;(file as any).__audioBase64 = base64
                    }}
                    onCancel={() => setIsRecording(false)}
                  />
                )}
                {voiceMode && (
                  <VoiceChat
                    onSendMessage={async (text: string) => {
                      lastResponseRef.current = ''
                      await handleSend(text)
                      return lastResponseRef.current
                    }}
                    onClose={() => setVoiceMode(false)}
                  />
                )}
                <div className="bg-bg2 border border-border rounded-2xl shadow-sm focus-within:border-gold/40 focus-within:shadow-md transition-all">
                  {/* Attachment Preview */}
                  {attachedFile && (
                    <div className="px-4 pt-3 pb-0">
                      <div className="inline-flex items-center gap-2 bg-bg3 rounded-lg px-3 py-2 max-w-xs">
                        {attachedPreview ? (
                          <img src={attachedPreview} alt="Anteprima" className="h-12 w-12 object-cover rounded" />
                        ) : attachedFile.type.startsWith('audio/') ? (
                          <Mic className="w-5 h-5 text-gold shrink-0" />
                        ) : (
                          <FileText className="w-5 h-5 text-gold shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="text-xs text-text truncate max-w-[160px]">{attachedFile.name}</p>
                          <p className="text-[10px] text-text3">{formatFileSize(attachedFile.size)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={removeAttachment}
                          className="p-0.5 rounded hover:bg-bg text-text3 hover:text-text transition-colors shrink-0"
                          title="Rimuovi allegato"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isLoading}
                      className="shrink-0 w-9 h-9 ml-2 mb-3 flex items-center justify-center text-text3 hover:text-text transition-colors disabled:opacity-30"
                      title="Allega file"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsRecording(true)}
                      disabled={isLoading || isRecording}
                      className="shrink-0 w-9 h-9 mb-3 flex items-center justify-center text-text3 hover:text-gold transition-colors disabled:opacity-30"
                      title="Registra audio"
                    >
                      <Mic className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setVoiceMode(v => !v)}
                      disabled={isLoading}
                      className={`shrink-0 w-9 h-9 mb-3 flex items-center justify-center transition-colors disabled:opacity-30 ${
                        voiceMode ? 'text-gold' : 'text-text3 hover:text-gold'
                      }`}
                      title="Conversazione vocale"
                    >
                      <Volume2 className="w-4 h-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx,.xls,.xlsx,.csv,.mp3,.wav,.webm,.ogg,.m4a,.mp4,.mov,.zip,.pptx"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                    <textarea
                      ref={inputRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Scrivi un messaggio..."
                      disabled={isLoading}
                      rows={1}
                      className="flex-1 bg-transparent px-3 pt-4 pb-12 text-sm text-text placeholder:text-text3 focus:outline-none resize-none max-h-40 disabled:opacity-50"
                      style={{ minHeight: '56px' }}
                      onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement
                        target.style.height = 'auto'
                        target.style.height = Math.min(target.scrollHeight, 160) + 'px'
                      }}
                    />
                  </div>
                  <div className="absolute bottom-3 right-3 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={isLoading || (!inputValue.trim() && !attachedFile)}
                      className="w-9 h-9 rounded-xl bg-gold hover:bg-gold-l text-bg flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </form>
              <p className="text-center text-[10px] text-text3 mt-2">
                FIAI AI &middot; Le risposte possono contenere errori
              </p>
            </div>
          </div>
        </div>

        {/* Right Panel — disabled for now, will be re-enabled when stable */}
      </div>
      <UserFilesModal open={filesModalOpen} onClose={() => setFilesModalOpen(false)} />

      {/* Artifact Overlay — disabled for now */}

      {/* Smart Upload Overlay */}
      {smartUpload && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-bg2 border border-border rounded-2xl shadow-2xl w-full max-w-md p-6">
            {smartUpload.status === 'analyzing' ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="w-10 h-10 animate-spin text-gold" />
                <p className="text-sm text-text font-medium">{smartUpload.phase || 'Analisi in corso...'}</p>
                <p className="text-xs text-text3">{smartUpload.fileName}</p>
                {smartUpload.fileSize && (
                  <p className="text-[10px] text-text3">{(smartUpload.fileSize / 1024).toFixed(0)} KB</p>
                )}
                {/* Phase progress dots */}
                <div className="flex gap-1.5 mt-1">
                  {['Caricamento', 'Estrazione', 'Analisi', 'Indicizzazione'].map((phase, i) => {
                    const currentIdx = ['Caricamento file...', 'Estrazione testo...', 'Analisi AI in corso...', 'Indicizzazione contenuto...'].findIndex(p => p === smartUpload.phase)
                    return (
                      <div key={phase} className={`w-2 h-2 rounded-full transition-colors ${i <= currentIdx ? 'bg-gold' : 'bg-bg3'}`} />
                    )
                  })}
                </div>
              </div>
            ) : smartUpload.result ? (
              <div className="space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text">Conferma catalogazione</h3>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-gold/10 text-gold">
                    {smartUpload.result.entity_type}
                  </span>
                </div>

                <p className="text-xs text-text2">Il sistema ha classificato il documento come segue. Verifica e conferma o modifica.</p>

                {/* Preview: image or audio */}
                {smartUpload.result.entity_type === 'foto' && smartUpload.result.file_url && (
                  <img src={smartUpload.result.file_url} alt="Preview" className="w-full max-h-48 object-contain rounded-lg bg-bg3" />
                )}
                {smartUpload.result.entity_type === 'audio' && smartUpload.result.file_url && (
                  <audio controls className="w-full" src={smartUpload.result.file_url} />
                )}

                <div className="space-y-2 text-xs">
                  {/* Editable fields */}
                  <div className="bg-bg3 rounded-lg p-3 space-y-2.5">
                    {/* Nome — editable */}
                    <div className="flex items-center gap-2">
                      <span className="text-text3 shrink-0 w-16">Nome:</span>
                      <input
                        type="text"
                        value={smartUpload.editNome ?? smartUpload.result.display_name}
                        onChange={(e) => setSmartUpload(prev => prev ? { ...prev, editNome: e.target.value } : null)}
                        className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text focus:outline-none focus:border-gold/40 font-medium"
                      />
                    </div>

                    {/* Autore — editable */}
                    <div className="flex items-center gap-2">
                      <span className="text-text3 shrink-0 w-16">Autore:</span>
                      <input
                        type="text"
                        value={smartUpload.editAutore ?? (smartUpload.result.extracted_data as any)?.autore ?? ''}
                        onChange={(e) => setSmartUpload(prev => prev ? { ...prev, editAutore: e.target.value } : null)}
                        placeholder="Autore del documento..."
                        className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
                      />
                    </div>

                    {/* Categoria — editable select */}
                    <div className="flex items-center gap-2">
                      <span className="text-text3 shrink-0">Categoria:</span>
                      <select
                        value={smartUpload.editCategoria ?? smartUpload.result.categoria}
                        onChange={(e) => setSmartUpload(prev => prev ? { ...prev, editCategoria: e.target.value, newCategoria: e.target.value === '__new__' ? '' : undefined } : null)}
                        className="flex-1 px-2 py-1 text-xs bg-bg2 border border-border rounded text-text focus:outline-none focus:border-gold/40"
                      >
                        {['legale', 'amministrazione', 'commerciale', 'hr', 'marketing', 'produzione', 'documentazione_tecnica', 'normative', 'contratti', 'letteratura', 'religione', 'altro'].map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                        {/* AI suggestion if not in standard list */}
                        {!['legale', 'amministrazione', 'commerciale', 'hr', 'marketing', 'produzione', 'documentazione_tecnica', 'normative', 'contratti', 'letteratura', 'religione', 'altro'].includes(smartUpload.result.categoria) && (
                          <option value={smartUpload.result.categoria}>{smartUpload.result.categoria} (suggerita)</option>
                        )}
                        {/* User-created category */}
                        {smartUpload.editCategoria && smartUpload.editCategoria !== '__new__' && !['legale', 'amministrazione', 'commerciale', 'hr', 'marketing', 'produzione', 'documentazione_tecnica', 'normative', 'contratti', 'letteratura', 'religione', 'altro'].includes(smartUpload.editCategoria) && smartUpload.editCategoria !== smartUpload.result.categoria && (
                          <option value={smartUpload.editCategoria}>✓ {smartUpload.editCategoria}</option>
                        )}
                        <option value="__new__">+ Nuova categoria...</option>
                      </select>
                    </div>

                    {/* New category form */}
                    {(smartUpload.editCategoria === '__new__' || smartUpload.newCategoria !== undefined) && (
                      <div className="space-y-2 bg-bg3/50 rounded-lg p-2.5 border border-border">
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={smartUpload.newCategoria || ''}
                            onChange={(e) => setSmartUpload(prev => prev ? { ...prev, newCategoria: e.target.value } : null)}
                            placeholder="Nome nuova categoria..."
                            autoFocus
                            className="flex-1 px-2 py-1.5 text-xs bg-bg2 border border-border rounded text-text placeholder:text-text3 focus:outline-none focus:border-gold/40"
                          />
                          {smartUpload.newCategoria && smartUpload.newCategoria.length > 2 && !smartUpload.newCategoriaDesc && (
                            <button
                              type="button"
                              disabled={smartUpload.suggestingDesc}
                              onClick={async () => {
                                setSmartUpload(prev => prev ? { ...prev, suggestingDesc: true } : null)
                                try {
                                  const token = (await import('../../lib/supabase')).getAuthToken()
                                  const res = await fetch('/api/chat/message', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                                    body: JSON.stringify({
                                      message: `Genera una breve descrizione (max 2 frasi) per la categoria "${smartUpload.newCategoria}" per il riconoscimento automatico di documenti simili. Rispondi SOLO con la descrizione.`,
                                      sessionId: 'system-suggest',
                                    }),
                                  })
                                  const data = await res.json()
                                  if (data.text) {
                                    setSmartUpload(prev => prev ? { ...prev, newCategoriaDesc: data.text.substring(0, 300), suggestingDesc: false } : null)
                                  } else {
                                    setSmartUpload(prev => prev ? { ...prev, suggestingDesc: false } : null)
                                  }
                                } catch {
                                  setSmartUpload(prev => prev ? { ...prev, suggestingDesc: false } : null)
                                }
                              }}
                              className="px-3 py-1.5 text-[10px] bg-gold/10 hover:bg-gold/20 text-gold rounded border border-gold/20 whitespace-nowrap disabled:opacity-50"
                            >
                              {smartUpload.suggestingDesc ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Suggerisci'}
                            </button>
                          )}
                        </div>
                        <textarea
                          value={smartUpload.newCategoriaDesc || ''}
                          onChange={(e) => setSmartUpload(prev => prev ? { ...prev, newCategoriaDesc: e.target.value } : null)}
                          placeholder="Descrivi questa categoria per il riconoscimento automatico futuro..."
                          rows={2}
                          className="w-full px-2 py-1.5 text-[10px] bg-bg2 border border-border rounded text-text placeholder:text-text3 focus:outline-none focus:border-gold/40 resize-none"
                        />
                        <div className="flex justify-end">
                          {smartUpload.newCategoria && smartUpload.newCategoria.length > 1 && (
                            <button
                              type="button"
                              onClick={() => setSmartUpload(prev => prev ? { ...prev, editCategoria: prev.newCategoria, newCategoria: undefined } : null)}
                              className="px-3 py-1 text-[10px] bg-gold hover:bg-gold-l text-white rounded font-medium"
                            >
                              Usa questa categoria
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Tags */}
                    {smartUpload.result.tags.length > 0 && (
                      <div className="flex gap-1 flex-wrap items-center">
                        <span className="text-text3">Tags:</span>
                        {smartUpload.result.tags.map((t: string) => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-bg2 text-text2 text-[10px]">{t}</span>
                        ))}
                      </div>
                    )}

                    {smartUpload.result.descrizione && (
                      <p><span className="text-text3">Descrizione:</span> <span className="text-text">{smartUpload.result.descrizione}</span></p>
                    )}
                  </div>

                  {/* Info & Statistics */}
                  <div className="bg-bg3 rounded-lg p-3 space-y-1">
                    <p className="text-text3 text-[10px] font-semibold uppercase tracking-wider mb-1.5">Informazioni</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <p className="text-[11px]"><span className="text-text3">File:</span> <span className="text-text">{smartUpload.fileName}</span></p>
                      <p className="text-[11px]"><span className="text-text3">Dimensione:</span> <span className="text-text">{smartUpload.fileSize ? (smartUpload.fileSize < 1024 * 1024 ? `${(smartUpload.fileSize / 1024).toFixed(0)} KB` : `${(smartUpload.fileSize / (1024 * 1024)).toFixed(1)} MB`) : '—'}</span></p>
                      {smartUpload.result.page_count && (
                        <p className="text-[11px]"><span className="text-text3">Pagine:</span> <span className="text-text">{smartUpload.result.page_count}</span></p>
                      )}
                      <p className="text-[11px]"><span className="text-text3">Tipo file:</span> <span className="text-text">{smartUpload.result.entity_type}</span></p>
                      <p className="text-[11px]"><span className="text-text3">Caricato da:</span> <span className="text-text">{profile?.nome || user?.email || '—'}</span></p>
                      <p className="text-[11px]"><span className="text-text3">Data:</span> <span className="text-text">{new Date().toLocaleDateString('it-IT')}</span></p>
                    </div>
                  </div>

                  {/* Matched name */}
                  {smartUpload.result.matched_name && (
                    <div className="bg-green/10 border border-green/20 rounded-lg p-2.5">
                      <p className="text-green text-[11px] font-medium">Collegato a: {smartUpload.result.matched_name.display_name}</p>
                    </div>
                  )}
                </div>

                {/* Actions: Conferma or Annulla */}
                <div className="flex gap-2 pt-1">
                  <button
                    disabled={smartUpload.actionLoading}
                    onClick={async () => {
                      setSmartUpload(prev => prev ? { ...prev, actionLoading: true } : null)
                      const r = smartUpload.result!
                      const finalCat = smartUpload.editCategoria && smartUpload.editCategoria !== '__new__'
                        ? smartUpload.editCategoria
                        : r.categoria

                      try {
                        // Confirm upload → saves entity + launches background job (chunk + tag + embed)
                        const { confirmUpload } = await import('../../lib/upload')
                        const finalNome = smartUpload.editNome || r.display_name
                        const finalAutore = smartUpload.editAutore || (r.extracted_data as any)?.autore || undefined
                        await confirmUpload(r.upload_id, finalCat, finalNome, finalAutore)
                        toast.success(`"${r.display_name}" — catalogazione in corso`)
                      } catch (err: any) {
                        toast.error(err.message || 'Errore nella conferma')
                      }
                      setSmartUpload(null)
                    }}
                    className="flex-1 px-4 py-2 text-xs bg-gold hover:bg-gold-l text-white rounded-lg font-medium disabled:opacity-50"
                  >
                    {smartUpload.actionLoading ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                    Conferma e cataloga
                  </button>
                  <button
                    onClick={async () => {
                      const r = smartUpload.result!
                      try {
                        const { cancelUpload } = await import('../../lib/upload')
                        await cancelUpload(r.upload_id)
                      } catch {}
                      toast('Upload annullato')
                      setSmartUpload(null)
                    }}
                    className="px-4 py-2 text-xs text-text3 hover:text-red border border-border rounded-lg"
                  >
                    Annulla
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {archiveModal && (
        <DocumentArchiveModal
          open={archiveModal.open}
          onClose={() => setArchiveModal(null)}
          fileUrl={archiveModal.fileUrl}
          fileName={archiveModal.fileName}
          fileSize={archiveModal.fileSize}
          suggestedCategoria={archiveModal.suggestedCategoria}
          suggestedTags={archiveModal.suggestedTags}
          suggestedDescrizione={archiveModal.suggestedDescrizione}
          extractedText={archiveModal.extractedText}
          onConfirm={async (data) => {
            const aziendaId = profile?.azienda_id
            const userId = user?.id
            if (!aziendaId || !userId) return
            const ext = archiveModal.fileName.split('.').pop()?.toLowerCase() || ''
            await useDocumentiStore.getState().create({
              azienda_id: aziendaId,
              nome: data.nome,
              tipo_file: ext,
              categoria: data.categoria as any,
              descrizione: data.descrizione || null,
              file_url: archiveModal.fileUrl,
              file_size: archiveModal.fileSize,
              tags: data.tags.length > 0 ? data.tags : null,
              contenuto_testo: data.contenuto_testo || null,
              uploaded_by: userId,
            })
          }}
        />
      )}

      {/* Job Monitor — floating badge */}
      <JobMonitor />
    </div>
  )
}
