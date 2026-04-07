import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'progetti',
    label: 'Progetti',
    icon: 'folder-kanban',
    trigger: 'auto',
    layout: {
      view: 'kanban',
      title: 'Progetti',
      source: { table: 'entity', type: 'progetto' },
      kanban: {
        groupBy: 'stato',
        groups: [
          { value: 'pianificato', label: 'Pianificati', color: '#1976D2' },
          { value: 'in_corso', label: 'In Corso', color: '#E68A00' },
          { value: 'in_pausa', label: 'In Pausa', color: '#8A8A9A' },
          { value: 'completato', label: 'Completati', color: '#2D8B56' },
        ],
        cardTitle: 'display_name',
        cardSubtitle: 'stato',
      },
    },
  },
  {
    id: 'ordini',
    label: 'Ordini',
    icon: 'package',
    trigger: 'on_find:ordine',
    layout: {
      view: 'list',
      title: 'Ordini',
      source: { table: 'entity', type: 'ordine' },
      columns: [
        { key: 'numero', label: 'Numero', type: 'text' },
        { key: 'display_name', label: 'Descrizione', type: 'text' },
        { key: 'totale', label: 'Totale', type: 'currency' },
        { key: 'stato', label: 'Stato', type: 'badge' },
      ],
    },
  },
  {
    id: 'dettaglio_progetto',
    label: 'Dettaglio',
    icon: 'folder-open',
    trigger: 'on_get_tree',
    layout: {
      view: 'detail',
      title: 'Dettaglio Progetto',
      sections: [
        { title: 'Progetto', fields: [
          { key: 'display_name', label: 'Nome' },
          { key: 'stato', label: 'Stato' },
          { key: 'data', label: 'Scadenza', type: 'date' },
        ]},
      ],
    },
  },
]

export default views
