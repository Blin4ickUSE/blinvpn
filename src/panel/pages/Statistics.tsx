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


export default function Statistics() {
    const [stats, setStats] = useState<any>(null);
    const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch(`/panel/statistics/full?period=${period}`);
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load statistics', e);
            }
        })();
    }, [period]);

    // Кол-во точек графика для выбранного периода
    const periodDays: Record<typeof period, number> = { week: 7, month: 30, year: 365 };
    const periodLabel: Record<typeof period, string> = { week: 'Выручка по неделе', month: 'Выручка по дням', year: 'Выручка по году' };

    // Обрезаем данные под период на клиенте — график меняется даже если бэкенд вернул полный массив
    const sliceByPeriod = (arr: any[]) => {
        const n = periodDays[period];
        return Array.isArray(arr) && arr.length > n ? arr.slice(-n) : (arr || []);
    };

    const fmtNumber = (v: number) => v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    const fmtMoney = (v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M ₽` : `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

    if (!stats) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div><h2 className="text-2xl font-bold text-white">Статистика</h2><p className="text-gray-400 mt-1">Детальная аналитика проекта</p></div>
                <div className="flex items-center justify-center h-64"><Loader className="animate-spin text-orange-500" size={32} /></div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Статистика</h2><p className="text-gray-400 mt-1">Детальная аналитика проекта</p></div>
            
            {/* Core Metrics */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard title="Всего пользователей" value={fmtNumber(stats.totalUsers)} icon={Users} color="blue" />
                <StatCard title="Активных подписок" value={fmtNumber(stats.activeSubscriptions)} icon={CheckCircle} color="green" />
                <StatCard title="Платежей сегодня" value={fmtNumber(stats.paymentsToday)} icon={CreditCard} color="indigo" />
                <StatCard title="Баланс клиентов" value={fmtMoney(stats.clientsBalance)} icon={Wallet} color="gray" />
            </div>

            {/* Revenue & Quick Metrics */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-gray-200">{periodLabel[period]}</h3>
                        <select
                            value={period}
                            onChange={(e) => setPeriod(e.target.value as 'week' | 'month' | 'year')}
                            className="bg-gray-800 border-gray-700 text-gray-300 text-sm rounded-lg p-2 focus:ring-orange-500 focus:border-orange-500"
                        >
                            <option value="month">За 30 дней</option>
                            <option value="week">За неделю</option>
                            <option value="year">За год</option>
                        </select>
                    </div>
                    <SmoothAreaChart color="#10b981" label="Выручка (₽)" data={sliceByPeriod(stats.revenueData)} height={250} id="revChart" labels={sliceByPeriod(stats.revenueLabels)} />
                </div>
                <div className="space-y-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col justify-center h-[calc(50%-8px)]">
                        <p className="text-gray-400 text-sm">В среднем в день</p>
                        <div className="text-2xl font-bold text-white mt-1">{fmtMoney(stats.avgDaily || 0)}</div>
                        <div className="text-green-400 text-xs mt-2 flex items-center"><ArrowUpRight size={12} className="mr-1" /> Растет</div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 flex flex-col justify-center h-[calc(50%-8px)]">
                        <p className="text-gray-400 text-sm">Лучший день</p>
                        <div className="text-2xl font-bold text-white mt-1">{fmtMoney(stats.bestDayValue || 0)}</div>
                        <div className="text-gray-500 text-xs mt-2">{stats.bestDayDate || ''}</div>
                    </div>
                </div>
            </div>

            {/* Distributions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <h3 className="text-lg font-bold text-gray-200 mb-6">Распределение пользователей</h3>
                    <PieChartComponent data={stats.userDistData || []} colors={['#3b82f6', '#ef4444', '#a855f7', '#f97316', '#6b7280']} />
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-6">Способы оплаты</h3>
                     <PieChartComponent data={stats.paymentMethodsData || []} colors={['#10b981', '#3b82f6', '#f59e0b', '#6b7280']} />
                </div>
            </div>

            {/* Subscriptions & Conversion */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Подписки</h3>
                     <div className="space-y-4">
                         <div className="flex justify-between"><span className="text-gray-400">Всего подписок</span><span className="text-white font-bold">{fmtNumber(stats.totalSubscriptions)}</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Платные</span><span className="text-green-400 font-bold">{fmtNumber(stats.paidSubscriptions)}</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Куплено за неделю</span><span className="text-orange-400 font-bold">+{fmtNumber(stats.boughtThisWeek)}</span></div>
                     </div>
                 </div>
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Конверсия Trial {'>'} Paid</h3>
                     <div className="flex items-end gap-2 mb-2">
                         <span className="text-4xl font-bold text-white">{stats.conversionRate?.toFixed(1) || 0}%</span>
                     </div>
                     <p className="text-xs text-gray-500">Пользователей переходят на платный тариф после пробного периода.</p>
                     <div className="w-full bg-gray-800 h-2 rounded-full mt-4"><div className="bg-green-500 h-2 rounded-full" style={{width: `${Math.min(stats.conversionRate || 0, 100)}%`}}></div></div>
                 </div>
                 <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                     <h3 className="text-lg font-bold text-gray-200 mb-4">Рефералы</h3>
                     <div className="space-y-4">
                         <div className="flex justify-between"><span className="text-gray-400">Всего приглашено</span><span className="text-white font-bold">{fmtNumber(stats.totalInvited)}</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Партнеров</span><span className="text-white font-bold">{fmtNumber(stats.partners)}</span></div>
                         <div className="flex justify-between"><span className="text-gray-400">Выплачено</span><span className="text-white font-bold">{fmtMoney(stats.totalPaid)}</span></div>
                     </div>
                 </div>
            </div>

            {/* Top Referrers */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-5 border-b border-gray-800"><h3 className="text-lg font-bold text-gray-200">Топ рефералов</h3></div>
                <table className="w-full text-left">
                    <thead><tr className="bg-gray-800/50 text-gray-400 text-xs uppercase"><th className="px-6 py-4">Пользователь</th><th className="px-6 py-4">Пригласил</th><th className="px-6 py-4">Заработал</th></tr></thead>
                    <tbody className="divide-y divide-gray-800">
                        {(stats.topReferrers || []).map((r: any) => (
                            <tr key={r.id}>
                                <td className="px-6 py-4 text-white font-medium flex items-center"><Trophy size={16} className={`mr-2 ${r.id === 1 ? 'text-yellow-400' : r.id === 2 ? 'text-gray-400' : 'text-orange-400'}`}/> {r.name}</td>
                                <td className="px-6 py-4 text-gray-300">{r.count} чел.</td>
                                <td className="px-6 py-4 text-green-400 font-bold">{r.earned.toLocaleString('ru-RU')} ₽</td>
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

