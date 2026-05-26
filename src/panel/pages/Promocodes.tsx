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

import { panelApiFetch as apiFetch } from '../../api/client';
import type { Promo } from '../../core/types';

import { usePanel } from '../context/PanelContext';

export default function Promocodes() {
  const { promos: _promos, addToast: onToast } = usePanel();
    const [promos, setPromos] = useState<Promo[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingPromo, setEditingPromo] = useState<Promo | null>(null);
    const [newPromo, setNewPromo] = useState<{ code: string; type: Promo['type']; value: string; limit: string; expires: string }>({
        code: '',
        type: 'balance',
        value: '',
        limit: '',
        expires: '',
    });

    const loadPromos = async () => {
        setLoading(true);
        try {
            const data = await apiFetch('/panel/promocodes');
            if (Array.isArray(data)) {
                setPromos(
                    data.map((p: any) => ({
                        id: p.id,
                        code: p.code,
                        type: p.type,
                        value: String(p.value ?? ''),
                        uses: Number(p.uses_count || 0),
                        limit: Number(p.uses_limit || 0),
                        expires: String(p.expires_at || ''),
                    }))
                );
            } else {
                setPromos([]);
            }
        } catch {
            onToast('Ошибка', 'Не удалось загрузить промокоды', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPromos();
    }, []);

    const handleCreatePromo = async () => {
        if (!newPromo.code || !newPromo.value) {
            onToast('Ошибка', 'Заполните код и значение промокода', 'error');
            return;
        }
        try {
            await apiFetch('/panel/promocodes', {
                method: 'POST',
                body: JSON.stringify({
                    code: newPromo.code.toUpperCase(),
                    type: newPromo.type,
                    value: newPromo.value,
                    uses_limit: newPromo.limit ? Number(newPromo.limit) : null,
                    expires_at: newPromo.expires || null,
                    is_active: 1,
                }),
            });
            onToast('Успех', 'Промокод создан', 'success');
            setNewPromo({ code: '', type: 'balance', value: '', limit: '', expires: '' });
            await loadPromos();
        } catch {
            onToast('Ошибка', 'Не удалось создать промокод', 'error');
        }
    };

    const handleDeletePromo = async (id: number) => {
        if (!confirm('Удалить промокод?')) return;
        try {
            await apiFetch(`/panel/promocodes/${id}`, { method: 'DELETE' });
            onToast('Успех', 'Промокод удален', 'success');
            await loadPromos();
        } catch {
            onToast('Ошибка', 'Не удалось удалить промокод', 'error');
        }
    };

    const handleSavePromo = async () => {
        if (!editingPromo) return;
        try {
            await apiFetch(`/panel/promocodes/${editingPromo.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                    code: editingPromo.code,
                    type: editingPromo.type,
                    value: editingPromo.value,
                    uses_limit: editingPromo.limit || null,
                    expires_at: editingPromo.expires || null,
                }),
            });
            onToast('Успех', 'Промокод обновлен', 'success');
            setEditingPromo(null);
            await loadPromos();
        } catch {
            onToast('Ошибка', 'Не удалось обновить промокод', 'error');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Промокоды</h2></div>
            <PromocodesStats promos={promos} />
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
                <h3 className="text-lg font-bold text-gray-200 mb-4">Новый промокод</h3>
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                    <input type="text" value={newPromo.code} onChange={e => setNewPromo({ ...newPromo, code: e.target.value.toUpperCase() })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Код" />
                    <select value={newPromo.type} onChange={e => setNewPromo({ ...newPromo, type: e.target.value as Promo['type'] })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"><option value="balance">Баланс</option><option value="discount">Скидка</option><option value="subscription">Подписка</option></select>
                    <input type="text" value={newPromo.value} onChange={e => setNewPromo({ ...newPromo, value: e.target.value })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Значение" />
                    <input type="number" value={newPromo.limit} onChange={e => setNewPromo({ ...newPromo, limit: e.target.value })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Лимит" />
                    <input type="text" value={newPromo.expires} onChange={e => setNewPromo({ ...newPromo, expires: e.target.value })} className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="2026-12-31" />
                </div>
                <button onClick={handleCreatePromo} className="mt-4 px-6 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg">Создать</button>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-gray-800">
                    <h3 className="text-lg font-bold text-gray-200">Список промокодов</h3>
                </div>
                {loading ? (
                    <div className="p-8 text-center text-gray-500">Загрузка...</div>
                ) : promos.length === 0 ? (
                    <div className="p-8 text-center text-gray-500">Промокодов пока нет</div>
                ) : (
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-gray-800/50 text-gray-400 text-xs uppercase">
                                <th className="px-6 py-4">Код</th>
                                <th className="px-6 py-4">Тип</th>
                                <th className="px-6 py-4">Значение</th>
                                <th className="px-6 py-4">Исп.</th>
                                <th className="px-6 py-4">Лимит</th>
                                <th className="px-6 py-4">Срок</th>
                                <th className="px-6 py-4 text-right">Действия</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {promos.map((p) => (
                                <tr key={p.id}>
                                    <td className="px-6 py-4 text-white font-mono">{p.code}</td>
                                    <td className="px-6 py-4 text-gray-300">{p.type}</td>
                                    <td className="px-6 py-4 text-gray-300">{p.value}</td>
                                    <td className="px-6 py-4 text-gray-400">{p.uses}</td>
                                    <td className="px-6 py-4 text-gray-400">{p.limit || '∞'}</td>
                                    <td className="px-6 py-4 text-gray-400">{p.expires || 'Без срока'}</td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="inline-flex gap-2">
                                            <button onClick={() => setEditingPromo({ ...p })} className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg">
                                                <Edit2 size={14} className="text-gray-200" />
                                            </button>
                                            <button onClick={() => handleDeletePromo(p.id)} className="p-2 bg-red-500/20 hover:bg-red-500/30 rounded-lg">
                                                <Trash2 size={14} className="text-red-400" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {editingPromo && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setEditingPromo(null)}>
                    <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-xl font-bold text-white mb-4">Редактировать промокод</h3>
                        <div className="space-y-3">
                            <input type="text" value={editingPromo.code} onChange={e => setEditingPromo({ ...editingPromo, code: e.target.value.toUpperCase() })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Код" />
                            <select value={editingPromo.type} onChange={e => setEditingPromo({ ...editingPromo, type: e.target.value as Promo['type'] })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white">
                                <option value="balance">Баланс</option><option value="discount">Скидка</option><option value="subscription">Подписка</option>
                            </select>
                            <input type="text" value={editingPromo.value} onChange={e => setEditingPromo({ ...editingPromo, value: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Значение" />
                            <input type="number" value={editingPromo.limit || ''} onChange={e => setEditingPromo({ ...editingPromo, limit: Number(e.target.value || 0) })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="Лимит" />
                            <input type="text" value={editingPromo.expires || ''} onChange={e => setEditingPromo({ ...editingPromo, expires: e.target.value })} className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white" placeholder="2026-12-31" />
                        </div>
                        <div className="flex gap-3 mt-5">
                            <button onClick={() => setEditingPromo(null)} className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg">Отмена</button>
                            <button onClick={handleSavePromo} className="flex-1 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg">Сохранить</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

