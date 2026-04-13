# Integrazione Chat Agent Pianificazione

Guida per integrare l'agent di pianificazione viaggi in un'applicazione web esistente.

## Architettura Attuale

```
┌─────────────────────────────────────────────────────────────┐
│                     FRONTEND (Streamlit)                     │
│  └── Chat: Conversazione con LLM Agent                      │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              LLM AGENT (PlanningAgent)                       │
│  ├── OpenRouter API (LLM con function calling)              │
│  ├── 14+ tools per pianificazione                          │
│  └── History conversazione in memoria                       │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│               TOOLS + CONNECTORS                             │
│  ├── TIRConnector → API Viaggi                              │
│  ├── BERLINKConnector → API Flotta/Autisti                  │
│  ├── WayTrackerConnector → GPS SOAP                         │
│  └── GeocodingService → OpenStreetMap                       │
└─────────────────────────────────────────────────────────────┘
```

## Opzione 1: API REST con FastAPI (Consigliata)

Crea un server API che wrappa il `PlanningAgent` per essere consumato da qualsiasi frontend.

### 1.1 Installazione Dipendenze

```bash
pip install fastapi uvicorn python-multipart
```

### 1.2 Server API (`agent/api/server.py`)

```python
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Dict, List
from datetime import date
import uuid

from agent.llm_agent import PlanningAgent
from agent.config import get_settings

app = FastAPI(title="Planning Agent API", version="1.0.0")

# CORS per permettere richieste da altri domini
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In produzione: specificare domini
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Storage sessioni in memoria (in produzione: Redis)
sessions: Dict[str, PlanningAgent] = {}


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    data_lavoro: Optional[str] = None  # YYYY-MM-DD


class ChatResponse(BaseModel):
    response: str
    session_id: str


class SessionInfo(BaseModel):
    session_id: str
    data_lavoro: str
    messages_count: int


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Invia un messaggio all'agent e ricevi la risposta."""

    # Gestione sessione
    session_id = request.session_id or str(uuid.uuid4())

    # Parse data lavoro
    data_lavoro = None
    if request.data_lavoro:
        try:
            data_lavoro = date.fromisoformat(request.data_lavoro)
        except ValueError:
            raise HTTPException(400, "Formato data non valido. Usa YYYY-MM-DD")

    # Crea o recupera agent
    if session_id not in sessions:
        sessions[session_id] = PlanningAgent(
            config=get_settings().llm,
            data_lavoro=data_lavoro
        )

    agent = sessions[session_id]

    # Aggiorna data lavoro se specificata
    if data_lavoro and agent.data_lavoro != data_lavoro:
        agent.data_lavoro = data_lavoro
        agent.reset_conversation()

    # Invia messaggio
    try:
        response = agent.chat(request.message)
        return ChatResponse(response=response, session_id=session_id)
    except Exception as e:
        raise HTTPException(500, f"Errore agent: {str(e)}")


@app.post("/sessions/{session_id}/reset")
async def reset_session(session_id: str):
    """Resetta la conversazione di una sessione."""
    if session_id in sessions:
        sessions[session_id].reset_conversation()
        return {"status": "ok", "message": "Conversazione resettata"}
    raise HTTPException(404, "Sessione non trovata")


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str):
    """Elimina una sessione."""
    if session_id in sessions:
        del sessions[session_id]
        return {"status": "ok", "message": "Sessione eliminata"}
    raise HTTPException(404, "Sessione non trovata")


@app.get("/sessions/{session_id}", response_model=SessionInfo)
async def get_session(session_id: str):
    """Info su una sessione."""
    if session_id not in sessions:
        raise HTTPException(404, "Sessione non trovata")

    agent = sessions[session_id]
    return SessionInfo(
        session_id=session_id,
        data_lavoro=agent.data_lavoro.isoformat(),
        messages_count=len(agent.messages)
    )


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "healthy"}


# Azioni rapide (shortcut per comandi comuni)
@app.post("/actions/stato")
async def azione_stato(session_id: str, data: Optional[str] = None):
    """Mostra stato pianificazione."""
    return await chat(ChatRequest(
        message="Mostrami lo stato della pianificazione",
        session_id=session_id,
        data_lavoro=data
    ))


@app.post("/actions/suggerisci")
async def azione_suggerisci(session_id: str, data: Optional[str] = None):
    """Genera suggerimenti pianificazione."""
    return await chat(ChatRequest(
        message="Suggerisci una pianificazione ottimizzata",
        session_id=session_id,
        data_lavoro=data
    ))
```

