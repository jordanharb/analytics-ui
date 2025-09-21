import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { MapView } from './views/MapView/MapView';
import { DirectoryView } from './views/DirectoryView/DirectoryView';
import { EntityView } from './views/EntityView/EntityView';
import { ChatView } from './views/ChatView/ChatView';
import { Header } from './components/Header/Header';
import { LaunchPage } from './components/LaunchPage/LaunchPage';
import LegislatureApp from './legislature/LegislatureApp';

function AppContent() {
  const location = useLocation();
  const isLaunchPage = location.pathname === '/';
  const isLegislaturePage = location.pathname.startsWith('/legislature');

  return (
    <div className="w-full h-screen overflow-x-hidden">
      <div className="h-full flex flex-col">
        {/* Only show Header on Woke Palantir pages (not launch or legislature pages) */}
        {!isLaunchPage && !isLegislaturePage && <Header />}
        
        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<LaunchPage />} />
            <Route path="/map" element={<MapView />} />
            <Route path="/directory" element={<DirectoryView />} />
            <Route path="/chat" element={<ChatView />} />
            <Route path="/entity/:entityType/:entityId" element={<EntityView />} />
            
            {/* Legislature & Campaign Finance Routes */}
            <Route path="/legislature/*" element={<LegislatureApp />} />
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
