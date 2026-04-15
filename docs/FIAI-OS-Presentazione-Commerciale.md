# FIAI OS — Gestionale AI-Native

**Fabbrica Italiana Agenti Intelligenti**

*La piattaforma che trasforma il gestionale aziendale in un team di agenti intelligenti specializzati.*

---

## Executive Summary

FIAI OS e' un sistema gestionale di nuova generazione in cui l'interazione con i dati aziendali avviene interamente tramite linguaggio naturale. Invece di navigare menu, compilare form e consultare dashboard statiche, l'utente parla con agenti AI specializzati per reparto — ciascuno con competenze, strumenti e accesso ai dati calibrato sul proprio dominio.

Il sistema non e' un chatbot aggiunto a un gestionale esistente. E' un gestionale **costruito intorno all'AI**: ogni operazione — dalla ricerca di un cliente alla generazione di un report, dall'invio di un messaggio WhatsApp all'analisi di un contratto — passa attraverso agenti che ragionano, cercano, agiscono e rispondono.

---

## Vantaggi Tecnologici

### 1. Un'interfaccia, tutte le operazioni

L'utente non deve imparare un software. Scrive o parla in italiano e il sistema capisce cosa serve, instrada la richiesta all'agente giusto, esegue le operazioni necessarie e restituisce il risultato. La curva di apprendimento e' praticamente zero.

### 2. Agenti specializzati, non un modello generico

Ogni agente ha un prompt di sistema calibrato sul reparto, conosce la terminologia di settore, sa quali dati cercare e come presentarli. Un agente commerciale ragiona diversamente da un agente di produzione — esattamente come un collaboratore umano specializzato.

### 3. Dati aziendali sempre aggiornati

Gli agenti non rispondono con conoscenze generiche. Prima di ogni risposta, interrogano il database aziendale tramite strumenti strutturati (ricerca SQL, full-text, semantica). Le risposte sono basate sui dati reali dell'azienda, non su allucinazioni del modello.

### 4. Multi-canale nativo

La stessa intelligenza e' accessibile da:
- **Chat web** (interfaccia principale)
- **WhatsApp** (per comunicazioni esterne e notifiche)
- **Email** (lettura, risposta, invio automatico)
- **API OpenAI-compatibile** (per dispositivi IoT, assistenti vocali, integrazioni custom)
- **Voce** (conversazione bidirezionale con TTS)

### 5. Documenti intelligenti

I documenti caricati (contratti, manuali, normative, datasheet) vengono analizzati dall'AI, classificati automaticamente, suddivisi in sezioni semantiche e indicizzati con embedding vettoriali. L'agente documentale puo' poi cercare al loro interno, citare passaggi specifici e confrontare documenti diversi.

### 6. Automazione senza codice

Gli agenti autonomi eseguono operazioni ricorrenti in background: controllo scadenze, generazione report periodici, monitoraggio KPI, notifiche automatiche. Si configurano in linguaggio naturale, senza programmare.

---

## Architettura

### Stack Tecnologico

| Livello | Tecnologia | Perche' |
|---------|-----------|---------|
| **Frontend** | React 19 + Vite + Tailwind | Interfaccia reattiva, rendering streaming in tempo reale |
| **Backend** | Node.js + Express + TypeScript | Architettura event-driven, streaming SSE nativo |
| **Database** | SQLite (WAL) + FTS5 + Vec0 | Zero configurazione, ricerca full-text + vettoriale integrata |
| **AI** | OpenRouter (multi-model) | Accesso a Claude, Mistral, Gemini — fallback automatico |
| **Embedding** | text-embedding-3-small (1536 dim) | Ricerca semantica ad alta precisione |
| **Deploy** | Docker Compose + Nginx | Deploy in minuti, aggiornamenti senza downtime |

### Modello Dati Unificato

Tutto e' una **Entity**: persone, fatture, documenti, progetti, agenti, job. Un'unica tabella con campi flessibili e metadati JSON. Questo elimina la complessita' di decine di tabelle separate e permette query trasversali immediate.

