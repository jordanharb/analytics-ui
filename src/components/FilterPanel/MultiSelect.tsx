import React, { useState, useRef, useEffect } from 'react';

interface MultiSelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
}

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchable = false
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = searchable && search
    ? options.filter(opt => 
        opt.label.toLowerCase().includes(search.toLowerCase())
      )
    : options;

  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter(v => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const selectAll = () => {
    onChange(options.map(opt => opt.value));
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <label className="filter-title block mb-2">
        {label}
        {value.length > 0 && (
          <span className="filter-count ml-2">({value.length})</span>
        )}
      </label>
      
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="input w-full text-left flex items-center justify-between"
      >
        <span className={value.length === 0 ? 'text-gray-400' : 'text-gray-900'}>
          {value.length === 0
            ? placeholder
            : value.length === 1
            ? options.find(opt => opt.value === value[0])?.label
            : `${value.length} selected`}
        </span>
        <svg
          className={`float-right w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden flex flex-col">
          {searchable && (
            <div className="p-2 border-b border-gray-100">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="input input-sm w-full"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          
          <div className="px-3 py-2 border-b border-gray-100 flex bg-snow-150" style={{ gap: "0.75rem" }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectAll();
              }}
              className="text-xs font-medium text-azure-primary hover:text-azure-dark transition-colors"
            >
              Select All
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
              className="text-xs font-medium text-azure-primary hover:text-azure-dark transition-colors"
            >
              Clear All
            </button>
          </div>
          
          <div className="overflow-y-auto scrollbar-thin flex-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-gray-400 text-center">No options found</div>
            ) : (
              filteredOptions.map(option => (
                <label
                  key={option.value}
                  className={`flex items-center px-3 py-2.5 text-sm cursor-pointer transition-all hover:bg-azure-lightest ${value.includes(option.value) ? 'bg-azure-lightest text-azure-primary' : 'hover:bg-snow-150'}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={value.includes(option.value)}
                    onChange={() => toggleOption(option.value)}
                    className="mr-3 rounded border-gray-300 text-azure-primary focus:ring-azure-primary focus:ring-2"
                  />
                  <span className="font-medium">{option.label}</span>
                </label>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};