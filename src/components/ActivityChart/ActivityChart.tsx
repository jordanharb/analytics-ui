import React from 'react';
import type { TimeseriesResponse } from '../../api/types';

interface ActivityChartProps {
  data: TimeseriesResponse;
  height?: number;
}

export const ActivityChart: React.FC<ActivityChartProps> = ({ data, height = 200 }) => {
  if (!data || !data.data_points || data.data_points.length === 0) {
    return (
      <div className="flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-50 rounded-lg border border-gray-100" style={{ height }}>
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm font-medium text-gray-400">No activity data available</p>
        </div>
      </div>
    );
  }

  const maxCount = Math.max(...data.data_points.map(d => d.count), 1);
  
  // If all values are 0, show a message
  if (maxCount === 0 || data.total_events === 0) {
    return (
      <div className="flex items-center justify-center bg-gradient-to-br from-slate-50 to-gray-50 rounded-lg border border-gray-100" style={{ height }}>
        <div className="text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm font-medium text-gray-400">No events in this time period</p>
        </div>
      </div>
    );
  }

  // Calculate chart dimensions
  const chartHeight = height - 45; // Leave space for labels
  
  // Create SVG path for smooth bezier curve
  const points = data.data_points.map((point, idx) => {
    const x = (idx / (data.data_points.length - 1)) * 100;
    const y = 100 - ((point.count / maxCount) * 100);
    return { x, y, count: point.count, label: point.label, date: point.date };
  });
  
  // Create smooth bezier curve path
  const createSmoothPath = (pathPoints: Array<{ x: number; y: number; count: number; label: string; date: string }>) => {
    if (pathPoints.length < 2) return '';
    
    let path = `M ${pathPoints[0].x} ${pathPoints[0].y}`;
    
    for (let i = 1; i < pathPoints.length; i++) {
      const prev = pathPoints[i - 1];
      const curr = pathPoints[i];
      const cpx = (prev.x + curr.x) / 2;
      path += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    
    return path;
  };
  
  const pathData = createSmoothPath(points);

  // Format Y-axis labels to be cleaner
  const formatYLabel = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}k`;
    }
    return value.toString();
  };

  // Generate y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(ratio => ({
    value: Math.round(maxCount * ratio),
    y: 100 - (ratio * 100)
  }));

  return (
    <div className="relative bg-white rounded-lg p-4" style={{ height }}>
      {/* Chart header with subtle gradient */}
      <div className="absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-gray-50/50 to-transparent rounded-t-lg pointer-events-none"></div>
      
      {/* Y-axis labels */}
      <div className="absolute left-4 top-4 bottom-4 flex flex-col justify-between text-xs" style={{ width: '40px' }}>
        {yTicks.map((tick, idx) => (
          <span key={idx} className="text-right font-mono text-gray-500 text-[10px] tracking-tight">
            {formatYLabel(tick.value)}
          </span>
        ))}
      </div>

      {/* Chart area with subtle background */}
      <div className="ml-12 mr-2 relative" style={{ height: chartHeight }}>
        {/* Background gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-blue-50/20 to-transparent rounded"></div>
        
        {/* Main chart SVG for lines and areas */}
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {/* Define gradients */}
          <defs>
            <linearGradient id="areaGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgb(59, 130, 246)" stopOpacity="0.15" />
              <stop offset="100%" stopColor="rgb(59, 130, 246)" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgb(99, 102, 241)" />
              <stop offset="50%" stopColor="rgb(59, 130, 246)" />
              <stop offset="100%" stopColor="rgb(37, 99, 235)" />
            </linearGradient>
            <filter id="glow">
              <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>
          
          {/* Grid lines - more subtle */}
          <g className="text-gray-100">
            {yTicks.slice(1, -1).map(tick => (
              <line
                key={tick.y}
                x1="0"
                y1={tick.y}
                x2="100"
                y2={tick.y}
                stroke="currentColor"
                strokeWidth="0.3"
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
                opacity="0.5"
              />
            ))}
          </g>
          
          {/* Vertical grid lines for time */}
          <g className="text-gray-100">
            {points.filter((_, idx) => idx % Math.ceil(points.length / 6) === 0 && idx !== 0).map((point) => (
              <line
                key={point.x}
                x1={point.x}
                y1="0"
                x2={point.x}
                y2="100"
                stroke="currentColor"
                strokeWidth="0.3"
                strokeDasharray="2 4"
                vectorEffect="non-scaling-stroke"
                opacity="0.3"
              />
            ))}
          </g>
          
          {/* Area under the line with gradient */}
          <path
            d={`${pathData} L 100 100 L 0 100 Z`}
            fill="url(#areaGradient)"
          />
          
          {/* Main line chart with gradient stroke */}
          <path
            d={pathData}
            fill="none"
            stroke="url(#lineGradient)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#glow)"
            opacity="0.9"
          />
        </svg>
        
        {/* Data points as absolute positioned divs to avoid stretching */}
        {points.map((point, idx) => {
          const xPercent = point.x;
          const yPercent = point.y;
          
          return (
            <div
              key={idx}
              className="absolute group cursor-pointer"
              style={{
                left: `${xPercent}%`,
                top: `${yPercent}%`,
                transform: 'translate(-50%, -50%)'
              }}
            >
              {/* Hover glow */}
              <div className="absolute inset-0 w-3 h-3 -translate-x-1/2 -translate-y-1/2 bg-blue-500/10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"></div>
              
              {/* Actual dot */}
              <div className="w-1 h-1 bg-white border border-blue-500 rounded-full"></div>
              
              {/* Invisible hit area */}
              <div 
                className="absolute -inset-2"
                title={`${point.label}: ${point.count.toLocaleString()} events`}
              ></div>
            </div>
          );
        })}
        
        {/* Interactive hover areas with enhanced tooltips */}
        <div className="absolute inset-0 flex">
          {points.map((point, idx) => (
            <div
              key={idx}
              className="relative flex-1 group"
            >
              {/* Enhanced tooltip */}
              <div 
                className="absolute opacity-0 group-hover:opacity-100 pointer-events-none transition-all duration-200 z-20 group-hover:scale-105"
                style={{
                  bottom: `${((point.count / maxCount) * 100)}%`,
                  left: '50%',
                  transform: 'translate(-50%, -12px)'
                }}
              >
                <div className="bg-gray-900/95 backdrop-blur-sm text-white text-xs rounded-lg py-2 px-3 whitespace-nowrap shadow-xl">
                  <div className="font-semibold text-blue-200 mb-1">{point.label}</div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-blue-400 rounded-full"></span>
                    <span className="font-mono">{point.count.toLocaleString()}</span>
                    <span className="text-gray-400">events</span>
                  </div>
                </div>
                <div className="w-3 h-3 bg-gray-900/95 rotate-45 absolute -bottom-1.5 left-1/2 -translate-x-1/2"></div>
              </div>
              
              {/* Vertical hover line */}
              <div className="absolute top-0 bottom-0 w-px bg-blue-400/30 opacity-0 group-hover:opacity-100 transition-opacity duration-200" 
                   style={{ left: '50%' }}></div>
            </div>
          ))}
        </div>

        {/* X-axis labels with improved spacing */}
        <div className="absolute top-full mt-3 left-0 right-0 flex justify-between text-[10px] font-medium text-gray-600">
          {data.data_points.filter((_, idx) => {
            const totalPoints = data.data_points.length;
            if (idx === 0 || idx === totalPoints - 1) return true;
            
            if (totalPoints <= 7) return true;
            if (totalPoints <= 14) return idx % 2 === 0;
            if (totalPoints <= 30) return idx % 5 === 0;
            if (totalPoints <= 60) return idx % 10 === 0;
            if (totalPoints <= 180) return idx % 30 === 0;
            return idx % 60 === 0;
          }).map((point, idx, arr) => (
            <span 
              key={point.date} 
              className={`${idx === 0 ? 'text-left' : idx === arr.length - 1 ? 'text-right' : 'text-center'} tracking-tight`}
            >
              {point.label}
            </span>
          ))}
        </div>
        
        {/* Subtle bottom border */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent"></div>
        
        {/* Left axis line */}
        <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-gray-200 via-gray-300 to-gray-200"></div>
      </div>
    </div>
  );
};