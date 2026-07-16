import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Filter, History, Settings as SettingsIcon, LogOut, Compass, Sun, Moon } from 'lucide-react';

export default function Navbar({ user, logout, theme, setTheme }) {
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-slate-950/80 backdrop-blur-md transition-colors duration-300 shadow-sm dark:shadow-slate-950/50">
      <div className="container mx-auto max-w-6xl px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="flex items-center space-x-2 text-slate-900 dark:text-white">
          <div className="p-2 rounded-xl bg-gradient-to-tr from-brand-600 to-violet-500 shadow-md shadow-brand-500/20">
            <Filter size={20} className="text-white" />
          </div>
          <span className="font-semibold text-lg tracking-tight bg-gradient-to-r from-slate-900 dark:from-white to-slate-600 dark:to-slate-300 bg-clip-text text-transparent">
            Funnelcraft
          </span>
        </Link>

        {/* Navigation */}
        {user && (
          <nav className="hidden md:flex items-center space-x-1">
            <Link
              to="/"
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/')
                  ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <Compass size={16} />
              <span>Planner</span>
            </Link>

            <Link
              to="/history"
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/history')
                  ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <History size={16} />
              <span>History</span>
            </Link>

            <Link
              to="/settings"
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive('/settings')
                  ? 'bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-500/20'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <SettingsIcon size={16} />
              <span>Settings</span>
            </Link>
          </nav>
        )}

        {/* User Details, Theme Toggle & Logout */}
        <div className="flex items-center space-x-4">
          {user && (
            <div className="hidden sm:flex flex-col text-right">
              <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium uppercase tracking-wider">Logged in as</span>
              <span className="text-xs text-slate-700 dark:text-slate-300 font-semibold truncate max-w-[150px]">
                {user?.email}
              </span>
            </div>
          )}

          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-lg bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:text-slate-950 dark:hover:text-brand-400 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800 transition-all shadow-sm"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {user && (
            <button
              onClick={logout}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-sm font-medium text-rose-500 hover:bg-rose-500/10 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 border border-transparent hover:border-rose-500/20 transition-all"
              title="Log Out"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Logout</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Bottom Navigation */}
      {user && (
        <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800/80 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] dark:shadow-[0_-4px_12px_rgba(0,0,0,0.5)] px-6 py-2 h-16 flex items-center justify-around">
          <Link
            to="/"
            className={`flex flex-col items-center justify-center space-y-1 text-[11px] font-medium transition-colors ${
              isActive('/')
                ? 'text-brand-600 dark:text-brand-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Compass size={20} />
            <span>Planner</span>
          </Link>

          <Link
            to="/history"
            className={`flex flex-col items-center justify-center space-y-1 text-[11px] font-medium transition-colors ${
              isActive('/history')
                ? 'text-brand-600 dark:text-brand-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <History size={20} />
            <span>History</span>
          </Link>

          <Link
            to="/settings"
            className={`flex flex-col items-center justify-center space-y-1 text-[11px] font-medium transition-colors ${
              isActive('/settings')
                ? 'text-brand-600 dark:text-brand-400 font-semibold'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <SettingsIcon size={20} />
            <span>Settings</span>
          </Link>
        </nav>
      )}
    </header>
  );
}
