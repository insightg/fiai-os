# 7 Idee LLM per la Pianificazione — Specifiche di Implementazione

## Stato implementazione

| # | Idea | Stato | Data |
|---|------|-------|------|
| 1 | Spiegazione assegnazioni | **IMPLEMENTATA** | 2026-03-15 |
| 2 | Override intelligente | Da fare | - |
| 3 | Assistente Viaggi Non Assegnati | **IMPLEMENTATA** | 2026-03-16 |
| 4 | Validazione dati pre-ottimizzazione | **IMPLEMENTATA** | 2026-03-15 |
| 5 | Ragionamento Conflitti e Priorità | **IMPLEMENTATA** | 2026-03-16 |
| 6 | Chat What-If Interattiva | **IMPLEMENTATA** | 2026-03-16 |
| 7 | Report giornaliero | **IMPLEMENTATA** | 2026-03-15 |

## Contesto

L'LLM oggi funge da interfaccia conversazionale con 17 tool. L'optimizer lavora in modo puramente algoritmico (greedy + scoring pesato). Queste 7 idee portano l'LLM dentro il processo decisionale.

**Architettura attuale di riferimento:**
- Optimizer: `agent/planner/optimizer.py` → `ottimizza_da_database()` → `Pianificazione`
- Feedback: `agent/planner/feedback.py` → `confronta()` → `FeedbackReport`
- Tools LLM: `agent/tools/planning_tools.py` → `TOOLS_SCHEMA` + `TOOLS_FUNCTIONS`
- Agent: `agent/llm_agent.py` → `PlanningAgent` con system prompt + tool calling
- History: `agent/planner/history_learner.py` → `learned_patterns.json`
- Config: `agent/config.py` → `get_settings()` singleton

---

## Idea 1: Spiegazione Intelligente delle Assegnazioni

### Obiettivo
L'operatore capisce *perché* l'optimizer ha scelto quella coppia, vedendo alternative scartate e motivi.

### Cosa manca oggi
`valuta_assegnazione_coppia()` restituisce solo `ScoreAssegnazione` per il candidato scelto. I candidati scartati e i motivi di esclusione vengono persi nel loop di assegnazione in `genera_pianificazione_coppie()`.

### Modifiche

#### 1.1 — `agent/planner/optimizer.py`

**Nuovo dataclass** `CandidatoValutato`:
```python
@dataclass
class CandidatoValutato:
    targa: str
    autista: str
    score_totale: float
    score_distanza: float
    score_tipo: float
    score_autista: float
    score_tempo: float
    km_vuoto: float
    escluso: bool
    motivo_esclusione: str  # "" se non escluso
```

**Modificare `genera_pianificazione_coppie()`**: nel loop interno dove si valutano le coppie per ogni viaggio, raccogliere tutti i candidati (scelti e scartati) in una lista `candidati_valutati: List[CandidatoValutato]`.

Aggiungere ad `AssegnazionePianificazione` un nuovo campo:
```python
candidati_valutati: List[CandidatoValutato] = field(default_factory=list)
```

**Nel loop di assegnazione** (dove oggi fa `sorted(scores, key=lambda x: x.score_totale, reverse=True)[0]`):
- Per ogni coppia candidata, salvare il `CandidatoValutato` con i punteggi
- Per ogni coppia esclusa da un filtro, salvare con `escluso=True` e `motivo_esclusione`
- Limitare a top 5 candidati + top 5 esclusi per non appesantire

#### 1.2 — `agent/tools/planning_tools.py`

**Nuovo tool** `spiega_assegnazione`:
```python
def spiega_assegnazione(codice_bg: str, data: str) -> str:
    """Spiega perché l'optimizer ha scelto questa coppia per il viaggio"""
```

Logica:
1. Recupera la `Pianificazione` dalla session (o ricalcola)
2. Trova l'`AssegnazionePianificazione` per quel BG
3. Legge `candidati_valutati`
4. Costruisce prompt per l'LLM con i dati strutturati:
   - Candidato scelto: targa, autista, scores breakdown
   - Top 3 alternative: perché hanno score inferiore
   - Top 3 esclusi: quale filtro li ha bloccati

**Alternativa senza LLM** (template): se non si vuole una chiamata LLM aggiuntiva, generare la spiegazione con un template Python:
```python
def _genera_spiegazione_template(assegnazione: AssegnazionePianificazione) -> str:
    parti = []
    scelto = assegnazione  # candidato vincente

    # Perché questo
    if scelto.distanza_km == 0:
        parti.append(f"Semi già in posizione (0 km)")
    elif scelto.distanza_km <= 50:
        parti.append(f"Molto vicino ({scelto.distanza_km:.0f} km)")

    # Perché non gli altri
    for alt in assegnazione.candidati_valutati[:3]:
        if alt.escluso:
            parti.append(f"{alt.targa}/{alt.autista} escluso: {alt.motivo_esclusione}")
        elif alt.score_totale < scelto.score_totale:
            diff = scelto.score_totale - alt.score_totale
            parti.append(f"{alt.targa}/{alt.autista} scartato (score {alt.score_totale:.2f}, -{diff:.2f})")

    return "\n".join(parti)
```

