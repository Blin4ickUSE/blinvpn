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

import { usePanel } from '../context/PanelContext';

export default function Subscriptions() {
  const { keys, keySearch, setKeySearch, setIsCreateKeyOpen, setEditingKey } = usePanel();
    const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Expired' | 'Banned'>('all');
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    
    const filteredKeys = keys.filter(k => {
        const matchesSearch = k.key.toLowerCase().includes(keySearch.toLowerCase()) || k.user.toLowerCase().includes(keySearch.toLowerCase());
        const matchesStatus = statusFilter === 'all' || k.status === statusFilter;
        return matchesSearch && matchesStatus;
    });
    
    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Подписки</h2><p className="text-gray-400 mt-1">Управление подписками VLESS/Vmess</p></div><button onClick={() => setIsCreateKeyOpen(true)} className="flex items-center px-5 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-orange-900/20 transition-all"><Plus size={18} className="mr-2" />Создать</button></div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6"><StatCard title="Всего ключей" value={keys.length} icon={Key} color="blue" /><StatCard title="Истёкшие" value={keys.filter(k => k.status === 'Expired').length} icon={Clock} color="orange" /><StatCard title="Заблокированные" value={keys.filter(k => k.status === 'Banned').length} icon={Ban} color="red" /></div>
            <div className="flex space-x-4">
                <div className="relative flex-grow"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div><input type="text" value={keySearch} onChange={e => setKeySearch(e.target.value)} className="block w-full pl-10 pr-3 py-3 bg-gray-900 border border-gray-700 rounded-xl leading-5 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="Поиск по ключу, пользователю..." /></div>
                <div className="relative">
                    <button onClick={() => setShowFilterMenu(!showFilterMenu)} className={`px-4 py-3 bg-gray-900 border rounded-xl text-gray-300 hover:bg-gray-800 transition-colors flex items-center ${statusFilter !== 'all' ? 'border-orange-500 text-orange-400' : 'border-gray-700'}`}>
                        <Filter size={18} className="mr-2" /> 
                        {statusFilter === 'all' ? 'Фильтр' : statusFilter === 'Active' ? 'Активные' : statusFilter === 'Expired' ? 'Истёкшие' : 'Забаненные'}
                    </button>
                    {showFilterMenu && (
                        <div className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[150px]">
                            {[{v: 'all', l: 'Все'}, {v: 'Active', l: 'Активные'}, {v: 'Expired', l: 'Истёкшие'}, {v: 'Banned', l: 'Забаненные'}].map(opt => (
                                <button key={opt.v} onClick={() => { setStatusFilter(opt.v as any); setShowFilterMenu(false); }} className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-800 transition-colors ${statusFilter === opt.v ? 'text-orange-400 bg-orange-600/10' : 'text-gray-300'}`}>{opt.l}</button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
             <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">ID / Ключ</th><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4">Осталось</th><th className="px-6 py-4">Трафик</th><th className="px-6 py-4">Устр.</th><th className="px-6 py-4 text-right"></th></tr></thead>
                        <tbody className="divide-y divide-gray-800">
                            {filteredKeys.map((k) => (
                                <tr key={k.id} onClick={() => setEditingKey(k)} className="hover:bg-gray-800/30 transition-colors group cursor-pointer relative">
                                    <td className="px-6 py-4"><div className="text-sm font-mono text-white">#{k.id}</div><div className="text-xs text-gray-500 truncate w-32 font-mono mt-0.5 opacity-70">{k.key}</div></td>
                                    <td className="px-6 py-4 text-sm text-orange-400 font-medium">{k.user}</td><td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs font-medium border ${k.status === 'Active' ? 'bg-green-500/10 text-green-400 border-green-500/20' : k.status === 'Expired' ? 'bg-orange-500/10 text-orange-400 border-orange-500/20' : 'bg-red-500/10 text-red-400 border-red-500/20'}`}>{k.status}</span></td>
                                    <td className="px-6 py-4 text-sm text-gray-300">{k.expiry > 0 ? `${k.expiry} дн.` : 'Истёк'}</td>
                                    <td className="px-6 py-4"><div className="text-xs text-gray-400 mb-1">{(k.trafficUsed / (1024**3)).toFixed(1)} / {k.trafficLimit > 0 ? (k.trafficLimit / (1024**3)).toFixed(0) : '∞'} GB</div><div className="w-24 bg-gray-800 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${k.trafficLimit > 0 && k.trafficUsed/k.trafficLimit > 0.9 ? 'bg-red-500' : k.trafficLimit > 0 && k.trafficUsed/k.trafficLimit > 0.7 ? 'bg-yellow-500' : 'bg-orange-500'}`} style={{ width: `${k.trafficLimit > 0 ? Math.min(100, (k.trafficUsed/k.trafficLimit)*100) : 0}%` }}></div></div></td><td className="px-6 py-4 text-sm text-gray-400 text-center">{k.devicesUsed}/{k.devicesLimit}</td>
                                    <td className="px-6 py-4 text-right"><div className="p-2 bg-gray-800 rounded-lg text-gray-500 group-hover:bg-orange-600 group-hover:text-white transition-colors inline-block"><Edit2 size={16} /></div></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
