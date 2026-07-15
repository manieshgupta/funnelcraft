import React, { useState, useEffect } from 'react';

/**
 * Premium glassmorphic loading indicator showing detailed processing steps.
 * 
 * @param {Object} props
 * @param {string} props.title - Main title of loading screen
 * @param {string} props.subtitle - Smaller description text
 * @param {Array<string>} props.steps - Array of steps to show progress
 */
export default function Loader({ title = "Analyzing Context", subtitle = "Our planning agents are running in the background...", steps = [] }) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  // Cycle through mock/actual worker steps to simulate active analysis progress
  useEffect(() => {
    if (steps.length === 0) return;
    
    // Auto-advance step progress indicators to show state transition
    const interval = setInterval(() => {
      setCurrentStepIndex((prev) => {
        if (prev < steps.length - 1) return prev + 1;
        return prev;
      });
    }, 4500);

    return () => clearInterval(interval);
  }, [steps]);

  return (
    <div className="flex flex-col items-center justify-center p-8 max-w-md mx-auto text-center glass-panel rounded-2xl shadow-2xl relative overflow-hidden my-8">
      {/* Background glow effect */}
      <div className="absolute -top-10 w-44 h-44 bg-brand-500/10 rounded-full blur-3xl -z-10" />

      {/* Loading Spin Rings */}
      <div className="relative flex items-center justify-center w-24 h-24 mb-6">
        <div className="absolute w-full h-full border-4 border-brand-900/20 rounded-full" />
        <div className="absolute w-full h-full border-4 border-t-brand-500 border-r-brand-400 border-b-transparent border-l-transparent rounded-full animate-spin" />
        <div className="absolute w-[80%] h-[80%] border border-violet-500/20 rounded-full" />
      </div>

      <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-1.5 tracking-tight font-sans">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6 px-4">{subtitle}</p>

      {/* Steps List */}
      {steps.length > 0 && (
        <div className="w-full text-left space-y-3.5 border-t border-slate-200 dark:border-white/5 pt-5">
          {steps.map((step, index) => {
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;
            return (
              <div key={index} className="flex items-center space-x-3.5 transition-all duration-300">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-semibold border ${
                  isCompleted 
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' 
                    : isCurrent 
                      ? 'bg-brand-500/20 text-brand-600 dark:text-brand-400 border-brand-500/30 animate-pulse'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600 border-slate-200 dark:border-white/5'
                }`}>
                  {isCompleted ? '✓' : index + 1}
                </div>
                <span className={`text-sm tracking-wide ${
                  isCompleted 
                    ? 'text-slate-400 dark:text-slate-500 line-through' 
                    : isCurrent 
                      ? 'text-brand-600 dark:text-brand-300 font-medium'
                      : 'text-slate-500 dark:text-slate-600'
                }`}>
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
