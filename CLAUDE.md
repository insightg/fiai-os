# FIAI OS — Documento Tecnico

FIAI (Fabbrica Italiana Agenti Intelligenti) e' un gestionale aziendale AI-native. 13 agenti specializzati gestiscono l'intera operativita' aziendale tramite chat in linguaggio naturale.

## Stack

```
Frontend:  React 19 + Vite + Tailwind + Zustand + Inter font
Backend:   Node.js + Express + TypeScript (ESM, tsx watch)
Database:  SQLite (better-sqlite3, WAL) + FTS5 + Vector Embeddings
AI:        OpenRouter multi-model (Claude Haiku 4.5, Mistral Small)
Embedding: text-embedding-3-small (1536 dim) via OpenRouter
TTS:       Qwen3-TTS 0.6B su RunPod (streaming PCM)
WhatsApp:  Baileys WebSocket
Deploy:    Docker Compose (nginx + node)
```

## Comandi

```bash
npm run dev          # Frontend Vite (porta 5173)
npm run server       # Backend tsx watch (porta 3001)
npm run dev:all      # Entrambi in parallelo
npm run build        # tsc -b && vite build

# Type check
npx tsc -p tsconfig.node.json --noEmit   # server
npx tsc -p tsconfig.app.json --noEmit    # frontend

# Env richieste
OPENROUTER_API_KEY=...   # AI models
JWT_SECRET=...           # Auth tokens
DB_PATH=/app/data/fiai.db
CONTEXT_DIR=/app/data/context
UPLOADS_DIR=/app/data/uploads
```

## Architettura Dati: Tutto e' Entity

Una sola tabella `entity` contiene tutto: persone, fatture, documenti, chunk, job, agenti autonomi.

```
entity:
  id, azienda_id, type, display_name, slug, stato
  email, telefono, tags (JSON array), piva, categoria
  body (testo pesante), embedding (BLOB Float32 1536 dim)
  parent_id, name_id, user_id, file_url, numero, data, totale
  metadata (JSON snello), path, ordine, created_at, updated_at

relations:
  from_id → to_id, tipo (membro_di, allegato_a, ordine_da_preventivo...)
```

**Tipi entity**: persona, utente, organizzazione, fattura, fattura_passiva, preventivo, ordine, progetto, conto, movimento, rimborso, documento, report, contratto, cv, chunk, job, autonomous_agent, skill, agent_memory, workflow, agent_log, category_template, board, board_column, card, evento, chat_session, chat_message

**Tags** (su persone/org): `["cliente"]`, `["lead"]`, `["fornitore"]`, `["candidato"]`, `["utente","admin"]`

## Pipeline Agente

```
Messaggio utente
  → Safety IN (prompt injection check)
  → Mode detect: minimal (saluti) | iteration (follow-up) | full
  → ClassifyIntent LLM (Haiku, max_tokens=80) → dominio
  → Agent-Native Tool Calling:
      L'agente chiama tool direttamente via OpenRouter tool_use
      Max 10 iterazioni, vede risultati strutturati, puo' adattarsi
  → Safety OUT (PII masking su WhatsApp)
  → Signal capture (log + auto-learn preferenze)
```

**NON c'e' un planner separato.** L'agente stesso decide quali tool chiamare, in che ordine, e reagisce ai risultati. Ispirato a Anthropic Programmatic Tool Calling.

## I 13 Agenti

Ogni agente ha una cartella in `server/agents/domains/`:

| Cartella | Nome | Dominio | Modello | Tool extra |
|----------|------|---------|---------|------------|
| `pulse/` | Pulse | pulse | Haiku 4.5 | — |
| `commerciale/` | Marco | commerciale | Haiku 4.5 | — |
| `produzione/` | Luca | produzione | Haiku 4.5 | — |
| `marketing/` | Giulia | marketing | Haiku 4.5 | generate_image |
| `amministrazione/` | Sofia | amministrazione | Haiku 4.5 | — |
| `hr/` | Elena | hr | Haiku 4.5 | — |
| `legal/` | Avv. Rossi | legal | Mistral Small | retrieve |
| `documentale/` | Archivista | documentale | Mistral Small | retrieve, list_documents, explore_document, rechunk_document, reclassify_document, generate_pdf |
| `whatsapp/` | WhatsApp Agent | whatsapp | Haiku 4.5 | send_whatsapp_*, generate_image, generate_tts |
| `it/` | Dev | it | Haiku 4.5 | create_autonomous_agent, list_autonomous_agents, toggle/delete_autonomous_agent, get_agent_logs, create/run/list_workflows, update_skill, list_skills, add_agent_lesson |
| `doctor/` | Doctor | doctor | Haiku 4.5 | get_api_costs, get_whatsapp_status, list_autonomous_agents, get_agent_logs, list_workflows, get_jobs |
| `tts/` | Voice Assistant | tts | Haiku 4.5 | list_voices, set_voice, get_current_voice, clone_voice, generate_tts |
| `general/` | Assistente FIAI | general | Haiku 4.5 | — |

