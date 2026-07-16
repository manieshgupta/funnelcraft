import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import History from './pages/History';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      
      // Decode user from mock or real JWT token
      if (token.startsWith('mock-user-')) {
        const userId = token.replace('mock-user-', '');
        setUser({ 
          id: userId, 
          email: localStorage.getItem('email') || 'user@example.com',
          accountType: localStorage.getItem('accountType') || 'company'
        });
      } else {
        // If it's a real Supabase JWT, we parse the claims
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          setUser({ 
            id: payload.sub, 
            email: payload.email,
            accountType: localStorage.getItem('accountType') || 'company'
          });
        } catch (e) {
          console.error('[App] Failed to parse JWT payload', e);
          setUser({ id: 'unknown', email: 'user@example.com' });
        }
      }
    } else {
      localStorage.removeItem('token');
      localStorage.removeItem('email');
      localStorage.removeItem('accountType');
      setUser(null);
    }
  }, [token]);

  const logout = () => {
    setToken('');
  };

  return (
    <Router>
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 bg-radial-glow flex flex-col transition-colors duration-300">
        <Navbar user={user} logout={logout} theme={theme} setTheme={setTheme} />
        <main className="flex-1 container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-6xl">
          <Routes>
            <Route path="/login" element={!token ? <Login setToken={setToken} /> : <Navigate to="/" />} />
            <Route path="/signup" element={!token ? <Signup setToken={setToken} /> : <Navigate to="/" />} />
            <Route path="/" element={token ? <Dashboard token={token} user={user} /> : <Navigate to="/login" />} />
            <Route path="/settings" element={token ? <Settings token={token} user={user} /> : <Navigate to="/login" />} />
            <Route path="/history" element={token ? <History token={token} user={user} /> : <Navigate to="/login" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
