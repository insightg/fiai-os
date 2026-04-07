import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: 'activity',
    trigger: 'auto',
    layout: {
      view: 'chart',
      title: 'Overview Aziendale',
      chart: { type: 'bar', data: [] },  // populated dynamically
    },
  },
]

export default views