#### 1.3 — `agent/web/components/dettaglio_assegnazione.py`

In `render_dettaglio_info()`, dopo la sezione "Motivo assegnazione", aggiungere un expander:
```python
if assegnazione.get("candidati_valutati"):
    with st.expander("Perché questa assegnazione?"):
        st.markdown(spiegazione_testuale)
        # Tabellina candidati alternativi
        st.dataframe(df_candidati, hide_index=True)
```

#### 1.4 — Propagazione dati

`suggerisci_pianificazione()` in `planning_tools.py` converte `Pianificazione` → dict per la UI. Aggiungere il campo `candidati_valutati` nella serializzazione di ogni suggerimento:
```python
suggerimento["candidati_valutati"] = [
    {
        "targa": c.targa, "autista": c.autista,
        "score": c.score_totale, "escluso": c.escluso,
        "motivo": c.motivo_esclusione
    }
    for c in assegnazione.candidati_valutati[:8]
]
```

### Verifica
- Lanciare ottimizzazione → ogni assegnazione ha `candidati_valutati` popolato
- Nel dettaglio UI, l'expander mostra spiegazione + tabella alternative
- Tool LLM `spiega_assegnazione` restituisce spiegazione leggibile

---

## Idea 2: Analisi Feedback e Suggerimenti di Tuning

### Obiettivo
L'LLM analizza i pattern di override nei feedback storici e suggerisce aggiustamenti ai pesi/regole dell'optimizer.

### Cosa manca oggi
Il feedback loop salva `data/feedback/feedback_YYYYMMDD.json` e `data/proposte/proposta_*.json`, ma nessuno li analizza sistematicamente. `alimenta_learner()` aggiorna le frequenze ma non interpreta i *perché*.

### Modifiche

#### 2.1 — `agent/planner/feedback.py`

**Nuova funzione** `aggrega_feedback`:
```python
def aggrega_feedback(giorni: int = 30) -> Dict:
    """Aggrega i feedback degli ultimi N giorni in metriche analizzabili."""
```

Restituisce:
```python
{
    "periodo": {"da": "2026-02-15", "a": "2026-03-15"},
    "totale_proposte": 450,
    "acceptance_rate_medio": 0.72,
    "per_stato": {
        "ACCETTATA": 324,
        "SEMI_MODIFICATO": 45,
        "AUTISTA_MODIFICATO": 36,
        "COMPLETAMENTE_MODIFICATA": 27,
        "NON_ASSEGNATO_TIR": 12,
        "AGGIUNTO_MANUALMENTE": 6
    },
    "override_per_cliente": {
        "CLIENTE_X": {"totale": 20, "override": 12, "rate": 0.60},
        ...
    },
    "override_per_genere": {
        "container_combinato": {"totale": 30, "override": 15, "rate": 0.50},
        ...
    },
    "override_per_autista": {
        "Rossi Mario": {"proposto": 15, "confermato": 8, "sostituito_con": {"Bianchi": 4, "Verdi": 3}},
        ...
    },
    "score_accettati_vs_rifiutati": {
        "media_score_accettati": 0.78,
        "media_score_rifiutati": 0.45,
        "soglia_suggerita": 0.55
    },
    "pattern_sostituzione_targa": [
        {"da_tipo": "CENTINATO", "a_tipo": "ROTOCELLA", "frequenza": 8, "clienti": ["X", "Y"]},
        ...
    ]
}
```

Implementazione: legge tutti i file `data/feedback/feedback_*.json` nel range date, incrocia con `data/proposte/proposta_*.json` per i dettagli score, aggrega con Counter/defaultdict.

#### 2.2 — `agent/tools/planning_tools.py`

**Nuovo tool** `analizza_feedback`:
```python
def analizza_feedback(giorni: int = 30) -> str:
    """Analizza i pattern di override nei feedback degli ultimi N giorni.
    Restituisce metriche aggregate e pattern identificati."""
```

Chiama `aggrega_feedback(giorni)` e restituisce il JSON formattato.

**Nuovo tool** `suggerisci_tuning`:
```python
def suggerisci_tuning(giorni: int = 30) -> str:
    """Basandosi sull'analisi feedback, suggerisce modifiche ai pesi e regole."""
```