```
Entity: id, tipo, nome, stato, email, telefono, tags, body, embedding, metadata
Relations: da → a, tipo_relazione (membro_di, allegato_a, ordine_da_preventivo...)
```

Ogni entity puo' avere embedding vettoriali per ricerca semantica, body testuale per ricerca full-text, e metadati strutturati per query SQL.

---

## Pipeline di Orchestrazione

Quando un utente invia un messaggio, il sistema esegue una pipeline a 7 fasi:

```
Messaggio utente
  │
  ├─ 1. SAFETY IN ─── Blocco prompt injection e richieste malevole
  │
  ├─ 2. MODE DETECT ── Minimal (saluti) | Iteration (follow-up) | Full (nuova richiesta)
  │
  ├─ 3. CLASSIFY ───── Scoring keyword pesato (istantaneo, 25+ gruppi di parole)
  │                     Se incerto → LLM classifier (Haiku, <100ms)
  │                     Session continuity: mantiene il dominio in conversazione
  │
  ├─ 4. AGENT LOOP ─── L'agente chiama tool in autonomia (max 10 iterazioni)
  │     │               Streaming: token emessi in tempo reale
  │     │               Pruning: rimuove tool exchange vecchi se >400K char
  │     │               Fallback: se il modello principale fallisce, usa Haiku
  │     │
  │     ├── find (SQL/FTS5/Semantic)
  │     ├── create / update / delete
  │     ├── execute_code (sandbox JavaScript per batch)
  │     ├── retrieve (RAG sui documenti)
  │     ├── web_search (ricerca web via Perplexity)
  │     ├── send_whatsapp / send_email
  │     ├── generate_image / generate_pdf
  │     ├── planning_* (19 tool per logistica)
  │     └── ... 40+ tool disponibili
  │
  ├─ 5. SAFETY OUT ─── Mascheramento PII su canali esterni (WhatsApp)
  │
  ├─ 6. SIGNAL ─────── Log strutturato: dominio, latenza, costo, tool usati
  │
  └─ 7. SUGGEST ────── Suggerimenti contestuali per il prossimo passo
```

### Multi-Agent

Richieste che toccano piu' reparti vengono eseguite in parallelo da agenti diversi, poi sintetizzate in un'unica risposta coerente.

*Esempio: "Fatturato dei clienti con progetti attivi" → Agente Amministrazione (fatture) + Agente Commerciale (clienti) + Agente Produzione (progetti) → Sintesi unificata.*

### Streaming in Tempo Reale

Le risposte appaiono token per token nella chat, esattamente come ChatGPT. L'utente vede l'agente "pensare" e puo' interrompere se la direzione e' sbagliata. I risultati dei tool (tabelle, card, grafici) appaiono progressivamente durante l'elaborazione.

---

## I Tool — Le Capacita' Operative

Ogni agente ha accesso a un set di strumenti che esegue autonomamente. L'agente decide quali usare, in che ordine, e reagisce ai risultati.

### Tool Generici (tutti gli agenti)

| Tool | Funzione |
|------|----------|
| `find` | Ricerca intelligente: SQL per filtri strutturali, FTS5 per testo, Semantic per significato |
| `create` | Crea qualsiasi entity (cliente, fattura, progetto, lead...) |
| `update` | Modifica entity esistenti |
| `delete_record` | Eliminazione con conferma |
| `relate` | Crea relazioni tra entity (fattura → cliente, progetto → team) |
| `get_tree` | Visualizza albero relazioni di un'entity |
| `render_view` | Genera viste dinamiche (tabelle, kanban, grafici) |
| `execute_code` | Sandbox JavaScript per operazioni batch complesse |
| `web_search` | Ricerca informazioni sul web |
| `create_job` | Avvia operazioni in background |

### Tool Specializzati

