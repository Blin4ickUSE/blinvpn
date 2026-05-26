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

import { usePanel } from '../context/PanelContext';

export default function Newsletter() {
  const { addToast: onToast } = usePanel();
    const [stats, setStats] = useState<{
        totalSent: number;
    } | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [selectedHistoryItem, setSelectedHistoryItem] = useState<any | null>(null);
    const [message, setMessage] = useState('');
    const [buttonType, setButtonType] = useState<string>('');
    const [buttonValue, setButtonValue] = useState('');
    const [imageUrl, setImageUrl] = useState('');
    const [targetUsers, setTargetUsers] = useState('all');

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/mailing/stats');
                if (data) {
                    setStats(data);
                }
            } catch (e) {
                console.error('Failed to load mailing stats', e);
            }
        })();

        (async () => {
            try {
                const data = await apiFetch('/panel/mailing/history');
                if (Array.isArray(data)) {
                    setHistory(data);
                }
            } catch (e) {
                console.error('Failed to load mailing history', e);
            }
        })();
    }, []);

    const handleSend = async () => {
        if (!message.trim()) {
            onToast('Ошибка', 'Введите текст сообщения', 'error');
            return;
        }
        if (!confirm('Подтвердить отправку рассылки?')) return;
        try {
            const payload: any = {
                message,
                target_users: targetUsers,
                title: message.substring(0, 50)
            };
            if (buttonType && buttonValue) {
                payload.button_type = buttonType;
                payload.button_value = buttonValue;
            }
            if (imageUrl.trim()) {
                payload.image_url = imageUrl.trim();
            }
            await apiFetch('/panel/mailing', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            onToast('Рассылка', 'Сообщения поставлены в очередь', 'success');
            setMessage('');
            setButtonType('');
            setButtonValue('');
            setImageUrl('');
            // Обновляем статистику и историю
            const statsData = await apiFetch('/panel/mailing/stats');
            if (statsData) setStats(statsData);
            const historyData = await apiFetch('/panel/mailing/history');
            if (Array.isArray(historyData)) setHistory(historyData);
        } catch (e: any) {
            onToast('Ошибка', 'Не удалось отправить рассылку', 'error');
        }
    };

    const buttonTypes = [
        { value: '', label: 'Без кнопки' },
        { value: 'external_link', label: 'Сторонняя ссылка' },
        { value: 'open_miniapp', label: 'Открыть мини-приложение' },
        { value: 'activate_promo', label: 'Активировать промокод' },
        { value: 'add_balance', label: 'Добавить баланс' },
    ];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
             <div className="flex flex-col md:flex-row md:items-center justify-between gap-4"><div><h2 className="text-2xl font-bold text-white">Рассылка</h2><p className="text-gray-400 mt-1">Массовая отправка сообщений пользователям</p></div></div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard 
                    title="Отправлено сообщений" 
                    value={stats ? stats.totalSent.toLocaleString('ru-RU') : '—'} 
                    icon={Send} 
                    color="blue" 
                />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                        <h3 className="text-lg font-bold text-gray-200 mb-4 flex items-center"><Plus size={20} className="mr-2 text-orange-500"/> Новая рассылка</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Текст сообщения</label>
                                <textarea 
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl p-4 text-white focus:outline-none focus:border-orange-500 h-32 resize-none" 
                                    placeholder="Введите текст рассылки... Поддерживается Markdown"
                                />
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="text-sm text-gray-400 mb-1.5 block">Тип кнопки</label>
                                    <select 
                                        value={buttonType}
                                        onChange={(e) => setButtonType(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-orange-500"
                                    >
                                        {buttonTypes.map(bt => (
                                            <option key={bt.value} value={bt.value}>{bt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-sm text-gray-400 mb-1.5 block">Значение</label>
                                    <input 
                                        type="text" 
                                        value={buttonValue}
                                        onChange={(e) => setButtonValue(e.target.value)}
                                        className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-orange-500" 
                                        placeholder={buttonType === 'external_link' ? 'https://example.com' : buttonType === 'activate_promo' ? 'PROMOCODE' : buttonType === 'add_balance' ? '100' : 'Введите значение...'}
                                        disabled={!buttonType}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-1.5 block">Картинка (URL, опционально)</label>
                                <input
                                    type="text"
                                    value={imageUrl}
                                    onChange={(e) => setImageUrl(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-orange-500"
                                    placeholder="https://.../image.jpg"
                                />
                                <div className="text-xs text-gray-500 mt-1">
                                    Форматирование: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;, а также **жирный**, *курсив*, `моно`; premium-emoji: ![ID_эмодзи]
                                </div>
                            </div>
                            <div>
                                <label className="text-sm text-gray-400 mb-2 block">Получатели</label>
                                <div className="flex flex-wrap gap-2">
                                    {['all', 'active', 'expired', 'no_subscription'].map(filter => (
                                        <button 
                                            key={filter}
                                            onClick={() => setTargetUsers(filter)}
                                            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                                                targetUsers === filter 
                                                    ? 'bg-orange-600 text-white border-orange-500' 
                                                    : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700'
                                            }`}
                                        >
                                            {filter === 'all' ? 'Все пользователи' : 
                                             filter === 'active' ? 'Активные' :
                                             filter === 'expired' ? 'Истекшие' : 'Без подписки'}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="pt-2 flex gap-4">
                                <button 
                                    onClick={handleSend} 
                                    className="flex-1 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold shadow-lg shadow-orange-900/20 transition-colors flex justify-center items-center"
                                >
                                    <Send size={18} className="mr-2" /> Отправить
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden flex flex-col max-h-[600px]">
                    <div className="p-5 border-b border-gray-800"><h3 className="text-lg font-bold text-gray-200">История</h3></div>
                    <div className="overflow-y-auto custom-scrollbar flex-1">
                        {history.length === 0 ? (
                            <div className="p-4 text-center text-gray-500">Нет рассылок</div>
                        ) : (
                            history.map((item) => (
                                <div key={item.id} className="p-4 border-b border-gray-800 hover:bg-gray-800/30 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-medium text-white line-clamp-1">{item.title || 'Без названия'}</span>
                                        <span className="text-xs text-gray-500 whitespace-nowrap ml-2">{item.date}</span>
                                    </div>
                                    <div className="flex justify-between items-center mt-2">
                                        <span className={`text-xs px-2 py-0.5 rounded border ${
                                            item.status === 'Completed' 
                                                ? 'bg-green-500/10 text-green-400 border-green-500/20' 
                                                : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                                        }`}>
                                            {item.status === 'Completed' ? 'Отправлено' : item.status}
                                        </span>
                                        <span className="text-xs text-gray-400 flex items-center">
                                            <Users size={12} className="mr-1"/> {item.sent_count || 0}
                                        </span>
                                    </div>
                                    <div className="flex gap-2 mt-3">
                                        <button onClick={() => setSelectedHistoryItem(item)} className="text-xs px-2 py-1 rounded bg-orange-600/20 text-orange-300 hover:bg-orange-600/30">Открыть</button>
                                        <button onClick={async () => {
                                            if (!confirm('Удалить рассылку и попытаться удалить сообщения у пользователей?')) return;
                                            try {
                                                await apiFetch(`/panel/mailing/${item.id}`, { method: 'DELETE' });
                                                onToast('Успех', 'Рассылка удалена', 'success');
                                                const historyData = await apiFetch('/panel/mailing/history');
                                                if (Array.isArray(historyData)) setHistory(historyData);
                                            } catch {
                                                onToast('Ошибка', 'Не удалось удалить рассылку', 'error');
                                            }
                                        }} className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-300 hover:bg-red-600/30">Удалить</button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
            {selectedHistoryItem && (
                <div className="fixed inset-0 bg-black/70 z-[70] flex items-center justify-center p-4" onClick={() => setSelectedHistoryItem(null)}>
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-2xl p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold text-white">{selectedHistoryItem.title || 'Текст рассылки'}</h3>
                            <button onClick={() => setSelectedHistoryItem(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
                        </div>
                        <div className="text-gray-200 whitespace-pre-wrap bg-gray-950 border border-gray-800 rounded-xl p-4 max-h-[60vh] overflow-auto">
                            {selectedHistoryItem.message_text || 'Пустое сообщение'}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

