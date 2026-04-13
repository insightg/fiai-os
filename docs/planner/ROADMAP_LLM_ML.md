# Roadmap: 7 Idee LLM + ML su Storico Avanzato

## Situazione Attuale

### Feedback Loop: implementato ma NON attivo
- `agent/planner/feedback.py` ha `confronta()`, `salva_proposta()`, `alimenta_learner()`
- `data/proposte/` ha solo **5 file** (13-15 marzo 2026)
- `data/feedback/` e' **vuota** — nessun confronto proposta-vs-TIR e' mai stato eseguito
- Senza dati di feedback, **ML e' impossibile** (servono 1000+ campioni etichettati)

### History Learner: frequency counting, non ML
- `learned_patterns.json` ha ~500 clienti, ~200 destinazioni, ~30 autisti
- Usa Counter (frequenze) con soglie hardcoded (0.5, 0.3, 0.7)
- Contribuisce ~12-15% allo score finale (20% peso driver x 60% esperienza)
- Nessuna analisi multivariata, nessun feature engineering, nessun temporal

### ML su Storico Avanzato (da tasks/implementazione_migliorie_optimizer.md): cosa significherebbe
Sostituire il frequency counting di `history_learner.py` con un modello predittivo (Random Forest/XGBoost) che:
- Predice: "l'operatore accettera' questa assegnazione?" (classificazione binaria)
- Features: 25-30 variabili (score componenti, storico autista/cliente, giorno settimana, competizione risorse...)
- Training data: campioni etichettati dal feedback loop (ACCETTATA vs OVERRIDE)
- Output: probabilita' 0-1 che sostituisce `get_score_autista()` e `get_score_storico()`

---

## Come le 7 Idee LLM si integrano con ML

### Idee che PRODUCONO dati per ML (prerequisiti)

| Idea | Cosa produce per ML | Criticita' |
|------|---------------------|-----------|
| **Feedback attivo** (pre-req) | Campioni etichettati (ACCETTATA/OVERRIDE) | **Bloccante**: senza questo, niente ML |
| **Idea 1** (Spiegazioni) | `candidati_valutati` = feature ricchissime per ML (score alternativi, motivi esclusione) | Alta |
| **Idea 2** (Analisi feedback) | Aggregazione che rivela quali feature sono predittive | Alta |
| **Idea 4** (Validazione) | Flag anomalie = feature "data_quality" per ML | Media |

### Idee che BENEFICIANO da ML (consumatori)

| Idea | Come ML la migliora |
|------|---------------------|
| **Idea 3** (Assistente non assegnati) | ML predice probabilita' accettazione per ogni opzione proposta |
| **Idea 5** (Conflitti) | ML quantifica "chi sacrificare" basandosi su acceptance probability |
| **Idea 6** (What-if) | ML rende i ricalcoli piu' realistici (score = probabilita' accettazione) |
| **Idea 7** (Report) | ML aggiunge metriche predittive ("domani prevedo 85% acceptance rate") |

### Idea che DIVENTA ML

| Idea | Evoluzione |
|------|-----------|
| **Idea 2** (Analisi feedback) | Fase 1: aggregazione statistica. Fase 2: i pattern identificati diventano le feature del modello ML |

---

## Ordine di Implementazione Raccomandato

### Fase 0 — Attivare il feedback loop (URGENTE, 1-2 giorni)
**Senza questo, tutto il resto e' cieco.**

Il codice esiste gia'. Serve:
1. Schedulare `confronta()` a fine giornata (cron o bottone UI)
2. Salvare i report in `data/feedback/`
3. Chiamare `alimenta_learner()` per aggiornare i pattern

Dopo 30 giorni: ~900 campioni etichettati (30 giorni x ~30 viaggi/giorno).

### Fase 1 — Quick wins LLM (2-3 settimane)
Valore immediato, nessuna dipendenza da ML.

1. **Idea 1 — Spiegazioni** (1 settimana)
   - Modifica optimizer per salvare candidati_valutati
   - Beneficio immediato per operatore
   - **Bonus ML**: i candidati_valutati diventano feature per il modello futuro

2. **Idea 4 — Validazione dati** (3-4 giorni)
   - Nuovo file `validator.py`, pochi touch point
   - Previene errori a monte
   - **Bonus ML**: anomalie = feature "data_quality_score"

3. **Idea 7 — Report** (3-4 giorni)
   - Nuovo file `report.py` + tool LLM
   - Valore manageriale immediato
   - **Bonus ML**: infrastruttura di monitoraggio riutilizzabile

### Fase 2 — Analisi e infrastruttura ML (2-3 settimane)
Qui si inizia a preparare il terreno per ML.

4. **Idea 2 — Analisi feedback** (1 settimana)
   - Richiede: dati feedback dalla Fase 0 (almeno 2-3 settimane di raccolta)
   - `aggrega_feedback()` diventa il **feature engineering pipeline** per ML
   - I pattern identificati dall'LLM → ipotesi da validare con ML
   - Esempio: "LLM dice che override rate su SILOS e' 40%" → ML verifica se `genere=SILOS` e' feature predittiva

5. **ML Baseline — Random Forest** (1-2 settimane)
   - Prerequisito: ~500+ campioni dal feedback loop (dopo ~3 settimane di raccolta)
   - Nuovo file `agent/planner/ml_scorer.py`
   - Features iniziali (15): score_distanza, score_tipo, score_autista, score_tempo, km_vuoto, impiego, efficienza, cliente_freq, dest_freq, driver_freq, genere, day_of_week, competing_candidates, rank_among_candidates, data_quality_flag
   - Target: `y = 1 se ACCETTATA, 0 altrimenti`
   - Output: `predict_proba()` → probabilita' 0-1
   - Integrazione graduale: blend 30% ML + 70% regole esistenti

