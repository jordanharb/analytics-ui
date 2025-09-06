import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { MapView } from './views/MapView/MapView';
import { DirectoryView } from './views/DirectoryView/DirectoryView';
import { EntityView } from './views/EntityView/EntityView';

function App() {
  return (
    <Router>
      <div className="w-screen h-screen">
        <div className="h-full flex flex-col">
          {/* Header */}
          <header className="bg-dark-900 text-white px-6 py-4 shadow-lg flex-shrink-0">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
                <p className="text-sm text-gray-300">Real-time Event Monitoring</p>
              </div>
              <nav className="flex space-x-4">
                <NavLink
                  to="/map"
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-dark-700 text-white hover:bg-dark-600'
                    }`
                  }
                >
                  Map View
                </NavLink>
                <NavLink
                  to="/directory"
                  className={({ isActive }) =>
                    `px-4 py-2 rounded-md transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'bg-dark-700 text-white hover:bg-dark-600'
                    }`
                  }
                >
                  Directory
                </NavLink>
              </nav>
            </div>
          </header>
          
          {/* Main Content */}
          <main className="flex-1 overflow-hidden">
            <Routes>
              <Route path="/" element={<Navigate to="/map" replace />} />
              <Route path="/map" element={<MapView />} />
              <Route path="/directory" element={<DirectoryView />} />
              <Route path="/entity/:entityType/:entityId" element={<EntityView />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  );
}

export default App;
