import React from 'react';
import { Sparkles, Satellite, Database } from 'lucide-react';

export const Overview: React.FC = () => {
  return (
    <div className="mx-auto w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white/60 shadow-xl backdrop-blur px-6 py-8 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          <Sparkles className="h-3.5 w-3.5" />
          MCP Gemini Assistant
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Ask about extremism events and campaign finance in one place
        </h2>
        <p>
          The assistant uses Google Gemini for reasoning and the hosted Woke Palantir MCP server for data access.
          It can call Supabase-backed tools over HTTP, returning live information from the investigative datasets.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mb-2 flex items-center gap-2 text-slate-900 dark:text-white">
            <Satellite className="h-4 w-4" />
            Woke Palantir Tools
          </div>
          <ul className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <li>• Inspect rallies, protests, and actors tracked in the field database.</li>
            <li>• Search verified social posts and clustering trends by keywords.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mb-2 flex items-center gap-2 text-slate-900 dark:text-white">
            <Database className="h-4 w-4" />
            Campaign Finance
          </div>
          <ul className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <li>• Map donors, committees, and spending activity for Arizona campaigns.</li>
            <li>• Cross-reference bills, votes, and stakeholder testimony in one conversation.</li>
          </ul>
        </div>
      </div>

      <div className="mt-6 text-xs text-slate-400 dark:text-slate-500">
        Tip: ask things like “Summarize the latest TPUSA events in Arizona and the top donors for allied committees.”
      </div>
    </div>
  );
};
