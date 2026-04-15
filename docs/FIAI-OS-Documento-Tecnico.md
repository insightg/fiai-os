# FIAI OS — Documento Tecnico

**Architettura AI, Motori di Ricerca, Sicurezza e Infrastruttura**

---

## 1. Architettura Multi-LLM

FIAI OS non dipende da un singolo fornitore di intelligenza artificiale. L'architettura multi-modello consente di scegliere il modello piu' adatto per ogni operazione, bilanciando costo, velocita' e qualita'.

### Routing Intelligente dei Modelli

```
                    ┌──────────────────────────────────┐
                    │         OpenRouter Gateway        │
                    │   (accesso unificato a 100+ LLM)  │
                    └──────────┬───────────────────────┘
                               │
         ┌─────────────┬───────┴───────┬─────────────────┐
         │             │               │                 │
   Anthropic       Mistral         Google            Open Source
   Claude 4.5      Small 3        Gemini 3.1         Llama, Qwen
   Haiku/Sonnet    Mistral Large   Flash/Pro          DeepSeek
```

### Modelli per Funzione

| Funzione | Modello Default | Perche' | Fallback |
|----------|----------------|---------|----------|
| **Agenti operativi** | Claude Haiku 4.5 | Veloce (1-3s), economico, ottimo per tool calling | Automatico su errore 5xx |
| **Classificatore intent** | Claude Haiku 4.5 | Risposta JSON in <100ms, max 150 token | Keyword scoring (0ms) |
| **Analisi documenti** | Claude Haiku 4.5 | Comprensione testo lungo, classificazione precisa | — |
| **Agente legale** | Mistral Small 3 | Modello europeo, buona comprensione normativa IT | Haiku (fallback auto) |
| **Generazione immagini** | Gemini 3.1 Flash | Generazione e editing immagini nativo | — |
| **OCR documenti** | GLM-5v-Turbo | Vision model economico, buona estrazione testo | — |
| **Embedding** | text-embedding-3-small | 1536 dimensioni, ottimo rapporto qualita'/costo | — |
| **Sintesi vocale** | Qwen3-TTS 0.6B | Self-hosted, zero costi per token, bassa latenza | — |

### Fallback Automatico

Se il modello principale restituisce errore (500, 502, 503), il sistema riprova automaticamente con il modello di fallback. L'utente non percepisce interruzioni — la risposta arriva dal modello alternativo in modo trasparente.

```
Richiesta → Claude Sonnet (timeout/errore)
         → Retry 1: Claude Haiku (fallback)
         → Retry 2: attesa esponenziale + retry
         → Retry 3: errore all'utente
```

### Override per Agente

Ogni agente puo' essere configurato con un modello specifico:

- Da codice: campo `model` nella configurazione agente
- Da database: entity `type='skill'` con `metadata.model`
- Da admin panel: modifica runtime senza riavvio

Questo consente di assegnare modelli piu' potenti (Sonnet, Opus) ad agenti critici (es. legale, direzione) mantenendo Haiku per operazioni di routine.

---

## 2. Agentic Tool Calling — Il Loop Autonomo

A differenza di un chatbot che genera solo testo, ogni agente FIAI e' un **agente operativo** che chiama strumenti in autonomia, reagisce ai risultati e decide il passo successivo.

### Architettura del Loop

```
Messaggio utente
  │
  ▼
┌─────────────────────────────────────────┐
│             AGENT LOOP (max 10 iter)     │
│                                          │
│  LLM riceve:                             │
│  - System prompt (personalita' + regole) │
│  - Contesto aziendale (8 livelli)        │
│  - Tool disponibili (schema JSON)        │
│  - Storico conversazione                 │
│  - Messaggio utente                      │
│                                          │
│  LLM decide:                             │
│  ┌─ Risposta testuale → fine             │
│  └─ Tool call → esegui → risultato      │
│       │                                  │
│       ▼                                  │
│  LLM vede il risultato e decide:         │
│  ┌─ Altro tool call → esegui → ...       │
│  └─ Risposta finale → fine               │
│                                          │
│  Safety: dopo execute_code → max 3 iter  │
│  Pruning: se >400K char → rimuovi vecchi │
│  Streaming: token emessi in tempo reale  │
└─────────────────────────────────────────┘
```

### Esempio Reale: "Mandami un report delle fatture scadute via WhatsApp"

