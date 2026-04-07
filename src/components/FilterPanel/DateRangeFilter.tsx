import React, { useState } from 'react';
import type { Filters } from '../../api/types';

type DateValue = Filters['period'] | Filters['date_range'];

interface DateRangeFilterProps {
  value?: DateValue;
  onChange: (value: DateValue) => void;
}

// fieldnotes palette: surface #fdfaf2  page #f6f1e6  ink #1a1a1a  muted #6b6b6b
// accent #c2410c   accent text #9a330a   neutral #ede5d2

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
  const [mode, setMode] = useState<'period' | 'custom'>(
    typeof value === 'string' ? 'period' : 'custom',
  );

  const currentPeriod = typeof value === 'string' ? value : 'month';
  const currentRange =
    typeof value === 'object' ? value : { start_date: '', end_date: '' };

  const handleModeChange = (newMode: 'period' | 'custom') => {
    setMode(newMode);
    if (newMode === 'period') {
      onChange('month');
    } else {
      const today = new Date();
      const lastMonth = new Date(today);
      lastMonth.setMonth(today.getMonth() - 1);

      onChange({
        start_date: lastMonth.toISOString().split('T')[0],
        end_date: today.toISOString().split('T')[0],
      });
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Mode toggle — segmented control */}
      <div
        className="flex bg-[#ede5d2] p-[3px]"
        style={{ borderRadius: 6 }}
        role="group"
      >
        <button
          type="button"
          onClick={() => handleModeChange('period')}
          className="flex-1 text-[11px] py-1.5 transition-colors"
          style={{
            background: mode === 'period' ? '#fdfaf2' : 'transparent',
            color: mode === 'period' ? '#1a1a1a' : '#6b6b6b',
            fontWeight: mode === 'period' ? 500 : 400,
            borderRadius: 4,
          }}
        >
          period
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('custom')}
          className="flex-1 text-[11px] py-1.5 transition-colors"
          style={{
            background: mode === 'custom' ? '#fdfaf2' : 'transparent',
            color: mode === 'custom' ? '#1a1a1a' : '#6b6b6b',
            fontWeight: mode === 'custom' ? 500 : 400,
            borderRadius: 4,
          }}
        >
          custom
        </button>
      </div>

      {/* Period selection */}
      {mode === 'period' && (
        <select
          value={currentPeriod}
          onChange={(e) => onChange(e.target.value as Filters['period'])}
          className="w-full bg-[#fdfaf2] border border-black/[0.12] hover:border-[#c2410c]/40 px-3 py-2 text-[12px] text-[#1a1a1a] focus:outline-none focus:border-[#c2410c]/40 focus:ring-2 focus:ring-[#c2410c]/15 transition-colors"
          style={{ borderRadius: 6 }}
        >
          <option value="week">last week</option>
          <option value="month">last month</option>
          <option value="year">last year</option>
          <option value="all">all time</option>
        </select>
      )}

      {/* Custom range */}
      {mode === 'custom' && (
        <div className="space-y-2">
          <div>
            <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-1">
              from
            </label>
            <input
              type="date"
              value={currentRange?.start_date || ''}
              onChange={(e) =>
                onChange({ ...currentRange, start_date: e.target.value })
              }
              className="w-full bg-[#fdfaf2] border border-black/[0.12] hover:border-[#c2410c]/40 px-3 py-2 text-[12px] text-[#1a1a1a] focus:outline-none focus:border-[#c2410c]/40 focus:ring-2 focus:ring-[#c2410c]/15 transition-colors"
              style={{ borderRadius: 6 }}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-1">
              to
            </label>
            <input
              type="date"
              value={currentRange?.end_date || ''}
              onChange={(e) =>
                onChange({ ...currentRange, end_date: e.target.value })
              }
              className="w-full bg-[#fdfaf2] border border-black/[0.12] hover:border-[#c2410c]/40 px-3 py-2 text-[12px] text-[#1a1a1a] focus:outline-none focus:border-[#c2410c]/40 focus:ring-2 focus:ring-[#c2410c]/15 transition-colors"
              style={{ borderRadius: 6 }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
