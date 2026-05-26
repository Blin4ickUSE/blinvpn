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

import { panelApiFetch as apiFetch, BOT_USERNAME } from '../../api/client';

import type {
  ToastType, Transaction, User, KeyItem, Promo, UserStatus, KeyStatus,
} from '../../core/types';

// ==========================================

interface UserActionModalProps {
    type: string;
    onClose: () => void;
    onConfirm: (value: string, notify: boolean) => void;
    initialValue?: string;
}

export const UserActionModal: React.FC<UserActionModalProps> = ({ type, onClose, onConfirm, initialValue = '' }) => {
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
      'EXTEND_SUB': { title: 'Продлить подписку', label: 'Количество дней', icon: Clock, color: 'text-orange-400', type: 'number' },
      'REDUCE_SUB': { title: 'Уменьшить срок', label: 'Количество дней', icon: Clock, color: 'text-orange-400', type: 'number' },
      'SET_TRAFFIC': { title: 'Лимит трафика', label: 'Макс. трафик (GB)', icon: Database, color: 'text-purple-400', type: 'number' },
      'SET_DEVICES': { title: 'Лимит устройств', label: 'Кол-во устройств', icon: Smartphone, color: 'text-indigo-400', type: 'number' },
      'BAN': { title: 'Заблокировать', label: 'Причина бана', icon: Ban, color: 'text-red-400', type: 'text' },
      'UNBAN': { title: 'Разблокировать', label: '', icon: CheckCircle, color: 'text-green-400', type: 'text' },
      'MASS_ADD_DAYS': { title: 'Всем добавить дни', label: 'Количество дней', icon: Calendar, color: 'text-orange-500', type: 'number' },
      'MASS_ADD_BALANCE': { title: 'Всем начислить', label: 'Сумма (₽)', icon: DollarSign, color: 'text-green-500', type: 'number' },
      'MASS_BAN': { title: 'Забанить всех', label: 'Причина', icon: Ban, color: 'text-red-500', type: 'text' },
      'MASS_UNBAN': { title: 'Разбанить всех', label: '', icon: CheckCircle, color: 'text-green-500', type: 'text' },
      'MASS_RESET_TRIAL': { title: 'Сбросить пробный период', label: '', icon: RefreshCw, color: 'text-yellow-500', type: 'text' },
      'MASS_DELETE_KEYS': { title: 'Удалить все ключи', label: '', icon: Trash2, color: 'text-red-500', type: 'text' },
      'MASS_SET_PARTNER': { title: 'Сделать партнерами', label: 'Процент реферала', icon: UserPlus, color: 'text-indigo-500', type: 'number' },
      'MASS_REMOVE_PARTNER': { title: 'Убрать партнерство', label: '', icon: UserMinus, color: 'text-gray-500', type: 'text' },
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
                        className="w-full bg-gray-950 border border-gray-700 text-white text-lg rounded-xl px-4 py-3 focus:ring-2 focus:ring-orange-500 outline-none font-mono" 
                        placeholder="0" 
                        autoFocus 
                        min="0"
                      />
                  </div>
                  <label className="flex items-center cursor-pointer group bg-gray-950/50 p-3 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors">
                      <div className="relative"><input type="checkbox" checked={notify} onChange={() => setNotify(!notify)} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full shadow-inner transition-colors ${notify ? 'bg-orange-600' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${notify ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="text-sm text-gray-200 font-medium">Уведомить пользователя</div><div className="text-xs text-gray-500">Отправить сообщение в бот</div></div>
                  </label>
                  <div className="flex gap-3 pt-2">
                      <button onClick={onClose} className="flex-1 py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-medium transition-colors">Отмена</button>
                      <button onClick={() => onConfirm(value, notify)} className="flex-1 py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold shadow-lg shadow-orange-900/20 transition-colors">Применить</button>
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
    onBlock?: (id: number, blocked: boolean) => void;
}

export const KeyEditModal: React.FC<KeyEditModalProps> = ({ keyItem, onClose, onSave, onDelete, onBlock }) => {
    const [expiryDays, setExpiryDays] = useState(keyItem.expiry);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [isBlocked, setIsBlocked] = useState(keyItem.status === 'Blocked' || keyItem.status === 'blocked');
    const [blockLoading, setBlockLoading] = useState(false);

    const handleToggleBlock = async () => {
        setBlockLoading(true);
        try {
            const newStatus = !isBlocked;
            await fetch(`/api/panel/keys/${keyItem.id}/block`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('panel_token') || ''}` },
                body: JSON.stringify({ blocked: newStatus })
            });
            setIsBlocked(newStatus);
            if (onBlock) onBlock(keyItem.id, newStatus);
        } catch (e) {
            console.error('Failed to toggle block', e);
        } finally {
            setBlockLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md p-6 shadow-2xl relative animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-start mb-6">
                    <h3 className="text-xl font-bold text-white flex items-center"><Key size={22} className="mr-2 text-orange-500"/> Редактирование ключа</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={20}/></button>
                </div>

                {!confirmDelete ? (
                    <div className="space-y-6">
                        <div className="p-3 bg-gray-950 rounded-xl border border-gray-800 font-mono text-xs text-gray-400 break-all select-all">
                            {keyItem.key}
                        </div>
                        
                        {/* Информация о трафике */}
                        <div className="p-4 bg-gray-950 rounded-xl border border-gray-800">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm text-gray-400">Использовано трафика</span>
                                <span className="text-sm font-mono text-white">
                                    {(keyItem.trafficUsed / (1024**3)).toFixed(2)} / {keyItem.trafficLimit > 0 ? (keyItem.trafficLimit / (1024**3)).toFixed(0) : '∞'} ГБ
                                </span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-2">
                                <div 
                                    className={`h-2 rounded-full transition-all ${
                                        keyItem.trafficLimit > 0 && keyItem.trafficUsed/keyItem.trafficLimit > 0.9 ? 'bg-red-500' : 
                                        keyItem.trafficLimit > 0 && keyItem.trafficUsed/keyItem.trafficLimit > 0.7 ? 'bg-yellow-500' : 'bg-orange-500'
                                    }`}
                                    style={{ width: `${keyItem.trafficLimit > 0 ? Math.min(100, (keyItem.trafficUsed/keyItem.trafficLimit)*100) : 0}%` }}
                                ></div>
                            </div>
                            {keyItem.trafficLimit > 0 && keyItem.trafficUsed/keyItem.trafficLimit > 0.9 && (
                                <div className="text-xs text-red-400 mt-2 flex items-center">
                                    <AlertTriangle size={12} className="mr-1" />
                                    Трафик почти исчерпан
                                </div>
                            )}
                        </div>
                        
                        {/* Статус блокировки */}
                        <div className="flex items-center justify-between p-3 bg-gray-950 rounded-xl border border-gray-800">
                            <div>
                                <div className="text-sm text-white font-medium">Блокировка ключа</div>
                                <div className="text-xs text-gray-500">
                                    {isBlocked ? 'Ключ заблокирован вручную' : 'Ключ активен'}
                                </div>
                            </div>
                            <button 
                                onClick={handleToggleBlock}
                                disabled={blockLoading}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                                    isBlocked 
                                        ? 'bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20' 
                                        : 'bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20'
                                } ${blockLoading ? 'opacity-50' : ''}`}
                            >
                                {blockLoading ? '...' : (isBlocked ? 'Разблокировать' : 'Заблокировать')}
                            </button>
                        </div>
                        
                        <div>
                            <label className="text-sm text-gray-400 block mb-2">Осталось дней</label>
                            <div className="flex gap-2">
                                <button onClick={() => setExpiryDays(Math.max(0, Number(expiryDays) - 1))} className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"><ArrowDownLeft size={18}/></button>
                                <input 
                                    type="number" 
                                    value={expiryDays} 
                                    onChange={(e) => setExpiryDays(parseInt(e.target.value) || 0)}
                                    className="flex-1 bg-gray-950 border border-gray-700 text-center text-white text-lg rounded-xl focus:border-orange-500 outline-none font-mono"
                                />
                                <button onClick={() => setExpiryDays(Number(expiryDays) + 1)} className="p-3 bg-gray-800 rounded-xl hover:bg-gray-700 transition-colors"><ArrowUpRight size={18}/></button>
                            </div>
                        </div>

                        <div className="flex gap-3 pt-4">
                            <button onClick={() => setConfirmDelete(true)} className="flex-1 py-3 bg-red-600/10 hover:bg-red-600/20 text-red-500 border border-red-600/20 rounded-xl font-medium transition-colors flex items-center justify-center">
                                <Trash2 size={18} className="mr-2"/> Удалить
                            </button>
                            <button onClick={() => onSave(keyItem.id, expiryDays)} className="flex-[2] py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold shadow-lg shadow-orange-900/20 transition-colors flex items-center justify-center">
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
}

export const TransactionModal: React.FC<TransactionModalProps> = ({ transaction, onClose }) => {
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
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><Users size={14} className="mr-2"/> Пользователь</span><span className="text-orange-400">{transaction.user}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><DollarSign size={14} className="mr-2"/> Сумма</span><span className={`font-bold ${isIncome ? 'text-green-400' : 'text-red-400'}`}>{transaction.amount} ₽</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><CreditCard size={14} className="mr-2"/> Метод</span><span className="text-white">{transaction.method}</span></div>
            <div className="flex justify-between items-center py-2 border-b border-gray-800"><span className="text-gray-400 flex items-center"><FileText size={14} className="mr-2"/> Hash</span><span className="text-xs text-gray-500 font-mono">{transaction.hash}</span></div>
        </div>

        <div className="flex gap-3">
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

export const CreateKeyModal: React.FC<CreateKeyModalProps> = ({ onClose, users = [], onToast }) => {
    const [searchUser, setSearchUser] = useState('');
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [isTrial, setIsTrial] = useState(false);
    const [isForever, setIsForever] = useState(false);
    const [params, setParams] = useState({ days: 30, traffic: 100, devices: 5 });
    const [selectedSquads, setSelectedSquads] = useState<string[]>([]);
    const [squads, setSquads] = useState<{uuid: string; name: string}[]>([]);
    const [loadingSquads, setLoadingSquads] = useState(false);
    
    const filteredUsers: User[] =
        searchUser && users
            ? users
                  .filter((u: User) =>
                      u.username.toLowerCase().includes(searchUser.toLowerCase()) ||
                      u.telegramId.toString().includes(searchUser)
                  )
                  .slice(0, 3)
            : [];
    
    useEffect(() => {
        (async () => {
            setLoadingSquads(true);
            try {
                const data = await apiFetch('/panel/remnawave/squads');
                if (Array.isArray(data)) {
                    setSquads(data);
                }
            } catch (e) {
                console.error('Failed to load squads', e);
                onToast('Ошибка', 'Не удалось загрузить сквады из Remnawave', 'error');
            } finally {
                setLoadingSquads(false);
            }
        })();
    }, []);

    const handleCreate = async () => { 
        if(!selectedUser) {
            onToast('Ошибка', 'Выберите пользователя', 'error');
            return;
        }
        try {
            // 27394 дня ≈ 75 лет (до ~2099 года)
            const finalDays = isForever ? 27394 : params.days;
            const response = await apiFetch('/panel/keys', {
                method: 'POST',
                body: JSON.stringify({
                    user_id: selectedUser.id,
                    days: finalDays,
                    traffic: params.traffic,
                    devices: params.devices,
                    is_trial: isTrial,
                    is_forever: isForever,
                    squads: selectedSquads
                })
            });
            onToast('Успех', isForever ? 'Бесконечный ключ создан!' : 'Ключ успешно создан и отправлен пользователю', 'success');
            onClose(); 
        } catch (e: any) {
            onToast('Ошибка', e.message || 'Не удалось создать ключ', 'error');
        }
    };

    useEffect(() => { 
        if(isTrial) { 
            setParams({ days: 1, traffic: 5, devices: 1 }); 
        } else if (isForever) {
            setParams(prev => ({ ...prev, traffic: 0, devices: 10 })); // 0 = безлимит
        } else { 
            setParams({ days: 30, traffic: 100, devices: 5 }); 
        } 
    }, [isTrial, isForever]);

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-800 flex justify-between items-center"><h3 className="text-xl font-bold text-white flex items-center"><Plus size={24} className="mr-2 text-orange-500"/> Создание ключа</h3><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button></div>
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
                                } rounded-xl px-4 py-3 focus:outline-none focus:border-orange-500`}
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
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex items-center cursor-pointer p-4 bg-gray-800/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"><div className="relative"><input type="checkbox" checked={isTrial} onChange={() => { setIsTrial(!isTrial); setIsForever(false); }} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full transition-colors ${isTrial ? 'bg-purple-600' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${isTrial ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="font-medium text-white">Пробный период</div><div className="text-xs text-gray-500">1 день, 5ГБ, 2 устройства</div></div></label>
                        <label className="flex items-center cursor-pointer p-4 bg-gray-800/50 border border-gray-800 rounded-xl hover:border-gray-700 transition-colors"><div className="relative"><input type="checkbox" checked={isForever} onChange={() => { setIsForever(!isForever); setIsTrial(false); }} className="sr-only" /><div className={`w-10 h-6 bg-gray-700 rounded-full transition-colors ${isForever ? 'bg-yellow-500' : ''}`}></div><div className={`absolute left-1 top-1 w-4 h-4 bg-white rounded-full transition-transform ${isForever ? 'translate-x-4' : ''}`}></div></div><div className="ml-3"><div className="font-medium text-white">∞ Навсегда</div><div className="text-xs text-gray-500">До 2099 года</div></div></label>
                    </div>
                    <div className="grid grid-cols-3 gap-4"><div><label className="text-xs text-gray-500 mb-1.5 block">Длительность (дней)</label><input type="number" min="1" value={isForever ? 27394 : params.days} disabled={isForever} onChange={e => setParams({...params, days: parseInt(e.target.value) || 0})} className={`w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono ${isForever ? 'opacity-50' : ''}`}/></div><div><label className="text-xs text-gray-500 mb-1.5 block">Трафик (GB)</label><input type="number" min="1" value={params.traffic} onChange={e => setParams({...params, traffic: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div><div><label className="text-xs text-gray-500 mb-1.5 block">Устройства</label><input type="number" min="1" value={params.devices} onChange={e => setParams({...params, devices: parseInt(e.target.value) || 0})} className="w-full bg-gray-950 border border-gray-700 rounded-xl px-3 py-2 text-white text-center font-mono"/></div></div>
                    <div>
                        <label className="text-sm font-medium text-gray-400 mb-2 block">Доступные сквады</label>
                        {loadingSquads ? (
                            <div className="text-gray-500 text-sm">Загрузка сквадов...</div>
                        ) : squads.length === 0 ? (
                            <div className="text-gray-500 text-sm">Нет доступных сквадов</div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {squads.map(sq => { 
                                    const isSelected = selectedSquads.includes(sq.uuid); 
                                    return (
                                        <button 
                                            key={sq.uuid} 
                                            onClick={() => setSelectedSquads(prev => isSelected ? prev.filter(s => s !== sq.uuid) : [...prev, sq.uuid])} 
                                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${isSelected ? 'bg-orange-600/20 border-orange-500 text-orange-400' : 'bg-gray-950 border-gray-800 text-gray-500 hover:border-gray-600'}`}
                                        >
                                            {sq.name}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-5 border-t border-gray-800"><button onClick={handleCreate} className="w-full py-3 bg-orange-600 hover:bg-orange-500 text-white rounded-xl font-bold shadow-lg shadow-orange-900/20 transition-colors">Создать ключ</button></div>
            </div>
        </div>
    );
};

interface UserDetailModalProps {
    user: User;
    onClose: () => void;
    onToast: (title: string, msg: string, type: ToastType) => void;
    onOpenUser: (u: User) => void;
}

interface UserSubscription {
  id: number;
  key_uuid: string;
  short_uuid: string;
  status: string;
  expiry_date: string;
  days_left: number;
  traffic_used: number;
  traffic_limit: number;
  type: string;
}

interface ReferralItem {
  id: number;
  telegram_id: number;
  username: string;
  full_name?: string;
  is_partner: number;
  partner_rate: number;
}

export const UserDetailModal: React.FC<UserDetailModalProps> = ({ user, onClose, onToast, onOpenUser }) => {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [partnerRateDraft, setPartnerRateDraft] = useState<number>(user?.partnerRate ?? 25);
  const [secondLevelRateDraft, setSecondLevelRateDraft] = useState<number>(user?.secondLevelRate ?? 5);
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  
  const refreshSubscriptions = async () => {
    setLoadingSubs(true);
    try {
      const data = await apiFetch(`/panel/users/${user.id}/subscriptions`);
      if (Array.isArray(data)) setSubscriptions(data);
      else setSubscriptions([]);
    } catch (e) {
      onToast('Ошибка', 'Не удалось загрузить подписки', 'error');
    } finally {
      setLoadingSubs(false);
    }
  };

  const refreshReferrals = async () => {
    setLoadingRefs(true);
    try {
      const data = await apiFetch(`/panel/users/${user.id}/referrals`);
      if (Array.isArray(data)) setReferrals(data);
      else setReferrals([]);
    } catch (e) {
      onToast('Ошибка', 'Не удалось загрузить рефералов', 'error');
    } finally {
      setLoadingRefs(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    setPartnerRateDraft(user.partnerRate ?? 25);
    setSecondLevelRateDraft(user.secondLevelRate ?? 5);
    refreshSubscriptions();
    refreshReferrals();
  }, [user]);
  
  if (!user) return null;
  const trafficPercent = (user.traffic / user.maxTraffic) * 100;
  const devicesPercent = (user.devices / user.maxDevices) * 100;

  const handleAction = (type: string) => setActiveAction(type);
  const confirmAction = async (value: string, notify: boolean) => {
      try {
        await apiFetch(`/panel/users/${user.id}/action`, {
          method: 'POST',
          body: JSON.stringify({ action: activeAction, value, notify })
        });
        onToast('Успешно', `Действие выполнено`, 'success');
        await refreshSubscriptions();
      } catch (e) {
        onToast('Ошибка', 'Не удалось выполнить действие', 'error');
      }
      setActiveAction(null); 
  };
  
  const handleNotify = async () => {
    const message = prompt('Введите сообщение для отправки пользователю:');
    if (!message) return;
    try {
      await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'NOTIFY', value: message, notify: true })
      });
      onToast('Успешно', 'Уведомление отправлено', 'success');
    } catch (e) {
      onToast('Ошибка', 'Не удалось отправить уведомление', 'error');
    }
  };
  
  const handleSubAction = async (subId: number, action: 'EXTEND_SUB' | 'REDUCE_SUB' | 'SET_TRAFFIC' | 'SET_DEVICES') => {
    const prompts: Record<string, string> = {
      EXTEND_SUB: 'На сколько дней продлить?',
      REDUCE_SUB: 'На сколько дней уменьшить?',
      SET_TRAFFIC: 'Новый лимит трафика (ГБ):',
      SET_DEVICES: 'Новый лимит устройств:',
    };
    const value = prompt(prompts[action]);
    if (!value) return;
    try {
      await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action, value, notify: true, subscription_id: subId }),
      });
      onToast('Успешно', 'Изменения применены', 'success');
      await refreshSubscriptions();
    } catch (e) {
      onToast('Ошибка', 'Не удалось применить действие', 'error');
    }
  };

  const handleBlockSubscription = async (subId: number, block: boolean) => {
    try {
      await apiFetch(`/panel/keys/${subId}/block`, {
        method: 'POST',
        body: JSON.stringify({ blocked: block })
      });
      onToast('Успешно', block ? 'Подписка заблокирована' : 'Подписка разблокирована', 'success');
      await refreshSubscriptions();
    } catch (e) {
      onToast('Ошибка', 'Не удалось изменить статус подписки', 'error');
    }
  };

  const saveReferralRates = async () => {
    try {
      await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'SET_PARTNER_RATE', value: String(partnerRateDraft), notify: true }),
      });
      await apiFetch(`/panel/users/${user.id}/action`, {
        method: 'POST',
        body: JSON.stringify({ action: 'SET_SECOND_LEVEL_RATE', value: String(secondLevelRateDraft), notify: false }),
      });
      onToast('Успех', 'Реферальные ставки обновлены', 'success');
    } catch (e: any) {
      onToast('Ошибка', e?.message || 'Не удалось сохранить ставки', 'error');
    }
  };

  const openReferralProfile = async (refId: number) => {
    try {
      const u = await apiFetch(`/panel/users/${refId}`);
      if (!u) return;
      const mapped: User = {
        id: u.id,
        telegramId: u.telegram_id,
        username: u.username ? (String(u.username).startsWith('@') ? String(u.username) : `@${u.username}`) : `@user_${u.telegram_id}`,
        name: u.full_name || u.username || '',
        balance: u.balance ?? 0,
        status: u.is_banned ? 'Banned' : 'Active',
        traffic: 0,
        maxTraffic: 0,
        devices: 0,
        maxDevices: 0,
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
        partnerRate: u.partner_rate ?? 25,
        secondLevelRate: u.second_level_rate ?? 5,
        thirdLevelRate: u.third_level_rate ?? 2,
        referrals: 0,
        totalEarned: u.total_earned ?? 0,
        inBlacklist: !!u.in_blacklist,
      };
      onOpenUser(mapped);
    } catch (e) {
      onToast('Ошибка', 'Не удалось открыть профиль реферала', 'error');
    }
  };

  const unlinkReferral = async (refId: number) => {
    if (!confirm('Отвязать этого реферала?')) return;
    try {
      await apiFetch(`/panel/users/${user.id}/referrals/${refId}/unlink`, { method: 'POST' });
      onToast('Успех', 'Реферал отвязан', 'success');
      await refreshReferrals();
    } catch (e) {
      onToast('Ошибка', 'Не удалось отвязать реферала', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto" onClick={onClose}>
        {activeAction && <UserActionModal type={activeAction} onClose={() => setActiveAction(null)} onConfirm={confirmAction} />}
        <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-4xl shadow-2xl relative animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-800 flex justify-between items-start bg-gray-900 rounded-t-2xl">
                <div className="flex items-center gap-4"><div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center text-2xl font-bold text-gray-500 border border-gray-700">{user.username.charAt(1).toUpperCase()}</div><div><h2 className="text-2xl font-bold text-white flex items-center">{user.username} {user.status === 'Active' && <CheckCircle size={18} className="text-green-500 ml-2" />}{user.status === 'Banned' && <Ban size={18} className="text-red-500 ml-2" />}{user.inBlacklist && <span className="ml-2 text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full border border-red-500/30">Чёрный список</span>}</h2><div className="flex items-center gap-3 text-sm text-gray-400 mt-1"><span className="flex items-center bg-gray-800 px-2 py-0.5 rounded"><Hash size={12} className="mr-1"/> ID: {user.telegramId}</span><span className="flex items-center"><Calendar size={12} className="mr-1"/> Рег: {user.regDate}</span></div></div></div>
                <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="space-y-6">
                    {/* Finance */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex justify-between items-start mb-4"><h3 className="text-lg font-bold text-gray-200 flex items-center"><DollarSign size={18} className="mr-2 text-green-400"/> Баланс</h3></div>
                        <div className="text-3xl font-bold text-white mb-4">{user.balance} ₽</div>
                        <div className="grid grid-cols-2 gap-3"><button onClick={() => handleAction('ADD_BALANCE')} className="bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20 py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center"><ArrowUpRight size={14} className="mr-2"/> Начислить</button><button onClick={() => handleAction('SUB_BALANCE')} className="bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 py-2 rounded-lg text-sm font-medium transition-colors flex justify-center items-center"><ArrowDownLeft size={14} className="mr-2"/> Списать</button></div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4">
                           <Zap size={18} className="mr-2 text-orange-400"/> Подписки ({subscriptions.length})
                         </h3>
                         {loadingSubs ? (
                           <div className="text-center py-4 text-gray-500">Загрузка...</div>
                         ) : subscriptions.length === 0 ? (
                           <div className="text-center py-4 text-gray-500">Нет активных подписок</div>
                         ) : (
                           <div className="space-y-3 max-h-[420px] overflow-y-auto">
                             {subscriptions.map((sub) => (
                               <div key={sub.id} className="p-3 rounded-lg border bg-gray-950 border-gray-800">
                                 <div className="flex justify-between items-start mb-2">
                                   <div>
                                     <div className="font-mono text-xs text-orange-400">#{sub.short_uuid || sub.key_uuid?.slice(0,8)}</div>
                                     <div className="text-xs text-gray-500 mt-0.5">Подписка</div>
                                   </div>
                                   <span className={`text-xs px-2 py-0.5 rounded ${
                                     sub.status === 'Active' ? 'bg-green-500/20 text-green-400' : 
                                     sub.status === 'Blocked' ? 'bg-red-500/20 text-red-400' : 
                                     'bg-gray-500/20 text-gray-400'
                                   }`}>{sub.status}</span>
                                 </div>
                                 <div className="flex justify-between text-xs">
                                   <span className={sub.days_left <= 3 ? 'text-red-400' : 'text-gray-400'}>
                                     {sub.days_left <= 0 ? 'Истекла' : `Осталось ${sub.days_left} дн.`}
                                   </span>
                                   <span className="text-gray-500">
                                     {sub.traffic_limit > 0 
                                       ? `${(sub.traffic_used / (1024**3)).toFixed(1)} / ${(sub.traffic_limit / (1024**3)).toFixed(0)} ГБ`
                                       : 'Безлимит'
                                     }
                                   </span>
                                 </div>
                                 <div className="mt-3 pt-3 border-t border-gray-800 grid grid-cols-2 gap-2">
                                   <button onClick={() => handleSubAction(sub.id, 'EXTEND_SUB')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Продлить</button>
                                   <button onClick={() => handleSubAction(sub.id, 'REDUCE_SUB')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Уменьшить срок</button>
                                   <button onClick={() => handleSubAction(sub.id, 'SET_TRAFFIC')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Изм. трафик</button>
                                   <button onClick={() => handleSubAction(sub.id, 'SET_DEVICES')} className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 py-2 rounded-lg text-xs font-medium transition-colors">Изм. устройства</button>
                                   <button
                                     onClick={() => handleBlockSubscription(sub.id, sub.status !== 'Blocked')}
                                     className={`col-span-2 py-2 rounded-lg text-xs font-medium ${
                                       sub.status === 'Blocked'
                                         ? 'bg-green-600/10 text-green-400 border border-green-600/20 hover:bg-green-600/20'
                                         : 'bg-red-600/10 text-red-400 border border-red-600/20 hover:bg-red-600/20'
                                     }`}
                                   >
                                     {sub.status === 'Blocked' ? 'Разблокировать (Remnawave + БД)' : 'Заблокировать (Remnawave + БД)'}
                                   </button>
                                 </div>
                               </div>
                             ))}
                           </div>
                         )}
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
                                <div><label className="text-xs text-gray-500 block mb-1">Реф. код</label><input type="text" readOnly value={user.refCode} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2 font-mono"/></div>
                                <div><label className="text-xs text-gray-500 block mb-1">1-я линия (%)</label><input type="number" value={partnerRateDraft} onChange={e => setPartnerRateDraft(Number(e.target.value) || 0)} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"/></div>
                                <div><label className="text-xs text-gray-500 block mb-1">2-я линия (%)</label><input type="number" value={secondLevelRateDraft} onChange={e => setSecondLevelRateDraft(Number(e.target.value) || 0)} className="w-full bg-gray-950 border border-gray-700 text-white text-sm rounded-lg px-3 py-2"/></div>
                                <button onClick={saveReferralRates} className="w-full mt-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-600/20 py-2 rounded-lg text-sm font-bold transition-colors">Сохранить реферальные ставки</button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="space-y-6">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Users size={18} className="mr-2 text-cyan-400"/> Рефералы</h3>
                         {loadingRefs ? (
                           <div className="text-center py-4 text-gray-500">Загрузка...</div>
                         ) : referrals.length === 0 ? (
                           <div className="text-center py-4 text-gray-500">Нет привязанных рефералов</div>
                         ) : (
                           <div className="space-y-2 max-h-[360px] overflow-y-auto">
                             {referrals.map((r) => (
                               <div key={r.id} className="bg-gray-950 border border-gray-800 rounded-lg p-3 flex items-center justify-between">
                                 <div>
                                   <div className="text-white text-sm font-medium">{r.username ? (String(r.username).startsWith('@') ? r.username : `@${r.username}`) : `id${r.id}`}</div>
                                   <div className="text-xs text-gray-500">ID: {r.telegram_id} {r.is_partner ? `· Партнер ${r.partner_rate}%` : ''}</div>
                                 </div>
                                 <div className="flex gap-2">
                                   <button onClick={() => openReferralProfile(r.id)} className="px-2.5 py-1.5 bg-orange-600/10 hover:bg-orange-600/20 border border-orange-600/20 text-orange-400 rounded text-xs">Открыть</button>
                                   <button onClick={() => unlinkReferral(r.id)} className="px-2.5 py-1.5 bg-red-600/10 hover:bg-red-600/20 border border-red-600/20 text-red-400 rounded text-xs">Отвязать</button>
                                 </div>
                               </div>
                             ))}
                           </div>
                         )}
                    </div>
                    {/* Действия с пользователем */}
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                         <h3 className="text-lg font-bold text-gray-200 flex items-center mb-4"><Bell size={18} className="mr-2 text-yellow-400"/> Действия</h3>
                         <div className="grid grid-cols-1 gap-3">
                           <button onClick={handleNotify} className="bg-yellow-600/10 hover:bg-yellow-600/20 text-yellow-400 border border-yellow-600/20 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center">
                             <Bell size={16} className="mr-2" /> Уведомить пользователя
                           </button>
                           {user.status !== 'Banned' && !user.inBlacklist ? (
                             <button onClick={() => handleAction('BAN')} className="bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center">
                               <Ban size={16} className="mr-2" /> Заблокировать
                             </button>
                           ) : (
                             <button onClick={() => handleAction('UNBAN')} className="bg-green-600/10 hover:bg-green-600/20 text-green-400 border border-green-600/20 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center">
                               <CheckCircle size={16} className="mr-2" /> Разблокировать{user.inBlacklist ? ' (из ЧС)' : ''}
                             </button>
                           )}
                         </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
  );
};
