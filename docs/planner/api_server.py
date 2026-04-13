"""
FastAPI REST wrapper for ai-planner tools.
Exposes all planning tools as HTTP endpoints for Bernardini OS integration.

Usage:
  pip install fastapi uvicorn
  python api_server.py
  # or: uvicorn api_server:app --host 0.0.0.0 --port 8602
"""

import json
import logging
import sys
import os

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Dict, Optional

# Load environment
from dotenv import load_dotenv
load_dotenv()

# Import the planning tools
from agent.tools.planning_tools import execute_tool, TOOLS_SCHEMA, TOOLS_FUNCTIONS

logger = logging.getLogger("planning-api")
logging.basicConfig(level=logging.INFO)

app = FastAPI(
    title="Bernardini Planner API",
    description="REST API for ai-planner tools — used by Bernardini OS",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health Check ──────────────────────────────────────────

@app.get("/api/planning/health")
def health():
    return {
        "status": "ok",
        "tools": len(TOOLS_FUNCTIONS),
        "tool_names": list(TOOLS_FUNCTIONS.keys()),
    }


# ── Generic tool executor ─────────────────────────────────

class ToolRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = {}

@app.post("/api/planning/execute")
def execute(req: ToolRequest):
    """Execute any tool by name with arguments."""
    result_str = execute_tool(req.tool, req.args)
    try:
        return json.loads(result_str)
    except json.JSONDecodeError:
        return {"result": result_str}


# ── Individual tool endpoints ─────────────────────────────

class DateRequest(BaseModel):
    data: str
    solo_non_assegnati: bool = False

@app.post("/api/planning/viaggi")
def viaggi(req: DateRequest):
    return _exec("get_viaggi_da_pianificare", {"data": req.data, "solo_non_assegnati": req.solo_non_assegnati})

@app.post("/api/planning/autisti")
def autisti(req: DateRequest):
    return _exec("get_autisti_disponibili", {"data": req.data})

class SemirimorchiRequest(BaseModel):
    data: str
    tipo: Optional[str] = None

@app.post("/api/planning/semirimorchi")
def semirimorchi(req: SemirimorchiRequest):
    args = {"data": req.data}
    if req.tipo:
        args["tipo"] = req.tipo
    return _exec("get_semirimorchi_disponibili", args)

class SuggerisciRequest(BaseModel):
    data: str
    template: Optional[str] = None

@app.post("/api/planning/suggerisci")
def suggerisci(req: SuggerisciRequest):
    args = {"data": req.data}
    if req.template:
        args["template"] = req.template
    return _exec("suggerisci_pianificazione", args)

class AssegnaRequest(BaseModel):
    data: str
    codice_viaggio: str
    targa_semirimorchio: str
    nome_autista: Optional[str] = None
    note: Optional[str] = None

@app.post("/api/planning/assegna")
def assegna(req: AssegnaRequest):
    args = {"data": req.data, "codice_viaggio": req.codice_viaggio, "targa_semirimorchio": req.targa_semirimorchio}
    if req.nome_autista: args["nome_autista"] = req.nome_autista
    if req.note: args["note"] = req.note
    return _exec("assegna_viaggio", args)

class DettaglioRequest(BaseModel):
    codice_bg: str
    data: Optional[str] = None

@app.post("/api/planning/dettaglio")
def dettaglio(req: DettaglioRequest):
    args = {"codice_bg": req.codice_bg}
    if req.data: args["data"] = req.data
    return _exec("get_dettaglio_viaggio", args)

class GPSRequest(BaseModel):
    targa: str

@app.post("/api/planning/gps")
def gps(req: GPSRequest):
    return _exec("get_posizione_gps", {"targa": req.targa})

class DistanzaRequest(BaseModel):
    origine: str
    destinazione: str

@app.post("/api/planning/distanza")
def distanza(req: DistanzaRequest):
    return _exec("calcola_distanza", {"origine": req.origine, "destinazione": req.destinazione})

class StatisticheRequest(BaseModel):
    data_inizio: str
    data_fine: str
    gruppo_per: Optional[str] = None

@app.post("/api/planning/statistiche")
def statistiche(req: StatisticheRequest):
    args = {"data_inizio": req.data_inizio, "data_fine": req.data_fine}
    if req.gruppo_per:
        args["gruppo_per"] = req.gruppo_per
    return _exec("get_statistiche_viaggi", args)

@app.post("/api/planning/confronta")
def confronta(req: DateRequest):
    return _exec("confronta_pianificazione", {"data": req.data})

class StoricoRequest(BaseModel):
    cliente: str
    destinazione: Optional[str] = None
    genere: Optional[str] = None

@app.post("/api/planning/storico")
def storico(req: StoricoRequest):
    args = {"cliente": req.cliente}
    if req.destinazione: args["destinazione"] = req.destinazione
    if req.genere: args["genere"] = req.genere
    return _exec("get_contesto_storico", args)

class AnalizzaRequest(BaseModel):
    codice_bg: str
    data: Optional[str] = None

@app.post("/api/planning/analizza")
def analizza(req: AnalizzaRequest):
    args = {"codice_bg": req.codice_bg}
    if req.data: args["data"] = req.data
    return _exec("analizza_viaggio_non_assegnato", args)

@app.post("/api/planning/conflitti")
def conflitti(req: DateRequest):
    return _exec("mostra_conflitti", {"data": req.data})

class ScenarioRequest(BaseModel):
    data: str
    escludi_autisti: Optional[list] = None
    escludi_targhe: Optional[list] = None
    max_distanza_km: Optional[float] = None
    bg_fissi: Optional[list] = None

@app.post("/api/planning/scenario")
def scenario(req: ScenarioRequest):
    args = {"data": req.data}
    if req.escludi_autisti: args["escludi_autisti"] = req.escludi_autisti
    if req.escludi_targhe: args["escludi_targhe"] = req.escludi_targhe
    if req.max_distanza_km: args["max_distanza_km"] = req.max_distanza_km
    if req.bg_fissi: args["bg_fissi"] = req.bg_fissi
    return _exec("ricalcola_scenario", args)

class ETARequest(BaseModel):
    nome_autista: str
    data: Optional[str] = None

@app.post("/api/planning/eta")
def eta(req: ETARequest):
    args = {"nome_autista": req.nome_autista}
    if req.data:
        args["data"] = req.data
    return _exec("get_eta_per_autista", args)

@app.post("/api/planning/pianificazione_corrente")
def pianificazione_corrente(req: DateRequest):
    return _exec("get_pianificazione_corrente", {"data": req.data})

class CercaAutistaRequest(BaseModel):
    nome: str

@app.post("/api/planning/cerca_autista")
def cerca_autista(req: CercaAutistaRequest):
    return _exec("cerca_autista", {"nome": req.nome})

# ── Tools schema endpoint ─────────────────────────────────

@app.get("/api/planning/tools")
def tools_schema():
    """Return all tool definitions (OpenAI function calling format)."""
    return TOOLS_SCHEMA


# ── Helper ────────────────────────────────────────────────

def _exec(tool_name: str, args: dict):
    """Execute a tool and parse JSON result."""
    result_str = execute_tool(tool_name, args)
    try:
        return json.loads(result_str)
    except json.JSONDecodeError:
        return {"result": result_str}


# ── Main ──────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8602, log_level="info")
