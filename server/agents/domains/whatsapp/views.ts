import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'contatti',
    label: 'Contatti',
    icon: 'phone',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Contatti WhatsApp',
      source: { table: 'entity', filters: { telefono: { $ne: null } } },
      columns: [
        { key: 'display_name', label: 'Nome', type: 'text' },
        { key: 'telefono', label: 'Telefono', type: 'phone' },
        { key: 'tags', label: 'Tipo', type: 'tags' },
      ],
    },
  },
]

export default views
