import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { RoomProvider, useRoom } from './context/RoomContext';
import { ThemeProvider } from './context/ThemeContext';
import LandingPage from './components/LandingPage';
import RoomLayout from './components/RoomLayout';

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
          <RoomProvider>
            <KickHandler />
            <ProtocolGuard><Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/room/:roomId" element={<RoomLayout />} />
            </Routes></ProtocolGuard>
            {/* ISSUE-26: Toaster must be inside the tree so toasts render */}
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
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
        </Router>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
