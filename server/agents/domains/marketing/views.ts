import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'lead_scoring',
    label: 'Lead Scoring',
    icon: 'target',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Lead Scoring',
      source: { table: 'entity', tags: ['lead'] },
      columns: [
        { key: 'display_name', label: 'Nome', type: 'text' },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'stato', label: 'Stato', type: 'badge' },
      ],
    },
  },
  {
    id: 'immagini',
    label: 'Immagini',
    icon: 'image',
    trigger: 'on_tool:generate_image',
    layout: {
      view: 'list',
      title: 'Immagini Generate',
    },
  },
]

export default views
