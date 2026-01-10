import React, { useState, useEffect, useRef } from 'react';
import {
  Home, DollarSign, BarChart2, Users, Key, Mail, Tag, Percent, 
  MessageSquare, Server, FileText, Globe, Settings, Menu, X, CheckCircle, 
  AlertCircle, TrendingUp, CreditCard, Search, Filter, ArrowUpRight, 
  ArrowDownLeft, Activity, Calendar, Download, Loader, RefreshCcw, 
  Hash, Monitor, PieChart, Ban, UserX, UserCheck, Trophy, UserPlus,
  Clock, XCircle, Edit2, Copy, Shield, Smartphone, Zap, Wifi, Database,
  Bell, CheckSquare, Square, ChevronRight, Wallet, Bitcoin, Plus,
  Terminal, Lock, Briefcase, Star, TrendingDown, Send, Image as ImageIcon, MousePointer,
  Gift, Layers, Flame, ShoppingBag, Paperclip, MoreVertical, MessageCircle, User as UserIcon,
  Moon, Dices, ToggleLeft, ToggleRight, FileCheck, FileText as FileTextIcon,
  Trash2, ChevronDown, Save, AlertTriangle, Cloud, Link, RefreshCw
} from 'lucide-react';

// ==========================================
// 0. ENV & API HELPERS
// ==========================================

declare const importMeta: any | undefined;

// Унифицированный доступ к env для Vite/CRA/простого window.__ENV__
const rawEnv: any =
  (typeof importMeta !== 'undefined' && importMeta.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

const API_BASE_URL: string = rawEnv.VITE_API_URL || rawEnv.REACT_APP_API_URL || '/api';
const PANEL_SECRET: string = rawEnv.VITE_PANEL_SECRET || rawEnv.REACT_APP_PANEL_SECRET || '';
const BOT_USERNAME: string = rawEnv.VITE_BOT_USERNAME || rawEnv.REACT_APP_BOT_USERNAME || 'blnnnbot';

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${API_BASE_URL.replace(/\/$/, '')}${path}`;
  const headers: any = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  // Все panel-* эндпоинты требуют Bearer
  if (path.startsWith('/panel') || path.startsWith('/api/panel')) {
    if (PANEL_SECRET) {
      headers['Authorization'] = `Bearer ${PANEL_SECRET}`;
    }
  }

  const res = await fetch(url.startsWith('/api') ? url : `/api${path}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ==========================================
// 1. TYPES & INTERFACES
// ==========================================

type ToastType = 'success' | 'error' | 'info';
type TransactionType = 'income' | 'expense';
type UserStatus = 'Active' | 'Trial' | 'Banned' | 'Expired';
type KeyStatus = 'Active' | 'Expired' | 'Banned';
type TicketStatus = 'Open' | 'Closed' | 'Pending';

interface Toast {
  id: number;
  title: string;
  message?: string;
  type: ToastType;
}

interface Transaction {
  id: number;
  user: string;
  amount: number;
  type: TransactionType;
  status: string;
  method: string;
  date: string;
  hash: string;
}

interface AutoPayDetails {
  sbp: boolean;
  card: boolean;
  crypto: boolean;
}

interface User {
  id: number;
  telegramId: number;
  username: string;
  name: string;
  balance: number;
  status: UserStatus;
  traffic: number;
  maxTraffic: number;
  devices: number;
  maxDevices: number;
  regDate: string;
  paidUntil: string;
  autoPayDetails: AutoPayDetails;
  refLink: string;
  refCode: string;
  squads: string[];
  firstDeposit: boolean;
  wasPaid: boolean;
  isPartner: boolean;
  partnerBalance: number;
  partnerRate: number;
  referrals: number;
  totalEarned: number;
}

interface KeyItem {
  id: number;
  key: string;
  user: string;
  status: KeyStatus;
  expiry: number;
  trafficUsed: number;
  trafficLimit: number;
  devicesUsed: number;
  devicesLimit: number;
  server: string;
}

interface Promo {
  id: number;
  code: string;
  type: 'balance' | 'discount' | 'ref_boost' | 'subscription';
  value: string;
  uses: number;
  limit: number;
  expires: string;
}

interface Plan {
  id: number;
  name: string;
  price: number;
  oldPrice?: number;
  duration: number;
  isHit: boolean;
  description: string;
}

interface Ticket {
  id: number;
  user: string;
  status: TicketStatus;
  lastMsg: string;
  time: string;
  unread: number;
  avatar: string;
  balance: number;
  sub: string;
}

// ==========================================
// 2. TOAST SYSTEM
// ==========================================

interface ToastContainerProps {
  toasts: Toast[];
  removeToast: (id: number) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, removeToast }) => {
  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div 
          key={toast.id} 
          className={`
            pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border 
            transform transition-all duration-300 animate-in slide-in-from-right-full fade-in
            ${toast.type === 'success' ? 'bg-gray-900 border-green-500/30 text-green-400' : 'bg-gray-900 border-red-500/30 text-red-400'}
          `}
          role="alert"
        >
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <div>
            <h4 className="font-bold text-sm text-gray-100">{toast.title}</h4>
            {toast.message && <p className="text-xs text-gray-400 mt-0.5">{toast.message}</p>}
          </div>
          <button onClick={() => removeToast(toast.id)} className="ml-2 text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
};

// ==========================================
// 3. API HELPERS (Mock generators removed - all data comes from backend)
// ==========================================

// ==========================================
// 4. UI COMPONENTS
// ==========================================

interface StatCardProps {
  title: string;
  value: string | number;
  change?: string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'indigo' | 'orange' | 'purple' | 'red' | 'gray';
  subValue?: string;
  className?: string;
}

