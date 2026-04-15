# FIAI OS — Documento Tecnico

FIAI (Fabbrica Italiana Agenti Intelligenti) e' una piattaforma AI-native per gestionali aziendali. Agenti specializzati gestiscono l'operativita' tramite chat in linguaggio naturale. Architettura multi-istanza: un core condiviso, configurazione per cliente.

## Stack

```
Frontend:  React 19 + Vite + Tailwind + Zustand + Inter font
Backend:   Node.js + Express + TypeScript (ESM, tsx watch)
Database:  SQLite (better-sqlite3, WAL) + FTS5 + Vector Embeddings (sqlite-vec)
AI:        OpenRouter multi-model (Claude Haiku 4.5, Mistral Small, Gemini)
Embedding: text-embedding-3-small (1536 dim) via OpenRouter
TTS:       Qwen3-TTS 0.6B su RunPod (streaming PCM)
WhatsApp:  Baileys WebSocket
Email:     IMAP (imapflow) + SMTP (nodemailer)
Admin:     React 19 + Vite + Express (porta 3002)
Deploy:    Docker Compose parametrico + deploy.sh per server remoti
```

## Comandi

```bash
npm run dev          # Frontend Vite (porta 5173)
npm run server       # Backend tsx watch (porta 3001)
npm run dev:all      # Entrambi in parallelo

# Build
npm run build        # tsc -b && vite build

# Type check
npx tsc -p tsconfig.node.json --noEmit   # server
npx tsc -p tsconfig.app.json --noEmit    # frontend

# Docker
FIAI_INSTANCE=fiai docker compose up --build -d         # istanza FIAI
FIAI_INSTANCE=bernardini docker compose up --build -d   # istanza Bernardini
docker compose -f docker-compose.admin.yml up -d        # admin dashboard

# Deploy remoto
./deploy.sh bernardini                  # usa registry
./deploy.sh nuovo-cliente root@1.2.3.4  # SSH diretto

# Admin dashboard (dev)
cd admin && npm run dev:all             # porta 5174 + 3002

# Env richieste
OPENROUTER_API_KEY=...
JWT_SECRET=...
FIAI_INSTANCE=fiai              # seleziona istanza (default: fiai)
```

## Struttura Progetto

```
fiai-os/
├── server/                      Core backend (condiviso tra istanze)
│   ├── index.ts                 Express app, routes, migrations, startup
│   ├── instance-config.ts       Carica instances/{name}/config.yaml
│   ├── settings.ts              Config dinamica DB + env + response profiles
│   ├── agents/
│   │   ├── orchestrator.ts      Classify → route → agent loop → safety
│   │   ├── base-agent.ts        Tool loop (streaming, pruning, session stats)
│   │   ├── config.ts            Carica agenti da YAML o fallback hardcoded
│   │   ├── tool-registry.ts     40+ tool definitions + executors + plugin merge
│   │   ├── index.ts             Chat router + SSE streaming + session persistence
│   │   ├── code-executor.ts     VM sandbox per batch operations
│   │   ├── context.ts           8 livelli contesto
│   │   ├── safety.ts            Input/output check, PII masking
│   │   ├── types.ts             AgentConfig, UserPermissions, AgentResult
│   │   └── domains/             Agenti hardcoded (fallback se no config.yaml)
│   ├── plugins/
│   │   ├── types.ts             PluginDefinition interface
│   │   ├── loader.ts            Scopre e carica plugin dinamicamente
│   │   └── planning/            Plugin: 19 tool trasporti via VPN
│   ├── auth.ts                  Login, sessions CRUD, API tokens
│   ├── admin.ts                 Users, groups, settings, agents, response profiles
│   ├── middleware.ts            JWT + group-based permissions
│   ├── email.ts                 IMAP/SMTP + inbox monitoring
│   ├── whatsapp.ts              Baileys + auth flow + document upload
│   ├── openai-compat.ts         /v1/chat/completions (OpenAI standard)
│   ├── vpn.ts                   OpenVPN client control
│   ├── ocr.ts                   OCR via vision model
│   ├── upload.ts, chunker.ts    Document pipeline
│   ├── embeddings.ts            Embedding pipeline + semantic search
│   └── planning-proxy.ts        Bridge HTTP a planner FastAPI
│
├── src/                         Frontend React (chat-first)
│   ├── App.tsx                  2 route: login + chat
│   ├── components/
│   │   ├── layout/ChatLayout.tsx  Chat principale + sidebar + admin overlay
│   │   ├── ChatToolRenderers.tsx  Card visive per risultati tool
│   │   └── dynamic/              DynamicPanel, ListView, KanbanView, ChartView
│   ├── lib/
│   │   ├── anthropic.ts         SSE streaming client + session management
│   │   ├── supabase.ts          QueryBuilder → /api/query
│   │   └── upload.ts            Smart upload + fetch_document
│   ├── store/                   3 store: authStore, uiStore, entityStore
│   ├── pages/
│   │   ├── auth/Login.tsx
│   │   └── admin/Admin.tsx      Admin overlay (users, groups, settings, agents)
│   └── types/index.ts           UserProfile, Entity, Relation, Layout*, Chat*
│
├── instances/                   Configurazione per cliente
│   ├── fiai/
│   │   ├── config.yaml          15 agenti, branding rosso #C41E3A
│   │   └── agents/*.md          Prompt markdown per agente
│   └── bernardini/
│       ├── config.yaml          16 agenti, branding blu #1565C0, keyword custom
│       └── agents/*.md
│
├── admin/                       Admin Dashboard (app separata)
│   ├── server/index.ts          API: istanze, agenti, registry, health remoto
│   ├── src/                     React: login, istanze, agent editor
│   └── data/
│       └── instances-registry.yaml  Mappa istanze → server remoti
│
├── docker-compose.yml           Template parametrico (FIAI_INSTANCE=xxx)
├── docker-compose.admin.yml     Admin dashboard container
├── Dockerfile.backend/frontend/admin
├── deploy.sh                    Deploy su server remoto (rsync + SSH)
└── docs/                        Documentazione commerciale e tecnica
```

