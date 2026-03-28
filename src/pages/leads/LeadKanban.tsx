import { useState, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useLeadsStore } from '../../store'
import type { Lead, LeadStato } from '../../types'
import Badge from '../../components/ui/Badge'
import toast from 'react-hot-toast'

interface LeadKanbanProps {
  onEditLead: (lead: Lead) => void
  onConvertLead: (lead: Lead) => void
}

const FASI: { key: LeadStato; label: string; color: 'blue' | 'amber' | 'purple' | 'gold' | 'green' | 'red' | 'gray' }[] = [
  { key: 'nuovo', label: 'Nuovo', color: 'blue' },
  { key: 'contattato', label: 'Contattato', color: 'amber' },
  { key: 'qualificato', label: 'Qualificato', color: 'purple' },
  { key: 'proposta', label: 'Proposta', color: 'gold' },
  { key: 'convertito', label: 'Convertito', color: 'green' },
  { key: 'perso', label: 'Perso', color: 'red' },
]

function formatEuro(value: number | null): string {
  if (value == null) return '-'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
}

/* ── Kanban Card ────────────────────────────── */

interface KanbanCardProps {
  lead: Lead
  onEdit: (lead: Lead) => void
  onConvert: (lead: Lead) => void
  overlay?: boolean
}

function KanbanCard({ lead, onEdit, onConvert, overlay }: KanbanCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id, data: { lead } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  if (overlay) {
    return (
      <div className="bg-bg3 border border-gold/40 rounded-lg p-3 shadow-lg shadow-gold/10 w-64">
        <CardContent lead={lead} />
      </div>
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-bg3 border border-border rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-border2 transition-colors group"
    >
      <CardContent lead={lead} />
      <div className="flex gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(lead) }}
          className="text-xs text-text3 hover:text-gold transition-colors"
        >
          Modifica
        </button>
        {lead.stato !== 'convertito' && lead.stato !== 'perso' && (
          <button
            onClick={(e) => { e.stopPropagation(); onConvert(lead) }}
            className="text-xs text-text3 hover:text-green transition-colors"
          >
            Converti
          </button>
        )}
      </div>
    </div>
  )
}

function CardContent({ lead }: { lead: Lead }) {
  return (
    <>
      <p className="text-sm font-medium text-text truncate">
        {lead.nome} {lead.cognome}
      </p>
      {lead.azienda_lead && (
        <p className="text-xs text-text3 truncate">{lead.azienda_lead}</p>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <span className="text-sm font-semibold text-gold">
          {formatEuro(lead.valore_stimato)}
        </span>
      </div>
    </>
  )
}

/* ── Kanban Column ──────────────────────────── */

interface KanbanColumnProps {
  fase: typeof FASI[number]
  leads: Lead[]
  onEdit: (lead: Lead) => void
  onConvert: (lead: Lead) => void
}

function KanbanColumn({ fase, leads, onEdit, onConvert }: KanbanColumnProps) {
  const totalValue = leads.reduce((sum, l) => sum + (l.valore_stimato ?? 0), 0)

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] flex-shrink-0">
      <div className="flex items-center justify-between px-3 py-2 mb-2">
        <div className="flex items-center gap-2">
          <Badge color={fase.color}>{fase.label}</Badge>
          <span className="text-xs text-text3">{leads.length}</span>
        </div>
        <span className="text-xs text-text3 font-medium">{formatEuro(totalValue)}</span>
      </div>

      <SortableContext
        items={leads.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
        id={fase.key}
      >
        <div className="flex flex-col gap-2 bg-bg/50 rounded-lg border border-border/50 p-2 min-h-[200px] flex-1">
          {leads.map((lead) => (
            <KanbanCard
              key={lead.id}
              lead={lead}
              onEdit={onEdit}
              onConvert={onConvert}
            />
          ))}
          {leads.length === 0 && (
            <div className="flex items-center justify-center h-20 text-text3 text-xs">
              Nessun lead
            </div>
          )}
        </div>
      </SortableContext>
    </div>
  )
}

/* ── Main Kanban Board ──────────────────────── */

export default function LeadKanban({ onEditLead, onConvertLead }: LeadKanbanProps) {
  const leads = useLeadsStore((s) => s.leads)
  const updateLead = useLeadsStore((s) => s.update)
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const leadsByFase = useMemo(() => {
    const map: Record<LeadStato, Lead[]> = {
      nuovo: [],
      contattato: [],
      qualificato: [],
      proposta: [],
      convertito: [],
      perso: [],
    }
    for (const lead of leads) {
      if (map[lead.stato]) {
        map[lead.stato].push(lead)
      }
    }
    return map
  }, [leads])

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over) return

    const leadId = active.id as string
    const lead = leads.find((l) => l.id === leadId)
    if (!lead) return

    // Determine target fase: check if dropped over a column container or another card
    let targetFase: LeadStato | null = null

    // Check if "over" is a column id (one of FASI keys)
    const faseKeys = FASI.map((f) => f.key) as string[]
    if (faseKeys.includes(over.id as string)) {
      targetFase = over.id as LeadStato
    } else {
      // Dropped over another card - find which fase that card belongs to
      const overLead = leads.find((l) => l.id === over.id)
      if (overLead) {
        targetFase = overLead.stato
      }
    }

    if (!targetFase || targetFase === lead.stato) return

    await updateLead(leadId, { stato: targetFase })
    const faseLabel = FASI.find((f) => f.key === targetFase)?.label ?? targetFase
    toast.success(`Lead spostato in "${faseLabel}"`)
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {FASI.map((fase) => (
          <KanbanColumn
            key={fase.key}
            fase={fase}
            leads={leadsByFase[fase.key]}
            onEdit={onEditLead}
            onConvert={onConvertLead}
          />
        ))}
      </div>

      <DragOverlay>
        {activeLead ? (
          <KanbanCard
            lead={activeLead}
            onEdit={onEditLead}
            onConvert={onConvertLead}
            overlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