Questo tool chiama `aggrega_feedback()` e poi costruisce un prompt strutturato per l'LLM con:
- Pesi attuali da `config/optimization.yaml`
- Metriche aggregate
- Pattern di override

L'LLM ragiona e produce suggerimenti tipo:
- "Aumentare peso tipo_semirimorchio da 0.30 a 0.35 (troppe sostituzioni tipo)"
- "Aggiungere regola: CLIENTE_X → preferire autisti zona Veneto"
- "Soglia minima score: alzare da 0 a 0.40 (sotto questa soglia, 80% override)"

#### 2.3 — Registrazione tool

In `TOOLS_SCHEMA` aggiungere le definizioni OpenAI function calling per `analizza_feedback` e `suggerisci_tuning`.

In `TOOLS_FUNCTIONS` mappare i nomi alle funzioni.

#### 2.4 — CLI

In `agent/main.py`, aggiungere comando:
```python
@app.command()
def analizza_feedback(giorni: int = 30):
    """Analizza pattern di override nei feedback"""
```

### Verifica
- `python run.py analizza-feedback 30` → stampa metriche aggregate
- In chat: "analizza i feedback dell'ultimo mese" → LLM chiama tool e produce analisi
- In chat: "suggerisci come migliorare i pesi" → LLM produce raccomandazioni concrete

---

## Idea 3: Assistente per Viaggi Non Assegnati

### Obiettivo
Per ogni viaggio non assegnato, l'LLM propone strategie concrete con trade-off quantificati.

### Cosa manca oggi
`motivi_non_assegnati` in `Pianificazione` è una lista di stringhe generiche. Non c'è ragionamento su come risolvere.

### Modifiche

#### 3.1 — `agent/planner/optimizer.py`

**Nuova funzione** `analizza_non_assegnato`:
```python
def analizza_non_assegnato(
    self,
    viaggio: Viaggio,
    coppie_tutte: List[CoppiaSemirimorchioAutista],
    assegnazioni_correnti: List[AssegnazionePianificazione],
    rilassamenti: List[str] = None  # ["distanza", "tipo", "impiego"]
) -> Dict:
    """Analizza un viaggio non assegnato e propone strategie di risoluzione."""
```

Logica:
1. **Diagnostica**: per ogni filtro hard, conta quante coppie passano → identifica il collo di bottiglia
   ```python
   diagnostica = {
       "coppie_totali": len(coppie_tutte),
       "dopo_filtro_tipo": N,      # quante passano il filtro tipo
       "dopo_filtro_distanza": N,   # quante passano il filtro distanza
       "dopo_filtro_impiego": N,    # quante passano il filtro impiego
       "collo_di_bottiglia": "distanza"  # il filtro che elimina più candidati
   }
   ```

2. **Rilassamento distanza**: ricalcola con `max_driver_distance_km` aumentato di 50km, 100km
   ```python
   opzioni_distanza = []
   for extra_km in [50, 100, 150]:
       candidati = self._filtra_con_distanza(viaggio, coppie_libere, max_km=350+extra_km)
       if candidati:
           best = max(candidati, key=lambda c: c.score_totale)
           opzioni_distanza.append({
               "raggio_km": 350 + extra_km,
               "candidati": len(candidati),
               "migliore": {"targa": best.targa, "autista": best.autista, "score": best.score_totale}
           })
   ```

3. **Scambio assegnazioni**: per ogni coppia già assegnata che sarebbe compatibile con questo viaggio, calcola il costo dello scambio
   ```python
   opzioni_scambio = []
   for assegnazione in assegnazioni_correnti:
       coppia = assegnazione.coppia
       if self._e_compatibile(viaggio, coppia):
           # Score se questa coppia facesse il viaggio non assegnato
           score_nuovo = self.valuta_assegnazione_coppia(viaggio, coppia)
           # Score dell'assegnazione che si perderebbe
           score_perso = assegnazione.score_totale
           # Possibilità di riassegnare il viaggio liberato
           ...
           opzioni_scambio.append({
               "libera_bg": assegnazione.viaggio.bg,
               "coppia": {"targa": coppia.targa, "autista": coppia.autista},
               "score_nuovo_viaggio": score_nuovo.score_totale,
               "score_perso": score_perso,
               "delta": score_nuovo.score_totale - score_perso
           })
   ```

4. **Risorse esterne**: lista coppie non utilizzate (trazionisti) che potrebbero essere disponibili
   ```python
   opzioni_esterne = [
       {"targa": c.targa, "autista": c.autista, "tipo": c.tipo, "posizione": c.posizione}
       for c in coppie_non_utilizzate
       if self._e_compatibile_tipo(viaggio, c)
   ]
   ```

