import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import ContentCard from '../components/ContentCard';
import Editor from '../components/Editor';
import { Globe, MessageSquare, Twitter, Calendar, CheckCircle } from 'lucide-react';

export default function History({ token }) {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('blog'); // 'blog' | 'linkedin' | 'twitter'
  const [historyItems, setHistoryItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Modal editor state
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    fetchHistory();
  }, [activeFilter]);

  const fetchHistory = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`http://localhost:5000/api/content/history?platform=${activeFilter}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setHistoryItems(data);
      } else {
        throw new Error(data.error || 'Failed to fetch content history.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveDraft = async (id, updatedTitle, updatedBody) => {
    try {
      const response = await fetch(`http://localhost:5000/api/content/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title: updatedTitle, body: updatedBody })
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save changes.');
      }
      setHistoryItems(prev => prev.map(item => {
        if (item.id === id) {
          return { ...item, title: updatedTitle, body: updatedBody };
        }
        return item;
      }));
    } catch (e) {
      console.error(e);
      throw e;
    }
  };

  const handleUpdateStatus = async (id, status) => {
    try {
      const response = await fetch(`http://localhost:5000/api/content/${id}/status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status })
      });
      if (response.ok) {
        setHistoryItems(prev => prev.map(item => {
          if (item.id === id) {
            return { 
              ...item, 
              status, 
              published_at: status === 'marked_published' ? new Date().toISOString() : null 
            };
          }
          return item;
        }));
        setEditingItem(prev => prev ? { 
          ...prev, 
          status, 
          published_at: status === 'marked_published' ? new Date().toISOString() : null 
        } : null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteContent = async (id) => {
    try {
      const response = await fetch(`http://localhost:5000/api/content/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setHistoryItems(prev => prev.filter(item => item.id !== id));
        setEditingItem(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderContentGrid = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-slate-500 font-medium">Fetching history archive...</span>
        </div>
      );
    }

    if (error) {
      return (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">
          {error}
        </div>
      );
    }

    if (historyItems.length === 0) {
      const labelMap = { blog: 'Blogs', linkedin: 'LinkedIn Posts', twitter: 'Tweets' };
      return (
        <div className="glass-panel rounded-2xl p-12 text-center text-slate-500 text-sm">
          No generated {labelMap[activeFilter]} found. Go to Planner to create your first draft!
        </div>
      );
    }

    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {historyItems.map((item) => (
          <ContentCard
            key={item.id}
            item={item}
            onView={(selected) => setEditingItem(selected)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-white/5 pb-5">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Content History</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Review your archive of drafts and published micro-content.</p>
        </div>

        {/* Tab Filters */}
        <div className="flex space-x-1.5 p-1 rounded-xl bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-white/5 self-start md:self-center">
          <button
            onClick={() => setActiveFilter('blog')}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeFilter === 'blog' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Globe size={13} />
            <span>Blogs</span>
          </button>
          <button
            onClick={() => setActiveFilter('linkedin')}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeFilter === 'linkedin' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MessageSquare size={13} />
            <span>LinkedIn</span>
          </button>
          <button
            onClick={() => setActiveFilter('twitter')}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeFilter === 'twitter' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Twitter size={13} />
            <span>Tweets</span>
          </button>
        </div>
      </div>

      {/* Grid */}
      {renderContentGrid()}

      {/* Detail Overlay Editor */}
      {editingItem && (
        <Editor
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={handleSaveDraft}
          onUpdateStatus={handleUpdateStatus}
          onDelete={handleDeleteContent}
          onRegenerate={(title) => navigate('/', { state: { regenerateTitle: title } })}
        />
      )}
    </div>
  );
}
