import React from 'react';
import { Calendar, CheckCircle2, FileEdit, FileText, Globe, Link2, MessageSquare, Twitter } from 'lucide-react';

export default function ContentCard({ item, onView }) {
  const getPlatformIcon = () => {
    switch (item.platform) {
      case 'blog': return <Globe size={18} className="text-blue-400" />;
      case 'linkedin': return <MessageSquare size={18} className="text-indigo-400" />;
      case 'twitter': return <Twitter size={18} className="text-sky-400" />;
      default: return <FileText size={18} />;
    }
  };

  const getStatusBadge = () => {
    if (item.status === 'marked_published') {
      return (
        <span className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 size={12} />
          <span>Published</span>
        </span>
      );
    }
    return (
      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
        Draft
      </span>
    );
  };

  return (
    <div className="glass-panel glass-panel-hover rounded-xl p-5 flex flex-col justify-between h-full transition-all duration-300">
      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5">
              {getPlatformIcon()}
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-widest font-semibold">
              {item.platform}
            </span>
          </div>
          {getStatusBadge()}
        </div>

        {/* Title */}
        <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-2 leading-snug line-clamp-2">
          {item.title || `${item.platform.toUpperCase()} Draft`}
        </h4>

        {/* Content Snippet */}
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-4 line-clamp-3 leading-relaxed">
          {item.body.replace(/!\[.*\]\(.*\)/g, '') /* strip images for preview */}
        </p>
      </div>

      {/* Footer Details & Actions */}
      <div className="border-t border-slate-200 dark:border-white/5 pt-4 mt-2 flex items-center justify-between">
        <div className="flex items-center space-x-1.5 text-xs text-slate-500 dark:text-slate-400">
          <Calendar size={13} />
          <span>{new Date(item.created_at).toLocaleDateString()}</span>
        </div>

        <button
          onClick={() => onView(item)}
          className="flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white shadow-md shadow-brand-600/10 hover:shadow-brand-500/25 transition-all"
        >
          <FileEdit size={13} />
          <span>Open Editor</span>
        </button>
      </div>
    </div>
  );
}
