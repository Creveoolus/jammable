import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Landing from './pages/Landing';
import Room from './pages/Room';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-900 text-white font-sans">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/room/:id" element={<Room />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