### 1.3 Avvio Server

```bash
# Sviluppo
uvicorn agent.api.server:app --reload --host 0.0.0.0 --port 8000

# Produzione
uvicorn agent.api.server:app --host 0.0.0.0 --port 8000 --workers 4
```

### 1.4 Integrazione Frontend (JavaScript/TypeScript)

```typescript
// chat-client.ts
class PlanningChatClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async sendMessage(message: string, dataLavoro?: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        session_id: this.sessionId,
        data_lavoro: dataLavoro
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }

    const data = await response.json();
    this.sessionId = data.session_id;
    return data.response;
  }

  async reset(): Promise<void> {
    if (!this.sessionId) return;

    await fetch(`${this.baseUrl}/sessions/${this.sessionId}/reset`, {
      method: 'POST'
    });
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}

// Uso
const chat = new PlanningChatClient('http://localhost:8000');

async function handleUserMessage(userMessage: string) {
  const response = await chat.sendMessage(userMessage, '2026-02-27');
  displayResponse(response);
}
```

### 1.5 Componente React

```tsx
// PlanningChat.tsx
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface PlanningChatProps {
  apiUrl?: string;
  dataLavoro?: string;
}

export const PlanningChat: React.FC<PlanningChatProps> = ({
  apiUrl = 'http://localhost:8000',
  dataLavoro
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');

    // Aggiungi messaggio utente
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    }]);

    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          session_id: sessionId,
          data_lavoro: dataLavoro
        })
      });

      if (!response.ok) {
        throw new Error(`Errore: ${response.status}`);
      }

      const data = await response.json();
      setSessionId(data.session_id);

      // Aggiungi risposta agent
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: data.response,
        timestamp: new Date()
      }]);

    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Errore: ${error instanceof Error ? error.message : 'Sconosciuto'}`,
        timestamp: new Date()
      }]);
    } finally {
      setLoading(false);
    }
  };

  const resetChat = async () => {
    if (sessionId) {
      await fetch(`${apiUrl}/sessions/${sessionId}/reset`, { method: 'POST' });
    }
    setMessages([]);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="planning-chat">
      {/* Header */}
      <div className="chat-header">
        <h3>Assistente Pianificazione</h3>
        <button onClick={resetChat} disabled={loading}>
          Reset
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-content">
              {msg.role === 'assistant' ? (
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              ) : (
                msg.content
              )}
            </div>
            <div className="message-time">
              {msg.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant loading">
            <span className="typing-indicator">...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Scrivi un messaggio..."
          disabled={loading}
          rows={2}
        />
        <button onClick={sendMessage} disabled={loading || !input.trim()}>
          Invia
        </button>
      </div>

      {/* Quick Actions */}
      <div className="quick-actions">
        <button onClick={() => setInput('Mostrami lo stato della pianificazione')}>
          📊 Stato
        </button>
        <button onClick={() => setInput('Suggerisci una pianificazione')}>
          💡 Suggerisci
        </button>
        <button onClick={() => setInput('Mostrami i viaggi da pianificare')}>
          🚛 Viaggi
        </button>
      </div>
    </div>
  );
};
```

### 1.6 CSS per il Componente

```css
/* planning-chat.css */
.planning-chat {
  display: flex;
  flex-direction: column;
  height: 600px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #1976d2;
  color: white;
}

.chat-header h3 {
  margin: 0;
  font-size: 16px;
}

.chat-header button {
  background: rgba(255,255,255,0.2);
  border: none;
  color: white;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: #f5f5f5;
}

