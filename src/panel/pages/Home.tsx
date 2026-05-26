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


export default function Home() {
    const [keysNewData, setKeysNewData] = useState<number[]>([]);
    const [subsNewData, setSubsNewData] = useState<number[]>([]);
    const [labels, setLabels] = useState<string[]>([]);
    const [summary, setSummary] = useState<{
        total_users: number;
        active_keys: number;
        monthly_revenue: number;
    } | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const data = await apiFetch('/panel/stats/charts');
                if (data) {
                    setKeysNewData(Array.isArray(data.keys_new) ? data.keys_new : []);
                    setSubsNewData(Array.isArray(data.subs_new) ? data.subs_new : []);
                    setLabels(Array.isArray(data.labels) ? data.labels : []);
                }
            } catch (e) {
                console.error('Failed to load dashboard charts', e);
            }
        })();

        (async () => {
            try {
                const data = await apiFetch('/panel/stats/summary');
                if (data) {
                    setSummary(data);
                }
            } catch (e) {
                console.error('Failed to load dashboard summary', e);
            }
        })();
    }, []);

    const fmtNumber = (v: number) =>
        v.toLocaleString('ru-RU', { maximumFractionDigits: 0 });

    const fmtMoney = (v: number) =>
        `${v.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₽`;

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div><h2 className="text-2xl font-bold text-white">Добро пожаловать в панель управления</h2><p className="text-gray-400 mt-1">Вот что происходит с BlinVPN сегодня.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard
                title="Всего пользователей"
                value={summary ? fmtNumber(summary.total_users) : '—'}
                icon={Users}
                color="blue"
              />
              <StatCard
                title="Активных ключей"
                value={summary ? fmtNumber(summary.active_keys) : '—'}
                icon={Key}
                color="green"
              />
              <StatCard
                title="Доход за месяц"
                value={summary ? fmtMoney(summary.monthly_revenue) : '—'}
                icon={DollarSign}
                color="indigo"
              />
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-lg font-semibold text-gray-200 flex items-center"><TrendingUp className="w-5 h-5 mr-2 text-orange-500" />Динамика</h3>
                </div>
                <CombinedLinesChart
                  labels={labels}
                  keysNewData={keysNewData}
                  subsNewData={subsNewData}
                />
            </div>
        </div>
    );
};

interface FinancePageProps {
  transactions: Transaction[];
  onSelectTransaction: (t: Transaction) => void;
}
