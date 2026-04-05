import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { RoomProvider } from './context/RoomContext';
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
    console.error('WatchSync caught an error:', error, info);
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

// ISSUE-32: Handles the 'watchsync:kicked' custom event fired by RoomContext,
// using React Router's navigate() instead of a hard page reload.
// Must be inside <Router> to access useNavigate.
function KickHandler() {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = () => navigate('/', { replace: true });
    window.addEventListener('watchsync:kicked', handler);
    return () => window.removeEventListener('watchsync:kicked', handler);
  }, [navigate]);
  return null;
}

function App() {
  return (
    // BUG-01: Router wraps RoomProvider so useNavigate works everywhere
    <ErrorBoundary>
      <ThemeProvider>
        <Router>
          <RoomProvider>
            <KickHandler />
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/room/:roomId" element={<RoomLayout />} />
            </Routes>
            {/* ISSUE-26: Toaster must be inside the tree so toasts render */}
            <Toaster
              position="bottom-center"
              toastOptions={{
                style: {
                  background: '#18181b',
                  color: '#f4f4f5',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                  fontSize: '13px',
                },
                success: { iconTheme: { primary: '#a855f7', secondary: '#18181b' } },
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
