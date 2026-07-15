import React, { useState, useEffect } from 'react';
import { Key, ShieldCheck, ShieldAlert, Cpu, Save, Trash2, Eye, EyeOff, Info } from 'lucide-react';

const MODEL_LISTS = {
  openrouter: [
    { label: 'Auto-Router Free (Default)', value: 'openrouter/free' },
    { label: 'Llama 3.3 70b Instruct', value: 'meta-llama/llama-3.3-70b-instruct' },
    { label: 'Mistral 7B Instruct', value: 'mistralai/mistral-7b-instruct' },
    { label: 'Command-R', value: 'cohere/command-r' }
  ],
  groq: [
    { label: 'Llama 3.3 70b Versatile', value: 'llama-3.3-70b-versatile' },
    { label: 'Llama 3.1 8b Instant', value: 'llama-3.1-8b-instant' },
    { label: 'Mixtral 8x7b 32k', value: 'mixtral-8x7b-32768' },
    { label: 'Gemma 2 9b', value: 'gemma2-9b-it' }
  ],
  gemini: [
    { label: 'Gemini 1.5 Flash (Default)', value: 'gemini-1.5-flash' },
    { label: 'Gemini 1.5 Pro', value: 'gemini-1.5-pro' }
  ]
};

export default function Settings({ token }) {
  // Key state
  const [credentials, setCredentials] = useState(null);
  const [providerInput, setProviderInput] = useState('openrouter');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState('');
  const [keySuccess, setKeySuccess] = useState('');
  const [keyLoading, setKeyLoading] = useState(false);

  // Model state
  const [models, setModels] = useState({
    planning: '',
    draft: '',
    linkedin: '',
    twitter: ''
  });
  const [modelSuccess, setModelSuccess] = useState('');
  const [modelError, setModelError] = useState('');

  useEffect(() => {
    fetchCredentials();
    fetchModelPreferences();
  }, []);

  const fetchCredentials = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/settings/ai-credential', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setCredentials(data);
        setProviderInput(data.provider);
      } else {
        setCredentials(null);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchModelPreferences = async () => {
    try {
      const response = await fetch('http://localhost:5000/api/settings/model-preferences', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (response.ok) {
        setModels(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpdateKey = async (e) => {
    e.preventDefault();
    setKeyLoading(true);
    setKeyError('');
    setKeySuccess('');

    try {
      const response = await fetch('http://localhost:5000/api/settings/ai-credential', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ provider: providerInput, apiKey: apiKeyInput })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setKeySuccess('API key updated and validated successfully!');
      setApiKeyInput('');
      fetchCredentials();
    } catch (err) {
      setKeyError(err.message);
    } finally {
      setKeyLoading(false);
    }
  };

  const handleRevokeKey = async () => {
    if (!window.confirm('Are you sure you want to revoke and delete your API key? Content generation will be disabled.')) return;
    
    setKeyError('');
    setKeySuccess('');

    try {
      const response = await fetch('http://localhost:5000/api/settings/ai-credential', {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        setKeySuccess('Key revoked successfully.');
        setCredentials(null);
      }
    } catch (e) {
      setKeyError(e.message);
    }
  };

  const handleUpdateModelPreference = async (taskType, modelSlug) => {
    setModelError('');
    setModelSuccess('');

    try {
      const response = await fetch('http://localhost:5000/api/settings/model-preferences', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ taskType, modelSlug })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error);

      setModels(prev => ({ ...prev, [taskType]: modelSlug }));
      setModelSuccess(`Preference for ${taskType} updated!`);
      setTimeout(() => setModelSuccess(''), 2000);
    } catch (err) {
      setModelError(err.message);
    }
  };

  const activeProvider = credentials?.provider || providerInput;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Account Settings</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Configure your LLM credentials and model specifications.</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* API Credentials */}
        <div className="glass-panel rounded-2xl p-6 space-y-6 shadow-md flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex justify-between items-center mb-1">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2">
                <Key size={18} className="text-brand-500 dark:text-brand-400" />
                <span>Provider Credentials (BYOK)</span>
              </h3>
              <a
                href="/api-key-guide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-brand-500 dark:text-brand-400 hover:underline flex items-center space-x-1"
              >
                <Info size={11} />
                <span>Setup Guide ↗</span>
              </a>
            </div>

            {/* Validation Banner */}
            {credentials ? (
              <div className={`p-4 rounded-xl border flex items-start space-x-3 ${
                credentials.is_valid 
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400' 
                  : 'bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400'
              }`}>
                {credentials.is_valid ? <ShieldCheck className="mt-0.5" /> : <ShieldAlert className="mt-0.5" />}
                <div className="text-xs leading-relaxed">
                  <p className="font-bold">
                    {credentials.is_valid ? 'API Key Active & Validated' : 'API Key Rejected / Invalidated'}
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Provider: <span className="uppercase font-semibold">{credentials.provider}</span><br />
                    Checked: {new Date(credentials.last_validated_at).toLocaleString()}
                  </p>
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-white/2 text-slate-500 dark:text-slate-400 text-xs">
                No active credentials configured. Please supply an API key below to unlock content generation.
              </div>
            )}

            {keyError && <div className="p-3 text-xs bg-rose-500/10 text-rose-400 rounded-lg">{keyError}</div>}
            {keySuccess && <div className="p-3 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg">{keySuccess}</div>}

            <form onSubmit={handleUpdateKey} className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Provider</label>
                <select
                  value={providerInput}
                  onChange={(e) => setProviderInput(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm cursor-pointer"
                >
                  <option value="openrouter" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">OpenRouter</option>
                  <option value="groq" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Groq</option>
                  <option value="gemini" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Google Gemini</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">API Key</label>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm pr-10"
                    placeholder="sk-or-v1-..."
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={keyLoading}
                className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold shadow-md transition-all"
              >
                {keyLoading ? 'Verifying Key...' : credentials ? 'Update / Rotate Key' : 'Save & Validate Key'}
              </button>
            </form>
          </div>

          {credentials && (
            <div className="border-t border-slate-200 dark:border-white/5 pt-4 mt-4">
              <button
                onClick={handleRevokeKey}
                className="w-full py-2 rounded-xl border border-rose-500/20 text-rose-500 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all"
              >
                <Trash2 size={13} />
                <span>Revoke & Delete Credentials</span>
              </button>
            </div>
          )}
        </div>

        {/* Model Preferences */}
        <div className="glass-panel rounded-2xl p-6 space-y-6 shadow-md">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center space-x-2">
            <Cpu size={18} className="text-brand-500 dark:text-brand-400" />
            <span>Agent Model Settings</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
            Map specific LLM models to each stage of the generation pipelines. Choices depend on your active credentials provider.
          </p>

          {modelError && <div className="p-3 text-xs bg-rose-500/10 text-rose-400 rounded-lg">{modelError}</div>}
          {modelSuccess && <div className="p-3 text-xs bg-emerald-500/10 text-emerald-400 rounded-lg">{modelSuccess}</div>}

          <div className="space-y-4">
            {['planning', 'draft', 'linkedin', 'twitter'].map((task) => {
              const labelMap = {
                planning: 'SEO Planning & Gap Analysis',
                draft: 'Long-Form Blog Drafting',
                linkedin: 'LinkedIn Copywriting',
                twitter: 'Twitter Ghostwriting'
              };

              const currentSlug = models[task] || '';
              const availableModels = MODEL_LISTS[activeProvider] || [];

              return (
                <div key={task} className="space-y-1.5">
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 capitalize">{labelMap[task]}</label>
                  <select
                    value={currentSlug}
                    onChange={(e) => handleUpdateModelPreference(task, e.target.value)}
                    disabled={!credentials}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-xs cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <option value="" disabled>Select model slug</option>
                    {availableModels.map((m) => (
                      <option key={m.value} value={m.value} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">
                        {m.label} ({m.value})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
