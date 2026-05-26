import React, { useState, useEffect, createContext, useContext, useMemo } from 'react';
import { panelApiFetch as apiFetch, BOT_USERNAME } from '../../api/client';
import type { Toast, ToastType, Transaction, User, KeyItem, Promo, UserStatus, KeyStatus } from '../../core/types';

export type PanelContextValue = Record<string, unknown>;

export const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanel(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('usePanel must be used within PanelProvider');
  return ctx;
}

export function PanelProvider({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState("Главная страница");
  const [toasts, setToasts] = useState<Toast[]>([]);
  
  // Data States
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [keys, setKeys] = useState<KeyItem[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  
  // UI States
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [massActionType, setMassActionType] = useState<string | null>(null);
  const [keySearch, setKeySearch] = useState('');
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  
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
          const usersFromApi = await apiFetch('/panel/users?limit=5000');
          if (!cancelled && Array.isArray(usersFromApi)) {
            const mapped: User[] = usersFromApi.map((u: any) => ({
              id: u.id,
              telegramId: u.telegram_id,
              username: u.username ? (u.username.startsWith('@') ? u.username : `@${u.username}`) : `id${u.telegram_id}`,
              name: u.full_name || '',
              balance: u.balance ?? 0,
              // Приоритет: in_blacklist -> Banned, is_banned -> Banned, иначе статус из БД или Trial
              status: (u.in_blacklist || u.is_banned) ? 'Banned' : ((u.status as UserStatus) || 'Trial'),
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
              partnerRate: u.partner_rate ?? 25,
              secondLevelRate: u.second_level_rate ?? 5,
              thirdLevelRate: u.third_level_rate ?? 2,
              referrals: 0,
              totalEarned: u.total_earned ?? 0,
              inBlacklist: !!u.in_blacklist,
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

        // Ключи VPN
        try {
          const keysFromApi = await apiFetch('/panel/keys?limit=5000');
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
  const value = useMemo(() => ({
    onLogout,
    isMobileMenuOpen, setIsMobileMenuOpen,
    activePage, setActivePage,
    toasts, setToasts,
    transactions, setTransactions,
    users, setUsers,
    keys, setKeys,
    promos, setPromos,
    selectedTransaction, setSelectedTransaction,
    selectedUser, setSelectedUser,
    userSearch, setUserSearch,
    massActionType, setMassActionType,
    keySearch, setKeySearch,
    isCreateKeyOpen, setIsCreateKeyOpen,
    editingKey, setEditingKey,
    addToast,
    handleUpdateKey,
    handleDeleteKey,
  }), [
    onLogout,
    isMobileMenuOpen, activePage, toasts,
    transactions, users, keys, promos,
    selectedTransaction, selectedUser, userSearch,
    massActionType, keySearch, isCreateKeyOpen, editingKey,
  ]);

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
