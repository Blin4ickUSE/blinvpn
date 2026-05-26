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

import type {
  ToastType, Transaction, User, KeyItem, Promo, UserStatus, KeyStatus,
} from '../../core/types';


interface PublicPagesProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const PromocodesStats: React.FC<{ promos: Promo[] }> = ({ promos }) => {
    const [stats, setStats] = useState<{ total: number; totalUses: number; activeCount: number } | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/promocodes/stats');
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load promocodes stats', e);
            }
        })();
    }, []);

    const totalBonus = promos.reduce((sum, p) => {
        if (p.type === 'balance') return sum + (Number(p.value) * p.uses);
        return sum;
    }, 0);

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatCard 
                title="Активных кодов" 
                value={stats ? stats.activeCount : promos.length} 
                icon={Tag} 
                color="green" 
            />
            <StatCard 
                title="Использований" 
                value={stats ? stats.totalUses.toLocaleString('ru-RU') : '0'} 
                icon={Users} 
                color="blue" 
            />
            <StatCard 
                title="Сумма бонусов" 
                value={`${totalBonus.toLocaleString('ru-RU')} ₽`} 
                icon={Gift} 
                color="purple" 
            />
        </div>
    );
};

const AutoDiscountsPage: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [discounts, setDiscounts] = useState<any[]>([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newDiscount, setNewDiscount] = useState({
        name: '',
        condition_type: 'payment_amount',
        condition_value: '',
        discount_type: 'percent',
        discount_value: '',
        is_active: true
    });

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/auto-discounts');
                if (Array.isArray(data)) {
                    setDiscounts(data);
                }
            } catch (e) {
                console.error('Failed to load auto discounts', e);
            }
        })();
    }, []);

    const handleCreate = async () => {
        if (!newDiscount.name || !newDiscount.condition_value || !newDiscount.discount_value) {
            onToast('Ошибка', 'Заполните все поля', 'error');
            return;
        }
        try {
            await apiFetch('/panel/auto-discounts', {
                method: 'POST',
                body: JSON.stringify(newDiscount),
            });
            onToast('Успех', 'Правило создано', 'success');
            setShowCreateModal(false);
            setNewDiscount({ name: '', condition_type: 'payment_amount', condition_value: '', discount_type: 'percent', discount_value: '', is_active: true });
            const data = await apiFetch('/panel/auto-discounts');
            if (Array.isArray(data)) setDiscounts(data);
        } catch (e: any) {
            onToast('Ошибка', 'Не удалось создать правило', 'error');
        }
    };

    return (
        <>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-800 flex justify-between items-center">
                    <h3 className="text-lg font-bold text-white">Автоматические правила</h3>
                    <button 
                        onClick={() => setShowCreateModal(true)}
                        className="text-orange-400 text-sm hover:underline font-medium"
                    >
                        + Добавить правило
                    </button>
                </div>
                <table className="w-full text-left">
                    <thead>
                        <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase">
                            <th className="px-6 py-4">Название</th>
                            <th className="px-6 py-4">Условие</th>
                            <th className="px-6 py-4">Бонус</th>
                            <th className="px-6 py-4">Статус</th>
                            <th className="px-6 py-4 text-right"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800">
                        {discounts.length === 0 ? (
                            <tr>
                                <td colSpan={5} className="px-6 py-8 text-center text-gray-500">
                                    Нет правил. Создайте первое правило.
                                </td>
                            </tr>
                        ) : (
                            discounts.map((d) => (
                                <tr key={d.id}>
                                    <td className="px-6 py-4 text-white font-medium">{d.name}</td>
                                    <td className="px-6 py-4 text-gray-400 text-sm">
                                        {d.condition_type === 'payment_amount' && `Пополнение > ${d.condition_value}₽`}
                                        {d.condition_type === 'payment_method' && `Оплата через ${d.condition_value}`}
                                        {d.condition_type === 'plan_type' && `Покупка тарифа "${d.condition_value}"`}
                                    </td>
                                    <td className="px-6 py-4 text-green-400 font-bold">
                                        {d.discount_type === 'percent' ? `+${d.discount_value}%` : `+${d.discount_value}₽`}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2 py-0.5 rounded text-xs border ${
                                            d.is_active 
                                                ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                                                : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                        }`}>
                                            {d.is_active ? 'Активна' : 'Неактивна'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button 
                                            onClick={async () => {
                                                try {
                                                    await apiFetch(`/panel/auto-discounts/${d.id}`, { method: 'DELETE' });
                                                    onToast('Успех', 'Правило удалено', 'success');
                                                    const data = await apiFetch('/panel/auto-discounts');
                                                    if (Array.isArray(data)) setDiscounts(data);
                                                } catch (e) {
                                                    onToast('Ошибка', 'Не удалось удалить правило', 'error');
                                                }
                                            }}
                                            className="text-red-500 hover:text-red-400"
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {showCreateModal && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl relative" onClick={e => e.stopPropagation()}>
                        <div className="p-5 border-b border-gray-800 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white">Создать правило</h3>
                            <button onClick={() => setShowCreateModal(false)} className="text-gray-400 hover:text-white"><X size={24} /></button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Название</label>
                                <input 
                                    type="text"
                                    value={newDiscount.name}
                                    onChange={e => setNewDiscount({ ...newDiscount, name: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                    placeholder="Бонус за крипту"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Тип условия</label>
                                <select 
                                    value={newDiscount.condition_type}
                                    onChange={e => setNewDiscount({ ...newDiscount, condition_type: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                >
                                    <option value="payment_amount">Сумма пополнения</option>
                                    <option value="payment_method">Способ оплаты</option>
                                    <option value="plan_type">Тип тарифа</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Значение условия</label>
                                <input 
                                    type="text"
                                    value={newDiscount.condition_value}
                                    onChange={e => setNewDiscount({ ...newDiscount, condition_value: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                    placeholder={newDiscount.condition_type === 'payment_amount' ? '1000' : newDiscount.condition_type === 'payment_method' ? 'crypto' : '1 год'}
                                />
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Тип бонуса</label>
                                <select 
                                    value={newDiscount.discount_type}
                                    onChange={e => setNewDiscount({ ...newDiscount, discount_type: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                >
                                    <option value="percent">Процент (%)</option>
                                    <option value="fixed">Фиксированная сумма (₽)</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Значение бонуса</label>
                                <input 
                                    type="text"
                                    value={newDiscount.discount_value}
                                    onChange={e => setNewDiscount({ ...newDiscount, discount_value: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white"
                                    placeholder="10"
                                />
                            </div>
                        </div>
                        <div className="p-5 border-t border-gray-800">
                            <button onClick={handleCreate} className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold">
                                Создать правило
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const PublicPages: React.FC<PublicPagesProps> = ({ onToast }) => {
    const [activeTab, setActiveTab] = useState<'offer' | 'privacy'>('offer');
    const [content, setContent] = useState('');
    const [lastUpdated, setLastUpdated] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/public-pages');
                if (data) {
                    setContent(data[activeTab]?.content || '');
                    setLastUpdated(data[activeTab]?.updated_at || null);
                }
            } catch (e) {
                console.error('Failed to load public pages', e);
            } finally {
                setLoading(false);
            }
        })();
    }, []);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/public-pages');
                if (data && data[activeTab]) {
                    setContent(data[activeTab].content || '');
                    setLastUpdated(data[activeTab].updated_at || null);
                }
            } catch (e) {
                console.error('Failed to load public page', e);
            }
        })();
    }, [activeTab]);

    const handleSave = async () => {
        try {
            await apiFetch(`/panel/public-pages/${activeTab}`, {
                method: 'PUT',
                body: JSON.stringify({ content }),
            });
            onToast('Сохранено', 'Документ успешно обновлен и синхронизирован с мини-приложением', 'success');
            setLastUpdated(new Date().toISOString());
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить документ', 'error');
        }
    };

    if (loading) {
        return (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-center h-64"><Loader className="animate-spin text-orange-500" size={32} /></div>
            </div>
        );
    }

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
                        {activeTab === 'offer' ? <FileTextIcon size={20} className="mr-2 text-orange-500"/> : <Shield size={20} className="mr-2 text-green-500"/>}
                        {activeTab === 'offer' ? 'Редактор оферты' : 'Редактор политики'}
                    </h3>
                    <div className="text-xs text-gray-500 flex items-center">
                        <Clock size={12} className="mr-1"/> 
                        Последнее сохранение: {lastUpdated ? new Date(lastUpdated).toLocaleString('ru-RU') : 'Никогда'}
                    </div>
                </div>
                <textarea 
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    className="flex-1 w-full bg-gray-950 border border-gray-700 rounded-xl p-6 text-gray-300 font-mono text-sm leading-relaxed focus:outline-none focus:border-orange-500 resize-none mb-4" 
                    placeholder={activeTab === 'offer' ? "# Договор оферты\n\n1. Общие положения..." : "# Политика конфиденциальности\n\n1. Сбор данных..."} 
                />
                <div className="flex justify-end">
                    <button onClick={handleSave} className="px-6 py-2.5 bg-orange-600 hover:bg-orange-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-orange-900/20 transition-all flex items-center">
                        <FileCheck size={18} className="mr-2" /> Сохранить изменения
                    </button>
                </div>
            </div>
        </div>
    );
};

// Компонент настроек подписок с загрузкой сквадов из Remnawave
const SubscriptionSettingsTab: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [squads, setSquads] = useState<any[]>([]);
    const [vpnSquads, setVpnSquads] = useState<string[]>([]);
    const [trialEnabled, setTrialEnabled] = useState(true);
    const [trialHours, setTrialHours] = useState('24');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            // Загружаем сквады из Remnawave
            const squadsData = await apiFetch('/panel/remnawave/squads');
            if (Array.isArray(squadsData)) {
                setSquads(squadsData);
            }
            
            // Загружаем сохраненные сквады по умолчанию
            const defaultSquadsData = await apiFetch('/panel/default-squads');
            if (defaultSquadsData) {
                if (Array.isArray(defaultSquadsData.vpn_squads)) {
                    setVpnSquads(defaultSquadsData.vpn_squads);
                }
            }
        } catch (e) {
            console.error('Failed to load squads:', e);
            onToast('Предупреждение', 'Не удалось загрузить сквады из Remnawave', 'info');
        }
        setLoading(false);
    };

    const toggleSquad = (uuid: string) => {
        setVpnSquads(prev => 
            prev.includes(uuid) ? prev.filter(s => s !== uuid) : [...prev, uuid]
        );
    };

    const saveSquads = async () => {
        setSaving(true);
        try {
            await apiFetch('/panel/default-squads', {
                method: 'PUT',
                body: JSON.stringify({ 
                    vpn_squads: vpnSquads
                })
            });
            onToast('Успешно', 'Сквады сохранены', 'success');
        } catch (e) {
            console.error('Failed to save default squads:', e);
            onToast('Ошибка', 'Не удалось сохранить сквады', 'error');
        }
        setSaving(false);
    };

    const syncWithRemnawave = async () => {
        setSyncing(true);
        try {
            const result = await apiFetch('/panel/remnawave/sync', { method: 'POST' });
            if (result.success) {
                onToast('Синхронизация', `Удалено ключей: ${result.deleted_keys}`, 'success');
            } else {
                onToast('Ошибка', result.error || 'Ошибка синхронизации', 'error');
            }
        } catch (e) {
            console.error('Failed to sync with Remnawave:', e);
            onToast('Ошибка', 'Не удалось синхронизировать с Remnawave', 'error');
        }
        setSyncing(false);
    };

    const SquadSelector = ({ title, description, selectedSquads, color }: { 
        title: string, description: string, selectedSquads: string[], color: string 
    }) => (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
            <p className="text-sm text-gray-400 mb-4">{description}</p>
            {loading ? (
                <div className="flex items-center justify-center py-4">
                    <Loader className="animate-spin text-orange-500" size={20} />
                    <span className="ml-2 text-gray-400">Загрузка...</span>
                </div>
            ) : squads.length === 0 ? (
                <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
                    Сквады не найдены
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {squads.map(sq => (
                        <label 
                            key={sq.uuid} 
                            className={`flex items-center space-x-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                                selectedSquads.includes(sq.uuid) 
                                    ? 'bg-orange-600/20 border-orange-500 shadow-lg shadow-orange-900/20' 
                                    : 'bg-gray-950 border-gray-700 hover:border-gray-600'
                            }`}
                            style={selectedSquads.includes(sq.uuid) ? {
                                backgroundColor: 'rgba(249, 115, 22, 0.2)',
                                borderColor: '#f97316'
                            } : {}}
                            onClick={() => toggleSquad(sq.uuid)}
                        >
                            <input 
                                type="checkbox" 
                                checked={selectedSquads.includes(sq.uuid)}
                                onChange={() => {}}
                                className="w-4 h-4 rounded bg-gray-800 border-gray-600 cursor-pointer" 
                            />
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-200 block truncate">{sq.name}</span>
                                <span className="text-xs text-gray-500">{sq.members_count || 0} участников</span>
                            </div>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-6 border-b border-gray-800 pb-4">Пробный период</h3>
                <div className="space-y-6">
                    <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                        <span className="text-gray-300 font-medium">Включить пробный период</span>
                        <button onClick={() => setTrialEnabled(!trialEnabled)} className={`w-12 h-6 rounded-full p-1 transition-colors relative ${trialEnabled ? 'bg-orange-600' : 'bg-gray-700'}`}>
                            <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${trialEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                        </button>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-2">Длительность (часов)</label>
                        <input 
                            type="number" 
                            value={trialHours}
                            onChange={e => setTrialHours(e.target.value)}
                            className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors" 
                            placeholder="24" 
                        />
                    </div>
                </div>
            </div>
            
            <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-white">Балансировщик сквадов</h3>
                <button 
                    onClick={saveSquads}
                    disabled={saving}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center"
                >
                    {saving && <Loader className="animate-spin mr-2" size={14} />}
                    Сохранить
                </button>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <div className="flex items-start gap-3 p-4 bg-orange-900/20 border border-orange-500/30 rounded-xl mb-4">
                    <Zap className="text-orange-400 shrink-0 mt-0.5" size={20} />
                    <div>
                        <div className="text-orange-400 font-bold mb-1">Автоматический балансировщик</div>
                        <div className="text-orange-300 text-sm">
                            При создании ключа система автоматически выберет сквад с наименьшим количеством пользователей из выбранных ниже. 
                            Если сквады не выбраны — будет использован сквад с минимальной нагрузкой из всех доступных.
                        </div>
                    </div>
                </div>
            </div>
            
            <SquadSelector 
                title="🔒 Сквады для подписок" 
                description="Выберите сквады для единой подписки (VPN + обход блокировок)"
                selectedSquads={vpnSquads}
                color="blue"
            />
            
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-white mb-2">Синхронизация с Remnawave</h3>
                <p className="text-sm text-gray-400 mb-4">
                    Удалить из БД бота ключи, которые были удалены из Remnawave
                </p>
                <button 
                    onClick={syncWithRemnawave}
                    disabled={syncing}
                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:bg-gray-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center"
                >
                    {syncing && <Loader className="animate-spin mr-2" size={14} />}
                    {syncing ? 'Синхронизация...' : '🔄 Синхронизировать'}
                </button>
            </div>
        </div>
    );
};

// Компонент настроек резервного копирования
const BackupSettingsTab: React.FC<{ onToast: (title: string, msg: string, type: ToastType) => void }> = ({ onToast }) => {
    const [backupEnabled, setBackupEnabled] = useState(false);
    const [backupInterval, setBackupInterval] = useState('12');
    const [lastBackup, setLastBackup] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);

    useEffect(() => {
        loadBackupStatus();
    }, []);

    const loadBackupStatus = async () => {
        try {
            const data = await apiFetch('/panel/backups/status');
            if (data) {
                setBackupEnabled(data.enabled || false);
                setBackupInterval(data.interval_hours?.toString() || '12');
                setLastBackup(data.last_backup || null);
            }
        } catch (e) {
            console.error('Failed to load backup status', e);
        }
    };

    const handleCreateBackup = async () => {
        setCreating(true);
        try {
            await apiFetch('/panel/backups/create', { method: 'POST' });
            onToast('Успех', 'Резервная копия создана и отправлена администратору', 'success');
            loadBackupStatus();
        } catch (e) {
            onToast('Ошибка', 'Не удалось создать резервную копию', 'error');
        }
        setCreating(false);
    };

    const handleSaveSettings = async () => {
        try {
            await apiFetch('/panel/backups/settings', {
                method: 'PUT',
                body: JSON.stringify({ enabled: backupEnabled, interval_hours: parseInt(backupInterval) })
            });
            onToast('Успех', 'Настройки бекапов сохранены', 'success');
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить настройки', 'error');
        }
    };

    return (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 mb-6">
            <h3 className="text-lg font-bold text-white mb-6 border-b border-gray-800 pb-4">Резервное копирование</h3>
            <div className="space-y-6">
                <div className="flex justify-between items-center p-4 bg-gray-950 rounded-xl border border-gray-800">
                    <div>
                        <span className="text-gray-300 font-medium">Автоматическое резервное копирование</span>
                        <p className="text-xs text-gray-500 mt-1">Бекапы будут создаваться автоматически и отправляться администратору</p>
                    </div>
                    <button onClick={() => setBackupEnabled(!backupEnabled)} className={`w-12 h-6 rounded-full p-1 transition-colors relative ${backupEnabled ? 'bg-orange-600' : 'bg-gray-700'}`}>
                        <div className={`w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${backupEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
                    </button>
                </div>
                
                <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Частота создания бэкапов (в часах)</label>
                    <input 
                        type="number" 
                        value={backupInterval}
                        onChange={e => setBackupInterval(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-orange-500 transition-colors" 
                        placeholder="12" 
                    />
                </div>

                {lastBackup && (
                    <div className="p-3 bg-gray-950 rounded-xl border border-gray-800">
                        <span className="text-gray-500 text-sm">Последний бекап: </span>
                        <span className="text-white text-sm">{new Date(lastBackup).toLocaleString('ru-RU')}</span>
                    </div>
                )}

                <div className="p-4 bg-orange-900/20 border border-orange-500/30 rounded-xl flex items-start">
                    <Cloud className="text-orange-400 mr-3 mt-0.5" size={20} />
                    <div>
                        <h4 className="text-orange-400 font-bold text-sm">Важно</h4>
                        <p className="text-orange-300/80 text-xs mt-1">Бэкапы будут отправляться в личные сообщения администратору в виде архива базы данных.</p>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button 
                        onClick={handleCreateBackup}
                        disabled={creating}
                        className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white rounded-xl font-medium transition-colors flex items-center justify-center"
                    >
                        {creating ? <Loader className="animate-spin mr-2" size={18} /> : <Download size={18} className="mr-2" />}
                        Создать бекап сейчас
                    </button>
                    <button 
                        onClick={handleSaveSettings}
                        className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-medium transition-colors flex items-center justify-center"
                    >
                        <Save size={18} className="mr-2" />
                        Сохранить настройки
                    </button>
                </div>
            </div>
        </div>
    );
};

// ==========================================
// SQUADS PAGE - Управление сквадами
// ==========================================

interface SquadsPageProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

interface SquadConfig {
    id: number;
    squad_uuid: string;
    squad_name: string;
    squad_type: string;
    max_users: number;
    current_users: number;
    is_active: boolean;
    priority: number;
}

const SquadsPage: React.FC<SquadsPageProps> = ({ onToast }) => {
    const [squads, setSquads] = useState<SquadConfig[]>([]);
    const [mapping, setMapping] = useState<{vpn: string[], trial: string[]}>({vpn: [], trial: []});
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [editingSquad, setEditingSquad] = useState<SquadConfig | null>(null);

    const loadSquads = async () => {
        try {
            const data = await apiFetch('/panel/squads');
            if (data) {
                setSquads(data.squads || []);
                setMapping({vpn: data.mapping?.vpn || [], trial: data.mapping?.trial || []});
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось загрузить сквады', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadSquads(); }, []);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await apiFetch('/panel/squads/sync', { method: 'POST' });
            if (result?.success) {
                onToast('Успех', `Синхронизировано ${result.count} сквадов`, 'success');
                loadSquads();
            } else {
                onToast('Ошибка', result?.error || 'Ошибка синхронизации', 'error');
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось синхронизировать', 'error');
        } finally {
            setSyncing(false);
        }
    };

    const handleSaveSquad = async (squad: SquadConfig) => {
        try {
            const result = await apiFetch(`/panel/squads/${squad.squad_uuid}`, {
                method: 'PUT',
                body: JSON.stringify({
                    squad_name: squad.squad_name,
                    squad_type: squad.squad_type,
                    max_users: squad.max_users,
                    priority: squad.priority,
                    is_active: squad.is_active
                })
            });
            if (result?.success) {
                onToast('Успех', 'Сквад обновлён', 'success');
                setEditingSquad(null);
                loadSquads();
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить', 'error');
        }
    };

    const handleSaveMapping = async () => {
        try {
            const result = await apiFetch('/panel/squads/mapping', {
                method: 'PUT',
                body: JSON.stringify(mapping)
            });
            if (result?.success) {
                onToast('Успех', 'Привязки сохранены', 'success');
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось сохранить привязки', 'error');
        }
    };

    const toggleSquadMapping = (type: 'vpn' | 'trial', uuid: string) => {
        setMapping(prev => {
            const current = prev[type] || [];
            if (current.includes(uuid)) {
                return { ...prev, [type]: current.filter(u => u !== uuid) };
            } else {
                return { ...prev, [type]: [...current, uuid] };
            }
        });
    };

    const getSquadTypeColor = (type: string) => {
        switch(type) {
            case 'vpn': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
            case 'trial': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
            default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
        }
    };

    if (loading) {
        return <div className="flex items-center justify-center h-64"><Loader className="animate-spin text-orange-500" size={32} /></div>;
    }

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-white">Сквады (Распределение нагрузки)</h1>
                    <p className="text-gray-400 mt-1">Управление распределением пользователей по серверам</p>
                </div>
                <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="flex items-center px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 text-white rounded-lg font-medium transition-colors"
                >
                    {syncing ? <Loader className="animate-spin mr-2" size={18} /> : <RefreshCw size={18} className="mr-2" />}
                    Синхронизировать с Remnawave
                </button>
            </div>

            {/* Squads Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {squads.map(squad => (
                    <div 
                        key={squad.squad_uuid} 
                        className={`bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-700 transition-all ${!squad.is_active ? 'opacity-50' : ''}`}
                    >
                        <div className="flex justify-between items-start mb-3">
                            <div>
                                <h3 className="font-bold text-white">{squad.squad_name}</h3>
                                <span className={`inline-block mt-1 px-2 py-0.5 text-xs font-medium rounded border ${getSquadTypeColor(squad.squad_type)}`}>
                                    {squad.squad_type.toUpperCase()}
                                </span>
                            </div>
                            <button 
                                onClick={() => setEditingSquad(squad)}
                                className="text-gray-400 hover:text-white p-1"
                            >
                                <Edit2 size={16} />
                            </button>
                        </div>
                        
                        <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Пользователей:</span>
                                <span className="text-white font-medium">
                                    {squad.current_users} {squad.max_users > 0 && `/ ${squad.max_users}`}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-400">Приоритет:</span>
                                <span className="text-white">{squad.priority}</span>
                            </div>
                            {squad.max_users > 0 && (
                                <div className="w-full bg-gray-800 rounded-full h-2 mt-2">
                                    <div 
                                        className="bg-orange-500 h-2 rounded-full transition-all"
                                        style={{ width: `${Math.min(100, (squad.current_users / squad.max_users) * 100)}%` }}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {squads.length === 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                    <Zap size={48} className="mx-auto text-gray-600 mb-4" />
                    <h3 className="text-lg font-bold text-white mb-2">Нет сквадов</h3>
                    <p className="text-gray-400 mb-4">Синхронизируйте сквады с Remnawave</p>
                    <button onClick={handleSync} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium">
                        Синхронизировать
                    </button>
                </div>
            )}

            {/* Squad Mapping */}
            {squads.length > 0 && (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                    <h2 className="text-lg font-bold text-white mb-4">Привязка сквадов к типам подписок</h2>
                    <p className="text-gray-400 text-sm mb-6">
                        Выберите, на какие сквады будут распределяться пользователи для каждого типа подписки.
                        Система автоматически выберет сквад с наименьшей нагрузкой.
                    </p>
                    
                    <div className="space-y-6">
                        {(['vpn', 'trial'] as const).map(type => (
                            <div key={type}>
                                <h3 className="font-medium text-white mb-3 flex items-center">
                                    <span className={`w-3 h-3 rounded-full mr-2 ${
                                        type === 'vpn' ? 'bg-orange-500' : 'bg-yellow-500'
                                    }`} />
                                    {type === 'vpn' ? 'Подписка (VPN + обход блокировок)' : 'Пробный период'}
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {squads.filter(s => s.is_active).map(squad => (
                                        <button
                                            key={squad.squad_uuid}
                                            onClick={() => toggleSquadMapping(type, squad.squad_uuid)}
                                            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                                                mapping[type]?.includes(squad.squad_uuid)
                                                    ? 'bg-orange-600 border-orange-500 text-white'
                                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600'
                                            }`}
                                        >
                                            {squad.squad_name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <button 
                        onClick={handleSaveMapping}
                        className="mt-6 px-6 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium transition-colors"
                    >
                        Сохранить привязки
                    </button>
                </div>
            )}

            {/* Edit Squad Modal */}
            {editingSquad && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setEditingSquad(null)}>
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
                        <h2 className="text-xl font-bold text-white mb-4">Редактирование сквада</h2>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Название</label>
                                <input
                                    type="text"
                                    value={editingSquad.squad_name}
                                    onChange={e => setEditingSquad({...editingSquad, squad_name: e.target.value})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Тип</label>
                                <select
                                    value={editingSquad.squad_type}
                                    onChange={e => setEditingSquad({...editingSquad, squad_type: e.target.value})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                >
                                    <option value="vpn">Подписка (VPN + обход)</option>
                                    <option value="trial">Trial (пробный)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Макс. пользователей (0 = без лимита)</label>
                                <input
                                    type="number"
                                    value={editingSquad.max_users}
                                    onChange={e => setEditingSquad({...editingSquad, max_users: parseInt(e.target.value) || 0})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-400 mb-2">Приоритет</label>
                                <input
                                    type="number"
                                    value={editingSquad.priority}
                                    onChange={e => setEditingSquad({...editingSquad, priority: parseInt(e.target.value) || 0})}
                                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white"
                                />
                            </div>
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    checked={editingSquad.is_active}
                                    onChange={e => setEditingSquad({...editingSquad, is_active: e.target.checked})}
                                    className="mr-2"
                                />
                                <label className="text-gray-400">Активен</label>
                            </div>
                        </div>

                        <div className="flex gap-3 mt-6">
                            <button
                                onClick={() => setEditingSquad(null)}
                                className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                            >
                                Отмена
                            </button>
                            <button
                                onClick={() => handleSaveSquad(editingSquad)}
                                className="flex-1 px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-500 transition-colors"
                            >
                                Сохранить
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ===== TOOLS PAGE =====
interface ToolsPageProps {
    onToast: (title: string, msg: string, type: ToastType) => void;
}

const ToolsPage: React.FC<ToolsPageProps> = ({ onToast }) => {
    const [exporting, setExporting] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [diagnostics, setDiagnostics] = useState<any>(null);
    const [loadingDiag, setLoadingDiag] = useState(false);

    const exportData = async (type: 'users' | 'keys' | 'transactions') => {
        setExporting(type);
        try {
            const res = await apiFetch(`/panel/export/${type}`);
            if (res && res.data) {
                const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${type}_export_${new Date().toISOString().slice(0,10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                onToast('Успех', `Экспортировано ${res.data.length} записей`, 'success');
            }
        } catch (e: any) {
            onToast('Ошибка', e.message || 'Не удалось экспортировать', 'error');
        } finally {
            setExporting(null);
        }
    };

    const runDiagnostics = async () => {
        setLoadingDiag(true);
        try {
            const res = await apiFetch('/panel/diagnostics');
            setDiagnostics(res);
        } catch (e) {
            onToast('Ошибка', 'Не удалось получить диагностику', 'error');
        } finally {
            setLoadingDiag(false);
        }
    };

    const syncRemnawave = async () => {
        setSyncing(true);
        try {
            const res = await apiFetch('/panel/remnawave/sync', { method: 'POST' });
            if (res?.success) {
                onToast('Успех', `Синхронизировано: ${res.synced || 0} ключей`, 'success');
            }
        } catch (e) {
            onToast('Ошибка', 'Не удалось синхронизировать', 'error');
        } finally {
            setSyncing(false);
        }
    };

    const cleanupExpired = async () => {
        if (!confirm('Удалить все истёкшие ключи старше 30 дней?')) return;
        try {
            const res = await apiFetch('/panel/tools/cleanup-expired', { method: 'POST' });
            onToast('Успех', `Удалено ${res?.deleted || 0} истёкших ключей`, 'success');
        } catch (e) {
            onToast('Ошибка', 'Не удалось выполнить очистку', 'error');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
                <h2 className="text-2xl font-bold text-white">Инструменты</h2>
                <p className="text-gray-400 mt-1">Полезные утилиты для администрирования</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Экспорт данных */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-orange-600/20 flex items-center justify-center">
                            <Download size={20} className="text-orange-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Экспорт данных</h3>
                            <p className="text-gray-500 text-sm">Скачать данные в JSON</p>
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => exportData('users')} disabled={!!exporting} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                            {exporting === 'users' ? <Loader size={14} className="animate-spin mx-auto" /> : 'Пользователи'}
                        </button>
                        <button onClick={() => exportData('keys')} disabled={!!exporting} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                            {exporting === 'keys' ? <Loader size={14} className="animate-spin mx-auto" /> : 'Ключи'}
                        </button>
                        <button onClick={() => exportData('transactions')} disabled={!!exporting} className="px-3 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
                            {exporting === 'transactions' ? <Loader size={14} className="animate-spin mx-auto" /> : 'Транзакции'}
                        </button>
                    </div>
                </div>

                {/* Синхронизация */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-green-600/20 flex items-center justify-center">
                            <RefreshCw size={20} className="text-green-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Синхронизация</h3>
                            <p className="text-gray-500 text-sm">Обновить данные из Remnawave</p>
                        </div>
                    </div>
                    <button onClick={syncRemnawave} disabled={syncing} className="w-full px-4 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                        {syncing ? <Loader size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {syncing ? 'Синхронизация...' : 'Синхронизировать ключи'}
                    </button>
                </div>

                {/* Очистка */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-red-600/20 flex items-center justify-center">
                            <Trash2 size={20} className="text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Очистка данных</h3>
                            <p className="text-gray-500 text-sm">Удалить устаревшие записи</p>
                        </div>
                    </div>
                    <button onClick={cleanupExpired} className="w-full px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 border border-red-500/30 rounded-xl font-medium transition-colors">
                        Удалить истёкшие ключи (30+ дней)
                    </button>
                </div>

                {/* Диагностика */}
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-purple-600/20 flex items-center justify-center">
                            <Activity size={20} className="text-purple-400" />
                        </div>
                        <div>
                            <h3 className="text-white font-bold">Диагностика</h3>
                            <p className="text-gray-500 text-sm">Проверка состояния системы</p>
                        </div>
                    </div>
                    <button onClick={runDiagnostics} disabled={loadingDiag} className="w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                        {loadingDiag ? <Loader size={16} className="animate-spin" /> : <Activity size={16} />}
                        Запустить диагностику
                    </button>
                </div>
            </div>

            {/* Результаты диагностики */}
            {diagnostics && (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                    <h3 className="text-white font-bold mb-4">Результаты диагностики</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-white">{diagnostics.users_count || 0}</div>
                            <div className="text-gray-400 text-sm">Пользователей</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-white">{diagnostics.keys_count || 0}</div>
                            <div className="text-gray-400 text-sm">Ключей</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-white">{diagnostics.active_keys || 0}</div>
                            <div className="text-gray-400 text-sm">Активных ключей</div>
                        </div>
                        <div className="bg-gray-800 rounded-xl p-4">
                            <div className="text-2xl font-bold text-green-400">{diagnostics.remnawave_status || 'N/A'}</div>
                            <div className="text-gray-400 text-sm">Remnawave</div>
                        </div>
                    </div>
                    {diagnostics.issues && diagnostics.issues.length > 0 && (
                        <div className="mt-4 bg-red-600/10 border border-red-500/30 rounded-xl p-4">
                            <div className="text-red-400 font-bold mb-2">Обнаружены проблемы:</div>
                            <ul className="text-red-300 text-sm space-y-1">
                                {diagnostics.issues.map((issue: string, i: number) => (
                                    <li key={i}>• {issue}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

import { usePanel } from '../context/PanelContext';

export default function Settings() {
  const { addToast: onToast } = usePanel();
    const [activeTab, setActiveTab] = useState<'squads' | 'backups'>('squads');

    return (
        <div className="flex flex-col lg:flex-row gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Sidebar */}
            <div className="w-full lg:w-64 flex-shrink-0">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden sticky top-24">
                    <div className="p-4 border-b border-gray-800"><h2 className="font-bold text-white">Категории</h2></div>
                    <nav className="p-2 space-y-1">
                        {[{id: 'squads', icon: Zap, label: 'Сквады'}, {id: 'backups', icon: Cloud, label: 'Резервные копии'}].map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`w-full flex items-center px-4 py-3 text-sm font-medium rounded-xl transition-colors ${activeTab === tab.id ? 'bg-orange-600/10 text-orange-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}>
                                <tab.icon size={18} className="mr-3"/> {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1">
                {activeTab === 'squads' && (
                    <SquadsPage onToast={onToast} />
                )}

                {activeTab === 'backups' && (
                    <BackupSettingsTab onToast={onToast} />
                )}
            </div>
        </div>
    );
};
