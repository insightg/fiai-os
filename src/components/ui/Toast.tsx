import { Toaster } from 'react-hot-toast'

export default function Toast() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: '#141418',
          color: '#F0EDE8',
          border: '1px solid #2A2A35',
          borderRadius: '12px',
          fontSize: '14px',
        },
        success: {
          iconTheme: {
            primary: '#C9A84C',
            secondary: '#0D0D0F',
          },
        },
        error: {
          iconTheme: {
            primary: '#E07070',
            secondary: '#0D0D0F',
          },
        },
      }}
    />
  )
}