```
Iterazione 1: LLM chiama execute_code →
  Script: cerca fatture scadute, aggrega per cliente, calcola totali
  Risultato: "12 fatture scadute, totale €47.830, top 3 clienti: ..."

Iterazione 2: LLM chiama send_whatsapp_message →
  Compone il messaggio con i dati trovati
  Risultato: "Messaggio inviato a 393471349312"

Iterazione 3: LLM genera risposta finale →
  "Ho inviato il report via WhatsApp. 12 fatture scadute per un 
   totale di €47.830. I 3 clienti con il debito maggiore sono..."
```

L'agente ha preso una richiesta in linguaggio naturale e ha eseguito 3 operazioni autonome: ricerca dati, elaborazione, invio — senza intervento umano intermedio.

### Confronto con Architetture Tradizionali

| Approccio | Come funziona | Limiti |
|-----------|--------------|-------|
| **Chatbot RAG** | Cerca documenti → genera risposta | Solo lettura, nessuna azione |
| **Chatbot + API** | LLM genera codice API → backend esegue | Fragile, errori di formato |
| **FIAI Agentic** | LLM chiama tool nativi → loop autonomo | Fino a 10 iterazioni, self-correcting |

La differenza fondamentale: l'agente FIAI **reagisce ai risultati**. Se una ricerca non trova nulla, prova con parametri diversi. Se un invio fallisce, segnala l'errore. Non segue uno script rigido — ragiona e si adatta.

---

## 3. Agentic Code Execution — Sandbox Sicura

Per operazioni complesse che richiederebbero molte chiamate tool sequenziali, l'agente scrive ed esegue codice JavaScript in una sandbox isolata.

### Architettura della Sandbox

```
┌─────────────────────────────────────────┐
│            VM Sandbox (Node.js vm)        │
│                                          │
│  Disponibile:                            │
│  ✅ find(), create(), update()           │
│  ✅ delete_record(), relate()            │
│  ✅ retrieve(), list_documents()         │
│  ✅ get_datetime(), date_diff()          │
│  ✅ generate_pdf(), render_view()        │
│  ✅ send_whatsapp_*(), send_email()      │
│  ✅ print() → output verso l'agente     │
│                                          │
│  Bloccato:                               │
│  ❌ require() / import()                 │
│  ❌ fetch() / HTTP                       │
│  ❌ fs / filesystem                      │
│  ❌ process / child_process              │
│  ❌ eval() / Function()                  │
│  ❌ setTimeout() / setInterval()         │
└─────────────────────────────────────────┘
```

### Perche' e' Potente

Il codice puo' fare in un'unica esecuzione cio' che richiederebbe 10+ chiamate tool separate:

```javascript
// L'agente genera questo codice automaticamente
const fatture = await find({ type: 'fattura', stato: 'scaduta' })
const clienti = {}
for (const f of fatture) {
  const nome = f.display_name || 'Sconosciuto'
  if (!clienti[nome]) clienti[nome] = { totale: 0, count: 0 }
  clienti[nome].totale += f.totale || 0
  clienti[nome].count++
}
const top5 = Object.entries(clienti)
  .sort((a, b) => b[1].totale - a[1].totale)
  .slice(0, 5)

print(`${fatture.length} fatture scadute`)
for (const [nome, data] of top5) {
  print(`- ${nome}: €${data.totale.toLocaleString('it-IT')} (${data.count} fatture)`)
}
```

### Perche' e' Sicuro

- **Nessun accesso al filesystem**: il codice non puo' leggere o scrivere file
- **Nessun accesso alla rete**: non puo' fare chiamate HTTP esterne
- **Nessun accesso al processo**: non puo' eseguire comandi di sistema
- **Timeout**: esecuzione limitata nel tempo
- **Solo tool FIAI**: puo' operare solo attraverso gli strumenti approvati del sistema
- **Output controllato**: solo `print()` produce output visibile

---

## 4. Ricerca a 3 Motori — SQL, Full-Text, Semantica

Il tool `find` sceglie automaticamente il motore di ricerca piu' adatto alla query.

### Motore 1: SQL — Ricerca Strutturale

Per query con filtri precisi su campi noti.

```
find({ type: 'fattura', stato: 'scaduta', tags: ['cliente'] })
→ SELECT * FROM entity WHERE type='fattura' AND stato='scaduta' AND tags LIKE '%cliente%'
```

**Quando si attiva**: filtri per type, stato, tags, name_id, date range, totale.

### Motore 2: FTS5 — Ricerca Full-Text