Struttura di ogni agente:
```
server/agents/domains/{nome}/
  index.ts    → export default AgentConfig (name, domain, color, model, toolNames)
  prompt.md   → system prompt in markdown
```

**Tool generici** (tutti gli agenti): find, create, update, delete_record, relate, get_tree, render_view, create_job, get_jobs, execute_code

**Model fallback**: se il modello configurato (es. Mistral) ritorna 500/502/503, il sistema riprova automaticamente con Haiku.

**Skills da DB**: entity `type='skill'` possono sovrascrivere system prompt, modello e regole di qualsiasi agente a runtime.

## Ricerca: 3 Motori in `find`

Il tool `find` sceglie automaticamente il motore:
- **SQL** — filtri strutturali (type, tags, stato, name_id)
- **FTS5** — keyword match nel contenuto documenti (chunk_fts)
- **Semantic** — cosine similarity sugli embedding (1536 dim)

Routing automatico basato sui parametri e sul testo della query.

## Code Execution Sandbox

Tool `execute_code`: l'agente scrive JavaScript che chiama tool FIAI in loop. Eseguito in `vm` sandbox (niente require/fetch/fs). Solo l'output finale (print) torna nel contesto.

```javascript
// Esempio: l'agente genera questo codice
const fatture = await find({type: 'fattura', stato: 'scaduta'})
let totale = 0
for (const f of fatture) { totale += f.totale || 0 }
print(`${fatture.length} fatture scadute, totale: €${totale}`)
```

File: `server/agents/code-executor.ts`

## Documenti: Agentic RAG

Upload → estrai testo → AI classifica → chunk per template → FTS5 + embedding auto.

**9 template di chunking** (`server/chunker.ts`): legge_it (per Articolo), contratto (per Clausola), cv, libro_sacro (per Capitolo), narrativa, poesia, manuale, report, generico.

**Ricerca nei documenti**: tool `retrieve` → FTS5 su chunk_fts → reranker LLM → testo letterale con heading_path.

## Contesto a 8 Livelli

Ogni agente riceve (`server/agents/context.ts`):
1. Globale (KPI aziendali)
2. Skill (dati dominio specifico)
3. Profilo utente
4. Sessione (storico)
5. Preferenze (auto-apprese)
6. Steering rules (da feedback)
7. Memoria agente (lezioni per dominio)
8. Sistema (entity counts)

## Agenti Autonomi e Job Queue

- `server/agents/autonomous.ts` — entity `type='autonomous_agent'` con trigger cron/event
- `server/jobs.ts` — job queue su SQLite, polling ogni 5s, retry con backoff esponenziale
- `server/agents/events.ts` — event bus in-process (entity_created:*, etc.)
- `server/agents/workflows.ts` — workflow multi-step con dipendenze

## Sicurezza

- **Input**: `server/agents/safety.ts` — blocca prompt injection
- **Output**: maschera PII (email, telefono, CF, IBAN, carte) su WhatsApp
- **Retrieval**: filtra contenuti sensibili

## File Server Principali

```
server/
  index.ts              Express app, routes, startup
  db.ts                 SQLite connection (WAL)
  auth.ts               Login/signup su entity, JWT
  middleware.ts          JWT validation, azienda_id resolution
  ai.ts                 LLM calls: analyzeUpload, rerankChunks, judgeRetrieval
  embeddings.ts         Pipeline embedding + semanticSearch
  chunker.ts            9 template chunking
  upload.ts             Smart upload: AI classify + chunk + embed
  jobs.ts               Job queue SQLite + cron parser
  whatsapp.ts           Baileys + LID + media
  tts.ts                TTS streaming PCM + voice cloning
  documenti.ts          Deep search FTS5 + AI synthesis
  query.ts              Generic CRUD REST
  pdf.ts                PDF generation
  context.ts            8 livelli contesto + signal capture
  signals.ts            SSE per notifiche real-time
  files.ts              File management
  uploads-static.ts     Static file serving
  
  agents/
    orchestrator.ts     Cuore: classify → agent → safety → signal
    base-agent.ts       Tool loop nativo (10 iter, fallback model)
    config.ts           Importa domains/, loadSkillsFromDB()
    tools.ts            GENERIC_TOOLS array
    tool-registry.ts    30+ tool definitions + executors
    code-executor.ts    VM sandbox per batch operations
    types.ts            AgentConfig, AgentResult, ChatResponse, etc.
    context.ts          buildContext(), generatePlannerContext()
    safety.ts           checkInput(), checkOutput()
    autonomous.ts       Agenti background (cron/event)
    workflows.ts        Workflow multi-step
    events.ts           Event bus (on/emit)
    hooks.ts            Lifecycle hooks
    suggestions.ts      Suggerimenti contestuali
    planner.ts          Legacy (non usato, backward compat)
    index.ts            Router /api/chat/*
    
    domains/            1 cartella per agente (13 totali)
      {nome}/index.ts   AgentConfig export
      {nome}/prompt.md  System prompt in markdown

  migrations/
    init-sqlite.sql     Schema completo (entity, relations, FTS5, triggers)
    migrate-vfs.ts      Migrazione da 25 tabelle a entity unificata
```

