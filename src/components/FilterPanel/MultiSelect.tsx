import React, { useState, useRef, useEffect } from 'react';

interface MultiSelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  searchable?: boolean;
}

// fieldnotes palette
// surface #fdfaf2  page #f6f1e6  ink #1a1a1a  muted #6b6b6b
// accent #c2410c  accent text #9a330a  tag fill #fdf2ed  neutral #ede5d2

export const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = 'select…',
  searchable = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions =
    searchable && search
      ? options.filter((opt) => opt.label.toLowerCase().includes(search.toLowerCase()))
      : options;

  const toggleOption = (optionValue: string) => {
    if (value.includes(optionValue)) {
      onChange(value.filter((v) => v !== optionValue));
    } else {
      onChange([...value, optionValue]);
    }
  };

  const selectAll = () => onChange(options.map((opt) => opt.value));
  const clearAll = () => onChange([]);

  return (
    <div className="relative" ref={dropdownRef}>
      {label && (
        <label className="block text-[10px] uppercase tracking-[0.4px] text-[#6b6b6b] mb-1.5">
          {label}
          {value.length > 0 && (
            <span className="ml-1.5 text-[#c2410c] normal-case tracking-normal">
              ({value.length})
            </span>
          )}
        </label>
      )}

      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left flex items-center justify-between bg-[#fdfaf2] border border-black/[0.12] hover:border-[#c2410c]/40 transition-colors px-3 py-2 text-[12px]"
        style={{ borderRadius: 6, minHeight: 34 }}
      >
        <span
          className="truncate"
          style={{ color: value.length === 0 ? '#9a9a9a' : '#1a1a1a' }}
        >
          {value.length === 0
            ? placeholder
            : value.length === 1
            ? options.find((opt) => opt.value === value[0])?.label
            : `${value.length} selected`}
        </span>
        <svg
          className={`w-4 h-4 text-[#9a9a9a] transition-transform flex-shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div
          className="absolute z-50 w-full mt-1 bg-[#fdfaf2] border border-black/[0.15] overflow-hidden flex flex-col"
          style={{
            borderRadius: 6,
            maxHeight: 280,
            boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
          }}
        >
          {searchable && (
            <div className="p-2 border-b border-black/[0.08]">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="search…"
                className="w-full bg-[#f6f1e6] border border-black/[0.1] px-2.5 py-1.5 text-[12px] text-[#1a1a1a] placeholder:text-[#9a9a9a] focus:border-[#c2410c]/40 focus:outline-none"
                style={{ borderRadius: 4 }}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          <div
            className="px-3 py-1.5 border-b border-black/[0.08] flex bg-[#f6f1e6]"
            style={{ gap: 12 }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                selectAll();
              }}
              className="text-[10px] font-medium text-[#c2410c] hover:text-[#9a330a] transition-colors"
            >
              select all
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearAll();
              }}
              className="text-[10px] font-medium text-[#6b6b6b] hover:text-[#1a1a1a] transition-colors"
            >
              clear
            </button>
          </div>

          <div className="overflow-y-auto scrollbar-thin flex-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-[#9a9a9a] text-center">
                no options
              </div>
            ) : (
              filteredOptions.map((option) => {
                const checked = value.includes(option.value);
                return (
                  <label
                    key={option.value}
                    className="flex items-center px-3 py-2 text-[12px] cursor-pointer transition-colors"
                    style={{
                      background: checked ? '#fdf2ed' : 'transparent',
                      color: checked ? '#9a330a' : '#1a1a1a',
                    }}
                    onMouseEnter={(e) => {
                      if (!checked) (e.currentTarget as HTMLElement).style.background = '#f6f1e6';
                    }}
                    onMouseLeave={(e) => {
                      if (!checked) (e.currentTarget as HTMLElement).style.background = 'transparent';
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleOption(option.value)}
                      className="mr-2.5"
                      style={{ accentColor: '#c2410c' }}
                    />
                    <span className="font-normal truncate">{option.label}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};
