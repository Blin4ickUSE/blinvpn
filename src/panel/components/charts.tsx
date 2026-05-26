import React, { useState, useEffect, useRef } from 'react';
import {
  Home, DollarSign, BarChart2, Users, Key, Mail, Tag, Percent,
  MessageSquare, Server, FileText, Globe, Settings, Menu, X, CheckCircle,
  AlertCircle, TrendingUp, CreditCard, Search, Filter, ArrowUpRight,
  ArrowDownLeft, Activity, Calendar, Download, Loader, RefreshCcw,
  Hash, Monitor, PieChart, Ban, UserX, UserCheck, Trophy, UserPlus, UserMinus,
  Clock, XCircle, Edit2, Copy, Shield, Smartphone, Zap, Wifi, Database,
  Bell, CheckSquare, Square, ChevronRight, Wallet, Bitcoin, Plus,
  Terminal, Lock, Briefcase, Star, TrendingDown, Send, Image as ImageIcon, MousePointer,
  Gift, Layers, Flame, ShoppingBag, Paperclip, MoreVertical, MessageCircle, User as UserIcon,
  Moon, Dices, ToggleLeft, ToggleRight, FileCheck, FileText as FileTextIcon,
  Trash2, ChevronDown, Save, AlertTriangle, Cloud, Link, RefreshCw
} from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'indigo' | 'orange' | 'purple' | 'red' | 'gray';
  subValue?: string;
  className?: string;
}

export function StatCard({ title, value, change, icon: Icon, color, subValue, className }: StatCardProps) {
  const isPositive = change && (change.startsWith('+') || !change.startsWith('-'));
  const colors = { 
    blue: "bg-orange-500 text-orange-500", 
    green: "bg-green-500 text-green-500", 
    indigo: "bg-indigo-500 text-indigo-500", 
    orange: "bg-orange-500 text-orange-500", 
    purple: "bg-purple-500 text-purple-500", 
    red: "bg-red-500 text-red-500", 
    gray: "bg-gray-500 text-gray-500" 
  };
  const bgClass = colors[color]?.split(' ')[0] + '/10';
  const textClass = colors[color]?.split(' ')[1];

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-2xl p-5 hover:border-gray-700 transition-all duration-300 group h-full ${className}`}>
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-gray-400 text-sm font-medium">{title}</p>
          <div className="flex items-baseline mt-1">
             <h3 className="text-2xl font-bold text-white group-hover:translate-x-1 transition-transform">{value}</h3>
             {subValue && <span className="ml-2 text-sm text-gray-500">{subValue}</span>}
          </div>
        </div>
        <div className={`p-3 rounded-xl ${bgClass}`}>
          <Icon size={22} className={textClass} />
        </div>
      </div>
      {change && (
        <div className="flex items-center text-xs">
          <span className={`font-medium px-2 py-0.5 rounded ${isPositive ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {change}
          </span>
          <span className="text-gray-500 ml-2">за период</span>
        </div>
      )}
    </div>
  );
}

interface SmoothAreaChartProps {
    color: string;
    data: number[];
    label: string;
    height?: number;
    id?: string;
    labels?: string[]; // Даты для отображения в tooltip
}

