import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'voci',
    label: 'Voci',
    icon: 'mic',
    trigger: 'auto',
    layout: {
      view: 'list',
      title: 'Voci Disponibili',
    },
  },
]

export default views
