import { useEffect } from 'react'
import '/src/styles/main.css'

function App() {
  useEffect(() => {
    import('./main.js').then(module => {
      if (module.init) module.init()
    })
  }, [])

  return (
    <div id="app">
      <div id="lobby" style={{ display: 'flex' }}></div>
      <div id="prejoin"></div>
      <div id="room"></div>
    </div>
  )
}

export default App