.message {
  margin-bottom: 12px;
  max-width: 80%;
}

.message.user {
  margin-left: auto;
}

.message.assistant {
  margin-right: auto;
}

.message-content {
  padding: 10px 14px;
  border-radius: 12px;
  line-height: 1.4;
}

.message.user .message-content {
  background: #1976d2;
  color: white;
  border-bottom-right-radius: 4px;
}

.message.assistant .message-content {
  background: white;
  border: 1px solid #e0e0e0;
  border-bottom-left-radius: 4px;
}

.message-content table {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 13px;
}

.message-content th,
.message-content td {
  border: 1px solid #ddd;
  padding: 6px 8px;
  text-align: left;
}

.message-content th {
  background: #f0f0f0;
}

.message-time {
  font-size: 11px;
  color: #999;
  margin-top: 4px;
  text-align: right;
}

.chat-input {
  display: flex;
  padding: 12px;
  background: white;
  border-top: 1px solid #e0e0e0;
  gap: 8px;
}

.chat-input textarea {
  flex: 1;
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 8px;
  resize: none;
  font-family: inherit;
}

.chat-input button {
  padding: 10px 20px;
  background: #1976d2;
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
}

.chat-input button:disabled {
  background: #ccc;
}

.quick-actions {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: #fafafa;
  border-top: 1px solid #e0e0e0;
}

.quick-actions button {
  padding: 6px 12px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 16px;
  cursor: pointer;
  font-size: 13px;
}

.quick-actions button:hover {
  background: #f0f0f0;
}

.typing-indicator {
  display: inline-block;
  animation: blink 1s infinite;
}

@keyframes blink {
  50% { opacity: 0.5; }
}
```

---

## Opzione 2: WebSocket per Real-Time

Per risposte streaming e comunicazione bidirezionale.

### 2.1 Server WebSocket (`agent/api/websocket_server.py`)

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import Dict
import json

from agent.llm_agent import PlanningAgent
from agent.config import get_settings

app = FastAPI()

connections: Dict[str, WebSocket] = {}
agents: Dict[str, PlanningAgent] = {}


@app.websocket("/ws/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: str):
    await websocket.accept()
    connections[session_id] = websocket

    # Crea agent per sessione
    if session_id not in agents:
        agents[session_id] = PlanningAgent(
            config=get_settings().llm,
            data_lavoro=None
        )

    agent = agents[session_id]

    try:
        while True:
            # Ricevi messaggio
            data = await websocket.receive_text()
            message = json.loads(data)

            if message.get("type") == "chat":
                user_msg = message.get("content", "")

                # Invia indicatore "typing"
                await websocket.send_json({
                    "type": "typing",
                    "status": True
                })

                # Processa messaggio
                try:
                    response = agent.chat(user_msg)
                    await websocket.send_json({
                        "type": "message",
                        "role": "assistant",
                        "content": response
                    })
                except Exception as e:
                    await websocket.send_json({
                        "type": "error",
                        "content": str(e)
                    })
                finally:
                    await websocket.send_json({
                        "type": "typing",
                        "status": False
                    })

            elif message.get("type") == "reset":
                agent.reset_conversation()
                await websocket.send_json({
                    "type": "system",
                    "content": "Conversazione resettata"
                })

            elif message.get("type") == "set_date":
                from datetime import date
                data_str = message.get("date")
                agent.data_lavoro = date.fromisoformat(data_str)
                agent.reset_conversation()
                await websocket.send_json({
                    "type": "system",
                    "content": f"Data impostata: {data_str}"
                })

    except WebSocketDisconnect:
        del connections[session_id]
        # Mantieni agent per riconnessione
```

### 2.2 Client WebSocket JavaScript