Restituisce:
```python
{
    "bg": "26A01289",
    "diagnostica": diagnostica,
    "opzioni": {
        "rilassamento_distanza": opzioni_distanza,
        "scambio_assegnazioni": opzioni_scambio[:5],  # top 5
        "risorse_esterne": opzioni_esterne[:5]
    }
}
```

#### 3.2 — `agent/tools/planning_tools.py`

**Nuovo tool** `analizza_viaggio_non_assegnato`:
```python
def analizza_viaggio_non_assegnato(codice_bg: str, data: str) -> str:
    """Analizza un viaggio non assegnato e propone strategie per assegnarlo."""
```

Chiama `optimizer.analizza_non_assegnato()` e restituisce il risultato formattato.

#### 3.3 — `agent/web/components/risultati_pianificazione.py`

In `_render_viaggi_non_assegnati()`, per ogni viaggio aggiungere un bottone "Analizza":
```python
if cols[4].button("Analizza", key=f"btn_analizza_{v['bg']}"):
    with st.spinner("Analisi in corso..."):
        analisi = optimizer.analizza_non_assegnato(viaggio, ...)
    st.session_state[f"analisi_{v['bg']}"] = analisi

if st.session_state.get(f"analisi_{v['bg']}"):
    _render_analisi_non_assegnato(analisi)
```

`_render_analisi_non_assegnato(analisi)`:
- Mostra diagnostica (quale filtro blocca)
- Tabella opzioni rilassamento distanza
- Tabella opzioni scambio (con delta score)
- Lista risorse esterne disponibili

### Verifica
- Ottimizzare → viaggio non assegnato → click "Analizza" → vedi opzioni concrete
- In chat: "perché BG 26A01289 non è assegnato e come posso risolverlo?" → LLM chiama tool
- Ogni opzione mostra il trade-off numerico (score guadagnato vs perso)

---

## Idea 4: Validazione Pre-Ottimizzazione dei Dati

### Obiettivo
Prima dell'ottimizzazione, segnalare anomalie nei dati in ingresso che potrebbero portare ad assegnazioni sbagliate.

### Cosa manca oggi
L'optimizer prende i dati così come sono. Posizioni GPS stale, autisti vicini al limite ore, incoerenze tra sistemi → assegnazioni subottimali che l'operatore poi override.

### Modifiche

#### 4.1 — `agent/planner/validator.py` (nuovo file)

```python
"""Validazione pre-ottimizzazione dei dati in ingresso."""

from dataclasses import dataclass
from typing import List, Dict, Optional
from datetime import date, datetime

@dataclass
class Anomalia:
    tipo: str        # "warning" | "error"
    categoria: str   # "posizione" | "impiego" | "dati" | "raggruppamento"
    entita: str      # BG, targa, o nome autista
    messaggio: str
    suggerimento: str

def valida_dati_pianificazione(
    viaggi: List[Viaggio],
    coppie: List[CoppiaSemirimorchioAutista],
    data_pianificazione: date
) -> List[Anomalia]:
    anomalie = []
    anomalie.extend(_valida_posizioni_gps(coppie))
    anomalie.extend(_valida_impiego_autisti(coppie, data_pianificazione))
    anomalie.extend(_valida_coerenza_dati(viaggi, coppie))
    anomalie.extend(_identifica_raggruppamenti(viaggi))
    return anomalie
```

**Check specifici:**

```python
def _valida_posizioni_gps(coppie) -> List[Anomalia]:
    """Segnala posizioni GPS potenzialmente obsolete o incoerenti."""
    for coppia in coppie:
        # Posizione non disponibile
        if not coppia.posizione_corrente or coppia.posizione_corrente == "-":
            anomalie.append(Anomalia(
                tipo="warning", categoria="posizione",
                entita=coppia.semirimorchio.targa,
                messaggio=f"Posizione GPS non disponibile",
                suggerimento="Verificare manualmente o escludere dalla pianificazione"
            ))
        # Posizione generica (solo città, nessun dettaglio)
        if coppia.posizione_corrente and len(coppia.posizione_corrente) < 5:
            anomalie.append(Anomalia(...))

def _valida_impiego_autisti(coppie, data) -> List[Anomalia]:
    """Segnala autisti vicini ai limiti EU 561."""
    # Carica impiego settimanale da storico
    for coppia in coppie:
        if coppia.autista:
            ore_settimana = _calcola_ore_settimanali(coppia.autista.id_employee, data)
            if ore_settimana > 50:  # soglia warning (limite 56h)
                anomalie.append(Anomalia(
                    tipo="warning", categoria="impiego",
                    entita=coppia.autista.nome_completo,
                    messaggio=f"Già {ore_settimana:.0f}h questa settimana (limite 56h)",
                    suggerimento=f"Max {56-ore_settimana:.0f}h disponibili oggi"
                ))

def _valida_coerenza_dati(viaggi, coppie) -> List[Anomalia]:
    """Segnala incoerenze tra TIR e BERLINK."""
    # Semi risulta disponibile in BERLINK ma ha viaggio assegnato in TIR
    # Autista in lista disponibili ma con assenza registrata
    ...

def _identifica_raggruppamenti(viaggi) -> List[Anomalia]:
    """Identifica viaggi raggruppabili (stessa destinazione, stesso cliente)."""
    from collections import Counter
    dest_counter = Counter((v.luogo_scarico, v.cliente) for v in viaggi)
    for (dest, cliente), count in dest_counter.items():
        if count >= 3:
            bgs = [v.bg for v in viaggi if v.luogo_scarico == dest and v.cliente == cliente]
            anomalie.append(Anomalia(
                tipo="info", categoria="raggruppamento",
                entita=f"{cliente}/{dest}",
                messaggio=f"{count} viaggi per stessa destinazione: {', '.join(bgs)}",
                suggerimento="Considerare sequenziamento o autista dedicato"
            ))
```