### Fase 3 — LLM + ML integrati (3-4 settimane)
Le idee piu' complesse, ora potenziate da ML.

6. **Idea 6 — What-if** (1-2 settimane)
   - Il ricalcolo scenario usa ML per stimare acceptance probability
   - "Se togli Rossi, BG001 va a Bianchi (ML: 72% accettazione vs 89% con Rossi)"
   - Molto piu' utile con ML che senza

7. **Idea 3 — Assistente non assegnati** (1-2 settimane)
   - Le opzioni proposte hanno ML confidence score
   - "Rilassamento a 400km: candidato AB123, ML prevede 65% accettazione"
   - Aiuta l'operatore a scegliere l'opzione piu' probabile

8. **Idea 5 — Conflitti e priorita'** (1-2 settimane)
   - ML quantifica il costo di ogni scelta nei conflitti
   - "Assegnare a BG001 (ML: 91%) vs BG007 (ML: 74%) → suggerisco BG001"

### Fase 4 — ML maturo (4-6 settimane, dopo 2-3 mesi di dati)
Con 2000+ campioni etichettati.

9. **XGBoost + feature engineering avanzato** (2-3 settimane)
   - 25-30 features con interazioni
   - Hyperparameter tuning (Optuna)
   - Cross-validation rigorosa
   - Sostituisce completamente `get_score_storico()` e `get_score_autista()`

10. **Monitoraggio e drift detection** (1-2 settimane)
    - Idea 7 (Report) estesa con metriche ML
    - Alert se acceptance rate predetta diverge da reale
    - Retraining automatico settimanale

---

## Timeline Visiva

```
Settimana  0   1   2   3   4   5   6   7   8   9  10  11  12
           |---|---|---|---|---|---|---|---|---|---|---|---|---|
Fase 0     [FB]                                    raccolta dati continua
Fase 1         [Idea1][Id4][Id7]
Fase 2                     [Idea2--][ML base-]
Fase 3                                 [Idea6-][Idea3-][Idea5-]
Fase 4                                                 [XGBoost---][Monitor]

FB = Attivare feedback loop
```

## Dipendenze Critiche

```
Fase 0 (feedback attivo)
  |
  +---> Fase 1 (indipendente, parallela alla raccolta dati)
  |
  +---> Idea 2 (serve 2-3 settimane di dati)
  |       |
  |       +---> ML Baseline (serve 3+ settimane di dati)
  |               |
  |               +---> Idea 6 (what-if con ML)
  |               +---> Idea 3 (non assegnati con ML)
  |               +---> Idea 5 (conflitti con ML)
  |
  +---> XGBoost (serve 2-3 mesi di dati)
```

## Features per il Modello ML

### Features iniziali (15) — ML Baseline
| # | Feature | Fonte | Tipo |
|---|---------|-------|------|
| 1 | score_distanza | optimizer | float 0-1 |
| 2 | score_tipo | optimizer | float 0-1 |
| 3 | score_autista | optimizer | float 0-1 |
| 4 | score_tempo | optimizer | float 0-1 |
| 5 | km_vuoto | optimizer | int |
| 6 | impiego_autista | optimizer | float 0-100 |
| 7 | efficienza | optimizer | float 0-100 |
| 8 | cliente_freq | learned_patterns | int (viaggi totali cliente) |
| 9 | dest_freq | learned_patterns | int (viaggi totali destinazione) |
| 10 | driver_freq_cliente | learned_patterns | int (viaggi autista per cliente) |
| 11 | genere | viaggio | categorical |
| 12 | day_of_week | data | int 0-6 |
| 13 | n_candidati_competitori | optimizer (Idea 1) | int |
| 14 | rank_tra_candidati | optimizer (Idea 1) | int 1-N |
| 15 | data_quality_flag | validator (Idea 4) | bool |

### Features avanzate (aggiuntive) — XGBoost
| # | Feature | Fonte |
|---|---------|-------|
| 16 | driver_is_external | autista.flag_esterno |
| 17 | driver_zone_match | optimizer zone scoring |
| 18 | trailer_type | semirimorchio.tipo |
| 19 | driver_skills_count | autista.skills (conteggio flag attivi) |
| 20 | client_override_rate_30d | feedback aggregato (Idea 2) |
| 21 | dest_override_rate_30d | feedback aggregato |
| 22 | driver_acceptance_rate_30d | feedback aggregato |
| 23 | hour_of_day | data_carico |
| 24 | is_month_end | data |
| 25 | km_trasporto | viaggio |
| 26 | ore_viaggio | calcolato |
| 27 | score_totale_rank_percentile | optimizer |
| 28 | scarsita_viaggio | optimizer (n. coppie compatibili) |
| 29 | delta_score_vs_secondo | optimizer (Idea 1) |
| 30 | anomalia_posizione | validator (Idea 4) |

## Rischio principale

Se il feedback loop non viene attivato ORA, tutto il percorso ML slitta.
Ogni giorno senza feedback = ~30 campioni persi.
Per ML baseline servono ~500 campioni = ~17 giorni.
Per ML robusto servono ~2000 campioni = ~67 giorni.

**Azione immediata: schedulare `confronta()` quotidianamente.**

---

## Riferimenti

- Specifiche dettagliate delle 7 idee LLM: `docs/IDEE_LLM_PIANIFICAZIONE.md`
- Migliorie optimizer originali: `tasks/implementazione_migliorie_optimizer.md`
- Logiche allocazione: `docs/LOGICHE_ALLOCAZIONE.md`