Per ricerca keyword nel contenuto dei documenti. Usa l'indice FTS5 di SQLite sui chunk testuali.

```
find({ query: 'clausola rescissione contratto' })
→ SELECT * FROM chunk_fts WHERE chunk_fts MATCH 'clausola rescissione contratto'
```

**Quando si attiva**: query testuale senza filtri strutturali, ricerca nei documenti.

**Caratteristiche**:
- Tokenizzazione italiana (stemming, stop words)
- Ranking BM25 (pertinenza per frequenza termine)
- Ricerca su `body` e `display_name` dei chunk
- Trigger automatici su insert (indicizzazione istantanea)

### Motore 3: Semantico — Ricerca per Significato

Per query dove il significato conta piu' delle parole esatte. Usa embedding vettoriali a 1536 dimensioni con cosine similarity.

```
find({ query: 'obblighi del fornitore in caso di ritardo', semantic: true })
→ embed(query) → cosine_similarity con tutti i chunk → top-K risultati
```

**Quando si attiva**: query complesse, domande concettuali, ricerca in documenti tecnici/legali.

**Pipeline**:
```
Testo → OpenAI text-embedding-3-small → Float32[1536] → SQLite vec0 → cosine similarity
```

**Caratteristiche**:
- 1536 dimensioni per embedding (alta precisione)
- Indice vec0 (sqlite-vec) per ricerca vettoriale nativa in SQLite
- Sync automatico: ogni chunk viene embedded al momento dell'indicizzazione
- Nessun database vettoriale esterno (Pinecone, Weaviate) — tutto in SQLite

### Routing Automatico

Il sistema decide quale motore usare basandosi sui parametri della query:

| Parametri | Motore | Motivazione |
|-----------|--------|-------------|
| `type`, `stato`, `tags` | SQL | Filtri strutturali precisi |
| `query` (testo breve) | FTS5 | Keyword match veloce |
| `query` + `semantic: true` | Vettoriale | Ricerca per significato |
| `query` + `type` | SQL + FTS5 | Ibrido: filtra per tipo, poi cerca nel testo |

---

## 5. Agentic RAG — Documenti Intelligenti

La pipeline RAG (Retrieval-Augmented Generation) di FIAI OS non e' un semplice "cerca e incolla". E' un sistema agentico dove l'agente decide come cercare, valuta i risultati e adatta la strategia.

### Pipeline di Indicizzazione

```
Documento (PDF, DOCX, TXT, immagine)
  │
  ├─ 1. ESTRAZIONE TESTO
  │     PDF → pdf-parse (testo nativo)
  │     PDF scansionato → OCR vision model (pagina per pagina)
  │     DOCX → mammoth (estrazione raw text)
  │     Immagine → vision model (descrizione)
  │
  ├─ 2. CLASSIFICAZIONE AI
  │     LLM analizza il contenuto e determina:
  │     - Tipo entity (documento, fattura, contratto, CV...)
  │     - Categoria (legale, tecnico, amministrativo...)
  │     - Tags automatici
  │     - Dati estratti (autore, data, numero, importo...)
  │     - Nome suggerito e associazione a entity esistenti
  │
  ├─ 3. CHUNKING INTELLIGENTE (9 template)
  │     │
  │     ├─ legge_it: per Articolo (Art. 1, Art. 2...)
  │     ├─ contratto: per Clausola
  │     ├─ cv: sezioni standard (Esperienza, Formazione...)
  │     ├─ libro_sacro: per Capitolo e Versetto
  │     ├─ narrativa: per scene e paragrafi
  │     ├─ poesia: per componimento
  │     ├─ manuale: per sezione tecnica
  │     ├─ report: per sezione analitica
  │     └─ generico: paragrafi di ~500 parole
  │
  │     Il template viene rilevato automaticamente dall'AI
  │     o specificato manualmente dall'utente
  │
  ├─ 4. TAGGING AI PER CHUNK
  │     LLM assegna a ogni chunk:
  │     - heading_path (es. "Capitolo 3 > Sezione 3.2 > Paragrafo A")
  │     - keywords rilevanti
  │     - tipo di contenuto (definizione, procedura, norma, dato)
  │
  ├─ 5. EMBEDDING VETTORIALE
  │     Ogni chunk → text-embedding-3-small → Float32[1536]
  │     Salvataggio come BLOB in SQLite + indice vec0
  │
  └─ 6. INDICIZZAZIONE FTS5
        body + display_name → indice full-text
        Trigger automatici su INSERT
```