## File Frontend Principali

```
src/
  App.tsx               Router + AuthGuard
  main.tsx              Entry point
  types/index.ts        Interfacce TypeScript

  components/
    layout/
      ChatLayout.tsx    Chat principale + upload modal + reasoning block
      Layout.tsx        Layout app con sidebar
      Sidebar.tsx       Navigazione
      Topbar.tsx        Header
    ChatToolRenderers.tsx  Card visive per risultati tool
    VoiceChat.tsx       Conversazione vocale bidirezionale
    dynamic/
      DynamicPanel.tsx  Viste dinamiche da LayoutDescriptor JSON
      ListView.tsx, KanbanView.tsx, ChartView.tsx, DetailView.tsx, FormView.tsx

  lib/
    anthropic.ts        Client API chat (sendMessage, createSession)
    upload.ts           Upload helpers
    supabase.ts         QueryBuilder → /api/query (legacy)

  store/
    authStore.ts        Auth state (Zustand)
    entityStore.ts      Entity CRUD
    namesStore.ts       Legacy wrapper
    ...                 1 store per dominio
```

## Come Aggiungere un Nuovo Agente

1. Crea cartella `server/agents/domains/{nome}/`
2. Crea `prompt.md` con personalita' e competenze
3. Crea `index.ts`:
```typescript
import fs from 'fs'
import path from 'path'
import { GENERIC_TOOLS } from '../../tools.js'
import type { AgentConfig } from '../../types.js'

const prompt = fs.readFileSync(path.join(import.meta.dirname, 'prompt.md'), 'utf-8')

const config: AgentConfig = {
  name: 'Nome Agente',
  domain: 'nome_dominio',
  color: '#HEXCOLOR',
  systemPrompt: prompt,
  toolNames: [...GENERIC_TOOLS],  // + tool specifici
}
export default config
```
4. Aggiungi import in `server/agents/config.ts`
5. Aggiungi dominio a `AgentDomain` in `server/agents/types.ts`
6. Aggiungi dominio a `VALID_DOMAINS` in `server/agents/orchestrator.ts`
7. Aggiungi descrizione dominio nel `CLASSIFICATION_PROMPT` in `orchestrator.ts`
8. Aggiungi colore in `AGENT_COLORS` in `config.ts`
9. Aggiungi suggerimenti in `server/agents/suggestions.ts`

## Come Aggiungere un Nuovo Tool

1. Aggiungi definizione in `TOOL_DEFINITIONS` (`server/agents/tool-registry.ts`):
```typescript
nome_tool: { type: 'function', function: {
  name: 'nome_tool',
  description: 'Cosa fa il tool',
  parameters: { type: 'object', properties: { ... }, required: [...] }
}}
```
2. Aggiungi executor nel `switch(name)` di `executeTool()` (stesso file)
3. Aggiungi il nome tool all'array `toolNames` degli agenti che devono usarlo (in `domains/{agente}/index.ts`)

## Come Modificare il Prompt di un Agente

Edita `server/agents/domains/{nome}/prompt.md`. Il file viene letto a startup dal `fs.readFileSync` in `index.ts`. Per applicare le modifiche in dev, riavvia il server (tsx watch ricarica automaticamente).

## Come Cambiare Modello LLM

- **Per un agente specifico**: aggiungi/modifica `model: 'provider/model-name'` in `domains/{nome}/index.ts`
- **Default globale**: modifica `AGENT_MODEL` in `server/agents/base-agent.ts` (default: `anthropic/claude-haiku-4.5`)
- **Classificatore**: modifica `CLASSIFIER_MODEL` in `server/agents/orchestrator.ts`
- **Da chat a runtime**: salva entity `type='skill'` con `metadata.model` per override da DB

## Convenzioni

- Lingua interfaccia: **Italiano**
- Font: **Inter** (tutto il frontend)
- Formato date: `DD/MM/YYYY`
- IDs: `crypto.randomUUID()`
- Slug: lowercase, diacritici rimossi, spazi→trattini
- ESM: tutto il server usa `import/export` (no require)
- Metadata: JSON snello — campi frequenti sono colonne entity (email, telefono, tags, body, piva, categoria)
- Embedding: Float32Array 1536 dim, salvato come BLOB
- FTS5: chunk_fts indicizza `body` e `display_name` dei chunk (trigger automatici)
- Test: nessun framework — test manuali via curl o test file tsx

## Variabili d'Ambiente

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | API key OpenRouter (obbligatoria) |
| `JWT_SECRET` | `fiai-dev-secret` | Secret per JWT token |
| `DB_PATH` | `/app/data/fiai.db` | Path database SQLite |
| `CONTEXT_DIR` | `/app/data/context` | Directory file contesto |
| `UPLOADS_DIR` | `/app/data/uploads` | Directory upload files |
| `PORT` | `3001` | Porta server Express |
| `EMBEDDING_MODEL` | `openai/text-embedding-3-small` | Modello embedding |
| `TTS_API_URL` | — | Endpoint TTS RunPod |