| Dominio | Tool | Funzione |
|---------|------|----------|
| **Documenti** | `retrieve` | Ricerca semantica nei documenti indicizzati |
| | `list_documents` | Lista documenti con filtri |
| | `explore_document` | Navigazione struttura documento |
| | `fetch_document` | Scarica e indicizza documenti da URL web |
| | `generate_pdf` | Genera PDF da contenuto testuale |
| **Comunicazione** | `send_whatsapp_message` | Invio messaggi WhatsApp |
| | `send_whatsapp_voice` | Messaggi vocali (TTS) |
| | `send_whatsapp_document` | Invio documenti via WhatsApp |
| | `send_email` / `reply_email` | Email con HTML e allegati |
| | `read_inbox` / `search_emails` | Lettura e ricerca email |
| **Marketing** | `generate_image` | Generazione immagini AI (Gemini) |
| **Pianificazione** | `planning_viaggi` | Lista viaggi per data |
| | `planning_suggerisci` | Ottimizzazione automatica assegnazioni |
| | `planning_gps` | Tracking GPS in tempo reale |
| | `planning_eta` | Calcolo ETA autisti in viaggio |
| | *+ 15 altri tool* | Statistiche, scenari, conflitti, storico |
| **Voce** | `generate_tts` | Sintesi vocale multi-voce |
| | `clone_voice` | Clonazione vocale personalizzata |
| **Sistema** | `create_autonomous_agent` | Crea agenti che lavorano in background |
| | `create_workflow` | Workflow multi-step con dipendenze |

### Code Execution Sandbox

Per operazioni complesse (aggregazioni su centinaia di record, batch update, report elaborati), l'agente scrive ed esegue codice JavaScript in una sandbox sicura. Il codice ha accesso a tutti i tool FIAI come funzioni async, ma non puo' accedere al filesystem o alla rete.

*Esempio: L'agente scrive uno script che cerca tutte le fatture scadute, calcola il totale per cliente, identifica i top 5 morosi e prepara un messaggio WhatsApp personalizzato per ciascuno — tutto in una singola operazione.*

---

## Gli Agenti — Il Team AI

### Agenti di Business

| Agente | Dominio | Specializzazione |
|--------|---------|-----------------|
| **Pulse** | Overview | KPI aziendali, briefing giornaliero, stato generale |
| **Marco** | Commerciale | Clienti, lead, pipeline, preventivi, ordini |
| **Luca** | Produzione | Progetti, milestone, avanzamento, delivery |
| **Giulia** | Marketing | Campagne, contenuti, generazione immagini AI |
| **Sofia** | Amministrazione | Fatture, conti, scadenze fiscali, cash flow |
| **Elena** | HR | Recruiting, candidati, costo aziendale, onboarding |
| **Avv. Rossi** | Legale | Compliance, GDPR, analisi contrattuale |

### Agenti Operativi

| Agente | Dominio | Specializzazione |
|--------|---------|-----------------|
| **Archivista** | Documentale | Indicizzazione, ricerca RAG, analisi documenti |
| **Email Agent** | Email | Lettura, invio, ricerca email, gestione allegati |
| **WhatsApp Agent** | Comunicazione | Messaggi, vocali, documenti via WhatsApp |
| **Pianificazione** | Logistica | Viaggi, autisti, GPS, ottimizzazione trasporti |
| **Voice Assistant** | Voce | Conversazione vocale, TTS multi-voce |

### Agenti di Sistema

| Agente | Dominio | Specializzazione |
|--------|---------|-----------------|
| **Dev** | IT/Ops | Agenti autonomi, workflow, configurazione |
| **Doctor** | Diagnostica | Salute sistema, performance, job falliti |

### Personalizzazione per Reparto

Ogni agente e' completamente personalizzabile:

- **Prompt di sistema**: definisce personalita', competenze, regole operative
- **Tool disponibili**: ogni agente vede solo gli strumenti pertinenti al suo dominio
- **Modello LLM**: agenti critici possono usare modelli piu' potenti (Sonnet, Opus)
- **Regole runtime**: modificabili dal pannello admin senza riavvio
- **Skills da DB**: override di prompt, modello e regole a runtime