#### 4.2 — `agent/planner/optimizer.py`

In `ottimizza_da_database()`, chiamare il validator prima dell'ottimizzazione:
```python
from .validator import valida_dati_pianificazione

anomalie = valida_dati_pianificazione(viaggi, coppie, data_pianificazione)
pianificazione.anomalie_pre = anomalie  # nuovo campo
```

Aggiungere campo `anomalie_pre: List[Anomalia]` a `Pianificazione`.

#### 4.3 — `agent/tools/planning_tools.py`

**Nuovo tool** `valida_dati`:
```python
def valida_dati(data: str) -> str:
    """Valida i dati in ingresso prima dell'ottimizzazione, segnalando anomalie."""
```

#### 4.4 — `agent/web/components/risultati_pianificazione.py`

In `render_risultati_pianificazione()`, prima della KPI bar, se ci sono anomalie:
```python
anomalie = risultato.get("anomalie_pre", [])
if anomalie:
    with st.expander(f"Anomalie rilevate ({len(anomalie)})", expanded=any(a['tipo']=='error' for a in anomalie)):
        for a in anomalie:
            icon = "ERR" if a["tipo"] == "error" else "WARN" if a["tipo"] == "warning" else "INFO"
            st.markdown(f"**[{icon}] {a['entita']}**: {a['messaggio']}")
            st.caption(f"Suggerimento: {a['suggerimento']}")
```

### Verifica
- Lanciare ottimizzazione con dati sporchi → anomalie mostrate in UI
- In chat: "valida i dati per domani" → LLM chiama tool e lista problemi
- Anomalie tipo "error" evidenziate in modo prominente

---

## Idea 5: Ragionamento su Conflitti e Priorità

### Obiettivo
Quando due viaggi competono per la stessa risorsa scarsa, l'LLM ragiona sulle priorità di business.

### Cosa manca oggi
L'optimizer usa solo scarsità (viaggi con meno opzioni → serviti prima). Non considera margini cliente, importanza strategica, urgenza.

### Modifiche

#### 5.1 — `agent/planner/optimizer.py`

**Tracciamento conflitti**: nel loop di `genera_pianificazione_coppie()`, quando una coppia viene assegnata e c'era un altro viaggio che la voleva, registrare il conflitto.

**Nuovo dataclass**:
```python
@dataclass
class ConflittoRisorsa:
    risorsa: str  # targa semi
    autista: str
    viaggio_assegnato_bg: str
    viaggio_assegnato_score: float
    viaggio_penalizzato_bg: str
    viaggio_penalizzato_score_potenziale: float
    score_alternativa_penalizzato: float  # miglior score con altra coppia, 0 se nessuna
    impatto: str  # "riassegnato" | "non_assegnato" | "score_ridotto"
```

Nel loop, dopo l'assegnazione di una coppia a un viaggio:
```python
# Per ogni altro viaggio che voleva questa coppia
for altro_viaggio in viaggi_rimanenti:
    if coppia in candidati_per_viaggio[altro_viaggio.bg]:
        score_potenziale = scores_cache[(altro_viaggio.bg, coppia.id)]
        conflitti.append(ConflittoRisorsa(
            risorsa=coppia.semirimorchio.targa,
            autista=coppia.autista.nome_completo if coppia.autista else "-",
            viaggio_assegnato_bg=viaggio.bg,
            viaggio_assegnato_score=best_score.score_totale,
            viaggio_penalizzato_bg=altro_viaggio.bg,
            viaggio_penalizzato_score_potenziale=score_potenziale.score_totale,
            ...
        ))
```

Aggiungere `conflitti: List[ConflittoRisorsa]` a `Pianificazione`.

#### 5.2 — `config/settings.yaml`

