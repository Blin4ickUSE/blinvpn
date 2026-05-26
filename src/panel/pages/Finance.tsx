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

import { panelApiFetch as apiFetch, BOT_USERNAME, getPanelToken, setPanelToken, clearPanelToken } from '../../api/client';

import { StatCard, CombinedLinesChart, SmoothAreaChart, PieChartComponent } from '../components/charts';

import { usePanel } from '../context/PanelContext';

export default function Finance() {
  const { transactions, setSelectedTransaction: onSelectTransaction } = usePanel();
    const [stats, setStats] = useState<{
        deposits: number;
        depositsChange: string;
        withdrawals: number;
        withdrawalsChange: string;
        successfulOps: number;
    } | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/finance/stats');
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load finance stats', e);
            }
        })();
    }, []);

    const fmtMoney = (v: number) =>
        `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Финансы</h2><p className="text-gray-400 mt-1">Управление доходами</p></div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatCard 
                    title="Пополнения" 
                    value={stats ? fmtMoney(stats.deposits) : '—'} 
                    change={stats?.depositsChange} 
                    icon={ArrowUpRight} 
                    color="green" 
                />
                <StatCard 
                    title="Успешные операции" 
                    value={stats ? stats.successfulOps.toLocaleString('ru-RU') : '—'} 
                    subValue="операций" 
                    icon={Activity} 
                    color="blue" 
                />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-sm"><div className="overflow-x-auto"><table className="w-full text-left border-collapse"><thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase tracking-wider"><th className="px-6 py-4">ID</th><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Сумма</th><th className="px-6 py-4">Статус</th><th className="px-6 py-4">Дата</th></tr></thead><tbody className="divide-y divide-gray-800">{transactions.map((tx) => (<tr key={tx.id} onClick={() => onSelectTransaction(tx)} className="hover:bg-gray-800/30 cursor-pointer"><td className="px-6 py-4 text-sm text-gray-500">#{tx.id}</td><td className="px-6 py-4 text-sm text-gray-300">{tx.user}</td><td className={`px-6 py-4 text-sm font-bold ${tx.amount > 0 ? 'text-green-400' : 'text-white'}`}>{tx.amount > 0 ? '+' : ''}{tx.amount} ₽</td><td className="px-6 py-4 text-sm text-gray-400">{tx.status}</td><td className="px-6 py-4 text-sm text-gray-500">{tx.date}</td></tr>))}</tbody></table></div></div>
        </div>
    );
}