### Ricerca Agentica nei Documenti

L'agente documentale non fa una singola query. Esegue una strategia di ricerca adattiva:

```
Utente: "Cosa dice l'Art. 12 del contratto sulla rescissione?"

Agente (internamente):
  1. retrieve({ query: "Art. 12 rescissione", doc_id: "..." })
     → 0 risultati (il testo dice "Articolo 12" non "Art. 12")
  
  2. retrieve({ query: "Articolo 12 rescissione" })
     → 2 risultati con score 0.82 e 0.71
  
  3. Reranker LLM valuta i chunk:
     → Chunk 1: pertinente (contiene la clausola cercata)
     → Chunk 2: marginalmente pertinente (menziona la rescissione)
  
  4. Risposta con citazione letterale e heading_path
```

### Fetch & Index da Web

Il tool `fetch_document` permette di scaricare documenti da URL e indicizzarli automaticamente:

```
Utente: "Scarica il datasheet dell'inverter Hitachi e indicizzalo"

Agente:
  1. web_search("datasheet inverter Hitachi PDF") → trova URL
  2. fetch_document({ url: "https://..../datasheet.pdf" })
     → Download → Estrazione testo → Classificazione AI
     → Chunking → Embedding → Indicizzazione FTS5
  3. "Documento indicizzato. Vuoi che cerchi qualcosa al suo interno?"
```

---

## 6. Sicurezza — LLM Locali e Protezione Dati

### Il Problema della Privacy con i Cloud LLM

Ogni chiamata a un LLM cloud (OpenAI, Anthropic, Google) invia i dati aziendali ai server del provider. Per aziende con dati sensibili (contratti, dati finanziari, informazioni personali), questo puo' rappresentare un rischio.

### Strategia di Sicurezza Multi-Livello di FIAI OS

```
┌─────────────────────────────────────────────────────────────┐
│                    LIVELLO 1: INPUT SAFETY                   │
│  Blocco prompt injection, comandi malevoli, jailbreak        │
│  → Ogni messaggio utente viene analizzato PRIMA di arrivare  │
│    all'LLM. Pattern pericolosi vengono bloccati.             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    LIVELLO 2: DATI MINIMI ALL'LLM            │
│  Context truncation: max 8000 char di contesto               │
│  History ridotto: ultimi 4 messaggi, max 2000 char ciascuno  │
│  Pruning: tool exchange vecchi rimossi sopra 400K char       │
│  → L'LLM vede solo i dati strettamente necessari,           │
│    mai l'intero database.                                    │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    LIVELLO 3: OUTPUT SAFETY                   │
│  Mascheramento PII su canali esterni (WhatsApp, email):      │
│  - Email → m***@example.com                                  │
│  - Telefono → 34***312                                       │
│  - Codice Fiscale → RSSMR***                                 │
│  - IBAN → IT60X054***                                        │
│  - Carte di credito → ****1234                               │
│  → I dati sensibili non escono mai in chiaro sui canali      │
│    esterni. Nella chat web interna sono visibili.             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    LIVELLO 4: PERMESSI GRANULARI             │
│  Matrice gruppi × tipi entity × azioni                       │
│  Permessi per agente: quali agenti ogni gruppo puo' usare    │
│  API token con scadenza e revoca                             │
│  → Ogni utente vede e fa solo cio' che il suo ruolo          │
│    permette. Nessun accesso non autorizzato.                 │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    LIVELLO 5: CODE SANDBOX                    │
│  execute_code gira in VM isolata                             │
│  Nessun accesso a: filesystem, rete, processo, eval          │
│  Solo tool FIAI approvati + print()                          │
│  → Anche se l'LLM generasse codice malevolo,                │
│    la sandbox ne impedisce l'esecuzione.                     │
└─────────────────────────────────────────────────────────────┘
```

### LLM Locali — La Soluzione per Dati Critici

FIAI OS supporta nativamente l'esecuzione di LLM locali, on-premise, senza che nessun dato esca dalla rete aziendale.

#### Architettura con LLM Locale