**Nuova sezione** `priorita_clienti` (opzionale, compilata manualmente):
```yaml
priorita_clienti:
  CLIENTE_STORICO_A:
    priorita: 1  # alta
    note: "Cliente strategico, 20% fatturato"
  CLIENTE_NUOVO_B:
    priorita: 3  # bassa
    note: "Primo ordine, da fidelizzare"
```

Se questa sezione non esiste, l'LLM ragiona solo sui dati disponibili (score, tipo, distanza).

#### 5.3 — `agent/tools/planning_tools.py`

**Nuovo tool** `mostra_conflitti`:
```python
def mostra_conflitti(data: str) -> str:
    """Mostra i conflitti di risorse nella pianificazione:
    viaggi che competono per la stessa coppia semi/autista."""
```

Restituisce lista conflitti con contesto:
```
Conflitto #1: Semi AB123 (ROTOCELLA) + Rossi
  Assegnato a: BG001 (CLIENTE_A, Terni→Roma, score 0.82)
  Penalizzato: BG007 (CLIENTE_B, Fiorenzuola→Milano, score potenziale 0.75)
  → BG007 riassegnato a semi CD456 con score 0.58 (-0.17)
  Priorità clienti: CLIENTE_A=1 (alta), CLIENTE_B=3 (bassa) → OK
```

#### 5.4 — `agent/web/components/risultati_pianificazione.py`

Aggiungere tab "Conflitti" accanto a "Non assegnati" e "Risorse libere":
```python
tab_non_assegnati, tab_risorse, tab_conflitti = st.tabs([
    f"Non assegnati ({len(viaggi_non_assegnati)})",
    f"Risorse libere ({len(coppie_non_utilizzate)})",
    f"Conflitti ({len(conflitti)})"
])
```

Nel tab conflitti, per ogni conflitto mostrare:
- I due viaggi in competizione con i rispettivi score
- Bottone "Inverti assegnazione" → scambia le coppie e ricalcola

### Verifica
- Ottimizzare con risorse scarse → tab Conflitti mostra le competizioni
- In chat: "ci sono conflitti nella pianificazione?" → LLM chiama tool
- "Inverti assegnazione" ricalcola correttamente i due viaggi coinvolti

---

## Idea 6: Chat di Pianificazione Interattiva (What-If)

### Obiettivo
L'operatore esplora scenari alternativi conversando con l'LLM: "togli Rossi", "aggiungi un semi", "cosa succede se...".

### Cosa esiste già
- `ricalcola_parziale()` in `planning_tools.py` accetta `bg_da_riassegnare` e `targhe_escluse`
- `suggerisci_pianificazione()` lancia ottimizzazione completa
- L'LLM ha tool calling funzionante

### Cosa manca
Il system prompt non guida l'LLM a interpretare richieste what-if e tradurle in sequenze di tool call. Serve orchestrazione.

### Modifiche

#### 6.1 — `agent/llm_agent.py`

**Arricchire il system prompt** con sezione what-if:

```python
WHAT_IF_PROMPT = """
## Scenari What-If

Quando l'utente chiede "cosa succede se...", devi:

1. CAPIRE lo scenario:
   - "Togli/escludi autista X" → ricalcola escludendo quell'autista
   - "Aggiungi semi Y da posizione Z" → ricalcola con risorsa aggiuntiva
   - "Sposta l'assegnazione di BG001 a semi CD456" → ricalcola con vincolo fisso
   - "Aumenta il raggio a 400km" → ricalcola con parametro modificato

2. ESEGUIRE il ricalcolo:
   - Usa `ricalcola_scenario` per modifiche parametriche
   - Usa `ricalcola_parziale` per modifiche locali (singoli BG)

3. CONFRONTARE i risultati:
   - Mostra delta: quanti viaggi in più/meno assegnati
   - Score medio prima vs dopo
   - Quali viaggi specifici cambiano
   - Impatto su autisti coinvolti

4. NON applicare le modifiche automaticamente. Mostra il confronto e chiedi conferma.

Esempio:
- Utente: "Cosa succede se tolgo Rossi?"
- Tu: chiami get_pianificazione_corrente per lo stato attuale
- Tu: identifichi i BG assegnati a Rossi
- Tu: chiami ricalcola_scenario con escludi_autisti=["Rossi Mario"]
- Tu: confronti e presenti il delta
"""
```

#### 6.2 — `agent/tools/planning_tools.py`

**Nuovo tool** `ricalcola_scenario`:
```python
def ricalcola_scenario(
    data: str,
    escludi_autisti: List[str] = None,
    escludi_targhe: List[str] = None,
    max_distanza_km: int = None,
    bg_fissi: Dict[str, str] = None,  # {bg: targa} assegnazioni da mantenere
) -> str:
    """Ricalcola la pianificazione con vincoli modificati per simulare scenari what-if.
    Restituisce il confronto tra pianificazione corrente e scenario simulato."""
```