## Architettura Dati: Tutto e' Entity

Una sola tabella `entity` contiene tutto: persone, fatture, documenti, chunk, agenti autonomi.

```
entity:
  id, azienda_id, type, display_name, slug, stato
  email, telefono, tags (JSON), piva, categoria
  body (testo), embedding (BLOB Float32 1536 dim)
  parent_id, name_id, user_id, file_url, numero, data, totale
  metadata (JSON), path, ordine, deleted_at, created_at, updated_at

relations:
  from_id → to_id, tipo (membro_di, allegato_a, membro_di_gruppo...)
```

## Pipeline Agente

```
Messaggio → Safety IN → Mode detect (minimal/iteration/full)
  → Keyword scoring (istantaneo, pesato) o LLM classifier (Haiku)
  → Agent Loop (max 10 iter, streaming SSE, pruning >400K)
  → Safety OUT (PII masking su WhatsApp/email)
  → Signal capture + session save
```

## Agenti: Config-Based (YAML)

Gli agenti sono definiti in `instances/{nome}/config.yaml`:

```yaml
agents:
  - domain: commerciale
    name: "Marco — Commerciale"
    color: "#1976D2"
    model: "anthropic/claude-haiku-4.5"  # opzionale
    prompt: "agents/commerciale.md"       # path relativo
    tools: [generic, send_whatsapp_*, send_email]  # wildcard supportati
```

Prompt in file `.md` separati. Tool con wildcard: `generic`, `planning_*`, `send_whatsapp_*`.

Se non esiste `config.yaml`, il sistema usa gli agenti hardcoded in `server/agents/domains/`.

## Plugin System

I plugin vivono in `server/plugins/{nome}/`:

```typescript
// server/plugins/planning/index.ts
export default {
  name: 'planning',
  description: '...',
  tools: [{ name: 'planning_viaggi', description: '...', parameters: {...}, permission: 'read', execute: async (input, ctx) => {...} }],
  settings: [{ key: 'planning_api_url', ... }],
  startup: async () => { /* auto-connect VPN */ },
}
```

Caricati automaticamente all'avvio. I tool vengono mergiati nel tool-registry.

## Come Aggiungere un Nuovo Cliente

1. `mkdir -p instances/nuovo/agents`
2. Copia e personalizza `config.yaml` da un template (fiai/bernardini)
3. Scrivi i prompt `.md` per ogni agente
4. Crea `.env` con credenziali (OPENROUTER_API_KEY, JWT_SECRET)
5. Deploy: `FIAI_INSTANCE=nuovo docker compose up -d` (locale) o `./deploy.sh nuovo root@ip` (remoto)

## Come Aggiungere un Nuovo Agente a un Cliente

1. Aggiungi entry in `instances/{cliente}/config.yaml` sotto `agents:`
2. Crea il file prompt: `instances/{cliente}/agents/{dominio}.md`
3. Riavvia l'istanza per applicare

## Come Aggiungere un Nuovo Plugin

1. Crea `server/plugins/{nome}/index.ts` con PluginDefinition
2. I tool vengono caricati automaticamente all'avvio
3. Per abilitarlo in un'istanza: aggiungi `plugins: { nome: {} }` nel config.yaml

## Come Aggiungere un Nuovo Tool (nel core)

1. Aggiungi definizione in `TOOL_DEFINITIONS` (`server/agents/tool-registry.ts`)
2. Aggiungi executor nel `switch(name)` di `executeTool()`
3. Aggiungi il nome tool all'array `tools` degli agenti che devono usarlo (nel config.yaml)

## Convenzioni

- Lingua interfaccia: **Italiano**
- Font: **Inter**
- Formato date: `DD/MM/YYYY`
- IDs: `crypto.randomUUID()`
- ESM: tutto il server usa `import/export`
- Embedding: Float32Array 1536 dim, BLOB in SQLite
- FTS5: chunk_fts su body + display_name dei chunk
- Test: nessun framework — test manuali

## Multi-Canale

| Canale | Protocollo | Note |
|--------|-----------|------|
| Web chat | SSE streaming | Chat principale, sidebar dinamica |
| WhatsApp | Baileys WebSocket | Auth con scadenza, PII masking |
| Email | IMAP + SMTP | Inbox monitoring, threading |
| API OpenAI | `/v1/chat/completions` | Per device IoT, app mobile, robot |
| Voce | TTS streaming | Qwen3-TTS self-hosted |

## Variabili d'Ambiente

| Variabile | Default | Descrizione |
|-----------|---------|-------------|
| `FIAI_INSTANCE` | `fiai` | Seleziona l'istanza da caricare |
| `OPENROUTER_API_KEY` | — | API key OpenRouter |
| `JWT_SECRET` | `fiai-dev-secret` | Secret JWT |
| `DB_PATH` | `/app/data/fiai.db` | Path database SQLite |
| `NODE_OPTIONS` | `--max-old-space-size=8192` | Heap limit Node.js |
