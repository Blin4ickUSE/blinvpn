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

export default function Users() {
  const { users, userSearch, setUserSearch, setSelectedUser, setMassActionType } = usePanel();
    const [statusFilter, setStatusFilter] = useState<'all' | 'Trial' | 'Active' | 'Banned'>('all');
    const [showFilterMenu, setShowFilterMenu] = useState(false);
    
    const filteredUsers = users.filter(u => {
        const matchesSearch = u.username.toLowerCase().includes(userSearch.toLowerCase()) || 
                              u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
                              u.telegramId.toString().includes(userSearch);
        const matchesStatus = statusFilter === 'all' || 
                              (statusFilter === 'Banned' ? u.status === 'Banned' : u.status === statusFilter);
        return matchesSearch && matchesStatus;
    });
    
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
                    <button onClick={() => setShowMassMenu(!showMassMenu)} className="flex items-center px-4 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-orange-900/20 transition-all">
                        <Layers size={18} className="mr-2" /> Массовые действия <ChevronDown size={16} className={`ml-2 transition-transform ${showMassMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showMassMenu && (
                        <div className="absolute right-0 mt-2 w-56 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                            <button onClick={() => { setMassActionType('MASS_ADD_DAYS'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Calendar size={16} className="mr-2 text-orange-400" /> Добавить дни всем
                            </button>
                            <button onClick={() => { setMassActionType('MASS_ADD_BALANCE'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <DollarSign size={16} className="mr-2 text-green-400" /> Начислить баланс всем
                            </button>
                            <button onClick={() => { setMassActionType('MASS_BAN'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Ban size={16} className="mr-2 text-red-400" /> Забанить всех
                            </button>
                            <button onClick={() => { setMassActionType('MASS_UNBAN'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <CheckCircle size={16} className="mr-2 text-green-400" /> Разбанить всех
                            </button>
                            <button onClick={() => { setMassActionType('MASS_RESET_TRIAL'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <RefreshCw size={16} className="mr-2 text-yellow-400" /> Сбросить пробный период
                            </button>
                            <button onClick={() => { setMassActionType('MASS_DELETE_KEYS'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <Trash2 size={16} className="mr-2 text-red-400" /> Удалить все ключи
                            </button>
                            <button onClick={() => { setMassActionType('MASS_SET_PARTNER'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center border-b border-gray-800">
                                <UserPlus size={16} className="mr-2 text-indigo-400" /> Сделать партнерами
                            </button>
                            <button onClick={() => { setMassActionType('MASS_REMOVE_PARTNER'); setShowMassMenu(false); }} className="w-full text-left px-4 py-3 text-sm text-gray-200 hover:bg-gray-800 flex items-center">
                                <UserMinus size={16} className="mr-2 text-gray-400" /> Убрать партнерство
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex space-x-4">
                <div className="relative flex-grow"><div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none"><Search className="h-4 w-4 text-gray-500" /></div><input type="text" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className="block w-full pl-10 pr-3 py-3 bg-gray-900 border border-gray-700 rounded-xl leading-5 text-gray-300 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500" placeholder="Поиск по имени, username или ID..." /></div>
                <div className="relative">
                    <button onClick={() => setShowFilterMenu(!showFilterMenu)} className={`px-4 py-3 bg-gray-900 border rounded-xl text-gray-300 hover:bg-gray-800 transition-colors flex items-center ${statusFilter !== 'all' ? 'border-orange-500 text-orange-400' : 'border-gray-700'}`}>
                        <Filter size={18} className="mr-2" /> 
                        {statusFilter === 'all' ? 'Фильтр' : statusFilter === 'Trial' ? 'Триал' : statusFilter === 'Active' ? 'Активные' : 'Забаненные'}
                    </button>
                    {showFilterMenu && (
                        <div className="absolute top-full right-0 mt-2 bg-gray-900 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden min-w-[150px]">
                            {[{v: 'all', l: 'Все'}, {v: 'Trial', l: 'Триал'}, {v: 'Active', l: 'Активные'}, {v: 'Banned', l: 'Забаненные'}].map(opt => (
                                <button key={opt.v} onClick={() => { setStatusFilter(opt.v as any); setShowFilterMenu(false); }} className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-800 transition-colors ${statusFilter === opt.v ? 'text-orange-400 bg-orange-600/10' : 'text-gray-300'}`}>{opt.l}</button>
                            ))}
                        </div>
                    )}
                </div>
            </div>
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
}
