# FIAI OS

**Fabbrica Italiana Agenti Intelligenti** — Piattaforma AI-native per gestionali aziendali multi-istanza.

Un sistema in cui l'interazione con i dati aziendali avviene tramite agenti AI specializzati per reparto, ciascuno con competenze, strumenti e accesso ai dati calibrato sul proprio dominio.

## Stack Tecnologico

| Layer | Tecnologie |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS, Zustand |
| **Backend** | Node.js, Express, TypeScript (ESM, tsx watch) |
| **Database** | SQLite (better-sqlite3, WAL) + FTS5 + Vector Embeddings (sqlite-vec) |
| **AI** | OpenRouter multi-model (Claude Haiku 4.5, Mistral Small, Gemini) |
| **Embedding** | text-embedding-3-small (1536 dim) |
| **TTS** | Qwen3-TTS 0.6B self-hosted (streaming PCM) |
| **WhatsApp** | Baileys WebSocket |
| **Email** | IMAP (imapflow) + SMTP (nodemailer) |
| **Deploy** | Docker Compose parametrico + deploy.sh |

## Quick Start

### Sviluppo locale

```bash
# Installa dipendenze
npm install

# Avvia frontend + backend in parallelo
npm run dev:all

# Oppure separatamente:
npm run dev          # Frontend Vite (porta 5173)
npm run server       # Backend tsx watch (porta 3001)
```

### Docker (produzione)

```bash
# Istanza FIAI
cd instances/fiai
docker compose up --build -d

# Istanza Bernardini
cd instances/bernardini
docker compose up --build -d
```

### Variabili d'Ambiente

Crea `instances/{nome}/.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-...
JWT_SECRET=your-secret-key
EMAIL_USER=...
EMAIL_PASSWORD=...
EMAIL_IMAP_HOST=imaps.aruba.it
EMAIL_SMTP_HOST=smtps.aruba.it
TTS_API_URL=http://host.docker.internal:7777/v1/audio/speech
```

## Architettura

```
                    ┌──────────────────────────────────┐
                    │          PLATFORM ADMIN           │
                    │         os.insightg.eu            │
                    └──────────┬──────────┬─────────────┘
                               │          │
                    ┌──────────▼──┐  ┌────▼──────────┐
                    │ ISTANZA A   │  │  ISTANZA B    │  ...N
                    │ 15 agenti   │  │  16 agenti    │
                    │ config.yaml │  │  + VPN plugin │
                    └─────────────┘  └───────────────┘
```

### Tutto e' Entity

Un unico modello dati (tabella `entity`) contiene tutto: persone, fatture, documenti, chunk, agenti autonomi. Le relazioni tra entita' sono nella tabella `relations`.

### Pipeline Agente

```
Messaggio → Safety IN → Mode detect → Keyword scoring / LLM classifier
  → Agent Loop (max 10 iter, streaming SSE, pruning >400K)
  → Safety OUT (PII masking) → Signal capture + session save
```

### Plugin System

Plugin in `server/plugins/{nome}/` con interfaccia `PluginDefinition`:
- **planning**: 26 tool trasporti (autisti, GPS, ottimizzazione) via VPN
- **light_planner**: accesso SQL diretto a database remoti (sperimentale)

## Struttura Progetto

