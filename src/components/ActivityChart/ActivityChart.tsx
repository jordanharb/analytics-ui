import React from 'react';
import type { TimeseriesResponse } from '../../api/types';

interface ActivityChartProps {
  data: TimeseriesResponse;
  height?: number;
}

export const ActivityChart: React.FC<ActivityChartProps> = ({ data, height = 200 }) => {
  const emptyState = (msg: string) => (
    <div
      className="flex items-center justify-center rounded-lg border border-black/[0.08] bg-[#f6f1e6]"
      style={{ height }}
    >
      <div className="text-center">
        <svg className="w-10 h-10 mx-auto mb-2 text-[#ede5d2]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <p className="text-[11px] text-[#9a9a9a]">{msg}</p>
      </div>
    </div>
  );

  if (!data || !data.data_points || data.data_points.length === 0) {
    return emptyState('no activity data available');
  }

  const maxCount = Math.max(...data.data_points.map(d => d.count), 1);

  if (maxCount === 0 || data.total_events === 0) {
    return emptyState('no events in this time period');
  }

  const chartHeight = height - 45;

  const points = data.data_points.map((point, idx) => {
    const x = (idx / (data.data_points.length - 1)) * 100;
    const y = 100 - ((point.count / maxCount) * 100);
    return { x, y, count: point.count, label: point.label, date: point.date };
  });

  const createSmoothPath = (pts: typeof points) => {
    if (pts.length < 2) return '';
    let path = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const cpx = (prev.x + curr.x) / 2;
      path += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    return path;
  };

  const pathData = createSmoothPath(points);

  const today = new Date();
  const startDate = new Date(data.data_points[0].date);
  const endDate = new Date(data.data_points[data.data_points.length - 1].date);

  const todayMarker = (() => {
    if (today >= startDate && today <= endDate) {
      const totalRange = endDate.getTime() - startDate.getTime();
      const todayOffset = today.getTime() - startDate.getTime();
      return { show: true, x: (todayOffset / totalRange) * 100 };
    }
    return { show: false, x: 0 };
  })();

  const formatYLabel = (value: number) => {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return value.toString();
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    value: Math.round(maxCount * ratio),
    y: 100 - ratio * 100,
  }));

  return (
    <div className="relative bg-transparent" style={{ height }}>
      {/* Y-axis labels */}
      <div className="absolute left-0 top-0 bottom-8 flex flex-col justify-between" style={{ width: '36px' }}>
        {yTicks.map((tick, idx) => (
          <span key={idx} className="text-right font-mono text-[#6b6b6b] text-[9px] tracking-tight pr-1">
            {formatYLabel(tick.value)}
          </span>
        ))}
      </div>

      {/* Chart area */}
      <div className="ml-10 mr-1 relative" style={{ height: chartHeight }}>
        {/* Subtle area bg */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#fdf2ed]/20 to-transparent rounded pointer-events-none" />

        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="fnAreaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#c2410c" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#c2410c" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="fnLineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#c2410c" />
              <stop offset="100%" stopColor="#9a330a" />
            </linearGradient>
            <filter id="fnGlow">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizontal grid lines */}
          {yTicks.slice(1, -1).map(tick => (
            <line
              key={tick.y}
              x1="0" y1={tick.y} x2="100" y2={tick.y}
              stroke="#ede5d2"
              strokeWidth="0.4"
              strokeDasharray="2 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Vertical grid lines */}
          {points
            .filter((_, idx) => idx % Math.ceil(points.length / 6) === 0 && idx !== 0)
            .map(point => (
              <line
                key={point.x}
                x1={point.x} y1="0" x2={point.x} y2="100"
                stroke="#ede5d2"
                strokeWidth="0.3"
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}

          {/* Today marker */}
          {todayMarker.show && (
            <g>
              <line
                x1={todayMarker.x} y1="0" x2={todayMarker.x} y2="100"
                stroke="#c2410c"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
                opacity="0.5"
                strokeDasharray="3 3"
              />
              <circle cx={todayMarker.x} cy="100" r="2.5" fill="#c2410c" opacity="0.7" />
            </g>
          )}

          {/* Area fill */}
          <path d={`${pathData} L 100 100 L 0 100 Z`} fill="url(#fnAreaGradient)" />

          {/* Line */}
          <path
            d={pathData}
            fill="none"
            stroke="url(#fnLineGradient)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#fnGlow)"
            opacity="0.9"
          />
        </svg>

        {/* Data point dots + tooltips */}
        {points.map((point, idx) => (
          <div
            key={idx}
            className="absolute group cursor-pointer"
            style={{ left: `${point.x}%`, top: `${point.y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className="absolute w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-[#c2410c]/10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="w-1.5 h-1.5 bg-[#fdfaf2] border border-[#c2410c] rounded-full" />

            {/* Tooltip */}
            <div
              className="absolute opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-150 z-20"
              style={{
                bottom: `calc(${100 - point.y}% + 8px)`,
                left: '50%',
                transform: 'translateX(-50%)',
              }}
            >
              <div className="bg-[#1a1a1a]/90 backdrop-blur-sm text-[#fdfaf2] text-[11px] rounded-md py-1.5 px-2.5 whitespace-nowrap shadow-lg">
                <div className="text-[#f9d4be] font-medium mb-0.5">{point.label}</div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 bg-[#c2410c] rounded-full" />
                  <span className="font-mono tabular-nums">{point.count.toLocaleString()}</span>
                  <span className="text-[#9a9a9a]">events</span>
                </div>
              </div>
              <div className="w-2 h-2 bg-[#1a1a1a]/90 rotate-45 absolute -bottom-1 left-1/2 -translate-x-1/2" />
            </div>
          </div>
        ))}

        {/* Hover columns (full-height hit areas) */}
        <div className="absolute inset-0 flex">
          {points.map((point, idx) => (
            <div key={idx} className="relative flex-1 group">
              <div
                className="absolute top-0 bottom-0 w-px bg-[#c2410c]/20 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: '50%' }}
              />
            </div>
          ))}
        </div>

        {/* X-axis labels */}
        <div className="absolute top-full mt-2 left-0 right-0 flex justify-between text-[9px] text-[#6b6b6b]">
          {data.data_points.filter((_, idx) => {
            const n = data.data_points.length;
            if (idx === 0 || idx === n - 1) return true;
            if (n <= 7) return true;
            if (n <= 14) return idx % 2 === 0;
            if (n <= 30) return idx % 5 === 0;
            if (n <= 60) return idx % 10 === 0;
            if (n <= 180) return idx % 30 === 0;
            return idx % 60 === 0;
          }).map((point, idx, arr) => (
            <span
              key={point.date}
              className={idx === 0 ? 'text-left' : idx === arr.length - 1 ? 'text-right' : 'text-center'}
            >
              {point.label}
            </span>
          ))}
        </div>

        {/* Today label */}
        {todayMarker.show && (
          <div
            className="absolute top-full mt-2 text-[9px] text-[#c2410c] bg-[#fdfaf2] px-1 rounded border border-[#c2410c]/30"
            style={{ left: `${todayMarker.x}%`, transform: 'translateX(-50%)' }}
          >
            today
          </div>
        )}

        {/* Axis lines */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-[#ede5d2]" />
        <div className="absolute left-0 top-0 bottom-0 w-px bg-[#ede5d2]" />
      </div>
    </div>
  );
};