**Per il cliente, questo significa**: sviluppiamo agenti su misura per ogni reparto, con prompt calibrati sulla terminologia, i processi e le esigenze specifiche dell'azienda. L'agente commerciale di un'azienda manifatturiera sara' diverso da quello di un'agenzia di servizi.

---

## Documenti Intelligenti — Agentic RAG

### Pipeline di Indicizzazione

```
Upload documento (o fetch da URL)
  │
  ├─ Estrazione testo (PDF, DOCX, TXT, immagini via OCR)
  │
  ├─ Classificazione AI (tipo, categoria, autore, dati estratti)
  │
  ├─ Chunking intelligente (9 template: legale, contratto, manuale, CV, report...)
  │
  ├─ Tagging AI per chunk (heading_path, sezione, rilevanza)
  │
  ├─ Embedding vettoriale (1536 dimensioni per chunk)
  │
  └─ Indicizzazione FTS5 (ricerca full-text istantanea)
```

### 3 Motori di Ricerca Integrati

1. **SQL** — Filtri strutturali (tipo, tags, stato, date)
2. **FTS5** — Ricerca keyword nel contenuto dei documenti
3. **Semantica** — Ricerca per significato (embedding cosine similarity)

Il sistema sceglie automaticamente il motore piu' adatto in base alla query.

### OCR per Documenti Scansionati

I PDF basati su immagine (scansioni) vengono processati automaticamente con un modello di visione AI che estrae il testo pagina per pagina, mantenendo la struttura del documento.

### Fetch da Web

L'agente documentale puo' scaricare documenti direttamente da URL web (datasheet, manuali, specifiche tecniche) e indicizzarli automaticamente nel sistema. Non serve scaricare manualmente e ricaricare.

---

## Sicurezza e Permessi

### Protezione Input/Output

- **Input**: rilevamento e blocco prompt injection
- **Output**: mascheramento automatico PII (email, telefono, CF, IBAN, carte) su canali esterni
- **Retrieval**: filtraggio contenuti sensibili

### Permessi Granulari

Sistema a gruppi con matrice di permessi per tipo di entity e per agente:

- **Amministratori**: accesso completo a tutti i dati e agenti
- **Operatori**: lettura, creazione e modifica (no eliminazione)
- **Lettori**: sola consultazione
- **Gruppi custom**: permessi specifici per tipo (es. accesso solo a fatture e clienti)
- **Permessi per agente**: controllo su quali agenti ogni gruppo puo' usare

### API Token

Autenticazione via JWT o API key per integrazioni esterne. Ogni token ha scadenza, revoca e tracking ultimo utilizzo.

---

## Integrazione Pianificazione Trasporti

Per aziende di logistica e trasporti, FIAI OS include un modulo di pianificazione con 19 tool specializzati:

- **Gestione viaggi**: lista, dettaglio, assegnazione autisti e semirimorchi
- **Ottimizzazione AI**: assegnazione automatica con scoring composito
- **GPS tracking**: posizione in tempo reale dei mezzi
- **ETA**: calcolo tempo di arrivo con affidabilita' GPS
- **Scenari what-if**: simulazione con vincoli diversi (autisti assenti, mezzi in manutenzione)
- **Statistiche**: analisi per cliente, destinazione, autista, periodo
- **Compliance EU 561**: monitoraggio ore guida e riposo

Il modulo si integra via VPN con sistemi di pianificazione esistenti (FastAPI/Python), fungendo da interfaccia conversazionale per strumenti che altrimenti richiederebbero formazione specialistica.

---

## Agenti Autonomi e Automazione

### Agenti Background

Entita' che eseguono operazioni ricorrenti senza intervento umano:

