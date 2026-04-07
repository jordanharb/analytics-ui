import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { Header } from './components/Header/Header';
import { AuthProvider, useAuth } from './auth/AuthProvider';

const MapView = lazy(() => import('./views/MapView/MapView').then(m => ({ default: m.MapView })));
const DirectoryView = lazy(() => import('./views/DirectoryView/DirectoryView').then(m => ({ default: m.DirectoryView })));
const EntityView = lazy(() => import('./views/EntityView/EntityView').then(m => ({ default: m.EntityView })));
const ActorsDirectoryView = lazy(() => import('./views/ActorsDirectory/ActorsDirectoryView').then(m => ({ default: m.ActorsDirectoryView })));
const LaunchPage = lazy(() => import('./components/LaunchPage/LaunchPage'));
const SettingsView = lazy(() => import('./views/Settings/SettingsView').then(m => ({ default: m.SettingsView })));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="flex items-center justify-center h-full text-sm text-[#6b6b6b]">loading…</div>;
  if (!session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppContent() {
  const location = useLocation();
  const isLanding = location.pathname === '/';
  const isMapPage = location.pathname === '/map';

  return (
    <div className={`w-full h-screen overflow-x-hidden ${isLanding ? '' : 'bg-[#f6f1e6]'}`}>
      <div className="h-screen flex flex-col">
        {!isLanding && <Header />}
        <main className={`flex-1 h-full ${isMapPage ? 'overflow-hidden' : 'overflow-auto'}`}>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-sm text-[#6b6b6b]">loading…</div>}>
            <div className={isMapPage ? 'h-full' : ''}>
              <Routes>
                <Route path="/" element={<LaunchPage />} />
                <Route path="/map" element={<ProtectedRoute><MapView /></ProtectedRoute>} />
                <Route path="/directory" element={<ProtectedRoute><DirectoryView /></ProtectedRoute>} />
                <Route path="/actors" element={<ProtectedRoute><ActorsDirectoryView /></ProtectedRoute>} />
                <Route path="/entity/:entityType/:entityId" element={<ProtectedRoute><EntityView /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute><SettingsView /></ProtectedRoute>} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </div>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </Router>
  );
}

export default App;