```typescript
// websocket-client.ts
class PlanningWebSocketClient {
  private ws: WebSocket | null = null;
  private sessionId: string;
  private onMessage: (msg: any) => void;
  private onTyping: (isTyping: boolean) => void;
  private reconnectAttempts = 0;

  constructor(
    sessionId: string,
    onMessage: (msg: any) => void,
    onTyping: (isTyping: boolean) => void
  ) {
    this.sessionId = sessionId;
    this.onMessage = onMessage;
    this.onTyping = onTyping;
  }

  connect(url: string = 'ws://localhost:8000') {
    this.ws = new WebSocket(`${url}/ws/${this.sessionId}`);

    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'typing') {
        this.onTyping(data.status);
      } else {
        this.onMessage(data);
      }
    };

    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.attemptReconnect(url);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  private attemptReconnect(url: string) {
    if (this.reconnectAttempts < 5) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(url), 2000 * this.reconnectAttempts);
    }
  }

  sendMessage(content: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'chat', content }));
    }
  }

  reset() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'reset' }));
    }
  }

  setDate(date: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'set_date', date }));
    }
  }

  disconnect() {
    this.ws?.close();
  }
}
```

---

## Opzione 3: Embedding come Widget

Widget JavaScript standalone da includere in qualsiasi pagina.

### 3.1 Widget Bundle (`dist/planning-chat-widget.js`)

```javascript
// planning-chat-widget.js
(function() {
  const WIDGET_STYLES = `
    .pcw-container { /* ... stili CSS inline ... */ }
  `;

  class PlanningChatWidget {
    constructor(config) {
      this.apiUrl = config.apiUrl || 'http://localhost:8000';
      this.containerId = config.containerId || 'planning-chat';
      this.sessionId = null;
      this.messages = [];

      this.init();
    }

    init() {
      // Inietta stili
      const style = document.createElement('style');
      style.textContent = WIDGET_STYLES;
      document.head.appendChild(style);

      // Crea UI
      this.render();
      this.bindEvents();
    }

    render() {
      const container = document.getElementById(this.containerId);
      container.innerHTML = `
        <div class="pcw-chat">
          <div class="pcw-header">
            <span>Assistente Pianificazione</span>
            <button class="pcw-reset">Reset</button>
          </div>
          <div class="pcw-messages"></div>
          <div class="pcw-input-area">
            <input type="text" class="pcw-input" placeholder="Scrivi...">
            <button class="pcw-send">Invia</button>
          </div>
        </div>
      `;
    }

    bindEvents() {
      const container = document.getElementById(this.containerId);
      const input = container.querySelector('.pcw-input');
      const sendBtn = container.querySelector('.pcw-send');
      const resetBtn = container.querySelector('.pcw-reset');

      sendBtn.addEventListener('click', () => this.sendMessage(input.value));
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendMessage(input.value);
      });
      resetBtn.addEventListener('click', () => this.reset());
    }

    async sendMessage(text) {
      if (!text.trim()) return;

      // Clear input
      const input = document.querySelector('.pcw-input');
      input.value = '';

      // Add user message
      this.addMessage('user', text);

      // Send to API
      try {
        const response = await fetch(`${this.apiUrl}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            session_id: this.sessionId
          })
        });

        const data = await response.json();
        this.sessionId = data.session_id;
        this.addMessage('assistant', data.response);

      } catch (error) {
        this.addMessage('assistant', 'Errore di connessione');
      }
    }

    addMessage(role, content) {
      const container = document.querySelector('.pcw-messages');
      const msg = document.createElement('div');
      msg.className = `pcw-message pcw-${role}`;
      msg.innerHTML = this.formatContent(content);
      container.appendChild(msg);
      container.scrollTop = container.scrollHeight;
    }

    formatContent(content) {
      // Basic markdown to HTML
      return content
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
    }

    async reset() {
      if (this.sessionId) {
        await fetch(`${this.apiUrl}/sessions/${this.sessionId}/reset`, {
          method: 'POST'
        });
      }
      document.querySelector('.pcw-messages').innerHTML = '';
    }
  }

  // Esponi globalmente
  window.PlanningChatWidget = PlanningChatWidget;
})();
```

### 3.2 Uso Widget in HTML

```html
<!DOCTYPE html>
<html>
<head>
  <title>La Mia App</title>
