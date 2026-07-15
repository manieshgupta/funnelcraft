import React, { useState } from 'react';
import { Copy, Save, Check, X, Clipboard, ExternalLink, Globe, Trash2, RefreshCw, EyeOff } from 'lucide-react';

export default function Editor({ item, onClose, onSave, onMarkPublished, onUpdateStatus, onDelete, onRegenerate }) {
  const [body, setBody] = useState(item.body);
  const [title, setTitle] = useState(item.title || '');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [saveMessage, setSaveMessage] = useState('');

  const handleCopy = () => {
    // Strip markdown image links for clean text copy if needed, or copy raw
    navigator.clipboard.writeText(body);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage('');
    try {
      await onSave(item.id, title, body);
      setSaveMessage('Changes saved successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (e) {
      console.error(e);
      setSaveMessage('Failed to save changes.');
      setTimeout(() => setSaveMessage(''), 3500);
      throw e;
    } finally {
      setSaving(false);
    }
  };

  const handleStatusTransition = async (newStatus) => {
    setPublishing(true);
    try {
      // Auto-save changes first
      await onSave(item.id, title, body);
      if (onUpdateStatus) {
        await onUpdateStatus(item.id, newStatus);
      } else if (newStatus === 'marked_published' && onMarkPublished) {
        await onMarkPublished(item.id);
      }
      setSaveMessage(newStatus === 'marked_published' ? 'Content published successfully!' : 'Content reverted to draft successfully!');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (e) {
      console.error(e);
      setSaveMessage('Failed to update status.');
      setTimeout(() => setSaveMessage(''), 3500);
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async () => {
    if (window.confirm("Are you sure you want to delete this content permanently?")) {
      try {
        if (onDelete) {
          await onDelete(item.id);
        }
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleRegenerate = () => {
    if (window.confirm("Are you sure you want to regenerate this content? Your current changes will be overwritten.")) {
      if (onRegenerate) {
        onRegenerate(item.title);
      }
      onClose();
    }
  };

  // Basic markdown-to-html rendering simulation
  const renderMarkdown = (md) => {
    if (!md) return '';
    return md
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Headers
      .replace(/^### (.*$)/gim, '<h4 class="text-md font-bold text-slate-750 dark:text-slate-200 mt-4 mb-2">$1</h4>')
      .replace(/^## (.*$)/gim, '<h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mt-5 mb-2.5 border-b border-slate-200 dark:border-white/5 pb-1">$1</h3>')
      .replace(/^# (.*$)/gim, '<h2 class="text-xl font-bold text-slate-900 dark:text-white mt-6 mb-3">$1</h2>')
      // Images: ![alt](url)
      .replace(/!\[(.*?)\]\((.*?)\)/gim, '<div class="my-4"><img src="$2" alt="$1" class="rounded-xl border border-slate-200 dark:border-white/10 shadow-lg max-h-[350px] w-full object-cover" /></div>')
      // Links: [text](url)
      .replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-brand-600 dark:text-brand-400 hover:underline flex inline-items items-center">$1 <span class="inline-block ml-0.5 text-[10px]">↗</span></a>')
      // Bold
      .replace(/\*\*(.*?)\*\*/gim, '<strong class="text-slate-900 dark:text-slate-100 font-semibold">$1</strong>')
      // Bullets
      .replace(/^\- (.*$)/gim, '<li class="ml-4 list-disc text-slate-600 dark:text-slate-300">$1</li>')
      // Line breaks
      .replace(/\n$/gim, '<br />')
      .split('\n')
      .map(line => line.trim().startsWith('<h') || line.trim().startsWith('<li') || line.trim().startsWith('<div') ? line : `<p class="mb-3 text-slate-600 dark:text-slate-300 leading-relaxed">${line}</p>`)
      .join('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-5xl h-[85vh] glass-panel rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Editor Toolbar */}
        <div className="h-16 px-6 border-b border-slate-200 dark:border-white/5 bg-slate-100/50 dark:bg-slate-900/50 flex items-center justify-between relative">
          <div className="flex items-center space-x-3">
            <span className="px-2.5 py-0.5 rounded bg-brand-500/10 text-brand-600 dark:text-brand-400 text-xs font-bold uppercase tracking-wider">
              {item.platform}
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="bg-transparent text-slate-900 dark:text-white font-bold text-lg focus:outline-none border-b border-transparent focus:border-brand-500/30 px-1 py-0.5 w-[180px] sm:w-[260px] md:w-[320px]"
              placeholder="Draft Title"
            />
          </div>          {saveMessage && (
            <div className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 px-5 py-2 rounded-xl text-xs font-extrabold tracking-wide animate-fade-in z-10 shadow-2xl border ${
              saveMessage.includes('Failed')
                ? 'bg-rose-600 text-white border-rose-500/30 shadow-rose-600/20'
                : 'bg-emerald-600 text-white border-emerald-500/30 shadow-emerald-600/20'
            }`}>
              {saveMessage}
            </div>
          )}

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all flex items-center space-x-1.5 text-xs font-semibold"
              title="Copy markdown to clipboard"
            >
              {copied ? <Check size={14} className="text-emerald-500 dark:text-emerald-400" /> : <Copy size={14} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving}
              className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 border border-slate-200 dark:border-white/5 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white transition-all flex items-center space-x-1.5 text-xs font-semibold"
            >
              <Save size={14} />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>

            {item.platform === 'blog' && item.status !== 'marked_published' && onRegenerate && (
              <button
                onClick={handleRegenerate}
                className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-indigo-650 hover:bg-indigo-600 text-white transition-all flex items-center space-x-1.5 text-xs font-bold shadow-md shadow-indigo-650/15"
                title="Regenerate Content"
              >
                <RefreshCw size={14} />
                <span>Regenerate</span>
              </button>
            )}

            {item.status !== 'marked_published' ? (
              <button
                onClick={() => handleStatusTransition('marked_published')}
                disabled={publishing}
                className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-all flex items-center space-x-1.5 text-xs font-bold shadow-md shadow-emerald-600/10"
              >
                <Globe size={14} />
                <span>{publishing ? 'Publishing...' : 'Mark Published'}</span>
              </button>
            ) : (
              <button
                onClick={() => handleStatusTransition('draft')}
                disabled={publishing}
                className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-all flex items-center space-x-1.5 text-xs font-bold shadow-md shadow-amber-600/10"
              >
                <EyeOff size={14} />
                <span>{publishing ? 'Updating...' : 'Mark Unpublished'}</span>
              </button>
            )}

            {onDelete && (
              <button
                onClick={handleDelete}
                className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-all flex items-center space-x-1.5 text-xs font-bold shadow-md shadow-rose-600/10"
                title="Delete content"
              >
                <Trash2 size={14} />
                <span>Delete</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 h-fit self-center whitespace-nowrap rounded-lg bg-slate-100 hover:bg-rose-500/20 hover:text-rose-600 dark:bg-white/5 dark:hover:bg-rose-500/20 dark:hover:text-rose-400 border border-slate-200 dark:border-white/5 text-slate-500 dark:text-slate-400 transition-all"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex divide-x divide-slate-200 dark:divide-white/5 overflow-hidden">
          {/* Edit Panel */}
          <div className="w-1/2 h-full flex flex-col">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="flex-1 w-full h-full p-6 bg-slate-50/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 font-mono text-sm leading-relaxed resize-none focus:outline-none focus:bg-slate-100/50 dark:focus:bg-slate-950/40 transition-colors"
              placeholder="Write your draft in markdown..."
            />
          </div>

          {/* Preview Panel */}
          <div className="w-1/2 h-full p-6 overflow-y-auto bg-slate-50/75 dark:bg-slate-950/40 prose dark:prose-invert max-w-none">
            <div 
              dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} 
              className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