Logica:
1. Salva la pianificazione corrente
2. Crea un optimizer con parametri modificati (override temporanei)
3. Esegue `ottimizza_da_database()` con i nuovi vincoli
4. Confronta:
   ```python
   confronto = {
       "assegnati_prima": N1,
       "assegnati_dopo": N2,
       "delta_assegnati": N2 - N1,
       "score_medio_prima": S1,
       "score_medio_dopo": S2,
       "viaggi_cambiati": [
           {"bg": "BG001", "prima": {"targa": "AB123", "score": 0.82}, "dopo": {"targa": "CD456", "score": 0.65}},
           ...
       ],
       "viaggi_persi": ["BG007", ...],  # assegnati prima, non assegnati dopo
       "viaggi_guadagnati": ["BG012", ...],  # non assegnati prima, assegnati dopo
   }
   ```
5. Restituisce confronto formattato

#### 6.3 — `agent/planner/optimizer.py`

Aggiungere supporto per override temporanei in `ottimizza_da_database()`:
```python
def ottimizza_da_database(
    self,
    data_pianificazione: date,
    # ... parametri esistenti ...
    escludi_autisti: List[str] = None,
    escludi_targhe: List[str] = None,
    override_max_distanza: int = None,
    bg_fissi: Dict[str, str] = None,
) -> Pianificazione:
```

Nel loop di filtraggio, applicare le esclusioni:
```python
if escludi_autisti:
    coppie = [c for c in coppie if c.autista and c.autista.nome_completo not in escludi_autisti]
if escludi_targhe:
    coppie = [c for c in coppie if c.semirimorchio.targa not in escludi_targhe]
if override_max_distanza:
    self._max_distance = override_max_distanza  # override temporaneo
```

### Verifica
- In chat: "cosa succede se tolgo Rossi dalla pianificazione di oggi?" → LLM mostra confronto
- In chat: "aumenta il raggio a 400km e mostrami l'impatto" → confronto con delta
- In chat: "sposta BG001 su semi CD456" → ricalcolo con vincolo fisso, mostra effetti a catena
- L'LLM non applica modifiche senza conferma esplicita

---

## Idea 7: Report di Fine Giornata

### Obiettivo
Generare un report narrativo leggibile con trend, colli di bottiglia e suggerimenti operativi.

### Cosa manca oggi
I dati esistono (feedback, pianificazioni, impegni) ma nessuno li aggrega in formato leggibile.

### Modifiche

#### 7.1 — `agent/planner/report.py` (nuovo file)

```python
"""Generazione report giornaliero/settimanale di pianificazione."""

def genera_dati_report(data: date) -> Dict:
    """Aggrega tutti i dati per il report di una giornata."""
```

Restituisce:
```python
{
    "data": "2026-03-15",
    "pianificazione": {
        "totale_viaggi": 32,
        "assegnati": 28,
        "non_assegnati": 4,
        "copertura_pct": 87.5,
        "score_medio": 0.72
    },
    "feedback": {  # se disponibile (confronto con TIR finale)
        "acceptance_rate": 0.75,
        "override_count": 7,
        "override_principali": [
            {"bg": "BG001", "motivo": "autista cambiato", "da": "Rossi", "a": "Bianchi"}
        ]
    },
    "impiego_autisti": {
        "media_impiego": 68.5,
        "sovraccaricati": [
            {"nome": "Rossi Mario", "impiego": 92, "viaggi": 3, "giorni_consecutivi_alto": 3}
        ],
        "sottoutilizzati": [
            {"nome": "Verdi Luigi", "impiego": 15, "viaggi": 1}
        ]
    },
    "colli_di_bottiglia": {
        "zone_carenti": [
            {"zona": "Veneto", "viaggi": 5, "semi_disponibili": 2, "deficit": 3}
        ],
        "tipi_carenti": [
            {"tipo": "ROTOCELLA", "richieste": 8, "disponibili": 5}
        ]
    },
    "viaggi_non_assegnati": [
        {"bg": "BG012", "motivi": ["nessun ROTOCELLA entro 350km"], "cliente": "CLIENTE_X"}
    ]
}
```

Fonti dati:
- `data/proposte/proposta_*.json` per pianificazione del giorno
- `data/feedback/feedback_*.json` per feedback (se disponibile)
- `agent/planner/optimizer.py` per impegni e colli di bottiglia (query API)

#### 7.2 — `agent/tools/planning_tools.py`

**Nuovo tool** `genera_report`:
```python
def genera_report(data: str, tipo: str = "giornaliero") -> str:
    """Genera i dati aggregati per il report di pianificazione.
    tipo: 'giornaliero' o 'settimanale'"""
```

