# Integrazione RAG nella pianificazione — Roadmap

## Stato attuale

| # | Descrizione | Impatto | Stato |
|---|-------------|---------|-------|
| **1** | Pre-ottimizzazione: suggerimenti RAG per viaggio | Alto | Implementato |
| **2** | Post-ottimizzazione: validazione proposte vs storico | Medio | Da fare |
| **3** | Fallback per viaggi senza match nel learner | Medio | Implementato |

---

## Punto 1 (implementato): Suggerimenti RAG pre-ottimizzazione

Per ogni viaggio, query semantica su ChromaDB con (cliente, destinazione, genere).
Dai risultati con feedback ACCETTATA/PROPOSTA, estrae targa e autista storicamente usati.
Se il candidato corrente matcha il suggerimento RAG → bonus nello score pesato (peso 0.10).

File coinvolti:
- `agent/planner/rag.py` — `get_suggerimenti_per_viaggi()`
- `agent/planner/optimizer.py` — `calcola_score_rag()` + integrazione in `valuta_assegnazione_coppia()`
- `agent/planner/optimization_config.py` — `weight_rag_suggestion`
- `config/optimization.yaml` — `weights.rag_suggestion`

Dettagli scoring in `docs/LOGICHE_ALLOCAZIONE.md`, sezione 3.5.

---

## Punto 2 (futuro): Post-ottimizzazione — validazione proposte vs storico

### Idea

Dopo aver generato la proposta, per ogni assegnazione query RAG per casi simili.
Se storicamente l'operatore ha sempre modificato quel tipo di assegnazione → segnala warning.

### Implementazione

- Nuovo metodo `valida_proposta_con_rag(pianificazione)` in `agent/planner/optimizer.py` o `agent/planner/feedback.py`
- Per ogni assegnazione, cerca nel RAG stessi cliente+destinazione+genere
- Se >50% dei risultati ha `feedback_stato=COMPLETAMENTE_MODIFICATA` → warning
- Output: lista di warning da mostrare in Streamlit/CLI

### Dettagli tecnici

```python
def valida_proposta_con_rag(
    self,
    pianificazione: Pianificazione
) -> List[dict]:
    """
    Valida assegnazioni contro storico RAG.

    Per ogni assegnazione:
    1. Query RAG con (cliente, destinazione, genere)
    2. Conta quanti risultati hanno feedback COMPLETAMENTE_MODIFICATA
    3. Se >50% → warning "assegnazione storicamente modificata"

    Returns:
        Lista di warning:
        [{"bg": str, "motivo": str, "percentuale_modificate": float, "n_risultati": int}]
    """
```

### Dove integrare

- **CLI** (`run.py ottimizza`): stampare warning dopo la proposta
- **Streamlit** (`web/components/risultati_pianificazione.py`): mostrare warning accanto all'assegnazione
- Non modifica lo scoring, solo aggiunge segnalazioni informative

### Valore

Catch early le assegnazioni che probabilmente l'operatore cambierà.
L'operatore vede un avviso tipo: "Storicamente il 70% delle assegnazioni simili è stato modificato" e può decidere subito se accettare o cambiare.

---

## Punto 3 (implementato): Fallback per viaggi senza match nel learner

### Idea

Quando `HistoryLearner.get_score_autista()` ritorna score neutro (0.5) perché non ha pattern
per quel cliente/destinazione, usare RAG per trovare casi semanticamente simili
(es. stessa zona, stesso genere) e suggerire candidati.

### Implementazione

- In `calcola_score_autista()` (`agent/planner/optimizer.py`), se `score_storico == 0.5` (neutro):
  - Query RAG per (cliente, destinazione, genere)
  - Se trova risultati ACCETTATA con autista simile → boost a 0.6-0.7
- Richiede matching fuzzy autista (non exact, perché i nomi possono differire tra sistemi)

### Dettagli tecnici

```python
# In calcola_score_autista(), dopo il calcolo esperienza storica:

if score_esperienza == 0.5 and self._rag_suggerimenti:
    # Nessuno storico nel learner → prova RAG
    suggerimenti = self._rag_suggerimenti.get(bg)
    if suggerimenti:
        for sug in suggerimenti:
            sug_autista = sug.get("autista", "").strip().upper()
            if autista_nome_norm in sug_autista or sug_autista in autista_nome_norm:
                score_esperienza = 0.65
                motivo_esperienza = f"RAG fallback: autista usato in caso simile (sim={sug['similarita']:.2f})"
                break
```

### Matching fuzzy autista

I nomi autista possono differire tra BERLINK e proposte storiche:
- "MARIO ROSSI" vs "Rossi Mario" vs "ROSSI MARIO 1"
- Serve normalizzazione: uppercase, rimuovi numeri trailing, confronto bidirezionale substring

### Valore

Migliora la copertura del learner per clienti/destinazioni nuovi o rari.
Il RAG trova pattern semantici che il learner quantitativo non cattura:
- Stesso tipo di cliente (chimico) anche se nome diverso
- Stessa zona di destinazione anche se indirizzo diverso
- Stesso genere merce con clienti diversi

### Rischi

- False positive: il RAG potrebbe suggerire autisti non più disponibili o non più adatti
- Overlap con punto 1: il punto 1 già dà un bonus RAG globale, il punto 3 agisce solo sul sub-score autista
- Mitigazione: usare boost conservativo (0.6-0.65, non 0.8+) per non sovrascrivere altri segnali
