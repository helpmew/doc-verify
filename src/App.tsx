import { AuthProvider } from './context/AuthProvider'
import { AuthArea } from './components/AuthArea'

export default function App() {
  return (
    <AuthProvider>
      <AuthArea />
    </AuthProvider>
  )
}