</head>
<body>
  <!-- Contenitore widget -->
  <div id="planning-chat"></div>

  <!-- Carica widget -->
  <script src="https://your-server.com/dist/planning-chat-widget.js"></script>
  <script>
    new PlanningChatWidget({
      apiUrl: 'http://localhost:8000',
      containerId: 'planning-chat'
    });
  </script>
</body>
</html>
```

---

## Configurazione Produzione

### Variabili Ambiente

```bash
# .env
OPENROUTER_API_KEY=sk-or-v1-xxxxx

# API endpoints interni
TIR_API_URL=http://192.168.0.12:9090
BERLINK_API_URL=http://192.168.0.12:9095

# Configurazione LLM
LLM_MODEL=anthropic/claude-3-5-haiku
LLM_TEMPERATURE=0.1
```

### Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  planning-api:
    build: .
    ports:
      - "8000:8000"
    environment:
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:alpine
    ports:
      - "6379:6379"
```

### Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "agent.api.server:app", "--host", "0.0.0.0", "--port", "8000"]
```

---

## API Reference

### Endpoints

| Metodo | Endpoint | Descrizione |
|--------|----------|-------------|
| POST | `/chat` | Invia messaggio, ricevi risposta |
| GET | `/sessions/{id}` | Info sessione |
| POST | `/sessions/{id}/reset` | Reset conversazione |
| DELETE | `/sessions/{id}` | Elimina sessione |
| GET | `/health` | Health check |
| POST | `/actions/stato` | Shortcut: stato pianificazione |
| POST | `/actions/suggerisci` | Shortcut: genera suggerimenti |

### Schema Richiesta Chat

```json
{
  "message": "Mostrami i viaggi da pianificare",
  "session_id": "uuid-opzionale",
  "data_lavoro": "2026-02-27"
}
```

### Schema Risposta Chat

```json
{
  "response": "Ho trovato 15 viaggi...\n| BG | Cliente | ... |",
  "session_id": "abc-123-def"
}
```

---

## Tools Disponibili nell'Agent

L'agent ha accesso a questi tools per rispondere alle domande:

| Tool | Descrizione |
|------|-------------|
| `get_viaggi_da_pianificare` | Lista viaggi da pianificare |
| `get_semirimorchi_disponibili` | Semirimorchi liberi |
| `get_autisti_disponibili` | Autisti disponibili |
| `get_pianificazione_corrente` | Pianificazione esistente |
| `suggerisci_pianificazione` | Genera suggerimenti ottimizzati |
| `assegna_viaggio` | Assegna viaggio a semirimorchio |
| `get_dettaglio_viaggio` | Dettagli completi viaggio |
| `get_dettaglio_semirimorchio` | Dettagli semirimorchio |
| `cerca_autista` | Cerca autista per nome |
| `get_posizione_gps` | GPS real-time |
| `calcola_distanza` | Distanza tra località |
| `get_statistiche_viaggi` | Statistiche aggregate |

---

## Esempi di Messaggi

```
"Mostrami i viaggi da pianificare per oggi"
"Quali semirimorchi SILOS sono disponibili?"
"Suggerisci una pianificazione ottimizzata"
"Assegna il viaggio 26A01289 al semirimorchio AD 24208"
"Dov'è il semirimorchio AD 24100?"
"Mostrami le statistiche degli ultimi 7 giorni"
```

---

## Note Importanti

1. **Sessioni**: Ogni sessione mantiene la history della conversazione. Usa lo stesso `session_id` per continuare una conversazione.

2. **Data di lavoro**: La data influenza quali viaggi e risorse vengono mostrate. Imposta sempre una data esplicita.

3. **Rate Limiting**: L'API OpenRouter ha limiti. In produzione, implementa caching e rate limiting.

4. **Sicurezza**: In produzione:
   - Usa HTTPS
   - Implementa autenticazione (JWT, API keys)
   - Limita CORS a domini specifici
   - Valida tutti gli input

5. **Persistenza**: In produzione, usa Redis per sessioni invece della memoria.
