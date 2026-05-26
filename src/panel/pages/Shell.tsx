import React from 'react';
import {
  Home, DollarSign, BarChart2, Users, Key, Mail, Settings, Menu, X, Gift, Lock,
} from 'lucide-react';
import { usePanel } from '../context/PanelContext';
import { ToastContainer } from '../components/Toast';
import {
  UserActionModal, KeyEditModal, TransactionModal, CreateKeyModal, UserDetailModal,
} from '../components/modals';
import { panelApiFetch as apiFetch } from '../../api/client';

type ShellProps = { children: React.ReactNode };

export default function Shell({ children }: ShellProps) {
  const props = usePanel();
  const {
    onLogout,
    isMobileMenuOpen, setIsMobileMenuOpen,
    activePage, setActivePage,
    toasts, setToasts,
    users,
    selectedTransaction, setSelectedTransaction,
    selectedUser, setSelectedUser,
    isCreateKeyOpen, setIsCreateKeyOpen,
    editingKey, setEditingKey,
    massActionType, setMassActionType,
    addToast,
    handleUpdateKey,
    handleDeleteKey,
  } = props as Record<string, unknown> & {
    onLogout: () => void;
    isMobileMenuOpen: boolean;
    setIsMobileMenuOpen: (v: boolean) => void;
    activePage: string;
    setActivePage: (v: string) => void;
    toasts: { id: number }[];
    setToasts: React.Dispatch<React.SetStateAction<{ id: number }[]>>;
    users: unknown[];
    selectedTransaction: unknown;
    setSelectedTransaction: (v: unknown) => void;
    selectedUser: unknown;
    setSelectedUser: (v: unknown) => void;
    isCreateKeyOpen: boolean;
    setIsCreateKeyOpen: (v: boolean) => void;
    editingKey: unknown;
    setEditingKey: (v: unknown) => void;
    massActionType: string | null;
    setMassActionType: (v: string | null) => void;
    addToast: (title: string, message: string, type?: string) => void;
    handleUpdateKey: (id: number, newExpiry: number) => void;
    handleDeleteKey: (id: number) => void;
  };

  return (
    <div className="min-h-screen bg-black text-gray-100 font-sans selection:bg-orange-500 selection:text-white">
      <ToastContainer toasts={toasts as never} removeToast={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))} />

      {selectedTransaction && (
        <TransactionModal transaction={selectedTransaction as never} onClose={() => setSelectedTransaction(null)} />
      )}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser as never}
          onClose={() => setSelectedUser(null)}
          onToast={addToast as never}
          onOpenUser={setSelectedUser as never}
        />
      )}
      {isCreateKeyOpen && (
        <CreateKeyModal onClose={() => setIsCreateKeyOpen(false)} users={users as never} onToast={addToast as never} />
      )}
      {editingKey && (
        <KeyEditModal
          keyItem={editingKey as never}
          onClose={() => setEditingKey(null)}
          onSave={handleUpdateKey}
          onDelete={handleDeleteKey}
        />
      )}
      {massActionType && (
        <UserActionModal
          type={massActionType}
          onClose={() => setMassActionType(null)}
          onConfirm={async (val, notify) => {
            try {
              await apiFetch('/panel/users/mass-action', {
                method: 'POST',
                body: JSON.stringify({ action: massActionType, value: val, notify }),
              });
              addToast('Массовое действие', 'Задача успешно выполнена', 'success');
            } catch {
              addToast('Ошибка', 'Не удалось выполнить действие', 'error');
            }
            setMassActionType(null);
          }}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-black border-r border-gray-800 transform transition-transform duration-300 ease-in-out ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 overflow-y-auto custom-scrollbar`}
      >
        <div className="p-6 border-b border-gray-800 hidden md:block">
          <h1 className="text-2xl font-bold text-orange-500 tracking-wider">BlinVPN</h1>
          <p className="text-xs text-gray-500 mt-1">Admin Panel v3.2</p>
        </div>
        <nav className="p-4 space-y-6">
          {[
            { category: 'Главное', items: [{ name: 'Главная страница', icon: Home }, { name: 'Финансы', icon: DollarSign }, { name: 'Статистика', icon: BarChart2 }] },
            { category: 'Пользователи', items: [{ name: 'Пользователи', icon: Users }, { name: 'Подписки', icon: Key }] },
            { category: 'Маркетинг', items: [{ name: 'Рассылка', icon: Mail }, { name: 'Промокоды', icon: Gift }] },
            { category: 'Другое', items: [{ name: 'Настройки', icon: Settings }] },
          ].map((section, idx) => (
            <div key={idx}>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 px-2">{section.category}</h3>
              <ul className="space-y-1">
                {section.items.map((item, itemIdx) => (
                  <li key={itemIdx}>
                    <button
                      onClick={() => {
                        setActivePage(item.name);
                        setIsMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center px-2 py-2 text-sm font-medium rounded-lg transition-colors ${activePage === item.name ? 'bg-orange-600/10 text-orange-400' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`}
                    >
                      <item.icon size={18} className={`mr-3 ${activePage === item.name ? 'text-orange-400' : 'text-gray-500'}`} />
                      {item.name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <main className="md:ml-64 min-h-screen transition-all duration-300">
        <div className="bg-black/50 backdrop-blur-md border-b border-gray-800 sticky top-0 z-30 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 md:gap-4">
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="md:hidden text-gray-300 hover:text-white p-1">
              {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
            </button>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogout}
              title="Выход"
              className="flex items-center justify-center w-9 h-9 bg-red-600/10 border border-red-500/20 rounded-lg hover:bg-red-600/20 transition-colors text-red-400"
            >
              <Lock size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
