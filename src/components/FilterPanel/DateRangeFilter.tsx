import React, { useState } from 'react';
import type { Filters } from '../../api/types';

type DateValue = Filters['period'] | Filters['date_range'];

interface DateRangeFilterProps {
  value?: DateValue;
  onChange: (value: DateValue) => void;
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({ value, onChange }) => {
  const [mode, setMode] = useState<'period' | 'custom'>(
    typeof value === 'string' ? 'period' : 'custom'
  );

  const currentPeriod = typeof value === 'string' ? value : 'month';
  const currentRange = typeof value === 'object' ? value : { start_date: '', end_date: '' };

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
        end_date: today.toISOString().split('T')[0]
      });
    }
  };

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Date Range
      </label>
      
      {/* Mode Toggle */}
      <div className="flex rounded-md shadow-sm" role="group">
        <button
          type="button"
          onClick={() => handleModeChange('period')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-l-md border ${
            mode === 'period'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Period
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('custom')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-r-md border-t border-b border-r ${
            mode === 'custom'
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
          }`}
        >
          Custom Range
        </button>
      </div>

      {/* Period Selection */}
      {mode === 'period' && (
        <select
          value={currentPeriod}
          onChange={(e) => onChange(e.target.value as Filters['period'])}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="week">Last Week</option>
          <option value="month">Last Month</option>
          <option value="year">Last Year</option>
          <option value="all">All Time</option>
        </select>
      )}

      {/* Custom Date Range */}
      {mode === 'custom' && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Start Date</label>
            <input
              type="date"
              value={currentRange?.start_date || ''}
              onChange={(e) => onChange({
                ...currentRange,
                start_date: e.target.value
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">End Date</label>
            <input
              type="date"
              value={currentRange?.end_date || ''}
              onChange={(e) => onChange({
                ...currentRange,
                end_date: e.target.value
              })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      )}
    </div>
  );
};