import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { MapView } from './views/MapView/MapView';
import { DirectoryView } from './views/DirectoryView/DirectoryView';
import { EntityView } from './views/EntityView/EntityView';
import { Header } from './components/Header/Header';
import { LaunchPage } from './components/LaunchPage/LaunchPage';

function AppContent() {
  const location = useLocation();
  const isLaunchPage = location.pathname === '/';

  return (
    <div className="w-full h-screen overflow-x-hidden">
      <div className="h-full flex flex-col">
        {/* Only show Header on non-launch pages */}
        {!isLaunchPage && <Header />}
        
        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<LaunchPage />} />
            <Route path="/map" element={<MapView />} />
            <Route path="/directory" element={<DirectoryView />} />
            <Route path="/entity/:entityType/:entityId" element={<EntityView />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

export default App;
