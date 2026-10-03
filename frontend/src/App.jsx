import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { RoomProvider, useRoom } from './context/RoomContext';
import { ThemeProvider } from './context/ThemeContext';
import { loadRoomLayout } from './roomRoute';
import { AuthProvider } from './context/AuthContext';

const LandingPage = lazy(() => import('./components/LandingPage'));
const RoomLayout = lazy(loadRoomLayout);
const AuthPage = lazy(() => import('./components/account/AuthPages'));
const AuthCallback = lazy(() => import('./components/account/AuthPages').then(module => ({ default: module.AuthCallback })));
const ProfilePage = lazy(() => import('./components/account/AuthPages').then(module => ({ default: module.ProfilePage })));
const MyWatchly = lazy(() => import('./components/account/MyWatchly'));
const LegalPage = lazy(() => import('./components/account/LegalPage'));

// BUG-25: Error boundary catches any render-time errors and shows a recovery UI
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('Watchly caught an error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          background: '#09090b', color: '#f4f4f5', fontFamily: 'system-ui, sans-serif',
          gap: '16px', padding: '24px', textAlign: 'center'
        }}>
          <div style={{ fontSize: '48px' }}>⚠️</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: '#71717a', fontSize: '14px', margin: 0, maxWidth: '400px' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/'; }}
            style={{
              marginTop: '8px', padding: '10px 24px', background: '#7c3aed',
              color: 'white', border: 'none', borderRadius: '10px',
              fontSize: '14px', fontWeight: 600, cursor: 'pointer'
            }}
          >
            Go Home
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ISSUE-32: Handles the 'watchly:kicked' custom event fired by RoomContext,
// using React Router's navigate() instead of a hard page reload.
// Must be inside <Router> to access useNavigate.
function KickHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => navigate('/', { replace: true });
    window.addEventListener('watchly:kicked', handler);
    return () => window.removeEventListener('watchly:kicked', handler);
  }, [navigate]);
  return null;
}

function ProtocolGuard({ children }) {
  const { protocolMismatch } = useRoom();
  if (!protocolMismatch) return children;
  return <div className="flex min-h-screen items-center justify-center bg-black p-6 text-center text-white">
    <div><h1 className="text-2xl font-bold">Update required</h1><p className="mt-2 text-zinc-400">Watchly changed while this page was open.</p>
      <button className="mt-5 rounded-xl bg-white px-5 py-3 font-bold text-black" onClick={() => window.location.reload()}>Refresh Watchly</button></div>
  </div>;
}

function App() {
  return (
    // BUG-01: Router wraps RoomProvider so useNavigate works everywhere
    <ErrorBoundary>
      <ThemeProvider>
        <Router>
          <AuthProvider>
          <RoomProvider>
            <KickHandler />
            <ProtocolGuard><Suspense fallback={<div className="min-h-screen bg-black" />}><Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/room/:roomId" element={<RoomLayout />} />
              <Route path="/auth" element={<AuthPage />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/setup-profile" element={<ProfilePage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/my-watchly" element={<MyWatchly />} />
              <Route path="/terms" element={<LegalPage kind="terms" />} />
              <Route path="/privacy" element={<LegalPage kind="privacy" />} />
            </Routes></Suspense></ProtocolGuard>
            {/* ISSUE-26: Toaster must be inside the tree so toasts render */}
            <Toaster
              position="bottom-center"
              containerClassName="watchly-toaster"
              toastOptions={{
                style: {
                  pointerEvents: 'none',
                  background: 'var(--glass-bg)',
                  color: 'var(--text)',
                  border: '1px solid var(--glass-border)',
                  borderTopColor: 'var(--glass-border-top)',
                  backdropFilter: 'blur(var(--blur)) saturate(var(--saturate))',
                  WebkitBackdropFilter: 'blur(var(--blur)) saturate(var(--saturate))',
                  boxShadow: 'var(--glass-shadow)',
                  borderRadius: '16px',
                  fontSize: '14px',
                  fontWeight: '500',
                  padding: '12px 16px'
                },
                success: { iconTheme: { primary: 'var(--text)', secondary: 'var(--accent)' } },
                error:   { iconTheme: { primary: '#f87171', secondary: '#18181b' } },
              }}
            />
          </RoomProvider>
          </AuthProvider>
        </Router>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
