import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'candidati',
    label: 'Candidati',
    icon: 'users',
    trigger: 'auto',
    layout: {
      view: 'kanban',
      title: 'Pipeline Candidati',
      source: { table: 'entity', tags: ['candidato'] },
      kanban: {
        groupBy: 'stato',
        groups: [
          { value: 'nuovo', label: 'Nuovi', color: '#1976D2' },
          { value: 'screening', label: 'Screening', color: '#E68A00' },
          { value: 'colloquio', label: 'Colloquio', color: '#9C27B0' },
          { value: 'offerta', label: 'Offerta', color: '#2D8B56' },
          { value: 'assunto', label: 'Assunti', color: '#00796B' },
        ],
        cardTitle: 'display_name',
        cardSubtitle: 'email',
      },
    },
  },
  {
    id: 'annunci',
    label: 'Annunci',
    icon: 'megaphone',
    trigger: 'on_find:annuncio',
    layout: {
      view: 'list',
      title: 'Annunci di Lavoro',
      source: { table: 'entity', type: 'annuncio' },
      columns: [
        { key: 'display_name', label: 'Ruolo', type: 'text' },
        { key: 'stato', label: 'Stato', type: 'badge' },
        { key: 'created_at', label: 'Creato', type: 'date' },
      ],
    },
  },
]

export default views
