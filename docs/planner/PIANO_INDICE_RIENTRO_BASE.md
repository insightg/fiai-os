# Indice Rientro Base - Formula km vuoto interpolata

## IMPLEMENTATO

## Semantica del parametro `emp_driver_skills.indice_rientro_base`

| Giorni fuori casa/sett | indice | Significato |
|---|---|---|
| 0 | 0.00 | Rientra TUTTE le sere (locale) |
| 1 | 0.18 | Rientra ~4.5 sere su 5.5 |
| 2 | 0.36 | Rientra ~3.5 sere su 5.5 |
| 3 | 0.55 | Rientra ~2.5 sere su 5.5 |
| 4 | 0.73 | Rientra ~1.5 sere su 5.5 |
| 5 | 0.91 | Rientra ~0.5 sere su 5.5 |
| 5.5 | 1.00 | Non rientra MAI (lunga percorrenza) |

## Formula (solo primo viaggio della giornata)

```
D_bc = distanza(base → luogo_carico)
D_sb = distanza(luogo_scarico → base)
D_pc = distanza(posizione_corrente → luogo_carico)
i = indice_rientro_base

km_vuoto = (1 - i) × (D_bc + D_sb) + i × D_pc
```

## Impatto

Il km_vuoto calcolato con questa formula viene usato in tutti i componenti dello score:
- **score_distanza**: exp(-km_vuoto / decay)
- **sostenibilità**: costo = (km_trasporto + km_vuoto) × euro_km
- **impiego**: (km_trasporto + km_vuoto + ...) / capacità
- **efficienza**: km_trasporto / (km_trasporto + km_vuoto)

Dal secondo viaggio in poi: km_vuoto = distanza(ultimo_scarico → nuovo_carico)