```
┌─────────────────────────────────────────────┐
│              RETE AZIENDALE                  │
│                                              │
│  ┌──────────┐     ┌──────────────────────┐  │
│  │ FIAI OS  │────▶│  LLM Server Locale   │  │
│  │ Backend  │◀────│  (vLLM / Ollama /    │  │
│  │          │     │   llama.cpp / TGI)   │  │
│  └──────────┘     └──────────────────────┘  │
│       │                    │                 │
│       │           ┌───────────────┐          │
│       │           │ GPU Server    │          │
│       │           │ NVIDIA A100   │          │
│       │           │ o RTX 4090    │          │
│       │           └───────────────┘          │
│       │                                      │
│  ┌──────────┐                                │
│  │ SQLite   │  ← Dati mai escono dalla rete  │
│  │ Database │                                │
│  └──────────┘                                │
│                                              │
│  ❌ NESSUN DATO ESCE DALLA RETE AZIENDALE   │
└─────────────────────────────────────────────┘
```

#### Modelli Locali Supportati

| Modello | Parametri | VRAM | Qualita' | Caso d'uso |
|---------|-----------|------|----------|------------|
| **Llama 3.1 70B** | 70B | 40 GB | Eccellente | Agenti principali, analisi complesse |
| **Llama 3.1 8B** | 8B | 8 GB | Buona | Classificazione, task semplici |
| **Mistral Small** | 22B | 16 GB | Ottima | Agenti europei, testi legali IT |
| **Qwen 2.5 72B** | 72B | 40 GB | Eccellente | Multilingue, ragionamento |
| **DeepSeek V3** | 685B MoE | 80 GB | Top | Codice, ragionamento avanzato |
| **Qwen3-TTS 0.6B** | 0.6B | 2 GB | Ottima | Sintesi vocale (gia' self-hosted) |

#### Come si Configura

FIAI OS usa OpenRouter come gateway, ma il campo `model` puo' puntare a qualsiasi endpoint compatibile OpenAI:

```
# Configurazione in settings (admin panel o DB)
company_name: "ACME S.R.L."
default_agent_model: "local/llama-3.1-70b"

# Il server LLM locale espone un endpoint compatibile:
# http://gpu-server.local:8000/v1/chat/completions
```

Il backend FIAI punta al server LLM locale invece che a OpenRouter. Nessuna modifica al codice — solo configurazione.

#### Architettura Ibrida: Locale + Cloud

La configurazione piu' flessibile e' l'ibrida: modelli locali per dati sensibili, cloud per operazioni non critiche.

```
Agente Legale     → LLM locale (contratti, dati personali mai in cloud)
Agente HR         → LLM locale (stipendi, CV, dati dipendenti)
Agente Commerciale → Cloud Haiku (dati clienti meno sensibili, piu' veloce)
Agente Marketing  → Cloud Gemini (generazione immagini, richiede cloud)
Classificatore    → LLM locale 8B (veloce, nessun dato esce)
Embedding         → Locale o cloud (configurabile per modello)
```

Ogni agente puo' avere il proprio modello — alcuni locali, altri cloud — nella stessa istanza FIAI OS.

#### TTS Self-Hosted (gia' attivo)

La sintesi vocale (Text-to-Speech) e' gia' eseguita su server locale con Qwen3-TTS 0.6B. Nessun audio viene inviato a servizi esterni. La voce e' generata in streaming PCM con latenza inferiore al secondo.

---

## 7. Embedding Vettoriali — Ricerca Semantica Nativa

### Come Funziona

Ogni documento, chunk testuale e entity viene convertito in un vettore a 1536 dimensioni che rappresenta il suo "significato" nello spazio semantico.

```
"Clausola di rescissione anticipata del contratto"
  → [0.023, -0.041, 0.087, ..., 0.015]  (1536 numeri float32)

"Il fornitore puo' recedere dal presente accordo"
  → [0.025, -0.039, 0.091, ..., 0.013]  (vettore simile!)

Cosine similarity: 0.94 → alta pertinenza
```

Due frasi con parole completamente diverse ma significato simile vengono trovate dalla ricerca semantica, mentre la ricerca keyword non le collegherebbe.

### Stack Vettoriale

| Componente | Tecnologia | Dettaglio |
|------------|-----------|-----------|
| Modello embedding | text-embedding-3-small | 1536 dim, ~0.00002 $/query |
| Storage | SQLite BLOB | Float32Array, 6 KB per embedding |
| Indice vettoriale | sqlite-vec (vec0) | Ricerca cosine similarity nativa |
| Sync | Automatico | Ogni chunk embedded al momento della creazione |

### Vantaggi rispetto a DB Vettoriali Esterni

| DB Vettoriale esterno (Pinecone, Weaviate) | FIAI OS (SQLite + vec0) |
|--------------------------------------------|------------------------|
| Servizio cloud separato | Tutto in un unico file SQLite |
| Latenza di rete aggiuntiva | Ricerca locale, sub-millisecondo |
| Costo mensile per indicizzazione | Zero costi aggiuntivi |
| Sincronizzazione complessa | Trigger automatici, sempre in sync |
| Backup separato | Un solo file da backuppare |
| Vendor lock-in | Standard SQLite, portabile ovunque |

---

## 8. Streaming SSE — Risposte in Tempo Reale

### Architettura del Flusso

```
Browser ──SSE──▶ Nginx ──proxy──▶ Express ──SSE──▶ OpenRouter
                                     │
                                     │ onProgress callback
                                     │
                              ┌──────┴──────┐
                              │ Event types: │
                              │ • token      │ → testo incrementale
                              │ • tool_start │ → "Cerco nel database..."
                              │ • tool_done  │ → "Trovati 12 risultati"
                              │ • agent      │ → "Sofia sta elaborando..."
                              │ • done       │ → metadata finale
                              │ • error      │ → errore
                              └─────────────┘
```

### Perche' e' Importante

- L'utente vede la risposta formarsi in tempo reale (come ChatGPT)
- I tool in esecuzione sono visibili ("Cerco fatture scadute...")
- L'utente puo' capire se la direzione e' corretta prima che finisca
- Percezione di velocita' molto superiore rispetto all'attesa di una risposta completa

### Configurazione Nginx per SSE

```nginx
location /api/chat/message/stream {
    proxy_buffering off;           # No buffering lato proxy
    proxy_request_buffering off;
    chunked_transfer_encoding off;
    proxy_read_timeout 600s;       # 10 minuti per risposte lunghe
    add_header X-Accel-Buffering no;
}
```

---

## 9. Contesto a 8 Livelli

Ogni agente riceve un contesto stratificato che gli permette di rispondere in modo pertinente senza dover accedere a tutto il database.

```
Livello 1: GLOBALE      → KPI aziendali (fatturato, clienti attivi, progetti)
Livello 2: SKILL        → Dati specifici del dominio (override da DB)
Livello 3: PROFILO       → Nome utente, ruolo, preferenze
Livello 4: SESSIONE      → Storico conversazione corrente
Livello 5: PREFERENZE    → Preferenze auto-apprese dall'uso
Livello 6: STEERING      → Regole da feedback esplicito dell'utente
Livello 7: MEMORIA       → Lezioni apprese dall'agente per dominio
Livello 8: SISTEMA       → Conteggio entity, stato servizi
```

Il contesto viene costruito dinamicamente, troncato a 8000 caratteri per evitare overflow, e cachato per 5 minuti per ridurre le query al database.

---

## 10. Infrastruttura e Deploy

### Stack di Produzione

```
┌─────────────────────────────────────────────┐
│                  NGINX                       │
│  (SSL termination, routing, SSE buffering)   │
├──────────────┬──────────────────────────────┤
│  Frontend    │         Backend               │
│  React SPA   │  Node.js + Express + tsx      │
│  (static)    │  SQLite + sqlite-vec          │
│              │  OpenVPN (per VPN integ.)      │
├──────────────┴──────────────────────────────┤
│              Docker Compose                   │
│  fiai-frontend (nginx:alpine)                │
│  fiai-backend  (node:20-slim)                │
│  Volume: fiai-data (database + uploads)      │
└─────────────────────────────────────────────┘
```

### Requisiti

| Componente | Minimo | Consigliato |
|-----------|--------|-------------|
| CPU | 4 core | 8 core |
| RAM | 8 GB | 16 GB |
| Storage | 50 GB SSD | 200 GB SSD |
| GPU (se LLM locale) | — | NVIDIA RTX 4090 (24 GB) o A100 (40/80 GB) |
| OS | Linux (Docker) | Ubuntu 22.04 LTS |
| Rete | HTTPS, porta 443 | + VPN per integrazioni remote |

### Backup

Un singolo file SQLite (`fiai.db`) contiene tutto: dati, embedding, storico chat, configurazione. Backup incrementale con `sqlite3 .backup` o copia del file in WAL checkpoint.

---

*FIAI — Fabbrica Italiana Agenti Intelligenti*
*Documento tecnico riservato — Vietata la riproduzione non autorizzata*