export const SmoothAreaChart: React.FC<SmoothAreaChartProps> = ({ color, data, label, height = 200, id, labels = [] }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const uniqueId = id || Math.random().toString(36).substr(2, 9);
  
  if (!data || data.length === 0) return <div className="h-48 flex items-center justify-center text-gray-500">Нет данных</div>;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const svgWidth = 1000; 
  const svgHeight = 400;

  const getPathData = (data: number[], width: number, height: number, max: number, min: number) => {
    const points = data.map((val, index) => {
      const x = (index / (data.length - 1)) * width;
      const normalizedY = ((val - min) / (max - min || 1));
      const y = height - (normalizedY * (height * 0.7) + (height * 0.15));
      return [x, y];
    });

    const line = (pointA: number[], pointB: number[]) => {
      const lengthX = pointB[0] - pointA[0];
      const lengthY = pointB[1] - pointA[1];
      return { length: Math.sqrt(Math.pow(lengthX, 2) + Math.pow(lengthY, 2)), angle: Math.atan2(lengthY, lengthX) };
    };

    const controlPoint = (current: number[], previous: number[], next: number[], reverse?: boolean) => {
      const p = previous || current; const n = next || current; const smoothing = 0.2;
      const o = line(p, n); const angle = o.angle + (reverse ? Math.PI : 0); const length = o.length * smoothing;
      const x = current[0] + Math.cos(angle) * length; const y = current[1] + Math.sin(angle) * length;
      return [x, y];
    };

    const bezierCommand = (point: number[], i: number, a: number[][]) => {
      const [cpsX, cpsY] = controlPoint(a[i - 1], a[i - 2], point);
      const [cpeX, cpeY] = controlPoint(point, a[i - 1], a[i + 1], true);
      return `C ${cpsX},${cpsY} ${cpeX},${cpeY} ${point[0]},${point[1]}`;
    };

    return points.reduce((acc, point, i, a) => {
      if (i === 0) return `M ${point[0]},${point[1]}`;
      return `${acc} ${bezierCommand(point, i, a)}`;
    }, "");
  };
  
  const pathD = getPathData(data, svgWidth, svgHeight, max, min);
  const fillPathD = `${pathD} L ${svgWidth},${svgHeight} L 0,${svgHeight} Z`;
  const points = data.map((val, index) => ({ x: (index / (data.length - 1)) * 100, val }));

  return (
    <div className={`w-full relative group select-none`} style={{ height: `${height}px` }} onMouseLeave={() => setActiveIndex(null)}>
      {activeIndex !== null && (
        <div 
          className="absolute -top-10 transform -translate-x-1/2 bg-gray-800 text-white text-xs py-1.5 px-3 rounded-lg shadow-xl border border-gray-700 whitespace-nowrap z-20 pointer-events-none transition-all duration-75"
          style={{ left: `${points[activeIndex].x}%` }}
        >
            {labels[activeIndex] && <span className="text-gray-400 mr-2">{labels[activeIndex]}</span>}
            <span className="font-bold">{points[activeIndex].val.toLocaleString('ru-RU')}</span>
            <span className="text-gray-400 ml-1">{label}</span>
        </div>
      )}

      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
        <defs>
          <linearGradient id={`grad-${uniqueId}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.4" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPathD} fill={`url(#grad-${uniqueId})`} />
        <path d={pathD} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      
      <div className="absolute inset-0 flex items-stretch">
         {data.map((_, i) => (
             <div 
                key={i}
                className="flex-1 hover:bg-white/5 transition-colors cursor-crosshair relative group/bar"
                onMouseEnter={() => setActiveIndex(i)}
             >
                 {activeIndex === i && (
                     <div className="absolute w-3 h-3 rounded-full border-2 border-white transform -translate-x-1/2 -translate-y-1/2 pointer-events-none shadow-lg"
                        style={{ 
                            backgroundColor: color, 
                            left: '50%', 
                            top: `${100 - (((data[i] - min) / (max - min || 1)) * 70 + 15)}%`
                        }}
                     />
                 )}
             </div>
         ))}
      </div>
    </div>
  );
};

type DynamicsPoint = {
  label: string;
  keysNew: number;
  subsNew: number;
};

export const CombinedLinesChart: React.FC<{
  labels: string[];
  keysNewData: number[];
  subsNewData: number[];
}> = ({ labels, keysNewData, subsNewData }) => {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const points: DynamicsPoint[] = labels.map((label, index) => ({
    label,
    keysNew: keysNewData[index] || 0,
    subsNew: subsNewData[index] || 0,
  }));
  if (!points.length) return <div className="h-56 flex items-center justify-center text-gray-500">Нет данных</div>;

  const allValues = points.flatMap((p) => [p.keysNew, p.subsNew]);
  const max = Math.max(...allValues);
  const min = Math.min(...allValues);
  const svgWidth = 1000;
  const svgHeight = 400;

  const getPathData = (series: number[]) => {
    const pathPoints = series.map((val, index) => {
      const x = (index / Math.max(1, series.length - 1)) * svgWidth;
      const normalizedY = ((val - min) / (max - min || 1));
      const y = svgHeight - (normalizedY * (svgHeight * 0.7) + (svgHeight * 0.15));
      return [x, y];
    });

    const line = (pointA: number[], pointB: number[]) => {
      const lengthX = pointB[0] - pointA[0];
      const lengthY = pointB[1] - pointA[1];
      return { length: Math.sqrt(Math.pow(lengthX, 2) + Math.pow(lengthY, 2)), angle: Math.atan2(lengthY, lengthX) };
    };

    const controlPoint = (current: number[], previous: number[], next: number[], reverse?: boolean) => {
      const p = previous || current;
      const n = next || current;
      const smoothing = 0.2;
      const o = line(p, n);
      const angle = o.angle + (reverse ? Math.PI : 0);
      const length = o.length * smoothing;
      const x = current[0] + Math.cos(angle) * length;
      const y = current[1] + Math.sin(angle) * length;
      return [x, y];
    };

    const bezierCommand = (point: number[], i: number, a: number[][]) => {
      const [cpsX, cpsY] = controlPoint(a[i - 1], a[i - 2], point);
      const [cpeX, cpeY] = controlPoint(point, a[i - 1], a[i + 1], true);
      return `C ${cpsX},${cpsY} ${cpeX},${cpeY} ${point[0]},${point[1]}`;
    };

    return pathPoints.reduce((acc, point, i, arr) => {
      if (i === 0) return `M ${point[0]},${point[1]}`;
      return `${acc} ${bezierCommand(point, i, arr)}`;
    }, "");
  };

  const keysPath = getPathData(points.map((p) => p.keysNew));
  const subsPath = getPathData(points.map((p) => p.subsNew));
  const keysFillPath = `${keysPath} L ${svgWidth},${svgHeight} L 0,${svgHeight} Z`;
  const subsFillPath = `${subsPath} L ${svgWidth},${svgHeight} L 0,${svgHeight} Z`;

  const active = activeIndex !== null ? points[activeIndex] : null;
  const tooltipLeftPercent =
    activeIndex === null
      ? 50
      : Math.max(24, Math.min(76, (activeIndex / Math.max(1, points.length - 1)) * 100));

  return (
    <div className="space-y-4">
      <div className="relative h-72 w-full" onMouseLeave={() => setActiveIndex(null)}>
        {active && (
          <div
            className="absolute top-2 z-20 bg-gray-900/95 border border-gray-700 rounded-xl p-3 text-xs text-gray-200 shadow-2xl pointer-events-none min-w-[240px]"
            style={{ left: `${tooltipLeftPercent}%`, transform: 'translateX(-50%)' }}
          >
            <div className="text-gray-400 mb-2">{active.label}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <span className="text-purple-400 whitespace-nowrap">Ключи новые:</span><span className="font-semibold text-white text-right whitespace-nowrap">+{active.keysNew.toLocaleString('ru-RU')}</span>
              <span className="text-orange-400 whitespace-nowrap">Подписки новые:</span><span className="font-semibold text-white text-right whitespace-nowrap">+{active.subsNew.toLocaleString('ru-RU')}</span>
            </div>
          </div>
        )}

        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
          <defs>
            <linearGradient id="keysAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="subsAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.36" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path d={keysFillPath} fill="url(#keysAreaGradient)" />
          <path d={subsFillPath} fill="url(#subsAreaGradient)" />

          <path
            d={keysPath}
            fill="none"
            stroke="#a855f7"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.2"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={subsPath}
            fill="none"
            stroke="#f97316"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.24"
            vectorEffect="non-scaling-stroke"
          />

          <path
            d={keysPath}
            fill="none"
            stroke="#a855f7"
            strokeWidth="2.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={subsPath}
            fill="none"
            stroke="#f97316"
            strokeWidth="2.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="absolute inset-0 flex">
          {points.map((_, i) => (
            <div key={i} className="flex-1 cursor-crosshair relative" onMouseEnter={() => setActiveIndex(i)}>
              {activeIndex === i && <div className="absolute inset-y-0 left-1/2 w-px bg-white/25" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-5 text-sm">
        <div className="flex items-center text-purple-300"><span className="w-4 h-0.5 bg-purple-400 mr-2" />Новые ключи</div>
        <div className="flex items-center text-orange-300"><span className="w-4 h-0.5 bg-orange-400 mr-2" />Новые подписки</div>
      </div>
    </div>
  );
};

interface PieChartItem {
    label: string;
    value: number;
}

interface PieChartProps {
    data: PieChartItem[];
    colors: string[];
}

export const PieChartComponent: React.FC<PieChartProps> = ({ data, colors }) => {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent: number) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  return (
    <div className="flex items-center justify-center gap-8">
      <div className="relative w-40 h-40">
        <svg viewBox="-1 -1 2 2" className="transform -rotate-90 w-full h-full">
          {data.map((item, index) => {
            const startPercent = cumulativePercent;
            const slicePercent = item.value / total;
            cumulativePercent += slicePercent;
            const [startX, startY] = getCoordinatesForPercent(startPercent);
            const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
            const largeArcFlag = slicePercent > 0.5 ? 1 : 0;
            const pathData = `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;
            
            return (
              <path key={index} d={pathData} fill={colors[index % colors.length]} className="hover:opacity-80 transition-opacity cursor-pointer" />
            );
          })}
        </svg>
      </div>
      <div className="space-y-2">
        {data.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[index % colors.length] }}></div>
            <span className="text-gray-300 text-sm font-medium">{item.label}</span>
            <span className="text-gray-500 text-xs">({Math.round((item.value / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==========================================
