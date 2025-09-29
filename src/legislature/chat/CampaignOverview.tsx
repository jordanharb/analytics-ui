import React from 'react';
import { Building2, Landmark, Scale } from 'lucide-react';

export const CampaignOverview: React.FC = () => {
  return (
    <div className="mx-auto w-full max-w-xl rounded-3xl border border-slate-200/80 bg-white/60 shadow-xl backdrop-blur px-6 py-8 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
          <Scale className="h-3.5 w-3.5" />
          Campaign Finance Assistant
        </div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Track spending, donors, and votes in one conversation
        </h2>
        <p>
          Powered by the same Gemini + MCP stack, this workspace connects Supabase-backed campaign finance tools with the
          Arizona legislative dataset. Ask questions across committees, donors, bills, and votes without leaving the chat.
        </p>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mb-2 flex items-center gap-2 text-slate-900 dark:text-white">
            <Building2 className="h-4 w-4" />
            Committees & Donors
          </div>
          <ul className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <li>• Search committees, candidates, and PAC networks by name.</li>
            <li>• Surface top donors, cash on hand, and large transactions.</li>
          </ul>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="mb-2 flex items-center gap-2 text-slate-900 dark:text-white">
            <Landmark className="h-4 w-4" />
            Legislature Links
          </div>
          <ul className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
            <li>• Map donor networks to legislators, sessions, and committee assignments.</li>
            <li>• Pull bill sponsorships, vote records, and stakeholder testimonies.</li>
          </ul>
        </div>
      </div>

      <div className="mt-6 text-xs text-slate-400 dark:text-slate-500">
        Tip: ask for “Top donors to [entity] this cycle, and how their aligned legislators voted on SB1234.”
      </div>
    </div>
  );
};

export default CampaignOverview;