- **Trigger cron**: "Ogni lunedi' alle 8:00, invia il riepilogo settimanale via WhatsApp al direttore"
- **Trigger evento**: "Quando viene creata una fattura sopra i 10.000 euro, notifica il CFO via email"
- **Job queue**: operazioni pesanti (embedding, chunking, report) eseguite in background con retry automatico

### Workflow Multi-Step

Catene di operazioni con dipendenze:

```
1. Cerca fatture scadute da piu' di 30 giorni
2. Per ciascuna, prepara un sollecito personalizzato
3. Invia via email con la fattura in allegato
4. Registra il sollecito nel sistema
5. Notifica l'amministrazione via chat
```

---

## Architettura Multi-Canale — Un Cervello, Molte Voci

FIAI OS non e' confinato a una singola interfaccia. La stessa intelligenza, gli stessi agenti, gli stessi dati sono raggiungibili da qualsiasi punto di contatto. Ogni canale parla con il medesimo orchestratore: cambia la forma, non la sostanza.

```
                    ┌─────────────────┐
                    │   ORCHESTRATORE  │
                    │   + 15 Agenti    │
                    │   + 40+ Tool     │
                    │   + Database     │
                    └────────┬────────┘
                             │
        ┌────────┬───────┬───┴───┬────────┬──────────┐
        │        │       │       │        │          │
     🌐 Web   📱 App  📧 Email 💬 WhatsApp 🤖 Robot  🔌 API
```

### 🌐 Interfaccia Web

Il punto di accesso principale. Chat full-screen con streaming in tempo reale, visualizzazione card per i risultati dei tool, upload documenti con classificazione AI, pannello admin per utenti e configurazione. Accessibile da qualsiasi browser, desktop o mobile, senza installazione.

- Streaming SSE token-by-token (risposta visibile in tempo reale)
- Sidebar dinamica con viste agente (pipeline, kanban, liste)
- Upload drag-and-drop con analisi AI istantanea
- Storico conversazioni persistente e ricercabile
- Conversazione vocale bidirezionale integrata

### 📱 App Smartphone Personalizzate

Grazie all'endpoint `/v1/chat/completions` compatibile con lo standard OpenAI, sviluppare app mobile native o ibride e' immediato. Qualsiasi framework (React Native, Flutter, Swift, Kotlin) puo' connettersi a FIAI OS come se fosse un'API OpenAI standard.

- **SDK standard**: qualsiasi libreria OpenAI funziona senza modifiche
- **Streaming nativo**: risposte in tempo reale anche su mobile
- **Response profiles**: il formato della risposta si adatta al contesto — `voice` per assistenti vocali (niente markdown, frasi naturali), `brief` per widget e notifiche (1-2 frasi), `json` per integrazioni machine-to-machine
- **Autenticazione**: JWT o API key con scadenza e revoca
- **Offline-first**: l'app puo' cachare risposte e sincronizzare
- **Branding personalizzato**: ogni cliente ha la propria app con logo, colori e agenti dedicati

*Esempio: un'app per il responsabile commerciale che mostra la pipeline con un tap, invia follow-up WhatsApp ai clienti con un messaggio vocale, e riceve notifiche push sulle offerte in scadenza — tutto alimentato dallo stesso motore FIAI OS.*

### 💬 WhatsApp Business

Gli agenti FIAI comunicano direttamente su WhatsApp. I collaboratori possono interrogare il sistema, ricevere report, inviare documenti e ottenere notifiche — tutto dalla chat WhatsApp che usano gia' ogni giorno.

- Invio messaggi di testo, vocali, immagini e documenti
- Ricezione comandi in linguaggio naturale ("mandami le fatture scadute")
- Notifiche proattive da agenti autonomi (scadenze, alert, report)
- Mascheramento automatico dati sensibili (PII) sulle risposte
- Nessuna app aggiuntiva da installare per i destinatari

*Esempio: il direttore chiede su WhatsApp "com'e' andata la settimana?" e riceve un briefing vocale sintetizzato con i KPI principali, le criticita' e le azioni suggerite.*

### 📧 Email