```
fiai-os/
├── server/                      Core backend condiviso
│   ├── index.ts                 Express app, routes, migrations
│   ├── instance-config.ts       Carica instances/{name}/config.yaml
│   ├── agents/                  Orchestrazione AI
│   │   ├── orchestrator.ts      Classify → route → agent loop
│   │   ├── base-agent.ts        Tool loop, streaming, pruning
│   │   ├── config.ts            Agenti da YAML + hot reload
│   │   ├── tool-registry.ts     52 tool core + plugin merge
│   │   └── code-executor.ts     VM sandbox per operazioni batch
│   ├── plugins/                 Plugin system
│   │   ├── types.ts             PluginDefinition interface
│   │   ├── loader.ts            Discovery + caricamento dinamico
│   │   └── planning/            Plugin trasporti (26 tool)
│   ├── auth.ts                  Login, sessions, API tokens
│   ├── email.ts                 IMAP/SMTP + inbox monitoring
│   ├── whatsapp.ts              Baileys + document upload
│   ├── embeddings.ts            Embedding pipeline + semantic search
│   ├── chunker.ts               Document chunking (smart + fallback)
│   └── openai-compat.ts         /v1/chat/completions (OpenAI standard)
│
├── src/                         Frontend React
│   ├── components/
│   │   ├── layout/ChatLayout.tsx  Chat + sidebar + app views
│   │   ├── ChatToolRenderers.tsx  Card visive risultati tool
│   │   └── dynamic/              DynamicPanel, Map, List, Chart, Docs
│   ├── lib/
│   │   ├── anthropic.ts         SSE streaming client
│   │   └── branding.ts          Branding dinamico da config
│   └── store/                   Zustand: auth, ui, entity
│
├── instances/                   Configurazione per cliente
│   ├── fiai/                    15 agenti, branding rosso
│   └── bernardini/              16 agenti, branding blu, planning
│
├── admin/                       Admin Dashboard (app separata)
│   ├── server/                  API: istanze, proxy, registry
│   └── src/                     React: gestione centralizzata
│
├── docs/                        Documentazione
│   ├── FIAI-OS-Architettura.md
│   ├── FIAI-OS-Documento-Tecnico.md
│   └── FIAI-OS-Presentazione-Commerciale.md
│
├── Dockerfile.backend           Container backend Node.js
├── Dockerfile.frontend          Container frontend Nginx
├── docker-compose.template.yml  Template parametrico
└── deploy.sh                    Deploy su server remoto
```

## Multi-Canale

| Canale | Protocollo | Note |
|--------|-----------|------|
| Web chat | SSE streaming | Interfaccia principale con sidebar dinamica |
| WhatsApp | Baileys WebSocket | Auth QR code, PII masking automatico |
| Email | IMAP + SMTP | Inbox monitoring, threading |
| API OpenAI | `/v1/chat/completions` | Per IoT, app mobile, robot |
| Voce | TTS streaming | Qwen3-TTS self-hosted |

## Aggiungere un Nuovo Cliente

1. `mkdir -p instances/nuovo/agents`
2. Crea `config.yaml` (copia da template fiai/bernardini)
3. Scrivi i prompt `.md` per ogni agente
4. Crea `.env` con credenziali
5. Deploy: `cd instances/nuovo && docker compose up --build -d`

## Aggiungere un Nuovo Agente

1. Aggiungi entry in `instances/{cliente}/config.yaml` sotto `agents:`
2. Crea file prompt: `instances/{cliente}/agents/{dominio}.md`
3. Riavvia l'istanza (o usa hot reload da admin)

## Aggiungere un Nuovo Plugin

1. Crea `server/plugins/{nome}/index.ts` con `PluginDefinition`
2. Tool caricati automaticamente all'avvio
3. Abilita in istanza: `plugins: { nome: {} }` nel config.yaml

## Documentazione

- [Architettura di Sistema](docs/FIAI-OS-Architettura.md) — diagrammi, flussi, struttura completa
- [Documento Tecnico](docs/FIAI-OS-Documento-Tecnico.md) — AI, ricerca semantica, sicurezza
- [Presentazione](docs/FIAI-OS-Presentazione-Commerciale.md) — overview commerciale

## Convenzioni

- Lingua interfaccia: **Italiano**
- Font: **Inter**
- Formato date: `DD/MM/YYYY`
- IDs: `crypto.randomUUID()`
- ESM: tutto il server usa `import/export`
- Embedding: Float32Array 1536 dim, BLOB in SQLite

## Licenza

Proprietary — InsightG S.r.l.
