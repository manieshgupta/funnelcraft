import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Loader from '../components/Loader';
import Editor from '../components/Editor';
import { Globe, MessageSquare, Twitter, Compass, Sparkles, Send, FileText, CheckCircle } from 'lucide-react';

export default function Dashboard({ token, user }) {
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('blog'); // 'blog' | 'linkedin' | 'twitter'
  
  // Blog-specific states
  const [topicInput, setTopicInput] = useState('');
  const [suggestedTopics, setSuggestedTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState('');
  const [isRegeneratingPillars, setIsRegeneratingPillars] = useState(false);
  
  // Job Tracking states
  const [runningJobId, setRunningJobId] = useState('');
  const [jobType, setJobType] = useState(''); // 'titles' | 'draft' | 'linkedin' | 'twitter'
  const [jobProgress, setJobProgress] = useState('');
  
  // Results states
  const [rankedTitles, setRankedTitles] = useState([]);
  const [activeDraft, setActiveDraft] = useState(null);
  
  // Editor Modal state
  const [editingItem, setEditingItem] = useState(null);
  
  const [error, setError] = useState('');

  // Auto-load topics for blog
  useEffect(() => {
    if (activeTab === 'blog') {
      fetchSuggestedTopics();
    }
    setError('');
  }, [activeTab]);

  // Polling hook for background jobs
  useEffect(() => {
    if (!runningJobId) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`http://localhost:5000/api/jobs/${runningJobId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const job = await response.json();

        if (response.ok) {
          setJobProgress(job.status);
          
          if (job.status === 'complete') {
            clearInterval(interval);
            setRunningJobId('');
            
            // Handle completed job output
            if (job.job_type === 'blog_titles') {
              setRankedTitles(job.result);
            } else if (job.job_type === 'blog_draft' || job.job_type === 'linkedin_draft' || job.job_type === 'twitter_draft') {
              // Open in Editor
              setActiveDraft(job.result);
              setEditingItem({
                id: job.result.contentId,
                platform: activeTab,
                title: job.result.title,
                body: job.result.body,
                status: 'draft'
              });
            }
          } else if (job.status === 'failed') {
            clearInterval(interval);
            setRunningJobId('');
            setError(job.error || 'Job failed. Please check your credentials and internet access.');
          }
        }
      } catch (err) {
        console.error('[Dashboard] Error polling job status:', err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [runningJobId, token, activeTab]);

  const fetchSuggestedTopics = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/blog/suggested-topics', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setSuggestedTopics(data.topics || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleRegeneratePillars = async () => {
    setError('');
    setIsRegeneratingPillars(true);
    try {
      const response = await fetch('http://localhost:5000/api/blog/suggested-topics/regenerate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setSuggestedTopics(data.topics || []);
    } catch (err) {
      setError('Failed to regenerate pillars: ' + err.message);
    } finally {
      setIsRegeneratingPillars(false);
    }
  };

  const handleSuggestTitles = async (topic) => {
    setError('');
    const targetTopic = topic || topicInput;
    if (!targetTopic) return setError('Please enter or select a topic first.');

    setJobType('titles');
    setJobProgress('queued');

    try {
      const response = await fetch('http://localhost:5000/api/blog/titles', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ topic: targetTopic })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setRunningJobId(data.jobId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGenerateBlogDraft = async (title) => {
    setError('');
    setJobType('draft');
    setJobProgress('queued');

    try {
      const response = await fetch('http://localhost:5000/api/blog/generate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ title })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setRunningJobId(data.jobId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGenerateLinkedIn = async () => {
    setError('');
    setJobType('linkedin');
    setJobProgress('queued');

    try {
      const response = await fetch('http://localhost:5000/api/linkedin/generate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setRunningJobId(data.jobId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGenerateTwitter = async () => {
    setError('');
    setJobType('twitter');
    setJobProgress('queued');

    try {
      const response = await fetch('http://localhost:5000/api/twitter/generate', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setRunningJobId(data.jobId);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    if (location.state && location.state.regenerateTitle) {
      setActiveTab('blog');
      handleGenerateBlogDraft(location.state.regenerateTitle);
      window.history.replaceState({}, document.title);
    }
  }, [location]);

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
      if (activeDraft && activeDraft.contentId === id) {
        setActiveDraft(prev => ({ ...prev, title: updatedTitle, body: updatedBody }));
      }
      setEditingItem(prev => prev ? { ...prev, title: updatedTitle, body: updatedBody } : null);
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
        if (activeDraft && activeDraft.contentId === id) {
          setActiveDraft(prev => ({ ...prev, status }));
        }
        setEditingItem(prev => prev ? { ...prev, status } : null);
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
        if (activeDraft && activeDraft.contentId === id) {
          setActiveDraft(null);
        }
        setEditingItem(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderBlogTab = () => {
    if (runningJobId && jobType === 'titles') {
      return (
        <Loader
          title="Performing Competitor & Gap Analysis"
          subtitle="Searching recent search indexes, scraping competitor blogs, and constructing suggestions..."
          steps={[
            'Initiating web search queries for gap analysis...',
            'Scraping organic metadata outlines from competitor content...',
            'Reviewing extracted text for voice match...',
            'Compiling optimal SEO title candidates...'
          ]}
        />
      );
    }

    if (runningJobId && jobType === 'draft') {
      return (
        <Loader
          title="Writing Comprehensive Blog Draft"
          subtitle="Retrieving RAG vectors, creating outline structure, and generating rich paragraphs..."
          steps={[
            'Pulling relevant RAG nodes from pgvector database...',
            'Structuring H2/H3 outline layout blocks...',
            'Executing long-form draft generation (1200+ words)...',
            'Applying Pollinations image generation and storage re-host...',
            'Performing 90-day cosine-similarity deduplication check...'
          ]}
        />
      );
    }

    return (
      <div className="space-y-6">
        {/* Step 1: Topics Selection / Input */}
        {rankedTitles.length === 0 && (
          <div className="glass-panel border border-slate-200 dark:border-white/5 rounded-2xl p-6 space-y-6 shadow-md">
            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <Sparkles size={18} className="text-brand-400" />
                <span>SEO Blog Title Suggester</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Enter a topic or select one of your AI-extracted content pillars to discover competitor-outranking titles.
              </p>
            </div>

            {/* Pillar suggestions */}
            {suggestedTopics.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Suggested Pillars</label>
                  <button
                    type="button"
                    onClick={handleRegeneratePillars}
                    disabled={isRegeneratingPillars}
                    className="text-[10px] font-bold text-brand-400 hover:text-brand-300 transition-all flex items-center space-x-1"
                  >
                    <Sparkles size={10} className={isRegeneratingPillars ? 'animate-spin' : ''} />
                    <span>{isRegeneratingPillars ? 'Regenerating...' : 'Regenerate'}</span>
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {suggestedTopics.map((topic, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSuggestTitles(topic)}
                      className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-brand-500/10 dark:bg-white/5 dark:hover:bg-brand-500/5 border border-slate-200 dark:border-white/5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:border-brand-500/30 transition-all"
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Custom Input */}
            <div className="flex items-center space-x-2 pt-2">
              <input
                type="text"
                value={topicInput}
                onChange={(e) => setTopicInput(e.target.value)}
                className="flex-1 px-4 py-2.5 rounded-xl glass-input text-sm"
                placeholder="Or type a custom topic (e.g. Next.js performance optimizations)"
              />
              <button
                onClick={() => handleSuggestTitles()}
                className="flex items-center space-x-1.5 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-md shadow-brand-600/10 hover:shadow-brand-500/25 transition-all h-full"
              >
                <Send size={15} />
                <span>Suggest</span>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Show suggestions */}
        {rankedTitles.length > 0 && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Suggested Outranking Titles</h3>
                <p className="text-xs text-slate-550 dark:text-slate-400">Select a ranked title to write a full long-form draft.</p>
              </div>
              <button
                onClick={() => setRankedTitles([])}
                className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                Reset Planner
              </button>
            </div>

            <div className="grid gap-4">
              {rankedTitles.map((item, i) => (
                <div
                  key={i}
                  className="glass-panel border border-slate-200 dark:border-white/5 rounded-2xl p-5 hover:border-brand-500/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-brand-500/10 text-brand-400 border border-brand-500/10 uppercase">
                        Rank {item.rank}
                      </span>
                      {item.target_keywords?.map((k, idx) => (
                        <span key={idx} className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">#{k}</span>
                      ))}
                    </div>
                    <h4 className="text-base font-bold text-slate-900 dark:text-white leading-snug">{item.title}</h4>
                    <p className="text-xs text-slate-400 leading-relaxed">{item.rationale}</p>
                  </div>

                  <button
                    onClick={() => handleGenerateBlogDraft(item.title)}
                    className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md shadow-brand-600/10 hover:shadow-brand-500/25 transition-all self-start md:self-center"
                  >
                    Draft Article
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLinkedInTab = () => {
    if (runningJobId && jobType === 'linkedin') {
      return (
        <Loader
          title="Crafting LinkedIn Insight Post"
          subtitle="Fetching viral patterns, matching format DNA, and analyzing trends..."
          steps={[
            'Retrieving local style-DNA posts context...',
            'Scraping LinkedIn search results for relevant news...',
            'Writing engaging hook lines and structured points...',
            'Formatting emojis and whitespace tags...'
          ]}
        />
      );
    }

    return (
      <div className="glass-panel border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center space-y-6 max-w-lg mx-auto shadow-md">
        <div className="mx-auto p-4 w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center text-indigo-400">
          <MessageSquare size={28} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">LinkedIn Post Generator</h3>
          <p className="text-sm text-slate-400 px-6 leading-relaxed">
            Our agent analyzes your onboarding profile summary and crawls trending LinkedIn news to write an optimized value post matched to your formatting tone.
          </p>
        </div>
        <button
          onClick={handleGenerateLinkedIn}
          className="px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-lg shadow-brand-600/15 transition-all"
        >
          Generate LinkedIn Post
        </button>
      </div>
    );
  };

  const renderTwitterTab = () => {
    if (runningJobId && jobType === 'twitter') {
      return (
        <Loader
          title="Ghostwriting Micro-Content Tweet"
          subtitle="Injecting bold takes, optimizing characters, and crafting hooks..."
          steps={[
            'Pulling user brand focus vectors...',
            'Structuring lesson layouts (micro-format)...',
            'Drafting character-count constrained post (<280 chars)...'
          ]}
        />
      );
    }

    return (
      <div className="glass-panel border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center space-y-6 max-w-lg mx-auto shadow-md">
        <div className="mx-auto p-4 w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/15 flex items-center justify-center text-sky-400">
          <Twitter size={28} />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Twitter Tweet Generator</h3>
          <p className="text-sm text-slate-400 px-6 leading-relaxed">
            Generate punchy, high-impact tweets mapping to your core areas of expertise, optimized for the 280-character micro-format.
          </p>
        </div>
        <button
          onClick={handleGenerateTwitter}
          className="px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-lg shadow-brand-600/15 transition-all"
        >
          Generate Tweet
        </button>
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 dark:border-white/5 pb-5">
        <div>
          <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">AI Content Planner</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Build and optimize competitor-aware drafts matched to your brand guidelines.
          </p>
        </div>

        {/* Tab Selector */}
        <div className="flex space-x-1.5 p-1 rounded-xl bg-slate-200 dark:bg-slate-900 border border-slate-300 dark:border-white/5 self-start md:self-center">
          <button
            onClick={() => setActiveTab('blog')}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'blog' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Globe size={13} />
            <span>Blog</span>
          </button>
          <button
            onClick={() => setActiveTab('linkedin')}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'linkedin' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <MessageSquare size={13} />
            <span>LinkedIn</span>
          </button>
          <button
            onClick={() => setActiveTab('twitter')}
            className={`flex items-center space-x-1 px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'twitter' ? 'bg-brand-600 text-white shadow-md' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Twitter size={13} />
            <span>Twitter</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold">
          {error}
        </div>
      )}

      {/* Render active content tab */}
      {activeTab === 'blog' && renderBlogTab()}
      {activeTab === 'linkedin' && renderLinkedInTab()}
      {activeTab === 'twitter' && renderTwitterTab()}

      {/* Overlay Editor Modal */}
      {editingItem && (
        <Editor
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSave={handleSaveDraft}
          onUpdateStatus={handleUpdateStatus}
          onDelete={handleDeleteContent}
          onRegenerate={handleGenerateBlogDraft}
        />
      )}
    </div>
  );
}
