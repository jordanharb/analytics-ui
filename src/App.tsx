import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { MapView } from './views/MapView/MapView';
import { DirectoryView } from './views/DirectoryView/DirectoryView';
import { EntityView } from './views/EntityView/EntityView';
import { ChatView } from './views/ChatView/ChatView';
import { Header } from './components/Header/Header';
import { LaunchPage } from './components/LaunchPage/LaunchPage';
import { LegislatureLanding } from './views/LegislatureView/LegislatureLanding';
import { CandidatePage } from './views/LegislatureView/CandidatePage';
import { LegislatorPage } from './views/LegislatureView/LegislatorPage';
import { BillPage } from './views/LegislatureView/BillPage';
import { CandidatesListPage } from './views/LegislatureView/CandidatesListPage';
import { LegislatorsListPage } from './views/LegislatureView/LegislatorsListPage';
import { BillsListPage } from './views/LegislatureView/BillsListPage';
import { SessionsListPage } from './views/LegislatureView/SessionsListPage';
import { TestConnection } from './views/LegislatureView/TestConnection';
import { PeopleListPage } from './views/LegislatureView/PeopleListPage';
import { PersonPage } from './views/LegislatureView/PersonPage';

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
            <Route path="/legislature" element={<LegislatureLanding />} />
            <Route path="/legislature/test" element={<TestConnection />} />
            
            {/* People-Centric Routes */}
            <Route path="/legislature/people" element={<PeopleListPage />} />
            <Route path="/legislature/person/:personId" element={<PersonPage />} />
            
            {/* List Pages */}
            <Route path="/legislature/candidates" element={<CandidatesListPage />} />
            <Route path="/legislature/legislators" element={<PeopleListPage />} /> {/* Redirect to people */}
            <Route path="/legislature/bills" element={<BillsListPage />} />
            <Route path="/legislature/sessions" element={<SessionsListPage />} />
            
            {/* Detail Pages */}
            <Route path="/legislature/candidate/:entityId" element={<CandidatePage />} />
            <Route path="/legislature/legislator/:legislatorId" element={<LegislatorPage />} />
            <Route path="/legislature/bill/:billId" element={<BillPage />} />
            <Route path="/legislature/session/:sessionId" element={<SessionsListPage />} />
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