Chiama `genera_dati_report()` e restituisce JSON strutturato. L'LLM poi lo trasforma in report narrativo.

#### 7.3 — `agent/llm_agent.py`

Aggiungere al system prompt una sezione report:
```
## Generazione Report

Quando l'utente chiede un report o un riepilogo della giornata:
1. Chiama `genera_report` per ottenere i dati aggregati
2. Trasforma i dati in un report narrativo con:
   - Riepilogo numerico (copertura, score, acceptance rate)
   - Punti di attenzione (sovraccarichi, colli di bottiglia)
   - Suggerimenti operativi (ridistribuire carico, aggiungere risorse)
   - Trend rispetto ai giorni precedenti (se dati disponibili)
3. Usa un tono professionale ma conciso
```

#### 7.4 — CLI

In `agent/main.py`:
```python
@app.command()
def report(data: str, tipo: str = "giornaliero"):
    """Genera report di pianificazione"""
    from agent.planner.report import genera_dati_report
    dati = genera_dati_report(parse_date(data))
    # Passa i dati all'LLM per generazione narrativa
    agent = PlanningAgent()
    risposta = agent.chat(f"Genera un report {tipo} con questi dati: {json.dumps(dati)}")
    print(risposta)
```

#### 7.5 — Report settimanale

`genera_dati_report()` con `tipo="settimanale"` aggrega 7 giorni:
```python
def genera_dati_report_settimanale(data_fine: date) -> Dict:
    giorni = [genera_dati_report(data_fine - timedelta(days=i)) for i in range(7)]
    return {
        "periodo": f"{data_fine - timedelta(6)} → {data_fine}",
        "trend_copertura": [g["pianificazione"]["copertura_pct"] for g in giorni],
        "trend_score": [g["pianificazione"]["score_medio"] for g in giorni],
        "autisti_piu_usati": ...,  # aggregazione
        "zone_critiche_ricorrenti": ...,
        ...
    }
```

### Verifica
- `python run.py report 2026-03-15` → report narrativo stampato
- In chat: "fammi un riepilogo della giornata" → LLM genera report completo
- In chat: "report settimanale" → trend su 7 giorni con confronti
- Il report identifica correttamente sovraccarichi e colli di bottiglia

---

## Riepilogo File da Creare/Modificare

| File | Azione | Idee |
|------|--------|------|
| `agent/planner/optimizer.py` | Modificare | 1, 3, 5, 6 |
| `agent/planner/feedback.py` | Modificare | 2 |
| `agent/planner/validator.py` | **Creare** | 4 |
| `agent/planner/report.py` | **Creare** | 7 |
| `agent/tools/planning_tools.py` | Modificare | 1, 2, 3, 4, 5, 6, 7 |
| `agent/llm_agent.py` | Modificare | 6, 7 |
| `agent/models/pianificazione.py` | Modificare | 1, 4, 5 |
| `agent/web/components/dettaglio_assegnazione.py` | Modificare | 1 |
| `agent/web/components/risultati_pianificazione.py` | Modificare | 3, 4, 5 |
| `agent/main.py` | Modificare | 2, 7 |
| `config/settings.yaml` | Modificare | 5 |

## Nuovi Tool LLM (da aggiungere a TOOLS_SCHEMA + TOOLS_FUNCTIONS)

| Tool | Idea | Descrizione |
|------|------|-------------|
| `spiega_assegnazione` | 1 | Spiega perché l'optimizer ha scelto questa coppia |
| `analizza_feedback` | 2 | Metriche aggregate override ultimi N giorni |
| `suggerisci_tuning` | 2 | Suggerimenti modifica pesi/regole basati su feedback |
| `analizza_viaggio_non_assegnato` | 3 | Strategie per assegnare un viaggio scoperto |
| `valida_dati` | 4 | Check anomalie dati pre-ottimizzazione |
| `mostra_conflitti` | 5 | Lista conflitti di risorse nella pianificazione |
| `ricalcola_scenario` | 6 | Simulazione what-if con confronto |
| `genera_report` | 7 | Dati aggregati per report narrativo |

## Ordine di Implementazione Suggerito

1. **Idea 1** (Spiegazioni) — fondamentale, sblocca la comprensione dell'operatore
2. **Idea 4** (Validazione) — previene errori a monte, valore immediato
3. **Idea 7** (Report) — bassa complessità, alto valore manageriale
4. **Idea 2** (Analisi feedback) — auto-miglioramento del sistema
5. **Idea 6** (What-if) — trasforma il workflow da reattivo a esplorativo
6. **Idea 3** (Assistente non assegnati) — risolve i casi più critici
7. **Idea 5** (Conflitti) — richiede più dati di business, implementare per ultimo
