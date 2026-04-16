# FIAI OS — Architettura di Sistema

## Vista d'Insieme

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PLATFORM ADMIN                                │
│                     os.insightg.eu:3002                               │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │  React GUI: Istanze · Agenti · Utenti · Gruppi · Settings    │   │
│  │             VPN · Token API · YAML Editor · Wizard            │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │  Express API: Proxy trasparente verso istanze                 │   │
│  │  Auth: JWT admin · Registry YAML · File management            │   │
│  └──────────────┬──────────────────────────┬─────────────────────┘   │
│                 │ proxy                     │ proxy                   │
└─────────────────┼──────────────────────────┼─────────────────────────┘
                  │                          │
      ┌───────────▼──────────┐   ┌───────────▼──────────┐
      │   ISTANZA FIAI       │   │  ISTANZA BERNARDINI  │   ···  N istanze
      │ fiai.insightg.eu     │   │ bernardini.insightg.eu│
      │ 14 agenti · rosso    │   │ 16 agenti · blu      │
      │ No VPN · No planning │   │ VPN · Planning plugin │
      └──────────────────────┘   └──────────────────────┘
```

## Struttura Repository (Monorepo)

```
fiai-os/
│
├── server/                          CORE BACKEND (condiviso)
│   ├── index.ts                     Express app, startup, migrations
│   ├── instance-config.ts           Carica config.yaml per istanza
│   ├── settings.ts                  Config dinamica DB + env
│   │
│   ├── agents/                      ORCHESTRAZIONE AI
│   │   ├── orchestrator.ts          Pipeline: classify → route → execute
│   │   ├── base-agent.ts            Agent loop: streaming, pruning, stats
│   │   ├── config.ts                Carica agenti da YAML (hot reload)
│   │   ├── tool-registry.ts         52 tool core + plugin merge
│   │   ├── code-executor.ts         Sandbox VM (tutti i tool disponibili)
│   │   ├── context.ts               8 livelli contesto
│   │   ├── safety.ts                Input/output security
│   │   └── domains/                 Agenti hardcoded (fallback)
│   │
│   ├── plugins/                     PLUGIN SYSTEM
│   │   ├── types.ts                 PluginDefinition interface
│   │   ├── loader.ts                Discovery + caricamento dinamico
│   │   └── planning/                Plugin: 19 tool trasporti
│   │       ├── index.ts             Tool definitions + executors
│   │       └── proxy.ts             Bridge HTTP verso planner via VPN
│   │
│   ├── auth.ts                      Login, sessions, API tokens
│   ├── admin.ts                     Users, groups, settings, reload
│   ├── middleware.ts                JWT + group permissions + platform bypass
│   ├── openai-compat.ts             /v1/chat/completions (standard OpenAI)
│   ├── whatsapp.ts                  Baileys + auth flow + upload
│   ├── email.ts                     IMAP/SMTP + inbox monitoring
│   ├── vpn.ts                       OpenVPN client (per-instance)
│   ├── upload.ts + chunker.ts       Document pipeline
│   ├── embeddings.ts                Vector search (1536 dim)
│   ├── ocr.ts                       Vision model OCR
│   └── tts.ts                       Text-to-Speech streaming
│
├── src/                             FRONTEND REACT (condiviso)
│   ├── App.tsx                      2 route: login + chat
│   ├── lib/branding.ts              Colori/nome dinamici da /api/branding
│   ├── lib/anthropic.ts             SSE streaming client
│   ├── components/
│   │   └── layout/ChatLayout.tsx    Chat-first UI + sidebar
│   └── store/                       3 store: auth, ui, entity
│
├── instances/                       CONFIGURAZIONE PER CLIENTE
│   ├── fiai/
│   │   ├── config.yaml              14 agenti, plugins: {}
│   │   ├── agents/*.md              Prompt per agente
│   │   ├── docker-compose.yml       Container fiai-backend/frontend
│   │   └── .env                     Credenziali (gitignored)
│   └── bernardini/
│       ├── config.yaml              16 agenti, plugins: { planning }
│       ├── agents/*.md              Prompt per agente
│       ├── vpn/                     Credenziali VPN (gitignored)
│       ├── docker-compose.yml       Container bernardini-backend/frontend
│       └── .env
│
├── admin/                           ADMIN DASHBOARD
│   ├── server/index.ts              API + proxy + VPN mgmt + registry
│   ├── src/                         React: Instances, Agents, Wizard
│   └── data/instances-registry.yaml Mappa istanze → server
│
├── docs/                            Documentazione
├── Dockerfile.backend               Node 20 + openvpn + poppler
├── Dockerfile.frontend              Vite build + nginx (BACKEND_HOST parametrico)
├── Dockerfile.admin                 Admin: Vite build + Express
├── docker-compose.admin.yml         Container admin su npm-network
└── deploy.sh                        Deploy remoto (rsync + SSH)
```

## Pipeline Messaggio

```
                    UTENTE
                      │
          ┌───────────┼───────────┐
          │           │           │
        Web Chat   WhatsApp    API /v1
        (SSE)      (Baileys)   (OpenAI)
          │           │           │
          └───────────┼───────────┘
                      │
                      ▼
              ┌───────────────┐
              │  SAFETY IN    │  Blocco prompt injection
              └───────┬───────┘
                      │
              ┌───────▼───────┐
              │  MODE DETECT  │  minimal · iteration · full
              └───────┬───────┘
                      │
              ┌───────▼──────────────┐
              │  KEYWORD SCORING     │  25+ gruppi pesati (0ms)
              │  Se confident (≥4)   │──── routing diretto
              │  Se no               │
              └───────┬──────────────┘
                      │ fallback
              ┌───────▼───────┐
              │  LLM CLASSIFY │  Haiku, <100ms, JSON
              └───────┬───────┘
                      │
              ┌───────▼───────────────────────────┐
              │         AGENT LOOP (max 10 iter)   │
              │                                     │
              │  System Prompt ({COMPANY_NAME})     │
              │  + 8 livelli contesto               │
              │  + Response profile (voice/brief/…) │
              │  + Tool definitions                 │
              │                                     │
              │  LLM decide:                        │
              │  ├── tool_call → executeTool()      │
              │  │   ├── plugin executor (priorità) │
              │  │   └── core executor (fallback)   │
              │  │   → risultato → continua loop    │
              │  └── testo → fine                   │
              │                                     │
              │  Streaming: token emessi via SSE    │
              │  Pruning: >400K char → rimuovi old  │
              │  Session stats: token tracking      │
              └───────┬───────────────────────────┘
                      │
              ┌───────▼───────┐
              │  SAFETY OUT   │  PII masking (WhatsApp/email)
              └───────┬───────┘
                      │
              ┌───────▼───────┐
              │  SIGNAL       │  Log: dominio, costo, latenza
              └───────┬───────┘
                      │
                      ▼
                   RISPOSTA
```

## Architettura Dati

```
┌─────────────────────────────────────────────────────────┐
│                    SQLite (WAL mode)                      │
│                                                           │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │       entity          │  │      relations           │  │
│  │                       │  │                          │  │
│  │  id                   │  │  from_id ──→ entity.id   │  │
│  │  azienda_id           │  │  to_id   ──→ entity.id   │  │
│  │  type (utente,        │  │  tipo (membro_di,        │  │
│  │    fattura, documento, │  │    allegato_a,           │  │
│  │    chunk, job, ...)   │  │    membro_di_gruppo, ...) │  │
│  │  display_name         │  └──────────────────────────┘  │
│  │  stato                │                                │
│  │  totale, data, numero │  ┌──────────────────────────┐  │
│  │  body (testo)         │  │    chunk_fts (FTS5)      │  │
│  │  embedding (BLOB      │  │    body + display_name   │  │
│  │    Float32 1536 dim)  │  │    → keyword search      │  │
│  │  metadata (JSON)      │  └──────────────────────────┘  │
│  │  tags (JSON array)    │                                │
│  │  deleted_at           │  ┌──────────────────────────┐  │
│  └──────────────────────┘  │  chunk_vec (vec0)         │  │
│                             │  chunk_id + embedding     │  │
│                             │  → cosine similarity      │  │
│                             └──────────────────────────┘  │
│                                                           │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │   chat_sessions      │  │   chat_messages          │  │
│  │   id, user_id,       │  │   session_id, ruolo,     │  │
│  │   titolo, channel,   │  │   contenuto, tool_calls, │  │
│  │   agent_domain       │  │   agent_domain/name      │  │
│  └──────────────────────┘  └──────────────────────────┘  │
│                                                           │
│  ┌──────────────────────┐                                 │
│  │   api_tokens          │  JWT hash, scadenza, revoca   │
│  └──────────────────────┘                                 │
└─────────────────────────────────────────────────────────┘
```

## Ricerca a 3 Motori

```
                   Query utente
                       │
            ┌──────────┼──────────┐
            │          │          │
        type/tags   testo      significato
        stato/data  keyword    concettuale
            │          │          │
            ▼          ▼          ▼
       ┌────────┐ ┌────────┐ ┌──────────┐
       │  SQL   │ │  FTS5  │ │ Vec0     │
       │        │ │        │ │ (1536d)  │
       │ WHERE  │ │ MATCH  │ │ cosine   │
       │ type=  │ │ body   │ │ sim.     │
       │ stato= │ │        │ │          │
       └────┬───┘ └────┬───┘ └────┬─────┘
            │          │          │
            └──────────┼──────────┘
                       │
                   Risultati
                   ordinati
```

## Multi-Canale

```
┌────────────────────────────────────────────────────────────────┐
│                     FIAI OS CORE                                │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              ORCHESTRATORE + AGENTI + TOOL               │   │
│  └─────┬────────┬─────────┬──────────┬──────────┬──────────┘   │
│        │        │         │          │          │               │
│   ┌────▼───┐┌───▼────┐┌───▼───┐┌────▼────┐┌───▼────┐          │
│   │  Web   ││WhatsApp││ Email ││  API    ││  TTS   │          │
│   │  Chat  ││Baileys ││IMAP/  ││ /v1    ││Qwen3  │          │
│   │  SSE   ││WebSock ││SMTP   ││OpenAI  ││Stream │          │
│   └────┬───┘└───┬────┘└───┬───┘└────┬────┘└───┬────┘          │
│        │        │         │          │          │               │
└────────┼────────┼─────────┼──────────┼──────────┼───────────────┘
         │        │         │          │          │
         ▼        ▼         ▼          ▼          ▼
      Browser  Telefono   Casella    ESP32     Altoparlante
      Desktop  WhatsApp   Email     Robot     Smart
      Mobile              Aruba    Raspberry   Speaker
```

## Plugin System

```
┌─────────────────────────────────────────────┐
│            PLUGIN LOADER                     │
│                                               │
│  Startup: scansiona server/plugins/           │
│  Per ogni cartella con index.ts:              │
│  1. Import dinamico                           │
│  2. Registra tools in TOOL_DEFINITIONS        │
│  3. Registra permissions in TOOL_ACTIONS      │
│  4. Monta Express routes (/api/plugins/*)     │
│  5. Chiama startup() hook                     │
│                                               │
│  ┌─────────────────────────────────────────┐ │
│  │  Plugin Definition                       │ │
│  │                                          │ │
│  │  name: string                            │ │
│  │  description: string                     │ │
│  │  tools: [{                               │ │
│  │    name, description, parameters,        │ │
│  │    permission, execute(input, ctx)       │ │
│  │  }]                                      │ │
│  │  settings?: [{ key, envVar, default }]  │ │
│  │  router?: Express.Router                 │ │
│  │  startup?: () => Promise<void>          │ │
│  │  shutdown?: () => Promise<void>         │ │
│  └─────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘

Plugins attivi:
┌────────────────────────────────────┐
│  planning/                          │
│  19 tool: viaggi, autisti, GPS,     │
│  ETA, ottimizzazione, scenari       │
│  Proxy HTTP → planner via VPN       │
└────────────────────────────────────┘
```

## Instance Config System

```
┌──────────────────────────────────────────────────────┐
│  instances/{cliente}/config.yaml                      │
│                                                        │
│  company:                                              │
│    name: "BERNARDINI S.R.L."                           │
│    color: "#1565C0"                 → CSS var runtime  │
│                                                        │
│  agents:                                               │
│    - domain: direzione                                 │
│      name: "Direzione"                                 │
│      prompt: "agents/direzione.md"  → file markdown   │
│      tools: [generic, send_whatsapp_*]  → wildcard    │
│      model: "anthropic/claude-haiku-4.5"  → opzionale │
│                                                        │
│  plugins:                                              │
│    planning:                                           │
│      api_url: "http://192.168.0.14:8602"              │
│                                                        │
│  classifier:                                           │
│    keywords:           → override keyword scoring      │
│      direzione:                                        │
│        - words: [overview, kpi]                        │
│          weight: 3                                     │
└──────────────────────────────────────────────────────┘
         │
         │ loadInstanceConfig()
         ▼
┌──────────────────────────────────────────────────────┐
│  RUNTIME                                              │
│                                                        │
│  AGENTS = buildAgentsFromConfig()  ← da YAML          │
│  AGENT_COLORS = da agents[].color  ← da YAML          │
│  DOMAIN_KEYWORDS += classifier     ← merge            │
│  VALID_DOMAINS = agents[].domain   ← dinamici         │
│                                                        │
│  reloadAgents() ← hot reload senza restart            │
│  /api/admin/reload-config                              │
└──────────────────────────────────────────────────────┘
```

## Docker Deploy

```
┌─────────────────────────────────────────────────────────────┐
│  SERVER (1 per cliente o condiviso)                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  npm-network (Docker bridge)                             │ │
│  │                                                          │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ fiai-backend  │  │ bernardini-  │  │  fiai-admin   │  │ │
│  │  │   :3001       │  │ backend:3001 │  │   :3002      │  │ │
│  │  │              │  │              │  │              │  │ │
│  │  │ FIAI_INSTANCE │  │ FIAI_INSTANCE │  │ Proxy verso  │  │ │
│  │  │ =fiai         │  │ =bernardini  │  │ tutte le     │  │ │
│  │  │              │  │              │  │ istanze      │  │ │
│  │  │ Vol: fiai-data│  │ Vol: bern-   │  │              │  │ │
│  │  │              │  │     data     │  │ Vol: admin-  │  │ │
│  │  │ No VPN       │  │ VPN: tun0    │  │     data     │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  │ │
│  │                                                          │ │
│  │  ┌──────────────┐  ┌──────────────┐                     │ │
│  │  │ fiai-frontend │  │ bernardini-  │                     │ │
│  │  │ nginx:3000   │  │ frontend     │                     │ │
│  │  │ BACKEND_HOST │  │ nginx:3000   │                     │ │
│  │  │ =fiai-backend│  │ BACKEND_HOST │                     │ │
│  │  │              │  │ =bernardini- │                     │ │
│  │  │              │  │  backend     │                     │ │
│  │  └──────────────┘  └──────────────┘                     │ │
│  │                                                          │ │
│  │  ┌──────────────────────────────────────────────────┐   │ │
│  │  │  Nginx Proxy Manager (NPM)                        │   │ │
│  │  │  :80/:443                                         │   │ │
│  │  │                                                   │   │ │
│  │  │  fiai.insightg.eu     → fiai-frontend:3000        │   │ │
│  │  │  bernardini.insightg.eu → bernardini-frontend:3000│   │ │
│  │  │  os.insightg.eu       → fiai-admin:3002           │   │ │
│  │  └──────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Sicurezza Multi-Livello

```
Livello 1: INPUT SAFETY
  └─ Blocco prompt injection, pattern malevoli

Livello 2: DATI MINIMI ALL'LLM
  └─ Context ≤8000 char, history 4 msg × 2000 char, pruning >400K

Livello 3: OUTPUT SAFETY
  └─ PII masking su WhatsApp/email (email, telefono, CF, IBAN, carte)

Livello 4: PERMESSI GRANULARI
  └─ Gruppi × tipi entity × azioni + permessi per agente

Livello 5: CODE SANDBOX
  └─ VM isolata: no fs, no rete, no process — solo tool FIAI

Livello 6: PLATFORM TOKEN
  └─ JWT con claim platform:true per admin cross-istanza
```
