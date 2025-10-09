import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Header } from './components/Header/Header';

// Lazy load components to reduce initial bundle size
const MapView = lazy(() => import('./views/MapView/MapView').then(m => ({ default: m.MapView })));
const DirectoryView = lazy(() => import('./views/DirectoryView/DirectoryView').then(m => ({ default: m.DirectoryView })));
const EntityView = lazy(() => import('./views/EntityView/EntityView').then(m => ({ default: m.EntityView })));
const ChatView = lazy(() => import('./views/ChatView/ChatView').then(m => ({ default: m.ChatView })));
const ActorsDirectoryView = lazy(() => import('./views/ActorsDirectory/ActorsDirectoryView').then(m => ({ default: m.ActorsDirectoryView })));
const ActorClassifierView = lazy(() => import('./views/ActorClassifier/ActorClassifierView').then(m => ({ default: m.ActorClassifierView })));
const AutomationView = lazy(() => import('./views/Automation/AutomationView').then(m => ({ default: m.AutomationView })));
const LaunchPage = lazy(() => import('./components/LaunchPage/LaunchPage').then(m => ({ default: m.LaunchPage })));
const LegislatureApp = lazy(() => import('./legislature/LegislatureApp'));

function AppContent() {
  const location = useLocation();
  const isLaunchPage = location.pathname === '/';
  const isLegislaturePage = location.pathname.startsWith('/legislature');

  return (
    <div className="w-full min-h-screen overflow-x-hidden bg-slate-50">
      <div className="min-h-screen flex flex-col">
        {/* Only show Header on Woke Palantir pages (not launch or legislature pages) */}
        {!isLaunchPage && !isLegislaturePage && <Header />}
        
        {/* Main Content */}
        <main className="flex-1 overflow-auto">
          <Suspense fallback={<div className="flex items-center justify-center h-full">Loading...</div>}>
            <Routes>
              <Route path="/" element={<LaunchPage />} />
              <Route path="/map" element={<MapView />} />
              <Route path="/directory" element={<DirectoryView />} />
              <Route path="/actors" element={<ActorsDirectoryView />} />
              <Route path="/actor-classifier" element={<ActorClassifierView />} />
              <Route path="/automation" element={<AutomationView />} />
              <Route path="/chat" element={<ChatView />} />
              <Route path="/entity/:entityType/:entityId" element={<EntityView />} />
              
              {/* Legislature & Campaign Finance Routes */}
              <Route path="/legislature/*" element={<LegislatureApp />} />
            </Routes>
          </Suspense>
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