FIAI OS legge, cerca, risponde e invia email dalla casella aziendale configurata. L'agente email gestisce la posta come un assistente personale: filtra, riassume, prepara bozze e mantiene i thread di conversazione.

- Connessione IMAP/SMTP a qualsiasi provider (Aruba, Gmail, Exchange, Office 365)
- Monitoraggio inbox in tempo reale (IDLE push — non polling)
- Ricerca email per mittente, oggetto, data, contenuto
- Risposta con thread mantenuto (In-Reply-To, References)
- Invio con allegati dal sistema documentale
- Download allegati email e indicizzazione automatica nel sistema

*Esempio: "cerca le email di UniLab dell'ultimo mese e fammi un riassunto" → l'agente cerca, legge, sintetizza e presenta i punti chiave.*

### 🤖 Robot e Dispositivi IoT

L'API OpenAI-compatibile (`/v1/chat/completions`) permette a qualsiasi dispositivo embedded di interagire con FIAI OS. Microcontrollori ESP32, Raspberry Pi, assistenti vocali custom, pannelli touch industriali — qualsiasi hardware che parla HTTP puo' diventare un terminale intelligente.

- **Protocollo standard**: POST JSON, risposta streaming o sincrona
- **Autenticazione leggera**: API key (niente OAuth, niente cookie)
- **Response profile `voice`**: risposte ottimizzate per sintesi vocale (niente markdown, numeri scritti per esteso, frasi naturali discorsive)
- **Response profile `brief`**: risposte ultra-compatte per display piccoli
- **Response profile `json`**: output strutturato per automazione machine-to-machine
- **Latenza contenuta**: Haiku risponde in 1-3 secondi, streaming dal primo token

*Esempio concreto — Robot industriale con ESP32:*
```
POST /v1/chat/completions
Authorization: Bearer fiai-xxxxx
{"model":"fiai-os-voice", "messages":[{"role":"user","content":"Quanti ordini in produzione oggi?"}]}

→ "Oggi ci sono dodici ordini in produzione. Tre sono in fase di assemblaggio, 
   cinque in lavorazione e quattro in attesa materiali. Due ordini hanno 
   ritardo sulla consegna prevista per domani."
```

*Il robot nel reparto produzione risponde a voce alle domande dell'operaio, senza che questi debba lasciare la postazione o consultare un terminale.*

### 🔌 API per Integrazioni Custom

Oltre al protocollo OpenAI, FIAI OS espone API REST complete per integrazioni dirette:

- `/api/query` — CRUD su qualsiasi entity (SQL-like)
- `/api/upload/smart` — Upload con classificazione AI
- `/api/documenti/search` — Ricerca RAG nei documenti
- `/api/chat/message/stream` — Chat con streaming SSE
- `/api/admin/*` — Gestione utenti, gruppi, settings
- `/api/whatsapp/*` — Controllo WhatsApp programmatico
- `/api/email/*` — Operazioni email programmatiche

Questo permette di integrare FIAI OS con ERP esistenti, BI tools, sistemi legacy, piattaforme e-commerce — qualsiasi software che possa fare chiamate HTTP.

---

## Perche' FIAI OS

| Gestionale tradizionale | FIAI OS |
|------------------------|---------|
| Menu, form, click | Linguaggio naturale |
| Formazione settimane | Formazione 1 ora |
| Dati in silos separati | Ricerca unificata su tutto |
| Report statici | Analisi on-demand conversazionale |
| Solo desktop/browser | Web + App + WhatsApp + Email + Robot + API |
| Un canale per volta | Stessa intelligenza su ogni punto di contatto |
| Integrazione costosa | API standard OpenAI — qualsiasi device si collega |
| Automazione con codice | Automazione in linguaggio naturale |
| Un software, un vendor | AI multi-model, nessun lock-in |

---

*FIAI — Fabbrica Italiana Agenti Intelligenti*
*Documento riservato — Vietata la riproduzione non autorizzata*
