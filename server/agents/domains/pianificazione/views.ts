import type { AgentView } from '../../types.js'

const views: AgentView[] = [
  {
    id: 'mappa-viaggi',
    label: 'Mappa Viaggi',
    icon: 'map',
    trigger: 'manual',
    layout: {
      view: 'map',
      title: 'Mappa Viaggi Oggi',
      source: { tool: 'planning_viaggi', toolParams: { data: 'today' } },
      map: {
        startField: 'partenza',
        endField: 'arrivo',
        colorField: 'targa_assegnata',
        colorFilled: '#2D8B56',
        colorEmpty: '#D32F2F',
        popupFields: ['bg', 'cliente', 'genere', 'targa_assegnata', 'data_carico'],
        labelField: 'bg',
      },
    },
  },
  {
    id: 'lista-viaggi',
    label: 'Lista Viaggi',
    icon: 'truck',
    trigger: 'manual',
    layout: {
      view: 'list',
      title: 'Viaggi Oggi',
      source: { tool: 'planning_viaggi', toolParams: { data: 'today' } },
      columns: [
        { key: 'bg', label: 'BG', type: 'text' },
        { key: 'cliente', label: 'Cliente', type: 'text' },
        { key: 'partenza', label: 'Partenza', type: 'text' },
        { key: 'arrivo', label: 'Arrivo', type: 'text' },
        { key: 'genere', label: 'Merce', type: 'text' },
        { key: 'targa_assegnata', label: 'Targa', type: 'text' },
        { key: 'data_carico', label: 'Carico', type: 'text' },
      ],
    },
  },
]

export default views