function StatCard({ title, value, change, icon: Icon, color, subValue, className }: StatCardProps) {
  const isPositive = change && (change.startsWith('+') || !change.startsWith('-'));
  const colors = { 
    blue: "bg-blue-500 text-blue-500", 
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
}

const SmoothAreaChart: React.FC<SmoothAreaChartProps> = ({ color, data, label, height = 200, id }) => {
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
            <span className="font-bold">{points[activeIndex].val}</span>
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

interface PieChartItem {
    label: string;
    value: number;
}

interface PieChartProps {
    data: PieChartItem[];
    colors: string[];
}

const PieChartComponent: React.FC<PieChartProps> = ({ data, colors }) => {
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
// 5. MODALS
// ==========================================

interface UserActionModalProps {
    type: string;
    onClose: () => void;
    onConfirm: (value: string, notify: boolean) => void;
    initialValue?: string;
}

const UserActionModal: React.FC<UserActionModalProps> = ({ type, onClose, onConfirm, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);
  const [notify, setNotify] = useState(true);

  type ActionConfig = {
      title: string;
      label: string;
      icon: React.ElementType;
      color: string;
      type: string;
  };

  const config: ActionConfig = ({
      'ADD_BALANCE': { title: 'Начислить баланс', label: 'Сумма (₽)', icon: ArrowUpRight, color: 'text-green-400', type: 'number' },
      'SUB_BALANCE': { title: 'Списать баланс', label: 'Сумма (₽)', icon: ArrowDownLeft, color: 'text-red-400', type: 'number' },
      'EXTEND_SUB': { title: 'Продлить подписку', label: 'Количество дней', icon: Clock, color: 'text-blue-400', type: 'number' },
      'REDUCE_SUB': { title: 'Уменьшить срок', label: 'Количество дней', icon: Clock, color: 'text-orange-400', type: 'number' },
      'SET_TRAFFIC': { title: 'Лимит трафика', label: 'Макс. трафик (GB)', icon: Database, color: 'text-purple-400', type: 'number' },
      'SET_DEVICES': { title: 'Лимит устройств', label: 'Кол-во устройств', icon: Smartphone, color: 'text-indigo-400', type: 'number' },
      'MASS_ADD_DAYS': { title: 'Всем добавить дни', label: 'Количество дней', icon: Calendar, color: 'text-blue-500', type: 'number' },
      'MASS_ADD_BALANCE': { title: 'Всем начислить', label: 'Сумма (₽)', icon: DollarSign, color: 'text-green-500', type: 'number' },
  } as Record<string, ActionConfig>)[type] || { title: 'Действие', label: 'Значение', icon: Settings, color: 'text-white', type: 'text' };

  return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-6"><div className={`p-2 bg-gray-800 rounded-lg ${config.color}`}><config.icon size={24} /></div><h3 className="text-xl font-bold text-white">{config.title}</h3></div>
              <div className="space-y-4">
                  <div>
                      <label className="text-xs text-gray-500 block mb-1.5">{config.label}</label>
                      <input 
                        type={config.type} 
                        value={value} 
                        onChange={e => setValue(e.target.value)} 
                        className="w-full bg-gray-950 border border-gray-700 text-white text-lg rounded-xl px-4 py-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono" 
                        placeholder="0" 
                        autoFocus 
                        min="0"
                      />
                  </div>
                  <label className="flex items-center cursor-pointer group bg-gray-950/50 p-3 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
                      <div className="relative"><input type="checkbox" checked={notify} onChange={() => setNotify(!notify)} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full shadow-inner transition-colors ${notify ? 'bg-blue-600' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${notify ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="text-sm text-gray-200 font-medium">Уведомить пользователя</div><div className="text-xs text-gray-500">Отправить сообщение в бот</div></div>
                  </label>
                  <div className="flex gap-3 pt-2">
                      <button onClick={onClose} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition-colors">Отмена</button>
                      <button onClick={() => onConfirm(value, notify)} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors">Применить</button>
                  </div>
              </div>
          </div>
      </div>
  );
};

interface KeyEditModalProps {
    keyItem: KeyItem;
    onClose: () => void;
    onSave: (id: number, expiry: number) => void;
    onDelete: (id: number) => void;
}

const KeyEditModal: React.FC<KeyEditModalProps> = ({ keyItem, onClose, onSave, onDelete }) => {
    const [expiryDays, setExpiryDays] = useState(keyItem.expiry);
    const [confirmDelete, setConfirmDelete] = useState(false);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center"><Key size={22} className="mr-2 text-blue-500"/> Редактирование ключа</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20}/></button>
                </div>

                {!confirmDelete ? (
                    <div className="space-y-6">
                        <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 font-mono text-xs text-gray-400 break-all select-all">
                            {keyItem.key}
                        </div>
                        
                        <div>
                            <label className="text-sm text-gray-400 block mb-2">Осталось дней</label>
                            <div className="flex gap-2">
                                <button onClick={() => setExpiryDays(Math.max(0, Number(expiryDays) - 1))} className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"><ArrowDownLeft size={18}/></button>
                                <input 
                                    type="number" 
                                    value={expiryDays} 
                                    onChange={(e) => setExpiryDays(parseInt(e.target.value) || 0)}
                                    className="flex-1 bg-gray-950 border border-gray-700 text-center text-white text-lg rounded-xl focus:border-blue-500 outline-none font-mono"
                                />
                                <button onClick={() => setExpiryDays(Number(expiryDays) + 1)} className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"><ArrowUpRight size={18}/></button>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button onClick={() => setConfirmDelete(true)} className="flex-1 py-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 border border-red-600/20 rounded-xl font-medium transition-colors flex items-center justify-center">
                                <Trash2 size={18} className="mr-2"/> Удалить
                            </button>
                            <button onClick={() => onSave(keyItem.id, expiryDays)} className="flex-[2] py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors flex items-center justify-center">
                                <Save size={18} className="mr-2"/> Сохранить
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="space-y-4 text-center py-4">
                        <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500 mb-2">
                            <AlertTriangle size={32} />
                        </div>
                        <h4 className="text-lg font-bold text-white">Удалить этот ключ?</h4>
                        <p className="text-gray-400 text-sm">Это действие необратимо. Пользователь потеряет доступ.</p>
                        <div className="flex gap-3 pt-4">
                             <button onClick={() => setConfirmDelete(false)} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-medium">Отмена</button>
                             <button onClick={() => onDelete(keyItem.id)} className="flex-1 py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold shadow-lg shadow-red-900/20">Да, удалить</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

interface TransactionModalProps {
    transaction: Transaction;
    onClose: () => void;
    onRefund: (id: number) => void;
}

const TransactionModal: React.FC<TransactionModalProps> = ({ transaction, onClose, onRefund }) => {
  const [refundStep, setRefundStep] = useState(0); 

  if (!transaction) return null;
  const isIncome = transaction.type === 'income';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-white transition-colors"><X size={20} /></button>
        
        <div className="text-center mb-6">
            <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center mb-4 ${isIncome ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
                {isIncome ? <ArrowUpRight size={32} /> : <ArrowDownLeft size={32} />}
            </div>
            <h3 className="text-xl font-bold text-white">{isIncome ? 'Пополнение баланса' : 'Списание средств'}</h3>
            <p className="text-gray-400 text-sm mt-1">{transaction.date}</p>
        </div>

        <div className="space-y-4 mb-8">
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><Hash size={14} className="mr-2"/> ID</span><span className="text-white font-mono">#{transaction.id}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><Users size={14} className="mr-2"/> Пользователь</span><span className="text-blue-400">{transaction.user}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><DollarSign size={14} className="mr-2"/> Сумма</span><span className={`font-bold ${isIncome ? 'text-green-400' : 'text-red-400'}`}>{transaction.amount} ₽</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><CreditCard size={14} className="mr-2"/> Метод</span><span className="text-white">{transaction.method}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><FileText size={14} className="mr-2"/> Hash</span><span className="text-xs text-gray-500 font-mono">{transaction.hash}</span></div>
        </div>

        <div className="flex gap-3">
            {isIncome && refundStep === 0 && (
                <button onClick={() => setRefundStep(1)} className="flex-1 py-2.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 rounded-xl transition-colors font-medium flex items-center justify-center">
                    <RefreshCw size={16} className="mr-2"/> Сделать возврат
                </button>
            )}
            {refundStep === 1 && (
                <button onClick={() => { onRefund(transaction.id); onClose(); }} className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl transition-colors font-bold flex items-center justify-center animate-in fade-in">
                    <AlertTriangle size={16} className="mr-2"/> Подтвердить возврат
                </button>
            )}
            <button onClick={onClose} className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl transition-colors font-medium">Закрыть</button>
        </div>
      </div>
    </div>
  );
};

interface CreateKeyModalProps {
    onClose: () => void;
    users: User[];
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const CreateKeyModal: React.FC<CreateKeyModalProps> = ({ onClose, users = [], onToast }) => {
    const [searchUser, setSearchUser] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [isTrial, setIsTrial] = useState(false);
    const [params, setParams] = useState({ days: 30, traffic: 100, devices: 5 });
    const [selectedSquads, setSelectedSquads] = useState<string[]>([]);
    
    const squads = ['Gamers', 'Crypto', 'Streaming', 'AdultSafe', 'Developers'];
    const filteredUsers: User[] =
        searchUser && users
            ? users
                  .filter((u: User) =>
                      u.username.toLowerCase().includes(searchUser.toLowerCase()) ||
                      u.telegramId.toString().includes(searchUser)
                  )
                  .slice(0, 3)
            : [];
    
    const handleCreate = () => { 
        if(!selectedUser) {
            onToast('Ошибка', 'Выберите пользователя', 'error');
            return;
        }
        onToast('Успех', 'Ключ успешно создан и отправлен', 'success');
        onClose(); 
    };

    useEffect(() => { if(isTrial) { setParams({ days: 3, traffic: 5, devices: 1 }); } else { setParams({ days: 30, traffic: 100, devices: 5 }); } }, [isTrial]);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-800 flex justify-between items-center"><h3 className="text-xl font-bold text-white flex items-center"><Plus size={24} className="mr-2 text-blue-500"/> Создание ключа</h3><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button></div>
                <div className="p-6 overflow-y-auto space-y-6">
                    <div className="relative">
                        <label className="text-sm font-medium text-gray-400 mb-1.5 block">Пользователь</label>
                        <div className="relative">
                            <input
                                type="text"
                                value={selectedUser ? selectedUser.username : searchUser}
                                onChange={e => {
                                    setSearchUser(e.target.value);
                                    setSelectedUser(null);
                                }}
                                className={`w-full bg-gray-950 border ${
                                    selectedUser ? 'border-green-500/50 text-green-400' : 'border-gray-700 text-white'
                                } rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500`}
                                placeholder="Введите ID или Username"
                            />
                            {selectedUser && (
                                <CheckCircle size={18} className="absolute right-4 top-3.5 text-green-500" />
                            )}
                        </div>
                        {searchUser && !selectedUser && filteredUsers.length > 0 && (
                            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-10 overflow-hidden">
                                {filteredUsers.map((u: User) => (
                                    <div
                                        key={u.id}
                                        onClick={() => {
                                            setSelectedUser(u);
                                            setSearchUser('');
                                        }}
                                        className="px-4 py-3 hover:bg-gray-700 cursor-pointer flex justify-between items-center"
                                    >
                                        <span className="text-white">{u.username}</span>
                                        <span className="text-xs text-gray-500">ID: {u.telegramId}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <label className="flex items-center cursor-pointer p-4 bg-gray-800/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"><div className="relative"><input type="checkbox" checked={isTrial} onChange={() => setIsTrial(!isTrial)} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full transition-colors ${isTrial ? 'bg-purple-600' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${isTrial ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="font-medium text-white">Пробный период</div><div className="text-xs text-gray-500">Автоматически выставит лимиты</div></div></label>
                    <div className="grid grid-cols-3 gap-4"><div><label className="text-xs text-gray-500 mb-1.5 block">Длительность (дней)</label><input type="number" min="1" value={params.days} onChange={e => setParams({...params, days: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div><div><label className="text-xs text-gray-500 mb-1.5 block">Трафик (GB)</label><input type="number" min="1" value={params.traffic} onChange={e => setParams({...params, traffic: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div><div><label className="text-xs text-gray-500 mb-1.5 block">Устройства</label><input type="number" min="1" value={params.devices} onChange={e => setParams({...params, devices: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div></div>
                    <div><label className="text-sm font-medium text-gray-400 mb-2 block">Доступные сквады</label><div className="flex flex-wrap gap-2">{squads.map(sq => { const isSelected = selectedSquads.includes(sq); return (<button key={sq} onClick={() => setSelectedSquads(prev => isSelected ? prev.filter(s => s !== sq) : [...prev, sq])} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${isSelected ? 'bg-blue-600/20 border-blue-500 text-blue-400' : 'bg-gray-950 border-gray-800 text-gray-500 hover:border-gray-600'}`}>{sq}</button>) })}</div></div>
                </div>
                <div className="p-5 border-t border-gray-800"><button onClick={handleCreate} className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors">Создать ключ</button></div>
            </div>
        </div>
    );
};

interface UserDetailModalProps {
    user: User;
    onClose: () => void;
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const UserDetailModal: React.FC<UserDetailModalProps> = ({ user, onClose, onToast }) => {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  
  if (!user) return null;
  const trafficPercent = (user.traffic / user.maxTraffic) * 100;
  const devicesPercent = (user.devices / user.maxDevices) * 100;

  const handleAction = (type: string) => setActiveAction(type);
  const confirmAction = (value: string, notify: boolean) => { 
      onToast('Успешно', `Действие выполнено. Значение: ${value}`, 'success');
      setActiveAction(null); 
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto" onClick={onClose}>
        {activeAction && <UserActionModal type={activeAction} onClose={() => setActiveAction(null)} onConfirm={confirmAction} />}
        <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-4xl shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-800 flex justify-between items-start bg-gray-900 rounded-t-2xl">
                <div className="flex items-center gap-4"><div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center text-2xl font-bold text-gray-500 border border-gray-700">{user.username.charAt(1).toUpperCase()}</div><div><h2 className="text-2xl font-bold text-white flex items-center">{user.username} {user.status === 'Active' && <CheckCircle size={18} className="text-green-500 ml-2" />}{user.status === 'Banned' && <Ban size={18} className="text-red-500 ml-2" />}</h2><div className="flex items-center gap-3 text-sm text-gray-400 mt-1"><span className="flex items-center bg-gray-800 px-2 py-0.5 rounded"><Hash size={12} className="mr-1"/> ID: {user.telegramId}</span><span className="flex items-center"><Calendar size={12} className="mr-1"/> Рег: {user.regDate}</span></div></div></div>
                <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                    {/* Finance */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex justify-between items-start mb-4"><h3 className="text-lg font-bold text-gray-200 flex items-center"><DollarSign size={18} className="mr-2 text-green-400"/> Баланс</h3><div className="text-xs bg-gray-950 border border-gray-800 rounded-lg p-2 min-w-[120px]"><div className="text-gray-500 mb-1 font-semibold text-[10px] uppercase">Автоплатёж</div><div className="space-y-1"><div className="flex justify-between"><span className="text-gray-400">СБП</span><span className={user.autoPayDetails?.sbp ? "text-green-400" : "text-gray-600"}>{user.autoPayDetails?.sbp ? 'Да' : 'Нет'}</span></div><div className="flex justify-between"><span className="text-gray-400">Card</span><span className={user.autoPayDetails?.card ? "text-green-400" : "text-gray-600"}>{user.autoPayDetails?.card ? 'Да' : 'Нет'}</span></div></div></div></div>
                        <div className="text-3xl font-bold text-white mb-4">{user.balance} ₽</div>
                        <div className="grid grid-cols-2 gap-3"><button onClick={() => handleAction('ADD_BALANCE')} className="bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20 py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center"><ArrowUpRight size={14} className="mr-2"/> Начислить</button><button onClick={() => handleAction('SUB_BALANCE')} className="bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center"><ArrowDownLeft size={14} className="mr-2"/> Списать</button></div>
                    </div>
                    {/* Subscription */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center"><Zap size={18} className="mr-2 text-blue-400"/> Подписка</h3>
                         <div className="space-y-4"><div className="flex justify-between text-sm"><span className="text-gray-400">Статус</span><span className={`font-medium ${user.status === 'Active' ? 'text-green-400' : 'text-red-400'}`}>{user.status}</span></div><div className="flex justify-between text-sm"><span className="text-gray-400">Оплачено до</span><span className="text-white">{user.paidUntil}</span></div><div><div className="flex justify-between text-xs mb-1"><span className="text-gray-400 flex items-center"><Database size={10} className="mr-1"/> Трафик</span><span className="text-gray-300">{user.traffic} / {user.maxTraffic} GB</span></div><div className="w-full bg-gray-800 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full" style={{ width: `${trafficPercent}%` }}></div></div></div><div><div className="flex justify-between text-xs mb-1"><span className="text-gray-400 flex items-center"><Smartphone size={10} className="mr-1"/> Устройства</span><span className="text-gray-300">{user.devices} / {user.maxDevices}</span></div><div className="w-full bg-gray-800 rounded-full h-2"><div className="bg-purple-500 h-2 rounded-full" style={{ width: `${devicesPercent}%` }}></div></div></div></div>
                    </div>
                    {/* PARTNER SECTION */}
                    {user.isPartner && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                            <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Users size={18} className="mr-2 text-indigo-400"/> Партнёрская программа</h3>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                                    <div className="text-xs text-gray-500">Баланс</div>
                                    <div className="text-xl font-bold text-white">{user.partnerBalance} ₽</div>
                                </div>
                                <div className="bg-gray-950 p-3 rounded-xl border border-gray-800">
                                    <div className="text-xs text-gray-500">Рефералов</div>
                                    <div className="text-xl font-bold text-white">{user.referrals}</div>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <div><label className="text-xs text-gray-500 block mb-1">Реф. код</label><input type="text" defaultValue={user.refCode} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 font-mono"/></div>
                                <div><label className="text-xs text-gray-500 block mb-1">Ставка (%)</label><input type="number" defaultValue={user.partnerRate} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"/></div>
                                <button onClick={() => onToast('Успех', 'Настройки партнера сохранены', 'success')} className="w-full mt-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-600/20 py-2 rounded-lg text-sm font-bold transition-colors">Сохранить настройки партнёра</button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Settings size={18} className="mr-2 text-orange-400"/> Управление подпиской</h3>
                         <div className="grid grid-cols-2 gap-3"><button onClick={() => handleAction('EXTEND_SUB')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Продлить</button><button onClick={() => handleAction('REDUCE_SUB')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Уменьшить срок</button><button onClick={() => handleAction('SET_TRAFFIC')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Изм. макс. трафик</button><button onClick={() => handleAction('SET_DEVICES')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Изм. кол-во уст.</button><button className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors col-span-2">Добавить Squad</button></div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Edit2 size={18} className="mr-2 text-gray-400"/> Редактирование профиля</h3>
                         <div className="space-y-3"><div><label className="text-xs text-gray-500 block mb-1">Username</label><input type="text" defaultValue={user.username} className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none" /></div><div><label className="text-xs text-gray-500 block mb-1">Имя</label><input type="text" defaultValue={user.name} className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-500 outline-none" /></div><div className="flex gap-4 pt-2"><label className="flex items-center text-sm text-gray-300 cursor-pointer"><input type="checkbox" defaultChecked={user.firstDeposit} className="form-checkbox bg-gray-800 border-gray-700 rounded text-blue-500 mr-2"/>Первое пополнение</label><label className="flex items-center text-sm text-gray-300 cursor-pointer"><input type="checkbox" defaultChecked={user.wasPaid} className="form-checkbox bg-gray-800 border-gray-700 rounded text-blue-500 mr-2"/>Была подписка</label></div><button onClick={() => onToast('Успех', 'Данные пользователя сохранены', 'success')} className="w-full mt-4 bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-lg text-sm font-bold transition-colors shadow-lg shadow-blue-900/20">Сохранить изменения</button></div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};

// ==========================================
// 5. MAIN COMPONENT APP
// ==========================================

export default function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState("Главная страница");
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Data States
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  
  // UI States
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [massActionType, setMassActionType] = useState<string | null>(null);
  const [keySearch, setKeySearch] = useState('');
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [activeTicketId, setActiveTicketId] = useState<number | null>(null);
  const [ticketMsg, setTicketMsg] = useState('');
  
  // New States for Key Editing
  const [editingKey, setEditingKey] = useState<KeyItem | null>(null);

  // Toast Handler
  const addToast = (title: string, message: string, type: ToastType = 'success') => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, title, message, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  // Инициализация данных — всё тянем из backend API
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        // Транзакции
        try {
          const transactionsFromApi = await apiFetch('/panel/transactions?limit=100');
          if (!cancelled && Array.isArray(transactionsFromApi)) {
            const mapped: Transaction[] = transactionsFromApi.map((t: any) => ({
              id: t.id,
              user: t.user || `@user_${t.user_id}`,
              amount: t.amount ?? 0,
              type: t.amount > 0 ? 'income' : 'expense',
              status: t.status || 'Pending',
              method: t.payment_method || 'Unknown',
              date: t.created_at
                ? new Date(t.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '',
              hash: t.hash || t.payment_id || '',
            }));
            setTransactions(mapped);
          }
        } catch (e) {
          console.error('Failed to load transactions from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить транзакции', 'error');
            setTransactions([]);
          }
        }

        // Пользователи
        try {
          const usersFromApi = await apiFetch('/panel/users?limit=500');
          if (!cancelled && Array.isArray(usersFromApi)) {
            const mapped: User[] = usersFromApi.map((u: any) => ({
              id: u.id,
              telegramId: u.telegram_id,
              username: u.username ? (u.username.startsWith('@') ? u.username : `@${u.username}`) : `id${u.telegram_id}`,
              name: u.full_name || '',
              balance: u.balance ?? 0,
              status: (u.status as UserStatus) || 'Trial',
              traffic: 0,
              maxTraffic: 100,
              devices: 0,
              maxDevices: 1,
              regDate: u.registration_date ? new Date(u.registration_date).toLocaleDateString('ru-RU') : '',
              paidUntil: u.paid_until ? new Date(u.paid_until).toLocaleDateString('ru-RU') : '—',
              autoPayDetails: { sbp: false, card: false, crypto: false },
              refLink: `https://t.me/${BOT_USERNAME}?start=ref=${u.telegram_id}`,
              refCode: u.referral_code || '',
              squads: [],
              firstDeposit: false,
              wasPaid: false,
              isPartner: !!u.is_partner,
              partnerBalance: u.partner_balance ?? 0,
              partnerRate: u.partner_rate ?? 20,
              referrals: 0,
              totalEarned: u.total_earned ?? 0,
            }));
            setUsers(mapped);
          }
        } catch (e) {
          console.error('Failed to load users from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить пользователей', 'error');
            setUsers([]);
          }
        }

        // Промокоды
        try {
          const promosFromApi = await apiFetch('/panel/promocodes');
          if (!cancelled && Array.isArray(promosFromApi)) {
            const mappedPromos: Promo[] = promosFromApi.map((p: any) => ({
              id: p.id,
              code: p.code,
              type: p.type,
              value: String(p.value),
              uses: p.uses_count ?? 0,
              limit: p.uses_limit ?? 0,
              expires: p.expires_at
                ? new Date(p.expires_at).toLocaleDateString('ru-RU')
                : 'Бессрочно',
            }));
            setPromos(mappedPromos);
          }
        } catch (e) {
          console.error('Failed to load promocodes from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить промокоды', 'error');
            setPromos([]);
          }
        }

        // Тикеты
        try {
          const ticketsFromApi = await apiFetch('/panel/tickets');
          if (!cancelled && Array.isArray(ticketsFromApi)) {
            const mappedTickets: Ticket[] = ticketsFromApi.map((t: any) => ({
              id: t.id,
              user: t.user,
              status: t.status as TicketStatus,
              lastMsg: t.lastMsg,
              time: t.time
                ? new Date(t.time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '',
              unread: t.unread ?? 0,
              avatar: (t.user || '?').charAt(1).toUpperCase(),
              balance: t.balance ?? 0,
              sub: t.sub || '',
            }));
            setTickets(mappedTickets);
          }
        } catch (e) {
          console.error('Failed to load tickets from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить тикеты', 'error');
            setTickets([]);
          }
        }

        // Ключи VPN
        try {
          const keysFromApi = await apiFetch('/panel/keys?limit=500');
          if (!cancelled && Array.isArray(keysFromApi)) {
            const mappedKeys: KeyItem[] = keysFromApi.map((k: any) => ({
              id: k.id,
              key: k.key_config || k.key_uuid || `key_${k.id}`,
              user: k.username || `@user_${k.user_id}`,
              status: (k.status as KeyStatus) || 'Active',
              expiry: k.expiry_date
                ? Math.ceil((new Date(k.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                : 0,
              trafficUsed: k.traffic_used ?? 0,
              trafficLimit: k.traffic_limit ?? 0,
              devicesUsed: k.devices_used ?? 0,
              devicesLimit: k.devices_limit ?? 1,
              server: k.server_location || 'Unknown',
            }));
            setKeys(mappedKeys);
          }
        } catch (e) {
          console.error('Failed to load keys from API', e);
          if (!cancelled) {
            addToast('Ошибка', 'Не удалось загрузить ключи', 'error');
            setKeys([]);
          }
        }

        // Тарифы (локальные, так как это конфигурация, а не данные из БД)
        if (!cancelled) {
          setPlans([
            { id: 1, name: '1 Месяц', price: 199, oldPrice: 250, duration: 30, isHit: false, description: 'Базовый доступ ко всем серверам' },
            { id: 2, name: '3 Месяца', price: 499, oldPrice: 750, duration: 90, isHit: true, description: 'Выгоднее на 15%' },
            { id: 3, name: '1 Год', price: 1500, oldPrice: 2400, duration: 365, isHit: false, description: 'Максимальная выгода' },
          ]);
        }
      } catch (e) {
        console.error('Initial panel data load failed', e);
        if (!cancelled) {
          addToast('Ошибка', 'Не удалось загрузить данные панели', 'error');
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpdateKey = (id: number, newExpiry: number) => {
      setKeys(prev => prev.map(k => k.id === id ? { ...k, expiry: newExpiry, status: newExpiry > 0 ? 'Active' : 'Expired' } : k));
      setEditingKey(null);
      addToast('Успешно', `Срок действия ключа #${id} обновлен`, 'success');
  };

  const handleDeleteKey = (id: number) => {
      setKeys(prev => prev.filter(k => k.id !== id));
      setEditingKey(null);
      addToast('Удалено', `Ключ #${id} успешно удален`, 'success');
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans selection:bg-blue-500 selection:text-white">
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
      
      {selectedTransaction && (<TransactionModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} onRefund={(id) => addToast('Возврат', `Возврат по транзакции #${id} успешно выполнен`, 'success')} />)}
      {selectedUser && (<UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} onToast={addToast} />)}
      {isCreateKeyOpen && (<CreateKeyModal onClose={() => setIsCreateKeyOpen(false)} users={users} onToast={addToast} />)}
      {editingKey && (<KeyEditModal keyItem={editingKey} onClose={() => setEditingKey(null)} onSave={handleUpdateKey} onDelete={handleDeleteKey} />)}
      {massActionType && <UserActionModal type={massActionType} onClose={() => setMassActionType(null)} onConfirm={(val) => { addToast('Массовое действие', `Задача запущена. Параметр: ${val}`, 'success'); setMassActionType(null); }} />}

      <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-gray-900 border-r border-gray-800 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 overflow-y-auto custom-scrollbar`}>
        <div className="p-6 border-b border-gray-800 hidden md:block"><h1 className="text-2xl font-bold text-blue-500 tracking-wider">BlinVPN</h1><p className="text-xs text-gray-500 mt-1">Admin Panel v3.2</p></div>
        <nav className="p-4 space-y-6">
            {[
                { category: "Главное", items: [{ name: "Главная страница", icon: Home }, { name: "Финансы", icon: DollarSign }, { name: "Статистика", icon: BarChart2 }] },
                { category: "Пользователи", items: [{ name: "Пользователи", icon: Users }, { name: "Ключи", icon: Key }] },
                { category: "Маркетинг", items: [{ name: "Рассылка", icon: Mail }, { name: "Тарифы", icon: Tag }] },
                { category: "Поддержка", items: [{ name: "Тикеты", icon: MessageSquare }] },
                { category: "Другое", items: [{ name: "Публичные страницы", icon: Globe }, { name: "Настройки", icon: Settings }] }
            ].map((section, idx) => (
                <div key={idx}>
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-2">{section.category}</h3>
                    <ul className="space-y-1">{section.items.map((item, itemIdx) => (<li key={itemIdx}><button onClick={() => { setActivePage(item.name); setIsMobileMenuOpen(false); }} className={`w-full flex items-center px-2 py-2 text-sm font-medium rounded-lg transition-colors ${activePage === item.name ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}><item.icon size={18} className={`mr-3 ${activePage === item.name ? 'text-blue-400' : 'text-gray-500'}`} />{item.name}</button></li>))}</ul>
                </div>
            ))}
        </nav>
      </aside>

      <main className="md:ml-64 min-h-screen transition-all duration-300">
        <div className="bg-gray-900/50 backdrop-blur-md border-b border-gray-800 sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4"><button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden text-gray-300 hover:text-white p-1">{isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}</button><div className="relative group cursor-pointer"><div className="flex items-center space-x-2 bg-green-500/10 border border-green-500/20 px-3 py-1.5 rounded-full"><div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div><span className="text-green-400 text-sm font-medium">Работает</span></div></div></div>
          <div className="flex items-center bg-blue-600/10 border border-blue-500/20 px-3 py-1.5 rounded-lg hover:bg-blue-600/20 transition-colors cursor-pointer"><DollarSign size={16} className="text-blue-400 mr-2" /><div className="text-lg font-bold text-blue-400 leading-none">1,240,500 ₽</div></div>
        </div>

        <div className="p-4 md:p-6">
            {activePage === 'Главная страница' && <Dashboard />}
            {activePage === 'Финансы' && <FinancePage transactions={transactions} onSelectTransaction={setSelectedTransaction} />}
            {activePage === 'Статистика' && <StatisticsPage />}
            {activePage === 'Пользователи' && <UsersPage users={users} userSearch={userSearch} setUserSearch={setUserSearch} setSelectedUser={setSelectedUser} setMassActionType={setMassActionType} />}
            {activePage === 'Ключи' && <KeysPage keys={keys} keySearch={keySearch} setKeySearch={setKeySearch} setIsCreateKeyOpen={setIsCreateKeyOpen} setEditingKey={setEditingKey} />}
            {activePage === 'Рассылка' && <MailingPage onToast={addToast} />}
            {activePage === 'Тарифы' && <TariffsPage promos={promos} plans={plans} setPlans={setPlans} onToast={addToast} />}
            {activePage === 'Тикеты' && <TicketsPage tickets={tickets} activeTicketId={activeTicketId} setActiveTicketId={setActiveTicketId} ticketMsg={ticketMsg} setTicketMsg={setTicketMsg} setSelectedUser={setSelectedUser} users={users} onToast={addToast} />}
            {activePage === 'Публичные страницы' && <PublicPages onToast={addToast} />}
            {activePage === 'Настройки' && <SettingsPage onToast={addToast} />}
        </div>
      </main>
    </div>
  );
}

// --- SUB-COMPONENTS FOR PAGES ---

const Dashboard = () => {
    const [usersData, setUsersData] = useState<number[]>([]);
    const [keysData, setKeysData] = useState<number[]>([]);
    const [labels, setLabels] = useState<string[]>([]);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/stats/charts');
                if (data) {
                    setUsersData(Array.isArray(data.users) ? data.users : []);
                    setKeysData(Array.isArray(data.keys) ? data.keys : []);
                    setLabels(Array.isArray(data.labels) ? data.labels : []);
                }
            } catch (e) {
                console.error('Failed to load dashboard charts', e);
            }
        })();
    }, []);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Добро пожаловать в панель управления</h2><p className="text-gray-400 mt-1">Вот что происходит с BlinVPN сегодня.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard title="Всего пользователей" value="45,231" change="+12%" icon={Users} color="blue" />
              <StatCard title="Активных ключей" value="32,045" change="+5.4%" icon={Key} color="green" />
              <StatCard title="Доход за месяц" value="854,200 ₽" change="+18%" icon={DollarSign} color="indigo" />
              <StatCard title="Открытые тикеты" value="12" change="-2" icon={MessageSquare} color="orange" />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-semibold text-gray-200 flex items-center"><TrendingUp className="w-5 h-5 mr-2 text-blue-500" />Динамика новых пользователей</h3>
                        <span className="text-xs font-medium text-green-400 bg-green-500/10 px-2 py-1 rounded">{labels.at(-1) || ''}</span>
                    </div>
                    <SmoothAreaChart color="#3b82f6" label="Пользователей" data={usersData} id="chart1" />
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-semibold text-gray-200 flex items-center"><Key className="w-5 h-5 mr-2 text-purple-500" />Новые ключи</h3>
                        <span className="text-xs font-medium text-purple-400 bg-purple-500/10 px-2 py-1 rounded">{labels.at(-1) || ''}</span>
                    </div>
                    <SmoothAreaChart color="#a855f7" label="Ключей" data={keysData} id="chart2" />
                </div>
            </div>
        </div>
    );
};

interface FinancePageProps {
  transactions: Transaction[];
  onSelectTransaction: (t: Transaction) => void;
}

const FinancePage: React.FC<FinancePageProps> = ({ transactions, onSelectTransaction }) => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Финансы</h2><p className="text-gray-400 mt-1">Управление доходами</p></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6"><StatCard title="Пополнения" value="1,240,500 ₽" change="+12.5%" icon={ArrowUpRight} color="green" /><StatCard title="Списания" value="142,300 ₽" subValue="(Расходы)" change="+2.1%" icon={ArrowDownLeft} color="red" /><StatCard title="Успешные операции" value="14,203" subValue="операций" icon={Activity} color="blue" /></div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm"><div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">ID</th><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Сумма</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4">Дата</th></tr></thead><tbody className="divide-y divide-gray-800">{transactions.map((tx) => (<tr key={tx.id} onClick={() => onSelectTransaction(tx)} className="hover:bg-gray-800/30 cursor-pointer"><td className="px-6 py-4 text-sm text-gray-500">#{tx.id}</td><td className="px-6 py-4 text-sm text-gray-300">{tx.user}</td><td className={`px-6 py-4 text-sm font-bold ${tx.amount > 0 ? 'text-green-400' : 'text-white'}`}>{tx.amount > 0 ? '+' : ''}{tx.amount} ₽</td><td className="px-6 py-4 text-sm text-gray-400">{tx.status}</td><td className="px-6 py-4 text-sm text-gray-500">{tx.date}</td></tr>))}</tbody></table></div></div>
    </div>
);

const StatisticsPage = () => {
    const revenueData = [15000, 18000, 16500, 22000, 21000, 25000, 30000, 28000, 35000, 38000, 42000, 45000, 43000, 50000, 55000];
    const userDistData = [
        { label: 'Активные', value: 400 },
        { label: 'Ушли', value: 200 },
        { label: 'Trial', value: 100 },
        { label: 'Бан', value: 50 },
        { label: 'Спящие', value: 500 },
    ];
    const paymentMethodsData = [
        { label: 'Card', value: 40 },
        { label: 'SBP', value: 30 },
        { label: 'Crypto', value: 20 },
        { label: 'Other', value: 10 },
    ];
    const topReferrers = [
        { id: 1, name: '@crypto_king', count: 1450, earned: 145000 },
        { id: 2, name: '@vpn_master', count: 890, earned: 89000 },
        { id: 3, name: '@traffic_guru', count: 560, earned: 56000 },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Статистика</h2><p className="text-gray-400 mt-1">Детальная аналитика проекта</p></div>
            
            {/* Core Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard title="Всего пользователей" value="45,231" change="+12%" icon={Users} color="blue" />
                <StatCard title="Активных подписок" value="12,040" icon={CheckCircle} color="green" />
                <StatCard title="Платежей сегодня" value="145" icon={CreditCard} color="indigo" />
                <StatCard title="Открытых тикетов" value="12" icon={MessageSquare} color="orange" />
                <StatCard title="Баланс клиентов" value="1.2M ₽" icon={Wallet} color="gray" />
            </div>

            {/* Revenue & Quick Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-gray-200">Выручка по дням</h3>
                        <select className="bg-gray-800 border-gray-700 text-gray-300 text-sm rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500"><option>За 30 дней</option><option>За неделю</option><option>За год</option></select>
                    </div>
                    <SmoothAreaChart color="#10b981" label="Выручка (₽)" data={revenueData} height={250} id="revChart" />
                </div>
                <div className="space-y-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col justify-center h-[calc(50%-8px)]">
                        <p className="text-gray-400 text-sm">В среднем в день</p>
                        <div className="text-2xl font-bold text-white mt-1">42,500 ₽</div>
                        <div className="text-green-400 text-xs mt-2 flex items-center"><ArrowUpRight size={12} className="mr-1" /> Растет (+5%)</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col justify-center h-[calc(50%-8px)]">
                        <p className="text-gray-400 text-sm">Лучший день</p>
                        <div className="text-2xl font-bold text-white mt-1">125,000 ₽</div>
                        <div className="text-gray-500 text-xs mt-2">12 Октября</div>
                    </div>
                </div>
            </div>

            {/* Distributions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-gray-200 mb-6">Распределение пользователей</h3>
                    <PieChartComponent data={userDistData} colors={['#3b82f6', '#ef4444', '#a855f7', '#f97316', '#6b7280']} />
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-6">Способы оплаты</h3>
                     <PieChartComponent data={paymentMethodsData} colors={['#10b981', '#3b82f6', '#f59e0b', '#6b7280']} />
                </div>
            </div>

            {/* Subscriptions & Conversion */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Подписки</h3>
                     <div className="space-y-4">
                         <div className="flex justify-between"><span className="text-gray-400">Всего подписок</span><span className="text-white font-bold">12,040</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Платные</span><span className="text-green-400 font-bold">8,500</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Куплено за неделю</span><span className="text-blue-400 font-bold">+450</span></div>
                     </div>
                 </div>
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Конверсия Trial {'>'} Paid</h3>
                     <div className="flex items-end gap-2 mb-2">
                         <span className="text-4xl font-bold text-white">18.5%</span>
                         <span className="text-green-400 text-sm mb-1.5">+2.1%</span>
                     </div>
                     <p className="text-xs text-gray-500">Пользователей переходят на платный тариф после пробного периода.</p>
                     <div className="w-full bg-gray-800 h-2 rounded-full mt-4"><div className="bg-green-500 h-2 rounded-full" style={{width: '18.5%'}}></div></div>
                 </div>
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Рефералы</h3>
                     <div className="space-y-4">
                         <div className="flex justify-between"><span className="text-gray-400">Всего приглашено</span><span className="text-white font-bold">15,400</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Партнеров</span><span className="text-white font-bold">1,200</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Выплачено</span><span className="text-white font-bold">450k ₽</span></div>
                     </div>
                 </div>
            </div>

            {/* Top Referrers */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-gray-800"><h3 className="text-lg font-bold text-gray-200">Топ рефералов</h3></div>
                <table className="w-full text-left">
                    <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase"><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Пригласил</th><th className="px-6 py-4">Заработал</th></tr></thead>
                    <tbody className="divide-y divide-gray-800">
                        {topReferrers.map(r => (
                            <tr key={r.id}>
                                <td className="px-6 py-4 text-white font-medium flex items-center"><Trophy size={16} className={`mr-2 ${r.id === 1 ? 'text-yellow-400' : r.id === 2 ? 'text-gray-400' : 'text-orange-400'}`}/> {r.name}</td>
                                <td className="px-6 py-4 text-gray-300">{r.count} чел.</td>
                                <td className="px-6 py-4 text-green-400 font-bold">{r.earned} ₽</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

interface UsersPageProps {
  users: User[];
  userSearch: string;
  setUserSearch: (s: string) => void;
  setSelectedUser: (u: User) => void;
  setMassActionType: (t: string | null) => void;
}

const UsersPage: React.FC<UsersPageProps> = ({ users, userSearch, setUserSearch, setSelectedUser, setMassActionType }) => {
    const filteredUsers = users.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()));
    const [showMassMenu, setShowMassMenu] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setShowMassMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-white">Пользователи</h2><p className="text-gray-400 mt-1">Управление базой клиентов</p></div>
                
                {/* REPLACED BUTTONS WITH MASS ACTION DROPDOWN */}
                <div className="relative" ref={menuRef}>
                    <button onClick={() => setShowMassMenu(!showMassMenu)} className="flex items-center px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all">
                        <Layers size={18} className="mr-2" /> Массовые действия <ChevronDown size={16} className={`ml-2 transition-transform ${showMassMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showMassMenu && (
                        <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <button onClick={() => { setMassActionType('MASS_ADD_DAYS'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Calendar size={16} className="mr-2 text-blue-400" /> Добавить дни всем
                            </button>
                            <button onClick={() => { setMassActionType('MASS_ADD_BALANCE'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center">
                                <DollarSign size={16} className="mr-2 text-green-400" /> Начислить баланс всем
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="relative"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div><input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="block w-full pl-10 pr-3 py-3 bg-gray-900 border border-gray-700 rounded-xl leading-5 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Поиск..." /></div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Баланс</th><th className="px-6 py-4">Подписка</th><th className="px-6 py-4">Партнер</th><th className="px-6 py-4 text-right">Действие</th></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            {filteredUsers.map((user) => (
                                <tr key={user.id} onClick={() => setSelectedUser(user)} className="hover:bg-gray-800/30 cursor-pointer group">
                                    <td className="px-6 py-4 text-sm font-medium text-white flex items-center"><div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center mr-3 text-xs font-bold text-gray-300">{user.username.substring(0, 2).toUpperCase()}</div>{user.username}</td>
                                    <td className="px-6 py-4 text-sm text-white font-bold">{user.balance} ₽</td>
                                    <td className="px-6 py-4 text-sm text-gray-400">{user.paidUntil}</td>
                                    <td className="px-6 py-4 text-sm">{user.isPartner ? <span className="text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded text-xs border border-indigo-400/20">Да</span> : <span className="text-gray-600">-</span>}</td>
                                    <td className="px-6 py-4 text-right"><button className="text-gray-500 hover:text-white p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"><Settings size={16} /></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

interface KeysPageProps {
  keys: KeyItem[];
  keySearch: string;
  setKeySearch: (s: string) => void;
  setIsCreateKeyOpen: (b: boolean) => void;
  setEditingKey: (k: KeyItem | null) => void;
}

const KeysPage: React.FC<KeysPageProps> = ({ keys, keySearch, setKeySearch, setIsCreateKeyOpen, setEditingKey }) => {
    const filteredKeys = keys.filter(k => k.key.toLowerCase().includes(keySearch.toLowerCase()) || k.user.toLowerCase().includes(keySearch.toLowerCase()));
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Ключи</h2><p className="text-gray-400 mt-1">Управление подписками VLESS/Vmess</p></div><button onClick={() => setIsCreateKeyOpen(true)} className="flex items-center px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all"><Plus size={18} className="mr-2" />Создать</button></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6"><StatCard title="Всего ключей" value={keys.length} icon={Key} color="blue" /><StatCard title="Истёкшие" value={keys.filter(k => k.status === 'Expired').length} icon={Clock} color="orange" /><StatCard title="Заблокированные" value={keys.filter(k => k.status === 'Banned').length} icon={Ban} color="red" /></div>
            <div className="flex space-x-4"><div className="relative flex-grow"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div><input type="text" value={keySearch} onChange={e => setKeySearch(e.target.value)} className="block w-full pl-10 pr-3 py-3 bg-gray-900 border border-gray-700 rounded-xl leading-5 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Поиск по ключу, пользователю..." /></div><button className="px-4 bg-gray-900 border border-gray-700 rounded-xl text-gray-300 hover:bg-gray-800 transition-colors flex items-center"><Filter size={18} className="mr-2" /> Фильтр</button></div>
             <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">ID / Ключ</th><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4">Осталось</th><th className="px-6 py-4">Трафик</th><th className="px-6 py-4">Устр.</th><th className="px-6 py-4 text-right"></th></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            {filteredKeys.map((k) => (
                                <tr key={k.id} onClick={() => setEditingKey(k)} className="hover:bg-gray-800/30 transition-colors group cursor-pointer relative">
                                    <td className="px-6 py-4"><div className="text-sm font-mono text-white">#{k.id}</div><div className="text-xs text-gray-500 truncate w-32 font-mono mt-0.5 opacity-70">{k.key}</div></td>
                                    <td className="px-6 py-4 text-sm text-blue-400 font-medium">{k.user}</td><td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs font-medium border ${k.status === 'Active' ? 'bg-green-500/10 text-green-400 border-green-500/20' : k.status === 'Expired' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{k.status}</span></td>
                                    <td className="px-6 py-4 text-sm text-gray-300">{k.expiry > 0 ? `${k.expiry} дн.` : 'Истёк'}</td>
                                    <td className="px-6 py-4"><div className="text-xs text-gray-400 mb-1">{k.trafficUsed} / {k.trafficLimit} GB</div><div className="w-24 bg-gray-800 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${(k.trafficUsed/k.trafficLimit)*100}%` }}></div></div></td><td className="px-6 py-4 text-sm text-gray-400 text-center">{k.devicesUsed}/{k.devicesLimit}</td>
                                    <td className="px-6 py-4 text-right"><div className="p-2 bg-gray-800 rounded-lg text-gray-500 group-hover:bg-blue-600 group-hover:text-white transition-colors inline-block"><Edit2 size={16} /></div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

interface MailingPageProps {
  onToast: (title: string, msg: string, type: ToastType) => void;
}

const MailingPage: React.FC<MailingPageProps> = ({ onToast }) => {
    const stats = { totalSent: 154300, delivered: 98.5, clicks: 12400, lastCampaign: "Новогодняя скидка" };
    const handleSend = () => { onToast('Рассылка', 'Сообщения поставлены в очередь', 'success'); };
    
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Рассылка</h2><p className="text-gray-400 mt-1">Массовая отправка сообщений пользователям</p></div></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6"><StatCard title="Отправлено сообщений" value={stats.totalSent.toLocaleString()} icon={Send} color="blue" /><StatCard title="Доставляемость" value={stats.delivered + '%'} icon={CheckCircle} color="green" /><StatCard title="Переходов" value={stats.clicks.toLocaleString()} icon={MousePointer} color="purple" /><StatCard title="Последняя кампания" value="Promo #12" subValue="Вчера" icon={Clock} color="orange" /></div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                        <h3 className="text-lg font-bold text-gray-200 mb-4 flex items-center"><Plus size={20} className="mr-2 text-blue-500"/> Новая рассылка</h3>
                        <div className="space-y-4"><div><label className="text-sm text-gray-400 mb-1.5 block">Текст сообщения</label><textarea className="w-full bg-gray-950 border border-gray-700 rounded-xl p-4 text-white focus:outline-none focus:border-blue-500 h-32 resize-none" placeholder="Введите текст рассылки... Поддерживается Markdown"></textarea></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="text-sm text-gray-400 mb-1.5 block">Изображение</label><div className="border-2 border-dashed border-gray-700 rounded-xl h-12 flex items-center justify-center text-gray-500 hover:border-gray-500 hover:text-gray-300 transition-colors cursor-pointer"><ImageIcon size={18} className="mr-2"/> Загрузить фото</div></div><div><label className="text-sm text-gray-400 mb-1.5 block">Кнопки (JSON)</label><input type="text" className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-blue-500" placeholder='[{"text": "Купить", "url": "..."}]' /></div></div><div><label className="text-sm text-gray-400 mb-2 block">Получатели</label><div className="flex flex-wrap gap-2">{['Все пользователи', 'Активные', 'Истекшие', 'Без подписки', 'English Users'].map(filter => (<button key={filter} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm text-gray-300 border border-gray-700 transition-colors">{filter}</button>))}</div></div><div className="pt-2 flex gap-4"><button onClick={handleSend} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-colors flex justify-center items-center"><Send size={18} className="mr-2" /> Отправить</button><button className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition-colors">Предпросмотр</button></div></div>
                    </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col max-h-[600px]"><div className="p-5 border-b border-gray-800"><h3 className="text-lg font-bold text-gray-200">История</h3></div><div className="overflow-y-auto custom-scrollbar flex-1">{[1,2,3,4,5].map((i) => (<div key={i} className="p-4 border-b border-gray-800 hover:bg-gray-800/30 transition-colors"><div className="flex justify-between items-start mb-1"><span className="font-medium text-white line-clamp-1">🔥 Скидка 50% на все тарифы только сегодня!</span><span className="text-xs text-gray-500 whitespace-nowrap ml-2">10.09.25</span></div><div className="flex justify-between items-center mt-2"><span className="text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded border border-green-500/20">Отправлено</span><span className="text-xs text-gray-400 flex items-center"><Users size={12} className="mr-1"/> 45,200</span></div></div>))}</div></div>
            </div>
        </div>
    );
};

interface TariffsPageProps {
  promos: Promo[];
  plans: Plan[];
  setPlans: React.Dispatch<React.SetStateAction<Plan[]>>;
  onToast: (title: string, msg: string, type: ToastType) => void;
}

const TariffsPage: React.FC<TariffsPageProps> = ({ promos, plans, setPlans, onToast }) => {
    const [activeTab, setActiveTab] = useState('plans');
    const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
    const [newPromo, setNewPromo] = useState<{ code: string; type: Promo['type']; value: string; limit: string; expires: string }>({
        code: '',
        type: 'balance',
        value: '',
        limit: '',
        expires: '',
    });

    const handleCreatePromo = async () => {
        if (!newPromo.code || !newPromo.value) {
            onToast('Ошибка', 'Заполните код и значение промокода', 'error');
            return;
        }
        try {
            const payload: any = {
                code: newPromo.code.toUpperCase(),
                type: newPromo.type,
                value: newPromo.value,
                uses_limit: newPromo.limit ? Number(newPromo.limit) : null,
                expires_at: newPromo.expires || null,
                is_active: 1,
            };
            const res = await apiFetch('/panel/promocodes', {
                method: 'POST',
                body: JSON.stringify(payload),
            });

            const p = res?.promocode || payload;
            const mapped: Promo = {
                id: p.id,
                code: p.code,
                type: p.type,
                value: String(p.value),
                uses: p.uses_count ?? 0,
                limit: p.uses_limit ?? 0,
                expires: p.expires_at
                    ? new Date(p.expires_at).toLocaleDateString('ru-RU')
                    : 'Бессрочно',
            };

            onToast('Успех', 'Промокод создан', 'success');
            // локальное обновление списка промо
            // setPlans не трогаем; промокоды приходят в родитель через стейт, поэтому тут просто уведомляем
            // в реальном приложении можно поднять setPromos в App и пробрасывать сюда сеттер
            promos.push(mapped);
            setNewPromo({ code: '', type: 'balance', value: '', limit: '', expires: '' });
        } catch (e: any) {
            console.error(e);
            onToast('Ошибка', 'Не удалось создать промокод', 'error');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-white">Тарифы и Маркетинг</h2><p className="text-gray-400 mt-1">Управление ценами, скидками и промокодами</p></div>
                <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1">
                    <button onClick={() => setActiveTab('plans')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'plans' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Тарифные планы</button>
                    <button onClick={() => setActiveTab('promos')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'promos' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Промокоды</button>
                    <button onClick={() => setActiveTab('discounts')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'discounts' ? 'bg-blue-600 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Авто-скидки</button>
                </div>
            </div>

            {activeTab === 'plans' && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {plans.map(plan => (
                        <div key={plan.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-6 relative group hover:border-gray-700 transition-colors">
                            {plan.isHit && <div className="absolute top-4 right-4 bg-orange-500/20 text-orange-400 px-2 py-1 rounded-lg text-xs font-bold border border-orange-500/20">ХИТ</div>}
                            <h3 className="text-xl font-bold text-white mb-1">{plan.name}</h3>
                            <p className="text-gray-400 text-sm mb-4">{plan.description}</p>
                            <div className="flex items-end gap-2 mb-6">
                                <span className="text-3xl font-bold text-white">{plan.price} ₽</span>
                                {plan.oldPrice && <span className="text-gray-500 line-through mb-1 text-sm">{plan.oldPrice} ₽</span>}
                            </div>
                            <div className="space-y-3">
                                <div><label className="text-xs text-gray-500">Цена (₽)</label><input type="number" defaultValue={plan.price} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono mt-1" /></div>
                                <div><label className="text-xs text-gray-500">Старая цена (₽)</label><input type="number" defaultValue={plan.oldPrice} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono mt-1" /></div>
                                <div><label className="text-xs text-gray-500">Дней</label><input type="number" defaultValue={plan.duration} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono mt-1" /></div>
                            </div>
                            <button onClick={() => onToast('Успех', `Тариф "${plan.name}" обновлен`, 'success')} className="w-full mt-6 bg-gray-800 hover:bg-blue-600 hover:text-white text-gray-300 py-2.5 rounded-xl font-medium transition-colors">Сохранить</button>
                        </div>
                    ))}
                    <button className="border-2 border-dashed border-gray-800 rounded-2xl p-6 flex flex-col items-center justify-center text-gray-500 hover:border-gray-600 hover:text-gray-300 transition-colors h-full min-h-[350px]">
                        <Plus size={48} className="mb-4 opacity-50"/>
                        <span className="font-medium">Добавить тариф</span>
                    </button>
                </div>
            )}

            {activeTab === 'promos' && (
                <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6"><StatCard title="Активных кодов" value={promos.length} icon={Tag} color="green" /><StatCard title="Использований" value="2,450" icon={Users} color="blue" /><StatCard title="Сумма бонусов" value="142,000 ₽" icon={Gift} color="purple" /></div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
                    <h3 className="text-lg font-bold text-gray-200 mb-4 flex items-center">
                        <Plus size={20} className="mr-2 text-blue-500" /> Новый промокод
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Код</label>
                            <input
                                type="text"
                                value={newPromo.code}
                                onChange={e => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono"
                                placeholder="NEW2025"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Тип</label>
                            <select
                                value={newPromo.type}
                                onChange={e => setNewPromo({ ...newPromo, type: e.target.value as Promo['type'] })}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                            >
                                <option value="balance">Пополнение баланса</option>
                                <option value="discount">Скидка (%)</option>
                                <option value="subscription">Подписка (дней)</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Значение</label>
                            <input
                                type="text"
                                value={newPromo.value}
                                onChange={e => setNewPromo({ ...newPromo, value: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                                placeholder="100 / 10 / 30"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Лимит</label>
                            <input
                                type="number"
                                value={newPromo.limit}
                                onChange={e => setNewPromo({ ...newPromo, limit: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                                placeholder="100"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Истекает (YYYY-MM-DD)</label>
                            <input
                                type="text"
                                value={newPromo.expires}
                                onChange={e => setNewPromo({ ...newPromo, expires: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                                placeholder="2025-12-31"
                            />
                        </div>
                    </div>
                    <div className="flex justify-end mt-4">
                        <button
                            onClick={handleCreatePromo}
                            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-colors flex items-center"
                        >
                            <Save size={18} className="mr-2" /> Создать промокод
                        </button>
                    </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">Код</th><th className="px-6 py-4">Тип</th><th className="px-6 py-4">Значение</th><th className="px-6 py-4">Использовано</th><th className="px-6 py-4">Срок действия</th><th className="px-6 py-4 text-right"></th></tr></thead>
                            <tbody className="divide-y divide-gray-800">
                                {promos.map((p) => (
                                    <tr key={p.id} className="hover:bg-gray-800/30 transition-colors group">
                                        <td className="px-6 py-4">
                                            <span className="text-sm font-bold text-white font-mono bg-gray-800 px-2 py-1 rounded border border-gray-700">
                                                {p.code}
                                            </span>
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-300">
                                            {p.type === 'balance' && 'Пополнение'}
                                            {p.type === 'discount' && 'Скидка'}
                                            {p.type === 'subscription' && 'Подписка'}
                                        </td>
                                        <td className="px-6 py-4 text-sm font-bold text-green-400">{p.value}</td>
                                        <td className="px-6 py-4 text-sm text-gray-400">
                                            {p.uses} / {p.limit || '∞'}
                                        </td>
                                        <td className="px-6 py-4 text-sm text-gray-400">{p.expires}</td>
                                        <td className="px-6 py-4 text-right">
                                            <button
                                                className="text-red-500 hover:text-red-400 p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                                                onClick={async () => {
                                                    try {
                                                        await apiFetch(`/panel/promocodes/${p.id}`, {
                                                            method: 'PUT',
                                                            body: JSON.stringify({ is_active: 0 }),
                                                        });
                                                        onToast('Промокод', 'Промокод деактивирован', 'success');
                                                    } catch (e) {
                                                        console.error(e);
                                                        onToast('Ошибка', 'Не удалось деактивировать промокод', 'error');
                                                    }
                                                }}
                                            >
                                                <Ban size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                </>
            )}

            {activeTab === 'discounts' && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                    <div className="p-4 border-b border-gray-800 flex justify-between items-center"><h3 className="text-lg font-bold text-white">Автоматические правила</h3><button className="text-blue-400 text-sm hover:underline font-medium">+ Добавить правило</button></div>
                    <table className="w-full text-left">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase"><th className="px-6 py-4">Название</th><th className="px-6 py-4">Условие</th><th className="px-6 py-4">Бонус</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4 text-right"></th></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            <tr><td className="px-6 py-4 text-white font-medium">Бонус за крипту</td><td className="px-6 py-4 text-gray-400 text-sm">Пополнение {'>'} 1000₽ через Crypto</td><td className="px-6 py-4 text-green-400 font-bold">+10%</td><td className="px-6 py-4"><span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded text-xs">Активна</span></td><td className="px-6 py-4 text-right"><button className="text-gray-500 hover:text-white"><Settings size={16}/></button></td></tr>
                            <tr><td className="px-6 py-4 text-white font-medium">Скидка на год</td><td className="px-6 py-4 text-gray-400 text-sm">Покупка тарифа "12 месяцев"</td><td className="px-6 py-4 text-blue-400 font-bold">-20% Цена</td><td className="px-6 py-4"><span className="bg-green-500/10 text-green-400 border border-green-500/20 px-2 py-0.5 rounded text-xs">Активна</span></td><td className="px-6 py-4 text-right"><button className="text-gray-500 hover:text-white"><Settings size={16}/></button></td></tr>
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

interface PublicPagesProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const PublicPages: React.FC<PublicPagesProps> = ({ onToast }) => {
    const [activeTab, setActiveTab] = useState<'offer' | 'privacy'>('offer');
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-white">Публичные страницы</h2><p className="text-gray-400 mt-1">Редактирование юридических документов</p></div>
                <div className="flex bg-gray-900 border border-gray-800 rounded-xl p-1">
                    <button onClick={() => setActiveTab('offer')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'offer' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Договор оферты</button>
                    <button onClick={() => setActiveTab('privacy')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'privacy' ? 'bg-gray-800 text-white shadow' : 'text-gray-400 hover:text-gray-200'}`}>Политика конфиденциальности</button>
                </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 flex flex-col h-[calc(100vh-240px)]">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-200 flex items-center">
                        {activeTab === 'offer' ? <FileTextIcon size={20} className="mr-2 text-blue-500"/> : <Shield size={20} className="mr-2 text-green-500"/>}
                        {activeTab === 'offer' ? 'Редактор оферты' : 'Редактор политики'}
                    </h3>
                    <div className="text-xs text-gray-500 flex items-center"><Clock size={12} className="mr-1"/> Последнее сохранение: Сегодня, 12:30</div>
                </div>
                <textarea className="flex-1 w-full bg-gray-950 border border-gray-700 rounded-xl p-6 text-gray-300 font-mono text-sm leading-relaxed focus:outline-none focus:border-blue-500 resize-none mb-4" defaultValue={activeTab === 'offer' ? "# Договор оферты\n\n1. Общие положения..." : "# Политика конфиденциальности\n\n1. Сбор данных..."} />
                <div className="flex justify-end">
                    <button onClick={() => onToast('Сохранено', 'Документ успешно обновлен', 'success')} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center">
                        <FileCheck size={18} className="mr-2" /> Сохранить изменения
                    </button>
                </div>
            </div>
        </div>
    );
};

interface TicketsPageProps {
    tickets: Ticket[];
    activeTicketId: number | null;
    setActiveTicketId: (id: number | null) => void;
    ticketMsg: string;
    setTicketMsg: (msg: string) => void;
    setSelectedUser: (u: User | null) => void;
    users: User[];
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const TicketsPage: React.FC<TicketsPageProps> = ({ tickets, activeTicketId, setActiveTicketId, ticketMsg, setTicketMsg, setSelectedUser, users, onToast }) => {
    const activeTicket = tickets.find(t => t.id === activeTicketId);
    
    const handleSendTicketMessage = async (ticketId: number, message: string) => {
        try {
            const response = await apiFetch(`/panel/tickets/${ticketId}/reply`, {
                method: 'POST',
                body: JSON.stringify({ message })
            });
            
            if (response.success) {
                onToast('Тикет', 'Сообщение отправлено', 'success');
                setTicketMsg('');
                // Обновляем список тикетов через небольшую задержку
                setTimeout(() => {
                    window.location.reload();
                }, 500);
            } else {
                onToast('Ошибка', response.error || 'Не удалось отправить сообщение', 'error');
            }
        } catch (error) {
            console.error('Error sending ticket message:', error);
            onToast('Ошибка', 'Не удалось отправить сообщение', 'error');
        }
    };
    
    return (
        <div className="h-[calc(100vh-140px)] flex gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="w-1/3 bg-gray-900 border border-gray-800 rounded-2xl flex flex-col overflow-hidden">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center"><h3 className="font-bold text-white text-lg">Тикеты</h3><button className="text-gray-400 hover:text-white"><Filter size={18}/></button></div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {tickets.map(t => (
                        <div key={t.id} onClick={() => setActiveTicketId(t.id)} className={`p-4 border-b border-gray-800 cursor-pointer hover:bg-gray-800/50 transition-colors ${activeTicketId === t.id ? 'bg-blue-900/10 border-l-2 border-l-blue-500' : ''}`}>
                            <div className="flex justify-between items-start mb-1"><div className="flex items-center"><div className="w-8 h-8 bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-gray-300 mr-2">{t.avatar}</div><span className="font-medium text-white">{t.user}</span></div><span className="text-xs text-gray-500">{t.time}</span></div>
                            <p className="text-sm text-gray-400 truncate mb-2">{t.lastMsg}</p>
                            <div className="flex justify-between items-center"><span className={`text-[10px] px-2 py-0.5 rounded border ${t.status === 'Open' ? 'bg-green-500/10 text-green-400 border-green-500/20' : t.status === 'Pending' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-gray-700 text-gray-400 border-gray-600'}`}>{t.status}</span>{t.unread > 0 && <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{t.unread}</span>}</div>
                        </div>
                    ))}
                </div>
            </div>
            <div className="w-2/3 bg-gray-900 border border-gray-800 rounded-2xl flex flex-col overflow-hidden">
                {activeTicket ? (
                    <>
                      <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-900/50">
                          <div className="flex items-center cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setSelectedUser(users.find(u => u.username === activeTicket.user) || users[0])}>
                              <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center font-bold text-gray-300 mr-3">{activeTicket.avatar}</div>
                              <div><div className="font-bold text-white flex items-center">{activeTicket.user} <ChevronRight size={14} className="ml-1 text-gray-500"/></div><div className="text-xs text-gray-400">Баланс: {activeTicket.balance}₽ • {activeTicket.sub}</div></div>
                          </div>
                          <div className="flex gap-2"><button onClick={() => onToast('Тикет', 'Тикет закрыт', 'success')} className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white" title="Закрыть тикет"><CheckCircle size={20}/></button><button className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-red-400" title="Заблокировать"><Ban size={20}/></button><button className="p-2 hover:bg-gray-800 rounded-lg text-gray-400 hover:text-white"><MoreVertical size={20}/></button></div>
                      </div>
                      <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-gray-950/30">
                          <div className="flex justify-start"><div className="bg-gray-800 text-gray-200 rounded-2xl rounded-tl-none py-3 px-4 max-w-[70%] text-sm">Здравствуйте! У меня не подключается Германия.</div></div>
                          <div className="flex justify-end"><div className="bg-blue-600 text-white rounded-2xl rounded-tr-none py-3 px-4 max-w-[70%] text-sm">Добрый день! Какую ошибку выдает приложение?</div></div>
                          <div className="flex justify-start"><div className="bg-gray-800 text-gray-200 rounded-2xl rounded-tl-none py-3 px-4 max-w-[70%] text-sm">Пишет "Timeout"</div></div>
                      </div>
                      <div className="p-4 border-t border-gray-800 bg-gray-900">
                          <div className="flex items-center gap-2"><button className="text-gray-500 hover:text-white p-2"><Paperclip size={20}/></button><input type="text" value={ticketMsg} onChange={e => setTicketMsg(e.target.value)} onKeyPress={e => {if (e.key === 'Enter' && activeTicketId && ticketMsg.trim()) { handleSendTicketMessage(activeTicketId, ticketMsg.trim()); }}} className="flex-1 bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500" placeholder="Написать сообщение..." /><button onClick={async () => {if (activeTicketId && ticketMsg.trim()) { await handleSendTicketMessage(activeTicketId, ticketMsg.trim()); }}} className="bg-blue-600 hover:bg-blue-500 text-white p-3 rounded-xl transition-colors"><Send size={20}/></button></div>
                      </div>
                    </>
                ) : (<div className="flex-1 flex flex-col items-center justify-center text-gray-500"><MessageCircle size={48} className="mb-4 opacity-50"/><p>Выберите чат из списка</p></div>)}
            </div>
        </div>
    );
};

interface SettingsPageProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onToast }) => {
    const [activeTab, setActiveTab] = useState<'general' | 'payments' | 'subs' | 'backups'>('general');
    
    // Toggle Switch Component
    const Toggle: React.FC<{ checked: boolean; onChange: (checked: boolean) => void }> = ({ checked, onChange }) => (
        <button onClick={() => onChange(!checked)} className={`w-12 h-6 rounded-full p-1 transition-colors relative ${checked ? 'bg-blue-600' : 'bg-gray-700'}`}>
            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-6' : 'translate-x-0'}`} />
        </button>
    );

    const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-6 border-b border-gray-800 pb-4">{title}</h3>
            <div className="space-y-6">{children}</div>
        </div>
    );

    const Input: React.FC<{ label: string; placeholder: string; type?: string }> = ({ label, placeholder, type="text" }) => (
        <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">{label}</label>
            <input type={type} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder={placeholder} />
        </div>
    );

    return (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Sidebar */}
            <div className="w-full lg:w-64 flex-shrink-0">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden sticky top-24">
                    <div className="p-4 border-b border-gray-800"><h2 className="font-bold text-white">Категории</h2></div>
                    <nav className="p-2 space-y-1">
                        {[{id: 'general', icon: Settings, label: 'Основное'}, {id: 'payments', icon: CreditCard, label: 'Платежи'}, {id: 'subs', icon: Zap, label: 'Подписки'}, {id: 'backups', icon: Cloud, label: 'Резервные копии'}].map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-colors ${activeTab === tab.id ? 'bg-blue-600/10 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                                <tab.icon size={18} className="mr-3"/> {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1">
                {activeTab === 'general' && (
                    <>
                        <Section title="Главные настройки">
                            <Input label="Токен бота (Telegram)" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
                            <Input label="ID Администратора" placeholder="123456789" />
                            <Input label="Токен поддержки" placeholder="Token..." />
                            <Input label="Сайт мини-приложения" placeholder="https://t.me/yourbot/app" />
                            <Input label="API ключ Remnawave" placeholder="rem_..." />
                        </Section>
                        <Section title="Обслуживание">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                                    <span className="text-gray-300 font-medium">Тех. работы Бота</span>
                                    <Toggle checked={false} onChange={() => {}} />
                                </div>
                                <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                                    <span className="text-gray-300 font-medium">Тех. работы Мини-аппа</span>
                                    <Toggle checked={false} onChange={() => {}} />
                                </div>
                                <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800 col-span-1 md:col-span-2">
                                    <div className="flex-1 mr-4">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-gray-300 font-medium">Тех. работы Локаций</span>
                                            <Toggle checked={true} onChange={() => {}} />
                                        </div>
                                        <select className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"><option>Все ноды</option><option>Germany #1</option><option>USA #2</option></select>
                                    </div>
                                </div>
                                <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                                    <span className="text-gray-300 font-medium">Статус-страница</span>
                                    <Toggle checked={true} onChange={() => {}} />
                                </div>
                            </div>
                        </Section>
                        <Section title="Дополнительно">
                            <Input label="Часовой пояс (UTC)" placeholder="+3" type="number" />
                        </Section>
                    </>
                )}

                {activeTab === 'payments' && (
                    <>
                        <Section title="YooKassa">
                            <Input label="ShopID" placeholder="123456" />
                            <Input label="SecretKey" placeholder="live_..." type="password" />
                        </Section>
                        <Section title="Platega">
                            <Input label="Merchant ID" placeholder="1234" />
                            <Input label="SecretKey" placeholder="key_..." type="password" />
                        </Section>
                        <Section title="Heleket">
                            <Input label="Merchant ID" placeholder="1234" />
                            <Input label="Heleket API Key" placeholder="api_..." type="password" />
                            <Input label="Домен" placeholder="https://heleket.com" />
                        </Section>
                    </>
                )}

                {activeTab === 'subs' && (
                    <Section title="Пробный период">
                         <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800 mb-6">
                            <span className="text-gray-300 font-medium">Включить пробный период</span>
                            <Toggle checked={true} onChange={() => {}} />
                        </div>
                        <Input label="Длительность (часов)" placeholder="24" type="number" />
                        <div className="mt-4">
                            <label className="block text-sm font-medium text-gray-400 mb-2">Доступные сквады для триала</label>
                            <div className="flex flex-wrap gap-3">
                                {['Gamers', 'Crypto', 'Streaming', 'AdultSafe'].map(sq => (
                                    <label key={sq} className="flex items-center space-x-2 bg-gray-950 px-3 py-2 rounded-lg border border-gray-700 cursor-pointer hover:border-blue-500">
                                        <input type="checkbox" className="rounded bg-gray-800 border-gray-600 text-blue-500" />
                                        <span className="text-sm text-gray-300">{sq}</span>
                                    </label>
                                ))}
                            </div>
                        </div>
                    </Section>
                )}

                {activeTab === 'backups' && (
                    <Section title="Резервное копирование">
                        <Input label="Частота создания бэкапов (в часах)" placeholder="12" type="number" />
                        <div className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-xl flex items-start mt-4">
                             <Cloud className="text-blue-400 mr-3 mt-0.5" size={20} />
                             <div>
                                 <h4 className="text-blue-400 font-bold text-sm">Важно</h4>
                                 <p className="text-blue-300/80 text-xs mt-1">Бэкапы будут отправляться в личные сообщения администратору в виде архива базы данных.</p>
                             </div>
                        </div>
                    </Section>
                )}

                <div className="flex justify-end pt-4">
                    <button onClick={() => onToast('Настройки', 'Конфигурация успешно сохранена', 'success')} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold shadow-lg shadow-blue-900/20 transition-all flex items-center">
                        <Save size={20} className="mr-2" /> Сохранить все
                    </button>
                </div>
            </div>
        </div>
    );
};
