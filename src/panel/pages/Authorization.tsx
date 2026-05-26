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

import { setPanelToken } from '../../api/client';

export default function Authorization({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initInfo, setInitInfo] = useState<{username?: string; password?: string; newAdmin?: boolean} | null>(null);

  // Проверяем инициализацию при загрузке
  useEffect(() => {
    fetch('/api/panel/auth/init')
      .then(res => res.json())
      .then(data => {
        if (data.new_admin && data.password) {
          setInitInfo({
            username: data.username,
            password: data.password,
            newAdmin: true
          });
        }
      })
      .catch(() => {});
  }, []);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/panel/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await res.json();

      if (res.ok && data.requires_2fa && data.temp_token) {
        setTempToken(data.temp_token);
      } else if (res.ok && data.session_token) {
        setPanelToken(data.session_token);
        onLogin(data.session_token);
      } else {
        setError(data.error || 'Неверные учетные данные');
      }
    } catch (err) {
      setError('Ошибка подключения к серверу');
    }
    setLoading(false);
  };

  const handleVerifyCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/panel/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp_token: tempToken, code: verifyCode })
      });
      const data = await res.json();
      if (res.ok && data.session_token) {
        setPanelToken(data.session_token);
        onLogin(data.session_token);
      } else {
        setError(data.error || 'Неверный код подтверждения');
      }
    } catch {
      setError('Ошибка подключения к серверу');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">BlinVPN Panel</h1>
          <p className="text-gray-400 mt-2">Войдите для доступа к панели</p>
        </div>

        {/* Уведомление о новом админе */}
        {initInfo?.newAdmin && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-400 px-4 py-3 rounded-lg text-sm mb-6">
            <p className="font-bold mb-2">Создан администратор!</p>
            <p>Логин: <code className="bg-green-900/30 px-1 rounded">{initInfo.username}</code></p>
            <p>Пароль: <code className="bg-green-900/30 px-1 rounded">{initInfo.password}</code></p>
            <p className="mt-2 text-xs text-green-500">Сохраните эти данные! Пароль показывается только один раз.</p>
          </div>
        )}

        {!tempToken ? (
          <form onSubmit={handleCredentialsSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Логин</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                placeholder="admin"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Пароль</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-orange-900/30"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <Loader size={20} className="animate-spin mr-2" />
                  Вход...
                </span>
              ) : (
                'Войти'
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyCodeSubmit} className="space-y-4">
            <div className="bg-orange-500/10 border border-orange-500/30 text-orange-300 px-4 py-3 rounded-lg text-sm">
              Код подтверждения отправлен администраторам в Telegram.
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Код подтверждения</label>
              <input
                type="text"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
                placeholder="123456"
                required
              />
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 px-4 py-3 rounded-lg text-sm">{error}</div>}
            <button type="submit" disabled={loading || !verifyCode} className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-3 rounded-lg transition-all shadow-lg shadow-orange-900/30">
              {loading ? 'Проверка...' : 'Подтвердить вход'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
