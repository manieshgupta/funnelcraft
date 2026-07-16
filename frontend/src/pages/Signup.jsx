import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import Loader from '../components/Loader';
import { Building2, User, Key, Check, Info, FileText, ChevronRight, Filter } from 'lucide-react';
import { getApiUrl } from '../utils/api';

export default function Signup({ setToken }) {
  const navigate = useNavigate();
  const [accountType, setAccountType] = useState('company'); // 'company' | 'personal'
  const [step, setStep] = useState(1); // 1: Selector, 2: Info & AI Key
  
  // General Fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Company Fields
  const [companyName, setCompanyName] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [companyLinkedin, setCompanyLinkedin] = useState('');
  
  // Personal Fields
  const [fullName, setFullName] = useState('');
  const [jobRole, setJobRole] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [twitterUrl, setTwitterUrl] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [contentGoal, setContentGoal] = useState('');
  const [resumeFile, setResumeFile] = useState(null);

  // AI BYOK Configuration
  const [provider, setProvider] = useState('openrouter'); // 'openrouter' | 'groq' | 'gemini'
  const [apiKey, setApiKey] = useState('');

  // Status & Polling States
  const [loading, setLoading] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobStatus, setJobStatus] = useState('');
  const [error, setError] = useState('');
  const [signupUserId, setSignupUserId] = useState('');

  // Onboarding Loader steps checklist
  const onboardingSteps = [
    'Verifying provider API credentials...',
    'Scraping/crawling digital profile resources...',
    'Analyzing text and extracting unique value angles...',
    'Generating custom content pillars and guidelines...',
    'Committing vectors into knowledge-base DB...'
  ];

  // Poll job status
  useEffect(() => {
    if (!jobId) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(getApiUrl(`/api/jobs/${jobId}`), {
          headers: {
            'Authorization': `Bearer mock-user-signup`
          }
        });
        const data = await response.json();
        
        if (response.ok) {
          setJobStatus(data.status);
          if (data.status === 'complete') {
            clearInterval(interval);
            setLoading(false);
            
            // On completion, set localStorage and token
            localStorage.setItem('email', email);
            localStorage.setItem('accountType', accountType);
            
            setToken(`mock-user-${signupUserId || data.user_id || 'onboarded'}`);
            navigate('/');
          } else if (data.status === 'failed') {
            clearInterval(interval);
            setLoading(false);
            setJobId('');
            setError(data.error || 'Onboarding analysis failed. Please verify that your website URL is reachable and your AI key is valid.');
          }
        }
      } catch (err) {
        console.error(err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [jobId, email, accountType, setToken, navigate]);

  // Handle PDF file -> base64
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      setResumeFile(reader.result); // Base64 string
    };
    reader.readAsDataURL(file);
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    if (!email || !password || !apiKey) {
      return setError('Please fill in all required fields.');
    }

    setLoading(true);
    setError('');

    const baseBody = {
      email,
      password,
      provider,
      apiKey
    };

    let url = getApiUrl('/api/auth/signup/company');
    let body = {
      ...baseBody,
      companyName,
      websiteUrl,
      linkedinUrl: companyLinkedin
    };

    if (accountType === 'personal') {
      url = getApiUrl('/api/auth/signup/personal');
      body = {
        ...baseBody,
        fullName,
        jobRole,
        linkedinUrl,
        twitterUrl,
        portfolioUrl,
        targetAudience,
        contentGoal,
        resumeFile 
      };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (!response.ok) {
        setLoading(false);
        return setError(data.error || 'Signup failed.');
      }

      setSignupUserId(data.userId);
      setJobId(data.jobId);
      setJobStatus('queued');
    } catch (err) {
      setLoading(false);
      setError('Connection failure: ' + err.message);
    }
  };

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto py-12">
        <Loader
          title="Onboarding & Training Your Lead Engine"
          subtitle="Our backend content agents are scanning your digital footprint and configuring your semantic database..."
          steps={onboardingSteps}
          currentStepIndex={
            jobStatus === 'queued' ? 0 :
            jobStatus === 'running' ? 2 : 4
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8">
      {/* Brand Icon */}
      <div className="flex flex-col items-center mb-8">
        <div className="p-3.5 rounded-2xl bg-gradient-to-tr from-brand-600 to-violet-500 mb-3 shadow-lg shadow-brand-500/15">
          <Filter size={26} className="text-white" />
        </div>
        <h2 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">Onboard Your Account</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Provide credentials and resources to build your brand profile</p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs font-semibold leading-relaxed">
          {error}
        </div>
      )}

      {step === 1 ? (
        /* STEP 1: Selector */
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setAccountType('company')}
              className={`p-6 rounded-2xl border text-left flex flex-col justify-between h-44 transition-all duration-300 ${
                accountType === 'company'
                  ? 'glass-panel border-brand-500 bg-brand-500/5 ring-1 ring-brand-500'
                  : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              <Building2 size={28} className={accountType === 'company' ? 'text-brand-500 dark:text-brand-400' : 'text-slate-500'} />
              <div>
                <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Company Mode</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Grow inbound leads, market products, and establish voice for a business.</p>
              </div>
            </button>

            <button
              onClick={() => setAccountType('personal')}
              className={`p-6 rounded-2xl border text-left flex flex-col justify-between h-44 transition-all duration-300 ${
                accountType === 'personal'
                  ? 'glass-panel border-brand-500 bg-brand-500/5 ring-1 ring-brand-500'
                  : 'bg-slate-100 dark:bg-white/5 border-slate-200 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              <User size={28} className={accountType === 'personal' ? 'text-brand-500 dark:text-brand-400' : 'text-slate-500'} />
              <div>
                <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">Personal Brand Mode</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">Build influence, share professional insights, and grow personal career reach.</p>
              </div>
            </button>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              className="flex items-center space-x-1.5 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-lg shadow-brand-600/15 transition-all"
            >
              <span>Continue Details</span>
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : (
        /* STEP 2: Input Details & API keys */
        <form onSubmit={handleSignup} className="glass-panel rounded-2xl p-8 space-y-6 shadow-xl">
          <div className="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-4">
            <h3 className="font-bold text-lg text-slate-900 dark:text-white">
              {accountType === 'company' ? 'Company Details' : 'Brand Profile Details'}
            </h3>
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs text-slate-500 hover:text-slate-850 dark:hover:text-white"
            >
              Change Account Type
            </button>
          </div>

          {/* Core Credentials */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                placeholder="Password"
                required
              />
            </div>
          </div>

          {/* Conditional Forms */}
          {accountType === 'company' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Company Name</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                  placeholder="ACME Corp"
                  required
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Website URL</label>
                  <input
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="https://acme.com"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">LinkedIn Company Page URL</label>
                  <input
                    type="url"
                    value={companyLinkedin}
                    onChange={(e) => setCompanyLinkedin(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="https://linkedin.com/company/acme"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Full Name</label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="Jane Doe"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Professional Role / Job Title</label>
                  <input
                    type="text"
                    value={jobRole}
                    onChange={(e) => setJobRole(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="Senior Software Engineer"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">LinkedIn Profile URL</label>
                  <input
                    type="url"
                    value={linkedinUrl}
                    onChange={(e) => setLinkedinUrl(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="https://linkedin.com/in/jane"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Twitter Profile URL</label>
                  <input
                    type="url"
                    value={twitterUrl}
                    onChange={(e) => setTwitterUrl(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="https://twitter.com/jane"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Portfolio URL (Optional)</label>
                  <input
                    type="url"
                    value={portfolioUrl}
                    onChange={(e) => setPortfolioUrl(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                    placeholder="https://janedoe.dev"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Target Audience</label>
                  <textarea
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl glass-input text-xs h-16 resize-none"
                    placeholder="e.g. Founders, Hiring Managers, Tech Enthusiasts"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Content Goal / Motive</label>
                  <textarea
                    value={contentGoal}
                    onChange={(e) => setContentGoal(e.target.value)}
                    className="w-full px-4 py-2 rounded-xl glass-input text-xs h-16 resize-none"
                    placeholder="e.g. Seeking tech lead jobs, sharing insights, building a SaaS community"
                  />
                </div>
              </div>

              {/* PDF Resume Upload */}
              <div className="border border-dashed border-slate-300 dark:border-white/10 rounded-xl p-4 bg-slate-50 dark:bg-white/2 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <FileText className="text-slate-400" />
                  <div>
                    <h5 className="text-xs font-bold text-slate-900 dark:text-white">Upload Professional Resume (PDF)</h5>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">Our agents will parse and extract experience details.</p>
                  </div>
                </div>
                <input
                  type="file"
                  accept=".pdf"
                  onChange={handleFileChange}
                  className="text-xs text-slate-500 dark:text-slate-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-slate-200 dark:file:bg-white/5 file:text-slate-700 dark:file:text-slate-300 hover:file:bg-slate-300 dark:hover:file:bg-white/10 file:cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* AI Settings (Bring Your Own Key) */}
          <div className="border-t border-slate-200 dark:border-white/5 pt-5 space-y-4">
            <div className="flex justify-between items-center mb-2">
              <h4 className="flex items-center space-x-2 text-sm font-bold text-slate-900 dark:text-white">
                <Key size={16} className="text-brand-500 dark:text-brand-400" />
                <span>AI Provider Configuration (BYOK)</span>
              </h4>
              <a
                href="/api-key-guide.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] font-bold text-brand-500 dark:text-brand-400 hover:underline flex items-center space-x-1"
              >
                <Info size={11} />
                <span>API Key Setup Guide ↗</span>
              </a>
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Select Provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm cursor-pointer"
                >
                  <option value="openrouter" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">OpenRouter</option>
                  <option value="groq" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Groq</option>
                  <option value="gemini" className="bg-white dark:bg-slate-900 text-slate-900 dark:text-white">Google Gemini</option>
                </select>
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="block text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">AI API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl glass-input text-sm"
                  placeholder="Paste your key here"
                  required
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
              Note: Key is validated instantly. We securely encrypt and store your key in a Postgres Vault. Your key is never shared or displayed back to the client.
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-white/5 pt-5">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center space-x-1.5 px-6 py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-bold shadow-lg shadow-brand-600/10 hover:shadow-brand-500/25 transition-all"
            >
              <span>{loading ? 'Initializing...' : 'Complete & Onboard'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Already have an account */}
      <div className="mt-8 text-center text-xs text-slate-500 dark:text-slate-400 border-t border-slate-200 dark:border-white/5 pt-5">
        <span>Already have an account? </span>
        <Link to="/login" className="text-brand-500 dark:text-brand-400 hover:underline font-bold">
          Sign In
        </Link>
      </div>
    </div>
  );
}
