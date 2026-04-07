import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'documenti',
    label: 'Documenti',
    icon: 'scale',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Documenti Legali',
      source: { table: 'entity', type: 'documento', filters: { categoria: 'legale' } },
      columns: [
        { key: 'display_name', label: 'Nome', type: 'text' },
        { key: 'categoria', label: 'Categoria', type: 'badge' },
        { key: 'created_at', label: 'Data', type: 'date' },
      ],
    },
  },
  {
    id: 'risultati_ricerca',
    label: 'Risultati',
    icon: 'search',
    trigger: 'on_tool:retrieve',
    layout: {
      view: 'list',
      title: 'Risultati Ricerca',
    },
  },
]

export default views
