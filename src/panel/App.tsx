import React, { useState, useEffect, useRef } from 'react';
import {
  Home, DollarSign, Users, Key, Mail, Gift, Percent, Link, Settings, Menu, X,
  CheckCircle, AlertCircle, CreditCard, Search, Filter, ArrowUpRight, ArrowDownLeft,
  Activity, Calendar, Download, Loader, Hash, Ban, Trophy, UserPlus, UserMinus, Clock,
  Edit2, Copy, Smartphone, Zap, Database, Bell, Wallet, Plus, Lock, Send,
  MousePointer, Layers, ToggleLeft, ToggleRight, Trash2, ChevronDown, Save,
  AlertTriangle, Cloud, RefreshCw, BarChart2
} from 'lucide-react';

// ==========================================================
// 0. ENV & API
// ==========================================================

declare const importMeta: any | undefined;

const rawEnv: any =
  (typeof importMeta !== 'undefined' && importMeta.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

const BOT_USERNAME: string = rawEnv.VITE_BOT_USERNAME || rawEnv.REACT_APP_BOT_USERNAME || 'blinvpn_bot';

function getPanelToken(): string {
  return typeof window !== 'undefined' ? localStorage.getItem('panel_token') || '' : '';
}
function setPanelToken(token: string): void {
  if (typeof window !== 'undefined') localStorage.setItem('panel_token', token);
}
function clearPanelToken(): void {
  if (typeof window !== 'undefined') localStorage.removeItem('panel_token');
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `/api${cleanPath}`;
  const headers: any = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (cleanPath.startsWith('/panel')) {
    const token = getPanelToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    if (res.status === 401) {
      clearPanelToken();
      window.location.reload();
    }
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  try { return await res.json(); } catch { return null; }
}

// ==========================================================
// 0.1 PAGINATION / SERVER-SIDE SEARCH
// ==========================================================

const PAGE_SIZE = 100;

function parseListResponse(res: any): { items: any[]; total: number | null } {
  if (Array.isArray(res)) return { items: res, total: null };
  if (res && typeof res === 'object') {
    const items =
      (Array.isArray(res.items) && res.items) ||
      (Array.isArray(res.data) && res.data) ||
      (Array.isArray(res.results) && res.results) ||
      (Array.isArray(res.rows) && res.rows) || [];
    const totalRaw = res.total ?? res.count ?? res.total_count ?? res.totalCount ?? null;
    const total = totalRaw == null ? null : Number(totalRaw);
    return { items, total: Number.isFinite(total as number) ? total : null };
  }
  return { items: [], total: null };
}

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

interface UsePaginatedListOptions {
  basePath: string;
  search: string;
  extraParams?: Record<string, string | undefined>;
  mapItem: (raw: any) => any;
  clientFilter?: (item: any) => boolean;
  enabled?: boolean;
  reloadKey?: number;
}

function usePaginatedList(opts: UsePaginatedListOptions) {
  const { basePath, search, extraParams, mapItem, clientFilter, enabled = true, reloadKey = 0 } = opts;
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [page, setPageState] = useState(1);
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localReload, setLocalReload] = useState(0);
  const extraKey = JSON.stringify(extraParams || {});

  useEffect(() => { setPageState(1); }, [debouncedSearch, extraKey]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const qp = new URLSearchParams();
        qp.set('limit', String(PAGE_SIZE));
        qp.set('offset', String(offset));
        qp.set('page', String(page));
        if (debouncedSearch) { qp.set('search', debouncedSearch); qp.set('q', debouncedSearch); }
        if (extraParams) {
          for (const [k, v] of Object.entries(extraParams)) {
            if (v != null && v !== '' && v !== 'all') qp.set(k, v);
          }
        }
        const res = await apiFetch(`${basePath}?${qp.toString()}`);
        if (cancelled) return;
        const { items: rawItems, total: serverTotal } = parseListResponse(res);
        const backendIgnoresPaging = rawItems.length > PAGE_SIZE;

        if (backendIgnoresPaging) {
          let all = rawItems.map(mapItem);
          if (debouncedSearch) {
            const q = debouncedSearch.toLowerCase();
            all = all.filter((it: any) => searchableMatch(it, q));
          }
          if (clientFilter) all = all.filter(clientFilter);
          const start = (page - 1) * PAGE_SIZE;
          setItems(all.slice(start, start + PAGE_SIZE));
          setTotal(all.length);
        } else {
          let pageItems = rawItems.map(mapItem);
          if (clientFilter) pageItems = pageItems.filter(clientFilter);
          let totalCount: number;
          if (serverTotal != null) totalCount = serverTotal;
          else if (pageItems.length < PAGE_SIZE) totalCount = offset + pageItems.length;
          else totalCount = offset + pageItems.length + 1;
          setItems(pageItems);
          setTotal(totalCount);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || 'Не удалось загрузить данные');
          setItems([]);
          setTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath, page, debouncedSearch, extraKey, enabled, reloadKey, localReload]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const setPage = (p: number) => setPageState(Math.min(Math.max(1, p), Math.max(1, totalPages)));

  return {
    items, total, page, totalPages, loading, error, setPage,
    nextPage: () => setPage(page + 1),
    prevPage: () => setPage(page - 1),
    reload: () => setLocalReload((n) => n + 1),
  };
}

function searchableMatch(item: any, q: string): boolean {
  const fields = [item.username, item.name, item.user, item.key, item.refCode,
    item.telegramId != null ? String(item.telegramId) : '', item.id != null ? String(item.id) : ''];
  return fields.filter((f) => f != null && f !== '').map((f) => String(f).toLowerCase()).join(' ').includes(q);
}

// ==========================================================
// 1. TYPES
// ==========================================================

type ToastType = 'success' | 'error' | 'info';
type TransactionType = 'income' | 'expense';
type UserStatus = 'Active' | 'Trial' | 'Banned' | 'Expired';
type KeyStatus = 'Active' | 'Expired' | 'Banned' | 'Blocked';

interface Toast { id: number; title: string; message?: string; type: ToastType; }

interface Transaction {
  id: number; user: string; amount: number; type: TransactionType;
  status: string; method: string; date: string; hash: string;
}

interface User {
  id: number; telegramId: number; username: string; balance: number; status: UserStatus;
  regDate: string; paidUntil: string; refCode: string; isPartner: boolean;
  partnerBalance: number; partnerRate: number; secondLevelRate: number;
  referrals: number; inBlacklist: boolean;
}

interface KeyItem {
  id: number; key: string; user: string; status: KeyStatus; expiry: number;
  trafficUsed: number; trafficLimit: number; devicesUsed: number; devicesLimit: number;
}

interface Promo {
  id: number; code: string; type: 'balance' | 'discount' | 'ref_boost' | 'subscription';
  value: string; uses: number; limit: number; expires: string;
}

interface TrackingLink {
  id: number; code: string; name: string; promocode: string | null; welcome_message: string | null;
  url: string; clicks: number; is_active: boolean; created_at: string; unique_users: number;
  new_users: number; total_revenue: number; paid_users: number; active_subscriptions: number;
  total_keys: number; conversion_rate: number;
}

interface TrackingLinkUser {
  user_id: number; telegram_id: number; username: string | null; full_name: string | null;
  is_new_user: boolean; visited_at: string; trial_used: boolean; total_spent: number;
  keys_count: number; active_keys: number; has_paid: boolean;
}

// ==========================================================
// 2. SHARED HELPERS & PRIMITIVES
// ==========================================================

const fmtInt = (v: number | null | undefined) => (v ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 });
const fmtMoney = (v: number | null | undefined) => `${fmtInt(v)} ₽`;
const fmtMoneyShort = (v: number | null | undefined) =>
  (v ?? 0) >= 1_000_000 ? `${((v ?? 0) / 1_000_000).toFixed(1)}M ₽` : fmtMoney(v);
const gb = (bytes: number) => (bytes / 1024 ** 3);

function toSeries(raw: any): { label: string; value: number }[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map((d: any) => ({
    label: String(d.label ?? d.date ?? d.day ?? d.name ?? ''),
    value: Number(d.value ?? d.amount ?? d.revenue ?? d.total ?? d.count ?? 0) || 0,
  }));
}

const Spinner: React.FC<{ size?: number; className?: string }> = ({ size = 20, className = '' }) => (
  <Loader size={size} className={`animate-spin ${className}`} style={{ color: 'var(--muted)' }} />
);

// ── Modal shell ───────────────────────────────────────────
const Modal: React.FC<{
  onClose: () => void;
  title?: React.ReactNode;
  icon?: React.ElementType;
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
  z?: number;
}> = ({ onClose, title, icon: Icon, footer, width = 460, children, z = 60 }) => (
  <div className="modal-backdrop" style={{ zIndex: z }} onClick={onClose}>
    <div className="modal" style={{ maxWidth: width }} onClick={(e) => e.stopPropagation()}>
      {title != null && (
        <div className="modal-head">
          <div className="modal-title">{Icon && <Icon size={18} className="faint" />}{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
      )}
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  </div>
);

// ── Toggle ────────────────────────────────────────────────
const Toggle: React.FC<{ on: boolean; onChange: () => void }> = ({ on, onChange }) => (
  <button type="button" className={`toggle ${on ? 'on' : ''}`} onClick={onChange} aria-pressed={on}>
    <span className="knob" />
  </button>
);

// ── Segmented control ─────────────────────────────────────
function Segmented<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={`seg-item ${value === o.value ? 'on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────
const Stat: React.FC<{ title: string; value: React.ReactNode; icon: React.ElementType; sub?: string }> =
  ({ title, value, icon: Icon, sub }) => (
    <div className="stat">
      <div className="stat-top">
        <span className="stat-label">{title}</span>
        <Icon size={18} className="stat-ico" />
      </div>
      <div className="flex items-baseline gap-2">
        <span className="stat-value">{value}</span>
        {sub && <span className="stat-sub">{sub}</span>}
      </div>
    </div>
  );

// ── Vertical bar chart (signature) ────────────────────────
const BarChart: React.FC<{
  data: { label: string; value: number }[];
  format?: (v: number) => string;
  height?: number;
}> = ({ data, format = (v) => String(v), height = 160 }) => {
  if (!data.length) return <p className="sub">Нет данных для графика</p>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const maxIdx = data.reduce((mi, d, i, a) => (d.value > a[mi].value ? i : mi), 0);
  return (
    <div className="bars" style={{ height }}>
      {data.map((d, i) => (
        <div className="bar-col" key={i} title={`${d.label}: ${format(d.value)}`}>
          <span className="bar-v">{d.value ? format(d.value) : ''}</span>
          <div className="bar-track">
            <div className={`bar ${i === maxIdx ? 'hot' : ''}`} style={{ height: `${Math.max(3, (d.value / max) * 100)}%` }} />
          </div>
          <span className="bar-x">{d.label}</span>
        </div>
      ))}
    </div>
  );
};

// ── Pagination ────────────────────────────────────────────
const PaginationBar: React.FC<{
  page: number; totalPages: number; total: number; loading?: boolean;
  onPrev: () => void; onNext: () => void; totalLabel?: string;
}> = ({ page, totalPages, total, loading, onPrev, onNext, totalLabel = 'Всего в базе' }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
    <div className="flex items-center gap-2 sub">
      {loading && <Spinner size={14} />}
      <span>{totalLabel}: <span style={{ color: 'var(--text)', fontWeight: 600 }}>{total.toLocaleString('ru-RU')}</span></span>
    </div>
    <div className="flex items-center gap-2">
      <button className="btn sm" onClick={onPrev} disabled={page <= 1 || loading}>Назад</button>
      <span className="sub tabular-nums" style={{ minWidth: 64, textAlign: 'center' }}>{page} / {totalPages}</span>
      <button className="btn sm" onClick={onNext} disabled={page >= totalPages || loading}>Вперёд</button>
    </div>
  </div>
);

// ── Toasts ────────────────────────────────────────────────
const ToastContainer: React.FC<{ toasts: Toast[]; removeToast: (id: number) => void }> = ({ toasts, removeToast }) => (
  <div className="toasts">
    {toasts.map((t) => (
      <div key={t.id} className={`toast ${t.type === 'error' ? 'error' : ''}`} role="alert">
        {t.type === 'error' ? <AlertCircle size={18} className="faint" style={{ marginTop: 1 }} />
          : <CheckCircle size={18} style={{ marginTop: 1 }} />}
        <div className="flex-1">
          <div className="toast-title">{t.title}</div>
          {t.message && <div className="toast-msg">{t.message}</div>}
        </div>
        <button className="icon-btn" style={{ width: 24, height: 24, border: 0 }} onClick={() => removeToast(t.id)}><X size={14} /></button>
      </div>
    ))}
  </div>
);

// status → badge class
const userStatusBadge = (s: UserStatus, blacklist?: boolean) => {
  if (blacklist || s === 'Banned') return { cls: 'danger', label: 'Заблокирован' };
  if (s === 'Active') return { cls: 'solid', label: 'Активен' };
  if (s === 'Trial') return { cls: 'mute', label: 'Триал' };
  return { cls: 'line', label: 'Истёк' };
};
const keyStatusBadge = (s: KeyStatus) => {
  if (s === 'Active') return { cls: 'solid', label: 'Активен' };
  if (s === 'Banned' || s === 'Blocked') return { cls: 'danger', label: 'Заблокирован' };
  return { cls: 'line', label: 'Истёк' };
};

// ==========================================================
// 3. MODALS
// ==========================================================

const DEVICE_LIMIT_PRESETS = [1, 2, 3, 5, 10, 15, 20];

const clampNumber = (raw: string, min: number, max: number, fallback: number) => {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

type ActionConfig = { title: string; label: string; icon: React.ElementType; type: string; min?: number; max?: number; presets?: number[]; };

const ACTION_MAP: Record<string, ActionConfig> = {
  ADD_BALANCE:        { title: 'Начислить баланс', label: 'Сумма, ₽', icon: ArrowUpRight, type: 'number' },
  SUB_BALANCE:        { title: 'Списать баланс', label: 'Сумма, ₽', icon: ArrowDownLeft, type: 'number' },
  EXTEND_SUB:         { title: 'Продлить подписку', label: 'Дней', icon: Clock, type: 'number' },
  REDUCE_SUB:         { title: 'Уменьшить срок', label: 'Дней', icon: Clock, type: 'number' },
  SET_TRAFFIC:        { title: 'Лимит трафика', label: 'Макс. трафик, ГБ', icon: Database, type: 'number' },
  SET_DEVICES:        { title: 'Лимит устройств', label: 'Устройств (1–20)', icon: Smartphone, type: 'number', min: 1, max: 20, presets: DEVICE_LIMIT_PRESETS },
  BAN:                { title: 'Заблокировать', label: 'Причина', icon: Ban, type: 'text' },
  UNBAN:              { title: 'Разблокировать', label: '', icon: CheckCircle, type: 'text' },
  MASS_ADD_DAYS:      { title: 'Всем добавить дни', label: 'Дней', icon: Calendar, type: 'number' },
  MASS_ADD_BALANCE:   { title: 'Всем начислить', label: 'Сумма, ₽', icon: DollarSign, type: 'number' },
  MASS_BAN:           { title: 'Заблокировать всех', label: 'Причина', icon: Ban, type: 'text' },
  MASS_UNBAN:         { title: 'Разблокировать всех', label: '', icon: CheckCircle, type: 'text' },
  MASS_RESET_TRIAL:   { title: 'Сбросить пробный период', label: '', icon: RefreshCw, type: 'text' },
  MASS_DELETE_KEYS:   { title: 'Удалить все ключи', label: '', icon: Trash2, type: 'text' },
  MASS_SET_PARTNER:   { title: 'Сделать партнёрами', label: 'Процент реферала', icon: UserPlus, type: 'number' },
  MASS_REMOVE_PARTNER:{ title: 'Убрать партнёрство', label: '', icon: UserMinus, type: 'text' },
};

const UserActionModal: React.FC<{
  type: string; onClose: () => void; onConfirm: (value: string, notify: boolean) => void; initialValue?: string;
}> = ({ type, onClose, onConfirm, initialValue = '' }) => {
  const [value, setValue] = useState(initialValue);
  const [notify, setNotify] = useState(true);
  const config = ACTION_MAP[type] || { title: 'Действие', label: 'Значение', icon: Settings, type: 'text' };
  const numMin = config.min ?? 0;
  const numMax = config.max ?? 999999;
  const numValue = config.type === 'number' ? clampNumber(value, numMin, numMax, numMin || 0) : 0;
  const showStepper = config.type === 'number' && (!!config.presets?.length || config.max !== undefined);
  const setNum = (n: number) => setValue(String(Math.max(numMin, Math.min(numMax, n))));
  const isDestructive = /BAN|DELETE|REMOVE|SUB_/.test(type);

  return (
    <Modal
      onClose={onClose} title={config.title} icon={config.icon} width={400} z={70}
      footer={
        <>
          <button className="btn block" onClick={onClose}>Отмена</button>
          <button
            className={`btn block ${isDestructive ? 'danger' : 'solid'}`}
            onClick={() => onConfirm(config.type === 'number' ? String(clampNumber(value, numMin, numMax, numMin || 0)) : value, notify)}
          >Применить</button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {config.label && (
          <div>
            <label className="field-label">{config.label}</label>
            {showStepper ? (
              <div className="flex flex-col gap-3">
                <div className="stepper">
                  <button className="step" onClick={() => setNum(numValue - 1)} disabled={numValue <= numMin}>−</button>
                  <input className="input center mono" style={{ fontSize: 20 }} type="number" value={value}
                    min={numMin} max={numMax} autoFocus onChange={(e) => setValue(e.target.value)} />
                  <button className="step" onClick={() => setNum(numValue + 1)} disabled={numValue >= numMax}>+</button>
                </div>
                {config.presets && (
                  <div className="flex flex-wrap gap-2">
                    {config.presets.map((p) => (
                      <button key={p} className={`chip mono ${numValue === p ? 'on' : ''}`} onClick={() => setNum(p)}>{p}</button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <input className="input mono" type={config.type} value={value} placeholder={config.type === 'number' ? '0' : ''}
                autoFocus min={numMin} max={config.max} onChange={(e) => setValue(e.target.value)} />
            )}
          </div>
        )}
        <label className="inset flex items-center justify-between gap-3" style={{ padding: 12, cursor: 'pointer' }}>
          <div>
            <div style={{ fontWeight: 500 }}>Уведомить пользователя</div>
            <div className="sub">Отправить сообщение в бот</div>
          </div>
          <Toggle on={notify} onChange={() => setNotify(!notify)} />
        </label>
      </div>
    </Modal>
  );
};

const KeyEditModal: React.FC<{
  keyItem: KeyItem; onClose: () => void; onSave: (id: number, expiry: number) => void;
  onDelete: (id: number) => void; onBlock?: (id: number, blocked: boolean) => void;
}> = ({ keyItem, onClose, onSave, onDelete, onBlock }) => {
  const [expiryDays, setExpiryDays] = useState(keyItem.expiry);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isBlocked, setIsBlocked] = useState(keyItem.status === 'Blocked');
  const [blockLoading, setBlockLoading] = useState(false);
  const usedPct = keyItem.trafficLimit > 0 ? Math.min(100, (keyItem.trafficUsed / keyItem.trafficLimit) * 100) : 0;
  const meterCls = usedPct > 90 ? 'crit' : usedPct > 70 ? 'warn' : '';

  const toggleBlock = async () => {
    setBlockLoading(true);
    try {
      const next = !isBlocked;
      await apiFetch(`/panel/keys/${keyItem.id}/block`, { method: 'POST', body: JSON.stringify({ blocked: next }) });
      setIsBlocked(next);
      onBlock?.(keyItem.id, next);
    } catch (e) { console.error(e); } finally { setBlockLoading(false); }
  };

  if (confirmDelete) {
    return (
      <Modal onClose={onClose} title="Удалить ключ?" icon={AlertTriangle} width={400} z={70}
        footer={<>
          <button className="btn block" onClick={() => setConfirmDelete(false)}>Отмена</button>
          <button className="btn block danger" onClick={() => onDelete(keyItem.id)}>Удалить</button>
        </>}>
        <p className="muted" style={{ lineHeight: 1.5 }}>Действие необратимо. Пользователь потеряет доступ по этому ключу.</p>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} title="Редактирование ключа" icon={Key} width={480} z={70}
      footer={<>
        <button className="btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={16} /> Удалить</button>
        <button className="btn solid block" onClick={() => onSave(keyItem.id, expiryDays)}><Save size={16} /> Сохранить</button>
      </>}>
      <div className="flex flex-col gap-4">
        <div className="inset mono" style={{ padding: 12, fontSize: 12, color: 'var(--muted)', wordBreak: 'break-all', userSelect: 'all' }}>{keyItem.key}</div>

        <div className="inset" style={{ padding: 14 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="sub">Использовано трафика</span>
            <span className="mono" style={{ fontSize: 13 }}>
              {gb(keyItem.trafficUsed).toFixed(2)} / {keyItem.trafficLimit > 0 ? gb(keyItem.trafficLimit).toFixed(0) : '∞'} ГБ
            </span>
          </div>
          <div className="meter"><i className={meterCls} style={{ width: `${usedPct}%` }} /></div>
          {usedPct > 90 && <div className="flex items-center gap-1 mt-2" style={{ color: 'var(--danger)', fontSize: 12 }}><AlertTriangle size={12} /> Трафик почти исчерпан</div>}
        </div>

        <div className="inset flex items-center justify-between gap-3" style={{ padding: 12 }}>
          <div>
            <div style={{ fontWeight: 500 }}>Блокировка ключа</div>
            <div className="sub">{isBlocked ? 'Заблокирован вручную' : 'Ключ активен'}</div>
          </div>
          <button className={`btn sm ${isBlocked ? 'solid' : 'danger'}`} onClick={toggleBlock} disabled={blockLoading}>
            {blockLoading ? '…' : isBlocked ? 'Разблокировать' : 'Заблокировать'}
          </button>
        </div>

        <div>
          <label className="field-label">Осталось дней</label>
          <div className="stepper">
            <button className="step" onClick={() => setExpiryDays(Math.max(0, Number(expiryDays) - 1))}>−</button>
            <input className="input center mono" style={{ fontSize: 18 }} type="number" value={expiryDays}
              onChange={(e) => setExpiryDays(parseInt(e.target.value) || 0)} />
            <button className="step" onClick={() => setExpiryDays(Number(expiryDays) + 1)}>+</button>
          </div>
        </div>
      </div>
    </Modal>
  );
};

const TransactionModal: React.FC<{ transaction: Transaction; onClose: () => void }> = ({ transaction, onClose }) => {
  if (!transaction) return null;
  const isIncome = transaction.type === 'income';
  const Row = ({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) => (
    <div className="flex justify-between items-center" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <span className="muted flex items-center gap-2"><Icon size={14} /> {label}</span>
      <span>{children}</span>
    </div>
  );
  return (
    <Modal onClose={onClose} title={isIncome ? 'Пополнение баланса' : 'Списание средств'} icon={isIncome ? ArrowUpRight : ArrowDownLeft} width={440}
      footer={<button className="btn block" onClick={onClose}>Закрыть</button>}>
      <div className="sub mb-3">{transaction.date}</div>
      <Row icon={Hash} label="ID"><span className="mono">#{transaction.id}</span></Row>
      <Row icon={Users} label="Пользователь">{transaction.user}</Row>
      <Row icon={DollarSign} label="Сумма"><span style={{ fontWeight: 600, color: isIncome ? 'var(--text)' : 'var(--muted)' }}>{isIncome ? '+' : ''}{transaction.amount} ₽</span></Row>
      <Row icon={CreditCard} label="Метод">{transaction.method}</Row>
      <Row icon={Hash} label="Hash"><span className="mono faint" style={{ fontSize: 12 }}>{transaction.hash || '—'}</span></Row>
    </Modal>
  );
};

const CreateKeyModal: React.FC<{ onClose: () => void; users: User[]; onToast: (t: string, m: string, ty: ToastType) => void }> =
  ({ onClose, users = [], onToast }) => {
  const [searchUser, setSearchUser] = useState('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [isTrial, setIsTrial] = useState(false);
  const [isForever, setIsForever] = useState(false);
  const [params, setParams] = useState({ days: 30, traffic: 100, devices: 5 });
  const [selectedSquads, setSelectedSquads] = useState<string[]>([]);
  const [squads, setSquads] = useState<{ uuid: string; name: string }[]>([]);
  const [loadingSquads, setLoadingSquads] = useState(false);

  const debouncedUserSearch = useDebouncedValue(searchUser.trim(), 300);
  const [remoteUsers, setRemoteUsers] = useState<User[]>([]);

  useEffect(() => {
    if (!debouncedUserSearch) { setRemoteUsers([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const qp = new URLSearchParams({ limit: '10', offset: '0', search: debouncedUserSearch, q: debouncedUserSearch });
        const res = await apiFetch(`/panel/users?${qp.toString()}`);
        if (cancelled) return;
        let mapped = parseListResponse(res).items.map(mapApiUser);
        if (mapped.length > 10) {
          const q = debouncedUserSearch.toLowerCase();
          mapped = mapped.filter((u: User) => u.username.toLowerCase().includes(q) || u.telegramId.toString().includes(q));
        }
        setRemoteUsers(mapped.slice(0, 8));
      } catch { if (!cancelled) setRemoteUsers([]); }
    })();
    return () => { cancelled = true; };
  }, [debouncedUserSearch]);

  const filteredUsers: User[] = (() => {
    if (!searchUser) return [];
    if (remoteUsers.length > 0) return remoteUsers;
    const q = searchUser.toLowerCase();
    return (users || []).filter((u) => u.username.toLowerCase().includes(q) || u.telegramId.toString().includes(q)).slice(0, 8);
  })();

  useEffect(() => {
    (async () => {
      setLoadingSquads(true);
      try {
        const data = await apiFetch('/panel/remnawave/squads');
        if (Array.isArray(data)) setSquads(data);
      } catch (e) { console.error(e); onToast('Ошибка', 'Не удалось загрузить сквады из Remnawave', 'error'); }
      finally { setLoadingSquads(false); }
    })();
  }, []);

  useEffect(() => {
    if (isTrial) setParams({ days: 1, traffic: 5, devices: 1 });
    else if (isForever) setParams((p) => ({ ...p, traffic: 0, devices: 10 }));
    else setParams({ days: 30, traffic: 100, devices: 5 });
  }, [isTrial, isForever]);

  const handleCreate = async () => {
    if (!selectedUser) { onToast('Ошибка', 'Выберите пользователя', 'error'); return; }
    try {
      const finalDays = isForever ? 27394 : params.days;
      await apiFetch('/panel/keys', {
        method: 'POST',
        body: JSON.stringify({ user_id: selectedUser.id, days: finalDays, traffic: params.traffic, devices: params.devices, is_trial: isTrial, is_forever: isForever, squads: selectedSquads }),
      });
      onToast('Готово', isForever ? 'Бесконечный ключ создан' : 'Ключ создан и отправлен пользователю', 'success');
      onClose();
    } catch (e: any) { onToast('Ошибка', e.message || 'Не удалось создать ключ', 'error'); }
  };

  return (
    <Modal onClose={onClose} title="Создание ключа" icon={Plus} width={560} z={70}
      footer={<button className="btn solid block" onClick={handleCreate}>Создать ключ</button>}>
      <div className="flex flex-col gap-5">
        <div style={{ position: 'relative' }}>
          <label className="field-label">Пользователь</label>
          <div style={{ position: 'relative' }}>
            <input className="input" value={selectedUser ? selectedUser.username : searchUser}
              placeholder="ID или username"
              onChange={(e) => { setSearchUser(e.target.value); setSelectedUser(null); }}
              style={selectedUser ? { borderColor: 'var(--border-strong)' } : undefined} />
            {selectedUser && <CheckCircle size={16} style={{ position: 'absolute', right: 12, top: 12, color: 'var(--text)' }} />}
          </div>
          {searchUser && !selectedUser && filteredUsers.length > 0 && (
            <div className="menu" style={{ left: 0, right: 0 }}>
              {filteredUsers.map((u) => (
                <button key={u.id} className="menu-item" onClick={() => { setSelectedUser(u); setSearchUser(''); }}>
                  <span className="flex-1">{u.username}</span>
                  <span className="faint mono" style={{ fontSize: 12 }}>ID {u.telegramId}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="chip" style={{ padding: 14, justifyContent: 'space-between' }} onClick={() => { setIsTrial(!isTrial); setIsForever(false); }}>
            <div><div style={{ fontWeight: 500, color: 'var(--text)' }}>Пробный</div><div className="sub">1 день · 5 ГБ · 1 устр.</div></div>
            <Toggle on={isTrial} onChange={() => { setIsTrial(!isTrial); setIsForever(false); }} />
          </label>
          <label className="chip" style={{ padding: 14, justifyContent: 'space-between' }} onClick={() => { setIsForever(!isForever); setIsTrial(false); }}>
            <div><div style={{ fontWeight: 500, color: 'var(--text)' }}>∞ Навсегда</div><div className="sub">До 2099 года</div></div>
            <Toggle on={isForever} onChange={() => { setIsForever(!isForever); setIsTrial(false); }} />
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div><label className="field-label">Дней</label><input className="input center mono" type="number" min={1} value={isForever ? 27394 : params.days} disabled={isForever} onChange={(e) => setParams({ ...params, days: parseInt(e.target.value) || 0 })} /></div>
          <div><label className="field-label">Трафик, ГБ</label><input className="input center mono" type="number" min={0} value={params.traffic} onChange={(e) => setParams({ ...params, traffic: parseInt(e.target.value) || 0 })} /></div>
          <div><label className="field-label">Устройств</label><input className="input center mono" type="number" min={1} max={20} value={params.devices} onChange={(e) => setParams({ ...params, devices: Math.max(1, Math.min(20, parseInt(e.target.value) || 1)) })} /></div>
        </div>

        {!isTrial && (
          <div className="flex flex-wrap gap-2">
            {DEVICE_LIMIT_PRESETS.map((p) => (
              <button key={p} className={`chip mono ${params.devices === p ? 'on' : ''}`} onClick={() => setParams((s) => ({ ...s, devices: p }))}>{p} устр.</button>
            ))}
          </div>
        )}

        <div>
          <label className="field-label">Сквады</label>
          {loadingSquads ? <div className="sub">Загрузка…</div>
            : squads.length === 0 ? <div className="sub">Нет доступных сквадов</div>
            : <div className="flex flex-wrap gap-2">
                {squads.map((sq) => (
                  <button key={sq.uuid} className={`chip ${selectedSquads.includes(sq.uuid) ? 'on' : ''}`}
                    onClick={() => setSelectedSquads((prev) => prev.includes(sq.uuid) ? prev.filter((s) => s !== sq.uuid) : [...prev, sq.uuid])}>
                    {sq.name}
                  </button>
                ))}
              </div>}
        </div>
      </div>
    </Modal>
  );
};

interface UserSubscription {
  id: number; key_uuid: string; short_uuid: string; status: string; expiry_date: string;
  days_left: number; traffic_used: number; traffic_limit: number; devices_limit: number; type: string;
}
interface ReferralItem { id: number; telegram_id: number; username: string; full_name?: string; is_partner: number; partner_rate: number; }

const UserDetailModal: React.FC<{
  user: User; onClose: () => void; onToast: (t: string, m: string, ty: ToastType) => void; onOpenUser: (u: User) => void;
}> = ({ user, onClose, onToast, onOpenUser }) => {
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [subAction, setSubAction] = useState<{ subId: number; action: string; initialValue: string } | null>(null);
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [partnerRateDraft, setPartnerRateDraft] = useState<number>(user?.partnerRate ?? 25);
  const [secondLevelRateDraft, setSecondLevelRateDraft] = useState<number>(user?.secondLevelRate ?? 5);
  const [referrals, setReferrals] = useState<ReferralItem[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const refreshSubscriptions = async () => {
    setLoadingSubs(true);
    try { const data = await apiFetch(`/panel/users/${user.id}/subscriptions`); setSubscriptions(Array.isArray(data) ? data : []); }
    catch { onToast('Ошибка', 'Не удалось загрузить подписки', 'error'); } finally { setLoadingSubs(false); }
  };
  const refreshReferrals = async () => {
    setLoadingRefs(true);
    try { const data = await apiFetch(`/panel/users/${user.id}/referrals`); setReferrals(Array.isArray(data) ? data : []); }
    catch { onToast('Ошибка', 'Не удалось загрузить рефералов', 'error'); } finally { setLoadingRefs(false); }
  };

  useEffect(() => {
    if (!user) return;
    setPartnerRateDraft(user.partnerRate ?? 25);
    setSecondLevelRateDraft(user.secondLevelRate ?? 5);
    refreshSubscriptions();
    refreshReferrals();
  }, [user]);

  if (!user) return null;

  const confirmAction = async (value: string, notify: boolean) => {
    try {
      await apiFetch(`/panel/users/${user.id}/action`, { method: 'POST', body: JSON.stringify({ action: activeAction, value, notify }) });
      onToast('Готово', 'Действие выполнено', 'success');
      await refreshSubscriptions();
    } catch { onToast('Ошибка', 'Не удалось выполнить действие', 'error'); }
    setActiveAction(null);
  };

  const handleNotify = async () => {
    const message = prompt('Сообщение пользователю:');
    if (!message) return;
    try {
      await apiFetch(`/panel/users/${user.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'NOTIFY', value: message, notify: true }) });
      onToast('Готово', 'Уведомление отправлено', 'success');
    } catch { onToast('Ошибка', 'Не удалось отправить', 'error'); }
  };

  const handleSubAction = (subId: number, action: 'EXTEND_SUB' | 'REDUCE_SUB' | 'SET_TRAFFIC' | 'SET_DEVICES') => {
    const sub = subscriptions.find((s) => s.id === subId);
    const initial: Record<string, string> = {
      EXTEND_SUB: '30', REDUCE_SUB: '7',
      SET_TRAFFIC: String(sub?.traffic_limit ? Math.round(gb(sub.traffic_limit)) : 100),
      SET_DEVICES: String(sub?.devices_limit ?? 1),
    };
    setSubAction({ subId, action, initialValue: initial[action] || '' });
  };

  const confirmSubAction = async (value: string, notify: boolean) => {
    if (!subAction) return;
    try {
      await apiFetch(`/panel/users/${user.id}/action`, { method: 'POST', body: JSON.stringify({ action: subAction.action, value, notify, subscription_id: subAction.subId }) });
      onToast('Готово', 'Изменения применены', 'success');
      await refreshSubscriptions();
    } catch { onToast('Ошибка', 'Не удалось применить', 'error'); } finally { setSubAction(null); }
  };

  const handleBlockSubscription = async (subId: number, block: boolean) => {
    try {
      await apiFetch(`/panel/keys/${subId}/block`, { method: 'POST', body: JSON.stringify({ blocked: block }) });
      onToast('Готово', block ? 'Подписка заблокирована' : 'Подписка разблокирована', 'success');
      await refreshSubscriptions();
    } catch { onToast('Ошибка', 'Не удалось изменить статус', 'error'); }
  };

  const saveReferralRates = async () => {
    try {
      await apiFetch(`/panel/users/${user.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'SET_PARTNER_RATE', value: String(partnerRateDraft), notify: true }) });
      await apiFetch(`/panel/users/${user.id}/action`, { method: 'POST', body: JSON.stringify({ action: 'SET_SECOND_LEVEL_RATE', value: String(secondLevelRateDraft), notify: false }) });
      onToast('Готово', 'Реферальные ставки обновлены', 'success');
    } catch (e: any) { onToast('Ошибка', e?.message || 'Не удалось сохранить', 'error'); }
  };

  const openReferralProfile = async (refId: number) => {
    try {
      const u = await apiFetch(`/panel/users/${refId}`);
      if (!u) return;
      onOpenUser(mapApiUser(u));
    } catch { onToast('Ошибка', 'Не удалось открыть профиль', 'error'); }
  };

  const unlinkReferral = async (refId: number) => {
    if (!confirm('Отвязать этого реферала?')) return;
    try {
      await apiFetch(`/panel/users/${user.id}/referrals/${refId}/unlink`, { method: 'POST' });
      onToast('Готово', 'Реферал отвязан', 'success');
      await refreshReferrals();
    } catch { onToast('Ошибка', 'Не удалось отвязать', 'error'); }
  };

  const st = userStatusBadge(user.status, user.inBlacklist);

  return (
    <div className="modal-backdrop" style={{ zIndex: 60, alignItems: 'flex-start', overflowY: 'auto' }} onClick={onClose}>
      {activeAction && <UserActionModal type={activeAction} onClose={() => setActiveAction(null)} onConfirm={confirmAction} />}
      {subAction && <UserActionModal type={subAction.action} initialValue={subAction.initialValue} onClose={() => setSubAction(null)} onConfirm={confirmSubAction} />}
      <div className="modal" style={{ maxWidth: 860, margin: '32px 0' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div className="flex items-center gap-3">
            <span className="avatar" style={{ width: 44, height: 44, fontSize: 16 }}>{user.username.replace('@', '').charAt(0).toUpperCase()}</span>
            <div>
              <div className="flex items-center gap-2">
                <span className="h-sec" style={{ fontSize: 18 }}>{user.username}</span>
                <span className={`badge ${st.cls}`}>{st.label}</span>
              </div>
              <div className="flex items-center gap-3 sub mt-1">
                <span className="mono">ID {user.telegramId}</span>
                <span className="flex items-center gap-1"><Calendar size={12} /> {user.regDate}</span>
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* left column */}
            <div className="flex flex-col gap-4">
              <div className="card" style={{ padding: 18 }}>
                <div className="flex items-center gap-2 mb-3"><DollarSign size={16} className="faint" /><span className="h-sec">Баланс</span></div>
                <div className="stat-value" style={{ fontSize: 28, marginBottom: 14 }}>{user.balance} ₽</div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn sm" onClick={() => setActiveAction('ADD_BALANCE')}><ArrowUpRight size={14} /> Начислить</button>
                  <button className="btn sm danger" onClick={() => setActiveAction('SUB_BALANCE')}><ArrowDownLeft size={14} /> Списать</button>
                </div>
              </div>

              <div className="card" style={{ padding: 18 }}>
                <div className="flex items-center gap-2 mb-3"><Zap size={16} className="faint" /><span className="h-sec">Подписки ({subscriptions.length})</span></div>
                {loadingSubs ? <div className="sub" style={{ textAlign: 'center', padding: 16 }}>Загрузка…</div>
                  : subscriptions.length === 0 ? <div className="sub" style={{ textAlign: 'center', padding: 16 }}>Нет активных подписок</div>
                  : <div className="flex flex-col gap-3" style={{ maxHeight: 420, overflowY: 'auto' }}>
                      {subscriptions.map((sub) => {
                        const sb = keyStatusBadge(sub.status as KeyStatus);
                        return (
                          <div key={sub.id} className="inset" style={{ padding: 12 }}>
                            <div className="flex justify-between items-start mb-2">
                              <div className="mono" style={{ fontSize: 12 }}>#{sub.short_uuid || sub.key_uuid?.slice(0, 8)}</div>
                              <span className={`badge ${sb.cls}`}>{sb.label}</span>
                            </div>
                            <div className="flex justify-between gap-2 sub" style={{ fontSize: 12 }}>
                              <span style={sub.days_left <= 3 ? { color: 'var(--danger)' } : undefined}>{sub.days_left <= 0 ? 'Истекла' : `${sub.days_left} дн.`}</span>
                              <span>{sub.devices_limit ?? 1} устр.</span>
                              <span>{sub.traffic_limit > 0 ? `${gb(sub.traffic_used).toFixed(1)} / ${gb(sub.traffic_limit).toFixed(0)} ГБ` : 'Безлимит'}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-3" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                              <button className="btn sm" onClick={() => handleSubAction(sub.id, 'EXTEND_SUB')}>Продлить</button>
                              <button className="btn sm" onClick={() => handleSubAction(sub.id, 'REDUCE_SUB')}>Уменьшить</button>
                              <button className="btn sm" onClick={() => handleSubAction(sub.id, 'SET_TRAFFIC')}>Трафик</button>
                              <button className="btn sm" onClick={() => handleSubAction(sub.id, 'SET_DEVICES')}>Устройства</button>
                              <button className={`btn sm ${sub.status === 'Blocked' ? 'solid' : 'danger'}`} style={{ gridColumn: 'span 2' }}
                                onClick={() => handleBlockSubscription(sub.id, sub.status !== 'Blocked')}>
                                {sub.status === 'Blocked' ? 'Разблокировать' : 'Заблокировать'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>}
              </div>

              {user.isPartner && (
                <div className="card" style={{ padding: 18 }}>
                  <div className="flex items-center gap-2 mb-3"><Users size={16} className="faint" /><span className="h-sec">Партнёрская программа</span></div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div className="inset" style={{ padding: 12 }}><div className="sub">Баланс</div><div className="stat-value" style={{ fontSize: 20 }}>{user.partnerBalance} ₽</div></div>
                    <div className="inset" style={{ padding: 12 }}><div className="sub">Рефералов</div><div className="stat-value" style={{ fontSize: 20 }}>{user.referrals}</div></div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <div><label className="field-label">Реф-код</label><input className="input mono" readOnly value={user.refCode} /></div>
                    <div><label className="field-label">1-я линия, %</label><input className="input" type="number" value={partnerRateDraft} onChange={(e) => setPartnerRateDraft(Number(e.target.value) || 0)} /></div>
                    <div><label className="field-label">2-я линия, %</label><input className="input" type="number" value={secondLevelRateDraft} onChange={(e) => setSecondLevelRateDraft(Number(e.target.value) || 0)} /></div>
                    <button className="btn solid block" onClick={saveReferralRates}>Сохранить ставки</button>
                  </div>
                </div>
              )}
            </div>

            {/* right column */}
            <div className="flex flex-col gap-4">
              <div className="card" style={{ padding: 18 }}>
                <div className="flex items-center gap-2 mb-3"><Users size={16} className="faint" /><span className="h-sec">Рефералы</span></div>
                {loadingRefs ? <div className="sub" style={{ textAlign: 'center', padding: 16 }}>Загрузка…</div>
                  : referrals.length === 0 ? <div className="sub" style={{ textAlign: 'center', padding: 16 }}>Нет привязанных рефералов</div>
                  : <div className="flex flex-col gap-2" style={{ maxHeight: 360, overflowY: 'auto' }}>
                      {referrals.map((r) => (
                        <div key={r.id} className="inset flex items-center justify-between" style={{ padding: 12 }}>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 500 }}>{r.username ? (String(r.username).startsWith('@') ? r.username : `@${r.username}`) : `id${r.id}`}</div>
                            <div className="sub mono">{r.telegram_id}{r.is_partner ? ` · партнёр ${r.partner_rate}%` : ''}</div>
                          </div>
                          <div className="flex gap-2">
                            <button className="btn sm" onClick={() => openReferralProfile(r.id)}>Открыть</button>
                            <button className="btn sm danger" onClick={() => unlinkReferral(r.id)}>Отвязать</button>
                          </div>
                        </div>
                      ))}
                    </div>}
              </div>

              <div className="card" style={{ padding: 18 }}>
                <div className="flex items-center gap-2 mb-3"><Bell size={16} className="faint" /><span className="h-sec">Действия</span></div>
                <div className="flex flex-col gap-2">
                  <button className="btn block" onClick={handleNotify}><Bell size={16} /> Уведомить пользователя</button>
                  {user.status !== 'Banned' && !user.inBlacklist
                    ? <button className="btn block danger" onClick={() => setActiveAction('BAN')}><Ban size={16} /> Заблокировать</button>
                    : <button className="btn block" onClick={() => setActiveAction('UNBAN')}><CheckCircle size={16} /> Разблокировать{user.inBlacklist ? ' (из ЧС)' : ''}</button>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================================
// 4. MAPPERS
// ==========================================================

function mapApiUser(u: any): User {
  return {
    id: u.id,
    telegramId: u.telegram_id,
    username: u.username ? (String(u.username).startsWith('@') ? u.username : `@${u.username}`) : `id${u.telegram_id}`,
    balance: u.balance ?? 0,
    status: (u.in_blacklist || u.is_banned) ? 'Banned' : ((u.status as UserStatus) || 'Trial'),
    regDate: u.registration_date ? new Date(u.registration_date).toLocaleDateString('ru-RU') : '',
    paidUntil: u.paid_until ? new Date(u.paid_until).toLocaleDateString('ru-RU') : '—',
    refCode: u.referral_code || '',
    isPartner: !!u.is_partner,
    partnerBalance: u.partner_balance ?? 0,
    partnerRate: u.partner_rate ?? 25,
    secondLevelRate: u.second_level_rate ?? 5,
    referrals: u.referrals ?? 0,
    inBlacklist: !!u.in_blacklist,
  };
}

function mapApiKey(k: any): KeyItem {
  return {
    id: k.id,
    key: k.key_config || k.key_uuid || `key_${k.id}`,
    user: k.username || `@user_${k.user_id}`,
    status: (k.status as KeyStatus) || 'Active',
    expiry: k.expiry_date ? Math.ceil((new Date(k.expiry_date).getTime() - Date.now()) / 86_400_000) : 0,
    trafficUsed: k.traffic_used ?? 0,
    trafficLimit: k.traffic_limit ?? 0,
    devicesUsed: k.devices_used ?? 0,
    devicesLimit: k.devices_limit ?? 1,
  };
}

// ==========================================================
// 5. LOGIN
// ==========================================================

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [initInfo, setInitInfo] = useState<{ username?: string; password?: string; newAdmin?: boolean; passwordRegenerated?: boolean; message?: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const setupToken = params.get('setup_token') || '';
    const headers: Record<string, string> = {};
    if (setupToken) headers['X-Panel-Setup-Token'] = setupToken;
    const qs = setupToken ? `?setup_token=${encodeURIComponent(setupToken)}` : '';
    fetch(`/api/panel/auth/init${qs}`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.show_credentials && data.password && data.username) {
          setInitInfo({ username: data.username, password: data.password, newAdmin: !!data.new_admin, passwordRegenerated: !!data.password_regenerated, message: data.message });
          setUsername(data.username);
        }
      }).catch(() => {});
  }, []);

  const submitCreds = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch('/api/panel/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      const data = await res.json();
      if (res.ok && data.requires_2fa && data.temp_token) setTempToken(data.temp_token);
      else if (res.ok && data.session_token) { setPanelToken(data.session_token); onLogin(data.session_token); }
      else setError(data.error || 'Неверные учётные данные');
    } catch { setError('Ошибка подключения к серверу'); }
    setLoading(false);
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const res = await fetch('/api/panel/auth/verify-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ temp_token: tempToken, code: verifyCode }) });
      const data = await res.json();
      if (res.ok && data.session_token) { setPanelToken(data.session_token); onLogin(data.session_token); }
      else setError(data.error || 'Неверный код');
    } catch { setError('Ошибка подключения к серверу'); }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div className="card-lg rise" style={{ padding: 32, width: '100%', maxWidth: 400, background: 'var(--surface)', border: '1px solid var(--border-strong)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div className="avatar" style={{ width: 56, height: 56, borderRadius: 14, margin: '0 auto 14px' }}>
            <img src="https://blinvpn.cc/assets/logo.png" alt="BlinVPN" style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 8 }}
              onError={(e) => { const img = e.currentTarget; img.style.display = 'none'; (img.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'block'); }} />
            <Lock size={26} style={{ display: 'none' }} />
          </div>
          <h1 className="h-page" style={{ fontSize: 22 }}>BlinVPN Panel</h1>
          <p className="sub mt-1">Вход в панель управления</p>
        </div>

        {initInfo?.password && (
          <div className="inset" style={{ padding: 14, marginBottom: 20 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              {initInfo.newAdmin ? 'Создан администратор' : initInfo.passwordRegenerated ? 'Пароль сброшен' : 'Данные для входа'}
            </div>
            <div className="sub">Логин: <code className="mono" style={{ color: 'var(--text)', userSelect: 'all' }}>{initInfo.username}</code></div>
            <div className="sub">Пароль: <code className="mono" style={{ color: 'var(--text)', userSelect: 'all', wordBreak: 'break-all' }}>{initInfo.password}</code></div>
            <div className="faint mt-2" style={{ fontSize: 12 }}>{initInfo.message || 'Показывается до первого входа. Сохраните.'}</div>
          </div>
        )}

        {!tempToken ? (
          <form onSubmit={submitCreds} className="flex flex-col gap-4">
            <div><label className="field-label">Логин</label><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" required /></div>
            <div><label className="field-label">Пароль</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required /></div>
            {error && <div className="badge danger" style={{ width: '100%', padding: '10px 12px', justifyContent: 'flex-start' }}>{error}</div>}
            <button className="btn solid block" type="submit" disabled={loading || !username || !password} style={{ padding: 12 }}>
              {loading ? <><Spinner size={18} /> Вход…</> : 'Войти'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex flex-col gap-4">
            <div className="inset sub" style={{ padding: 12 }}>Код подтверждения отправлен администраторам в Telegram.</div>
            <div><label className="field-label">Код</label><input className="input mono center" value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="123456" required /></div>
            {error && <div className="badge danger" style={{ width: '100%', padding: '10px 12px', justifyContent: 'flex-start' }}>{error}</div>}
            <button className="btn solid block" type="submit" disabled={loading || !verifyCode} style={{ padding: 12 }}>{loading ? 'Проверка…' : 'Подтвердить'}</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ==========================================================
// 6. ROOT
// ==========================================================

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const token = getPanelToken();
    if (!token) { setIsAuthenticated(false); return; }
    fetch('/api/panel/stats/summary', { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
      .then((res) => { if (res.ok) setIsAuthenticated(true); else { clearPanelToken(); setIsAuthenticated(false); } })
      .catch(() => setIsAuthenticated(false));
  }, []);

  if (isAuthenticated === null) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={36} /></div>;
  if (!isAuthenticated) return <LoginForm onLogin={() => setIsAuthenticated(true)} />;
  return <AuthenticatedApp onLogout={() => { clearPanelToken(); setIsAuthenticated(false); }} />;
}

const NAV = [
  { group: 'Главное', items: [{ name: 'Главная', icon: Home }, { name: 'Финансы', icon: DollarSign }] },
  { group: 'Пользователи', items: [{ name: 'Пользователи', icon: Users }, { name: 'Подписки', icon: Key }] },
  { group: 'Маркетинг', items: [{ name: 'Рассылка', icon: Mail }, { name: 'Промокоды', icon: Gift }, { name: 'Акции', icon: Percent }, { name: 'Ссылки', icon: Link }] },
  { group: 'Другое', items: [{ name: 'Настройки', icon: Settings }] },
];

function AuthenticatedApp({ onLogout }: { onLogout: () => void }) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState('Главная');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [massActionType, setMassActionType] = useState<string | null>(null);
  const [keySearch, setKeySearch] = useState('');
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<KeyItem | null>(null);

  const addToast = (title: string, message: string, type: ToastType = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, title, message, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 4000);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tx = await apiFetch('/panel/transactions?limit=100');
        if (!cancelled && Array.isArray(tx)) {
          setTransactions(tx.map((t: any) => ({
            id: t.id, user: t.user || `@user_${t.user_id}`, amount: t.amount ?? 0,
            type: t.amount > 0 ? 'income' : 'expense', status: t.status || 'Pending', method: t.payment_method || 'Unknown',
            date: t.created_at ? new Date(t.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
            hash: t.hash || t.payment_id || '',
          })));
        }
      } catch (e) { console.error(e); if (!cancelled) addToast('Ошибка', 'Не удалось загрузить транзакции', 'error'); }

      try {
        const usersApi = await apiFetch('/panel/users?limit=500&offset=0');
        if (!cancelled) setUsers(parseListResponse(usersApi).items.map(mapApiUser));
      } catch (e) { console.error(e); }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleUpdateKey = (id: number, newExpiry: number) => { setEditingKey(null); addToast('Готово', `Срок ключа #${id} обновлён`, 'success'); void newExpiry; };
  const handleDeleteKey = (id: number) => { setEditingKey(null); addToast('Готово', `Ключ #${id} удалён`, 'success'); };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts((p) => p.filter((t) => t.id !== id))} />

      {selectedTransaction && <TransactionModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />}
      {selectedUser && <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} onToast={addToast} onOpenUser={setSelectedUser} />}
      {isCreateKeyOpen && <CreateKeyModal onClose={() => setIsCreateKeyOpen(false)} users={users} onToast={addToast} />}
      {editingKey && <KeyEditModal keyItem={editingKey} onClose={() => setEditingKey(null)} onSave={handleUpdateKey} onDelete={handleDeleteKey} />}
      {massActionType && (
        <UserActionModal type={massActionType} onClose={() => setMassActionType(null)} onConfirm={async (val, notify) => {
          try {
            await apiFetch('/panel/users/mass-action', { method: 'POST', body: JSON.stringify({ action: massActionType, value: val, notify }) });
            addToast('Готово', 'Массовое действие выполнено', 'success');
          } catch { addToast('Ошибка', 'Не удалось выполнить действие', 'error'); }
          setMassActionType(null);
        }} />
      )}

      {/* Sidebar */}
      <aside style={{
        position: 'fixed', insetBlock: 0, left: 0, zIndex: 50, width: 250,
        background: 'var(--surface)', borderRight: '1px solid var(--border)',
        transform: isMobileMenuOpen ? 'none' : 'translateX(-100%)', transition: 'transform var(--t)', overflowY: 'auto',
      }} className="md:!translate-x-0">
        <div className="flex items-center gap-3" style={{ padding: 20, borderBottom: '1px solid var(--border)' }}>
          <img src="https://blinvpn.cc/assets/logo.png" alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'contain' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div><div className="h-sec">BlinVPN</div><div className="faint" style={{ fontSize: 12 }}>Панель управления</div></div>
        </div>
        <nav style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {NAV.map((section) => (
            <div key={section.group}>
              <div className="nav-group">{section.group}</div>
              <div className="flex flex-col gap-1">
                {section.items.map((item) => (
                  <button key={item.name} className={`nav-item ${activePage === item.name ? 'on' : ''}`}
                    onClick={() => { setActivePage(item.name); setIsMobileMenuOpen(false); }}>
                    <item.icon size={17} className={activePage === item.name ? '' : 'faint'} /> {item.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="md:!ml-[250px]" style={{ minHeight: '100vh' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--border)' }}>
          <button className="icon-btn md:!hidden" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>{isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}</button>
          <div className="flex-1" />
          <button className="icon-btn danger" onClick={onLogout} title="Выход"><Lock size={16} /></button>
        </div>

        <div style={{ padding: 20 }} className="rise">
          {activePage === 'Главная' && <Dashboard />}
          {activePage === 'Финансы' && <FinancePage transactions={transactions} onSelectTransaction={setSelectedTransaction} />}
          {activePage === 'Пользователи' && <UsersPage userSearch={userSearch} setUserSearch={setUserSearch} setSelectedUser={setSelectedUser} setMassActionType={setMassActionType} />}
          {activePage === 'Подписки' && <KeysPage keySearch={keySearch} setKeySearch={setKeySearch} setIsCreateKeyOpen={setIsCreateKeyOpen} setEditingKey={setEditingKey} />}
          {activePage === 'Рассылка' && <MailingPage onToast={addToast} />}
          {activePage === 'Промокоды' && <PromocodesPage onToast={addToast} />}
          {activePage === 'Акции' && <PromotionsPage onToast={addToast} />}
          {activePage === 'Ссылки' && <TrackingLinksPage onToast={addToast} />}
          {activePage === 'Настройки' && <SettingsPage onToast={addToast} />}
        </div>
      </main>

      {isMobileMenuOpen && <div onClick={() => setIsMobileMenuOpen(false)} className="md:!hidden" style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.5)' }} />}
    </div>
  );
}

// ── page header helper ────────────────────────────────────
const PageHead: React.FC<{ title: string; sub?: string; children?: React.ReactNode }> = ({ title, sub, children }) => (
  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
    <div><h2 className="h-page">{title}</h2>{sub && <p className="sub mt-1">{sub}</p>}</div>
    {children}
  </div>
);

// ==========================================================
// 7. DASHBOARD
// ==========================================================

const Dashboard = () => {
  const [summary, setSummary] = useState<{ total_users: number; active_keys: number; monthly_revenue: number } | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [period, setPeriod] = useState<'week' | 'month' | 'year'>('month');

  useEffect(() => { (async () => { try { const d = await apiFetch('/panel/stats/summary'); if (d) setSummary(d); } catch (e) { console.error(e); } })(); }, []);
  useEffect(() => { (async () => { try { const d = await apiFetch(`/panel/statistics/full?period=${period}`); if (d) setStats(d); } catch (e) { console.error(e); } })(); }, [period]);

  const totalUsers = stats?.totalUsers ?? summary?.total_users;
  const activeSubs = stats?.activeSubscriptions ?? summary?.active_keys;
  const monthlyRevenue = summary?.monthly_revenue;

  const revenueSeries = toSeries(stats?.revenueByDay ?? stats?.dailyRevenue ?? stats?.revenueChart ?? stats?.revenue_by_day ?? stats?.chart);

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Панель управления" sub="Обзор BlinVPN" />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat title="Пользователи" value={totalUsers != null ? fmtInt(totalUsers) : '—'} icon={Users} />
        <Stat title="Активные подписки" value={activeSubs != null ? fmtInt(activeSubs) : '—'} icon={Key} />
        <Stat title="Доход за месяц" value={monthlyRevenue != null ? fmtMoneyShort(monthlyRevenue) : '—'} icon={DollarSign} />
        <Stat title="Платежей сегодня" value={stats ? fmtInt(stats.paymentsToday) : '—'} icon={CreditCard} />
        <Stat title="Баланс клиентов" value={stats ? fmtMoneyShort(stats.clientsBalance) : '—'} icon={Wallet} />
      </div>

      {!stats ? (
        <div className="flex items-center justify-center" style={{ height: 200 }}><Spinner size={28} /></div>
      ) : (
        <>
          <div className="card" style={{ padding: 24 }}>
            <div className="flex justify-between items-center mb-5">
              <h3 className="h-sec">Выручка</h3>
              <Segmented value={period} onChange={setPeriod} options={[{ value: 'week', label: 'Неделя' }, { value: 'month', label: '30 дней' }, { value: 'year', label: 'Год' }]} />
            </div>
            {revenueSeries.length > 0 && (
              <div className="mb-6"><BarChart data={revenueSeries} format={(v) => fmtMoneyShort(v)} height={180} /></div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="inset" style={{ padding: 16 }}><div className="sub">В среднем в день</div><div className="stat-value mt-1">{fmtMoneyShort(stats.avgDaily || 0)}</div></div>
              <div className="inset" style={{ padding: 16 }}><div className="sub">Лучший день</div><div className="stat-value mt-1">{fmtMoneyShort(stats.bestDayValue || 0)}</div><div className="faint" style={{ fontSize: 12, marginTop: 2 }}>{stats.bestDayDate || ''}</div></div>
              <div className="inset" style={{ padding: 16 }}><div className="sub">Куплено за неделю</div><div className="stat-value mt-1">+{fmtInt(stats.boughtThisWeek)}</div></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="card" style={{ padding: 24 }}>
              <h3 className="h-sec mb-5">Распределение пользователей</h3>
              <BarChart data={toSeries(stats.userDistData)} format={fmtInt} />
            </div>
            <div className="card" style={{ padding: 24 }}>
              <h3 className="h-sec mb-5">Способы оплаты</h3>
              <BarChart data={toSeries(stats.paymentMethodsData)} format={fmtInt} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="card" style={{ padding: 24 }}>
              <h3 className="h-sec mb-4">Подписки</h3>
              <div className="flex flex-col gap-3" style={{ fontSize: 14 }}>
                <div className="flex justify-between"><span className="muted">Всего</span><span style={{ fontWeight: 500 }}>{fmtInt(stats.totalSubscriptions)}</span></div>
                <div className="flex justify-between"><span className="muted">Платные</span><span style={{ fontWeight: 500 }}>{fmtInt(stats.paidSubscriptions)}</span></div>
                <div className="flex justify-between"><span className="muted">За неделю</span><span style={{ fontWeight: 500 }}>+{fmtInt(stats.boughtThisWeek)}</span></div>
              </div>
            </div>
            <div className="card" style={{ padding: 24 }}>
              <h3 className="h-sec mb-4">Конверсия trial → paid</h3>
              <div className="stat-value" style={{ fontSize: 36 }}>{stats.conversionRate?.toFixed(1) || 0}%</div>
              <p className="sub mt-2">Переход на платный тариф после пробного периода.</p>
              <div className="hbar mt-4"><i style={{ width: `${Math.min(stats.conversionRate || 0, 100)}%`, background: 'var(--text)' }} /></div>
            </div>
            <div className="card" style={{ padding: 24 }}>
              <h3 className="h-sec mb-4">Рефералы</h3>
              <div className="flex flex-col gap-3" style={{ fontSize: 14 }}>
                <div className="flex justify-between"><span className="muted">Приглашено</span><span style={{ fontWeight: 500 }}>{fmtInt(stats.totalInvited)}</span></div>
                <div className="flex justify-between"><span className="muted">Партнёров</span><span style={{ fontWeight: 500 }}>{fmtInt(stats.partners)}</span></div>
                <div className="flex justify-between"><span className="muted">Выплачено</span><span style={{ fontWeight: 500 }}>{fmtMoneyShort(stats.totalPaid)}</span></div>
              </div>
            </div>
          </div>

          <div className="tbl-wrap">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><h3 className="h-sec">Топ рефералов</h3></div>
            <table className="tbl">
              <thead><tr><th>Пользователь</th><th>Пригласил</th><th>Заработал</th></tr></thead>
              <tbody>
                {(stats.topReferrers || []).map((r: any) => (
                  <tr key={r.id}>
                    <td><span className="flex items-center gap-2"><Trophy size={14} className="faint" /> {r.name}</span></td>
                    <td className="muted">{r.count} чел.</td>
                    <td style={{ fontWeight: 500 }}>{fmtMoney(r.earned)}</td>
                  </tr>
                ))}
                {(!stats.topReferrers || stats.topReferrers.length === 0) && <tr className="empty-row"><td colSpan={3}>Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ==========================================================
// 8. FINANCE
// ==========================================================

const FinancePage: React.FC<{ transactions: Transaction[]; onSelectTransaction: (t: Transaction) => void }> = ({ transactions, onSelectTransaction }) => {
  const [stats, setStats] = useState<{ deposits: number; withdrawals: number; successfulOps: number } | null>(null);
  useEffect(() => { (async () => { try { const d = await apiFetch('/panel/finance/stats'); if (d) setStats(d); } catch (e) { console.error(e); } })(); }, []);

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Финансы" sub="Доходы и операции" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Stat title="Пополнения" value={stats ? fmtMoney(stats.deposits) : '—'} icon={ArrowUpRight} />
        <Stat title="Успешные операции" value={stats ? fmtInt(stats.successfulOps) : '—'} sub="операций" icon={Activity} />
      </div>
      <div className="tbl-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>ID</th><th>Пользователь</th><th>Сумма</th><th>Статус</th><th>Дата</th></tr></thead>
            <tbody>
              {transactions.length === 0 ? <tr className="empty-row"><td colSpan={5}>Пока нет операций</td></tr>
                : transactions.map((tx) => (
                  <tr key={tx.id} className="click" onClick={() => onSelectTransaction(tx)}>
                    <td className="muted mono">#{tx.id}</td>
                    <td className="muted">{tx.user}</td>
                    <td style={{ fontWeight: 600, color: tx.amount > 0 ? 'var(--text)' : 'var(--muted)' }}>{tx.amount > 0 ? '+' : ''}{tx.amount} ₽</td>
                    <td className="muted">{tx.status}</td>
                    <td className="faint">{tx.date}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// ==========================================================
// 9. USERS
// ==========================================================

// small hook: close menu on outside click
function useOutside<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOutside(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onOutside]);
  return ref;
}

const MASS_ACTIONS = [
  { t: 'MASS_ADD_DAYS', icon: Calendar, label: 'Добавить дни всем' },
  { t: 'MASS_ADD_BALANCE', icon: DollarSign, label: 'Начислить баланс всем' },
  { t: 'MASS_BAN', icon: Ban, label: 'Заблокировать всех' },
  { t: 'MASS_UNBAN', icon: CheckCircle, label: 'Разблокировать всех' },
  { t: 'MASS_RESET_TRIAL', icon: RefreshCw, label: 'Сбросить пробный период' },
  { t: 'MASS_DELETE_KEYS', icon: Trash2, label: 'Удалить все ключи' },
  { t: 'MASS_SET_PARTNER', icon: UserPlus, label: 'Сделать партнёрами' },
  { t: 'MASS_REMOVE_PARTNER', icon: UserMinus, label: 'Убрать партнёрство' },
];

const UsersPage: React.FC<{
  userSearch: string; setUserSearch: (s: string) => void; setSelectedUser: (u: User) => void; setMassActionType: (t: string | null) => void;
}> = ({ userSearch, setUserSearch, setSelectedUser, setMassActionType }) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'Trial' | 'Active' | 'Banned'>('all');
  const [showFilter, setShowFilter] = useState(false);
  const [showMass, setShowMass] = useState(false);
  const massRef = useOutside<HTMLDivElement>(() => setShowMass(false));
  const filterRef = useOutside<HTMLDivElement>(() => setShowFilter(false));

  const { items: users, total, page, totalPages, loading, error, nextPage, prevPage } = usePaginatedList({
    basePath: '/panel/users', search: userSearch,
    extraParams: { status: statusFilter === 'all' ? undefined : statusFilter },
    mapItem: mapApiUser,
    clientFilter: (u: User) => statusFilter === 'all' ? true : statusFilter === 'Banned' ? u.status === 'Banned' : u.status === statusFilter,
  });

  const filterLabels: Record<string, string> = { all: 'Все', Trial: 'Триал', Active: 'Активные', Banned: 'Заблок.' };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Пользователи" sub="База клиентов">
        <div style={{ position: 'relative' }} ref={massRef}>
          <button className="btn solid" onClick={() => setShowMass(!showMass)}><Layers size={16} /> Массовые действия <ChevronDown size={15} style={{ transform: showMass ? 'rotate(180deg)' : 'none', transition: 'transform var(--t)' }} /></button>
          {showMass && (
            <div className="menu" style={{ right: 0 }}>
              {MASS_ACTIONS.map((a) => (
                <button key={a.t} className="menu-item" onClick={() => { setMassActionType(a.t); setShowMass(false); }}><a.icon size={15} className="faint" /> {a.label}</button>
              ))}
            </div>
          )}
        </div>
      </PageHead>

      <div className="flex gap-3">
        <div className="search flex-1">
          <Search className="ico" size={16} />
          <input className="input" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Имя, username или ID…" />
        </div>
        <div style={{ position: 'relative' }} ref={filterRef}>
          <button className={`btn ${statusFilter !== 'all' ? 'solid' : ''}`} onClick={() => setShowFilter(!showFilter)}><Filter size={16} /> {filterLabels[statusFilter]}</button>
          {showFilter && (
            <div className="menu" style={{ right: 0, minWidth: 160 }}>
              {(['all', 'Trial', 'Active', 'Banned'] as const).map((v) => (
                <button key={v} className="menu-item" onClick={() => { setStatusFilter(v); setShowFilter(false); }}>{filterLabels[v]}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="badge danger" style={{ width: '100%', padding: '10px 14px', justifyContent: 'flex-start' }}>{error}</div>}

      <div className="tbl-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>Пользователь</th><th>Баланс</th><th>Подписка</th><th>Статус</th><th style={{ textAlign: 'right' }}></th></tr></thead>
            <tbody>
              {loading && users.length === 0 ? <tr className="empty-row"><td colSpan={5}><Spinner size={18} className="inline-block mr-2" />Загрузка…</td></tr>
                : users.length === 0 ? <tr className="empty-row"><td colSpan={5}>Ничего не найдено</td></tr>
                : users.map((user: User) => {
                    const st = userStatusBadge(user.status, user.inBlacklist);
                    return (
                      <tr key={user.id} className="click" onClick={() => setSelectedUser(user)}>
                        <td><span className="flex items-center gap-3"><span className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{user.username.replace('@', '').slice(0, 2).toUpperCase()}</span><span style={{ fontWeight: 500 }}>{user.username}</span></span></td>
                        <td style={{ fontWeight: 600 }}>{user.balance} ₽</td>
                        <td className="muted">{user.paidUntil}</td>
                        <td><span className={`badge ${st.cls}`}>{st.label}</span>{user.isPartner && <span className="badge mute" style={{ marginLeft: 6 }}>Партнёр</span>}</td>
                        <td style={{ textAlign: 'right' }}><span className="icon-btn" style={{ display: 'inline-flex' }}><Settings size={15} /></span></td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} loading={loading} onPrev={prevPage} onNext={nextPage} />
    </div>
  );
};

// ==========================================================
// 10. KEYS / SUBSCRIPTIONS
// ==========================================================

const KeysPage: React.FC<{
  keySearch: string; setKeySearch: (s: string) => void; setIsCreateKeyOpen: (b: boolean) => void; setEditingKey: (k: KeyItem | null) => void;
}> = ({ keySearch, setKeySearch, setIsCreateKeyOpen, setEditingKey }) => {
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Expired' | 'Banned'>('all');
  const [showFilter, setShowFilter] = useState(false);
  const filterRef = useOutside<HTMLDivElement>(() => setShowFilter(false));

  const { items: keys, total, page, totalPages, loading, error, nextPage, prevPage } = usePaginatedList({
    basePath: '/panel/keys', search: keySearch,
    extraParams: { status: statusFilter === 'all' ? undefined : statusFilter },
    mapItem: mapApiKey,
    clientFilter: (k: KeyItem) => statusFilter === 'all' ? true : k.status === statusFilter,
  });

  const filterLabels: Record<string, string> = { all: 'Все', Active: 'Активные', Expired: 'Истёкшие', Banned: 'Заблок.' };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Подписки" sub="Управление ключами VLESS / Vmess">
        <button className="btn solid" onClick={() => setIsCreateKeyOpen(true)}><Plus size={16} /> Создать</button>
      </PageHead>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat title="Всего ключей" value={fmtInt(total)} icon={Key} />
        <Stat title="Истёкшие (стр.)" value={keys.filter((k: KeyItem) => k.status === 'Expired').length} icon={Clock} />
        <Stat title="Заблок. (стр.)" value={keys.filter((k: KeyItem) => k.status === 'Banned' || k.status === 'Blocked').length} icon={Ban} />
      </div>

      <div className="flex gap-3">
        <div className="search flex-1">
          <Search className="ico" size={16} />
          <input className="input" value={keySearch} onChange={(e) => setKeySearch(e.target.value)} placeholder="Ключ или пользователь…" />
        </div>
        <div style={{ position: 'relative' }} ref={filterRef}>
          <button className={`btn ${statusFilter !== 'all' ? 'solid' : ''}`} onClick={() => setShowFilter(!showFilter)}><Filter size={16} /> {filterLabels[statusFilter]}</button>
          {showFilter && (
            <div className="menu" style={{ right: 0, minWidth: 160 }}>
              {(['all', 'Active', 'Expired', 'Banned'] as const).map((v) => (
                <button key={v} className="menu-item" onClick={() => { setStatusFilter(v); setShowFilter(false); }}>{filterLabels[v]}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <div className="badge danger" style={{ width: '100%', padding: '10px 14px', justifyContent: 'flex-start' }}>{error}</div>}

      <div className="tbl-wrap">
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>ID / Ключ</th><th>Пользователь</th><th>Статус</th><th>Осталось</th><th>Трафик</th><th>Устр.</th><th></th></tr></thead>
            <tbody>
              {loading && keys.length === 0 ? <tr className="empty-row"><td colSpan={7}><Spinner size={18} className="inline-block mr-2" />Загрузка…</td></tr>
                : keys.length === 0 ? <tr className="empty-row"><td colSpan={7}>Ничего не найдено</td></tr>
                : keys.map((k: KeyItem) => {
                    const st = keyStatusBadge(k.status);
                    const pct = k.trafficLimit > 0 ? Math.min(100, (k.trafficUsed / k.trafficLimit) * 100) : 0;
                    const meterCls = pct > 90 ? 'crit' : pct > 70 ? 'warn' : '';
                    return (
                      <tr key={k.id} className="click" onClick={() => setEditingKey(k)}>
                        <td><div className="mono" style={{ fontWeight: 500 }}>#{k.id}</div><div className="faint mono line-clamp-1" style={{ fontSize: 11, maxWidth: 130 }}>{k.key}</div></td>
                        <td style={{ fontWeight: 500 }}>{k.user}</td>
                        <td><span className={`badge ${st.cls}`}>{st.label}</span></td>
                        <td className="muted">{k.expiry > 0 ? `${k.expiry} дн.` : 'Истёк'}</td>
                        <td>
                          <div className="faint mb-1" style={{ fontSize: 12 }}>{gb(k.trafficUsed).toFixed(1)} / {k.trafficLimit > 0 ? gb(k.trafficLimit).toFixed(0) : '∞'} ГБ</div>
                          <div className="meter" style={{ width: 96 }}><i className={meterCls} style={{ width: `${pct}%` }} /></div>
                        </td>
                        <td className="muted" style={{ textAlign: 'center' }}>{k.devicesUsed}/{k.devicesLimit}</td>
                        <td style={{ textAlign: 'right' }}><span className="icon-btn" style={{ display: 'inline-flex' }}><Edit2 size={15} /></span></td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} loading={loading} onPrev={prevPage} onNext={nextPage} totalLabel="Всего подписок" />
    </div>
  );
};

// ==========================================================
// 11. MAILING
// ==========================================================

const MailingPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [stats, setStats] = useState<{ totalSent: number } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [message, setMessage] = useState('');
  const [buttonType, setButtonType] = useState('');
  const [buttonLabel, setButtonLabel] = useState('');
  const [buttonUrl, setButtonUrl] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [targetUsers, setTargetUsers] = useState('all');
  const [isSending, setIsSending] = useState(false);

  const loadHistory = async () => { try { const d = await apiFetch('/panel/mailing/history'); if (Array.isArray(d)) setHistory(d); } catch (e) { console.error(e); } };
  const loadStats = async () => { try { const d = await apiFetch('/panel/mailing/stats'); if (d) setStats(d); } catch (e) { console.error(e); } };

  useEffect(() => { loadStats(); loadHistory(); }, []);
  useEffect(() => {
    if (!history.some((i) => i.status === 'Sending')) return;
    const timer = setInterval(() => { loadHistory(); loadStats(); }, 4000);
    return () => clearInterval(timer);
  }, [history]);

  const handleSend = async () => {
    if (!message.trim()) { onToast('Ошибка', 'Введите текст сообщения', 'error'); return; }
    if ((buttonType === 'external_link' || buttonType === 'open_miniapp') && (!buttonLabel.trim() || !buttonUrl.trim())) { onToast('Ошибка', 'Укажите текст кнопки и ссылку', 'error'); return; }
    if (buttonType === 'activate_promo' && !promoCode.trim()) { onToast('Ошибка', 'Укажите промокод', 'error'); return; }
    if (!confirm('Запустить рассылку?')) return;
    setIsSending(true);
    try {
      const payload: any = { message, target_users: targetUsers, title: message.substring(0, 50) };
      if (buttonType === 'external_link' || buttonType === 'open_miniapp') { payload.button_type = buttonType; payload.button_value = `${buttonLabel.trim()}|${buttonUrl.trim()}`; }
      else if (buttonType === 'activate_promo') { payload.button_type = buttonType; payload.button_value = promoCode.trim(); }
      if (imageUrl.trim()) payload.image_url = imageUrl.trim();
      await apiFetch('/panel/mailing', { method: 'POST', body: JSON.stringify(payload) });
      onToast('Рассылка', 'Запущена и отправляется в фоне', 'success');
      setMessage(''); setButtonType(''); setButtonLabel(''); setButtonUrl(''); setPromoCode(''); setImageUrl('');
      loadStats(); loadHistory();
    } catch { onToast('Ошибка', 'Не удалось запустить рассылку', 'error'); } finally { setIsSending(false); }
  };

  const targets = [{ v: 'all', l: 'Все' }, { v: 'active', l: 'Активные' }, { v: 'expired', l: 'Истёкшие' }, { v: 'no_subscription', l: 'Без подписки' }];
  const historyBadge = (s: string) => s === 'Completed' ? { cls: 'solid', label: 'Отправлено' } : s === 'Sending' ? { cls: 'mute', label: 'Отправляется' } : s === 'Cancelled' ? { cls: 'danger', label: 'Отменено' } : { cls: 'line', label: s };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Рассылка" sub="Массовая отправка сообщений" />
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Stat title="Отправлено сообщений" value={stats ? fmtInt(stats.totalSent) : '—'} icon={Send} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card" style={{ padding: 24 }}>
          <h3 className="h-sec mb-4 flex items-center gap-2"><Plus size={18} className="faint" /> Новая рассылка</h3>
          <div className="flex flex-col gap-4">
            <div><label className="field-label">Текст сообщения</label><textarea className="textarea" style={{ minHeight: 128 }} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Текст рассылки… Поддерживается Markdown" /></div>
            <div><label className="field-label">Тип кнопки</label>
              <select className="select" value={buttonType} onChange={(e) => { setButtonType(e.target.value); setButtonLabel(''); setButtonUrl(''); setPromoCode(''); }}>
                <option value="">Без кнопки</option><option value="external_link">Сторонняя ссылка</option><option value="open_miniapp">Открыть мини-приложение</option><option value="activate_promo">Активировать промокод</option>
              </select>
            </div>
            {(buttonType === 'external_link' || buttonType === 'open_miniapp') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div><label className="field-label">Текст на кнопке</label><input className="input" value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} placeholder={buttonType === 'open_miniapp' ? 'Открыть' : 'Перейти'} /></div>
                <div><label className="field-label">Ссылка</label><input className="input" value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://example.com" /></div>
              </div>
            )}
            {buttonType === 'activate_promo' && <div><label className="field-label">Промокод</label><input className="input mono" value={promoCode} onChange={(e) => setPromoCode(e.target.value)} placeholder="PROMOCODE" /></div>}
            <div>
              <label className="field-label">Картинка (URL, опционально)</label>
              <input className="input" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/image.jpg" />
              <div className="faint mt-1" style={{ fontSize: 12 }}>Форматирование: &lt;b&gt;, &lt;i&gt;, &lt;code&gt;, **жирный**, *курсив*, `моно`; premium-emoji: ![ID]</div>
            </div>
            <div>
              <label className="field-label">Получатели</label>
              <div className="flex flex-wrap gap-2">
                {targets.map((t) => <button key={t.v} className={`chip ${targetUsers === t.v ? 'on' : ''}`} onClick={() => setTargetUsers(t.v)}>{t.l}</button>)}
              </div>
            </div>
            <button className="btn solid block" onClick={handleSend} disabled={isSending} style={{ padding: 12 }}>{isSending ? <><Spinner size={16} /> Запуск…</> : <><Send size={16} /> Отправить</>}</button>
          </div>
        </div>

        <div className="tbl-wrap" style={{ display: 'flex', flexDirection: 'column', maxHeight: 620 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><h3 className="h-sec">История</h3></div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {history.length === 0 ? <div className="sub" style={{ padding: 16, textAlign: 'center' }}>Нет рассылок</div>
              : history.map((item) => {
                  const b = historyBadge(item.status);
                  return (
                    <div key={item.id} style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <span className="line-clamp-1" style={{ fontWeight: 500 }}>{item.title || 'Без названия'}</span>
                        <span className="faint" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{item.date}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className={`badge ${b.cls}`}>{b.label}</span>
                        <span className="sub flex items-center gap-1"><Users size={12} /> {item.sent_count || 0}</span>
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button className="btn sm" onClick={() => setSelected(item)}>Открыть</button>
                        <button className="btn sm danger" onClick={async () => {
                          if (!confirm('Удалить рассылку и попытаться удалить сообщения у пользователей?')) return;
                          try { await apiFetch(`/panel/mailing/${item.id}`, { method: 'DELETE' }); onToast('Готово', 'Рассылка удалена', 'success'); loadHistory(); }
                          catch { onToast('Ошибка', 'Не удалось удалить', 'error'); }
                        }}>Удалить</button>
                      </div>
                    </div>
                  );
                })}
          </div>
        </div>
      </div>

      {selected && (
        <Modal onClose={() => setSelected(null)} title={selected.title || 'Текст рассылки'} width={640} z={70}>
          <div className="inset mono" style={{ padding: 16, whiteSpace: 'pre-wrap', maxHeight: '60vh', overflow: 'auto', fontSize: 13 }}>{selected.message_text || 'Пустое сообщение'}</div>
        </Modal>
      )}
    </div>
  );
};

// ==========================================================
// 12. PROMOCODES
// ==========================================================

const PromocodesStats: React.FC<{ promos: Promo[] }> = ({ promos }) => {
  const [stats, setStats] = useState<{ total: number; totalUses: number; activeCount: number } | null>(null);
  useEffect(() => { (async () => { try { const d = await apiFetch('/panel/promocodes/stats'); if (d) setStats(d); } catch (e) { console.error(e); } })(); }, []);
  const totalBonus = promos.reduce((s, p) => p.type === 'balance' ? s + Number(p.value) * p.uses : s, 0);
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Stat title="Активных кодов" value={stats ? stats.activeCount : promos.length} icon={Gift} />
      <Stat title="Использований" value={stats ? fmtInt(stats.totalUses) : '0'} icon={Users} />
      <Stat title="Сумма бонусов" value={fmtMoney(totalBonus)} icon={DollarSign} />
    </div>
  );
};

const PromocodesPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Promo | null>(null);
  const [form, setForm] = useState<{ code: string; type: Promo['type']; value: string; limit: string; expires: string }>({ code: '', type: 'balance', value: '', limit: '', expires: '' });

  const load = async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/panel/promocodes');
      setPromos(Array.isArray(data) ? data.map((p: any) => ({ id: p.id, code: p.code, type: p.type, value: String(p.value ?? ''), uses: Number(p.uses_count || 0), limit: Number(p.uses_limit || 0), expires: String(p.expires_at || '') })) : []);
    } catch { onToast('Ошибка', 'Не удалось загрузить промокоды', 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!form.code || !form.value) { onToast('Ошибка', 'Заполните код и значение', 'error'); return; }
    try {
      await apiFetch('/panel/promocodes', { method: 'POST', body: JSON.stringify({ code: form.code.toUpperCase(), type: form.type, value: form.value, uses_limit: form.limit ? Number(form.limit) : null, expires_at: form.expires || null, is_active: 1 }) });
      onToast('Готово', 'Промокод создан', 'success');
      setForm({ code: '', type: 'balance', value: '', limit: '', expires: '' }); load();
    } catch { onToast('Ошибка', 'Не удалось создать', 'error'); }
  };
  const remove = async (id: number) => { if (!confirm('Удалить промокод?')) return; try { await apiFetch(`/panel/promocodes/${id}`, { method: 'DELETE' }); onToast('Готово', 'Промокод удалён', 'success'); load(); } catch { onToast('Ошибка', 'Не удалось удалить', 'error'); } };
  const save = async () => {
    if (!editing) return;
    try {
      await apiFetch(`/panel/promocodes/${editing.id}`, { method: 'PUT', body: JSON.stringify({ code: editing.code, type: editing.type, value: editing.value, uses_limit: editing.limit || null, expires_at: editing.expires || null }) });
      onToast('Готово', 'Промокод обновлён', 'success'); setEditing(null); load();
    } catch { onToast('Ошибка', 'Не удалось обновить', 'error'); }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Промокоды" />
      <PromocodesStats promos={promos} />

      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Новый промокод</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <input className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="КОД" />
          <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as Promo['type'] })}><option value="balance">Баланс</option><option value="discount">Скидка</option><option value="subscription">Подписка</option></select>
          <input className="input" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder="Значение" />
          <input className="input" type="number" value={form.limit} onChange={(e) => setForm({ ...form, limit: e.target.value })} placeholder="Лимит" />
          <input className="input" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} placeholder="2026-12-31" />
        </div>
        <button className="btn solid mt-4" onClick={create}>Создать</button>
      </div>

      <div className="tbl-wrap">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><h3 className="h-sec">Список промокодов</h3></div>
        {loading ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Загрузка…</div>
          : promos.length === 0 ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Промокодов пока нет</div>
          : <div style={{ overflowX: 'auto' }}><table className="tbl">
              <thead><tr><th>Код</th><th>Тип</th><th>Значение</th><th>Исп.</th><th>Лимит</th><th>Срок</th><th style={{ textAlign: 'right' }}>Действия</th></tr></thead>
              <tbody>{promos.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.code}</td><td className="muted">{p.type}</td><td className="muted">{p.value}</td>
                  <td className="muted">{p.uses}</td><td className="muted">{p.limit || '∞'}</td><td className="muted">{p.expires || 'Без срока'}</td>
                  <td style={{ textAlign: 'right' }}><span className="inline-flex gap-2"><button className="icon-btn" onClick={() => setEditing({ ...p })}><Edit2 size={14} /></button><button className="icon-btn danger" onClick={() => remove(p.id)}><Trash2 size={14} /></button></span></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title="Редактировать промокод" width={440}
          footer={<><button className="btn block" onClick={() => setEditing(null)}>Отмена</button><button className="btn solid block" onClick={save}>Сохранить</button></>}>
          <div className="flex flex-col gap-3">
            <input className="input mono" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} placeholder="Код" />
            <select className="select" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as Promo['type'] })}><option value="balance">Баланс</option><option value="discount">Скидка</option><option value="subscription">Подписка</option></select>
            <input className="input" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} placeholder="Значение" />
            <input className="input" type="number" value={editing.limit || ''} onChange={(e) => setEditing({ ...editing, limit: Number(e.target.value || 0) })} placeholder="Лимит" />
            <input className="input" value={editing.expires || ''} onChange={(e) => setEditing({ ...editing, expires: e.target.value })} placeholder="2026-12-31" />
          </div>
        </Modal>
      )}
    </div>
  );
};

// ==========================================================
// 13. PROMOTIONS
// ==========================================================

type PromotionType = 'deposit_multiplier' | 'global_discount';
type PromotionItem = {
  id: number; name: string; type: PromotionType; value: number; min_amount: number | null;
  max_amount: number | null; uses_limit: number | null; uses_count: number; expires_at: string | null; is_active: boolean;
};

const PromotionsPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const emptyForm = { name: '', type: 'deposit_multiplier' as PromotionType, value: '', min_amount: '', max_amount: '', uses_limit: '', expires_at: '', is_active: true };
  const [items, setItems] = useState<PromotionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<PromotionItem | null>(null);

  const load = async () => { setLoading(true); try { const d = await apiFetch('/panel/promotions'); setItems(Array.isArray(d) ? d : []); } catch { onToast('Ошибка', 'Не удалось загрузить акции', 'error'); setItems([]); } finally { setLoading(false); } };
  useEffect(() => { load(); }, []);

  const toPayload = (src: typeof form | PromotionItem) => {
    const isEdit = 'id' in src;
    const type = src.type;
    const valueRaw = isEdit ? String((src as PromotionItem).value) : (src as typeof form).value;
    const g = (edit: any, f: string) => isEdit ? (edit != null ? String(edit) : '') : f;
    const minRaw = g((src as PromotionItem).min_amount, (src as typeof form).min_amount);
    const maxRaw = g((src as PromotionItem).max_amount, (src as typeof form).max_amount);
    const limitRaw = g((src as PromotionItem).uses_limit, (src as typeof form).uses_limit);
    const expiresRaw = isEdit ? ((src as PromotionItem).expires_at || '') : ((src as typeof form).expires_at || '');
    let expires_at: string | null = null;
    if (expiresRaw) { const d = new Date(expiresRaw); expires_at = Number.isNaN(d.getTime()) ? String(expiresRaw) : d.toISOString(); }
    return {
      name: src.name.trim(), type, value: valueRaw,
      min_amount: type === 'deposit_multiplier' && minRaw !== '' ? Number(minRaw) : null,
      max_amount: type === 'deposit_multiplier' && maxRaw !== '' ? Number(maxRaw) : null,
      uses_limit: limitRaw !== '' ? Number(limitRaw) : null,
      expires_at, is_active: isEdit ? (src as PromotionItem).is_active : (src as typeof form).is_active,
    };
  };
  const parseApiError = (e: any, fallback: string) => { try { const p = JSON.parse(e?.message || ''); if (p?.error) return String(p.error); } catch {} return fallback; };

  const create = async () => {
    if (!form.name.trim() || !form.value || !form.expires_at) { onToast('Ошибка', 'Заполните название, значение и дату', 'error'); return; }
    try { await apiFetch('/panel/promotions', { method: 'POST', body: JSON.stringify(toPayload(form)) }); onToast('Готово', 'Акция создана', 'success'); setForm(emptyForm); load(); }
    catch (e: any) { onToast('Ошибка', parseApiError(e, 'Не удалось создать'), 'error'); }
  };
  const save = async () => {
    if (!editing || !editing.name.trim() || !editing.expires_at) { onToast('Ошибка', 'Заполните название и дату', 'error'); return; }
    try { await apiFetch(`/panel/promotions/${editing.id}`, { method: 'PUT', body: JSON.stringify(toPayload(editing)) }); onToast('Готово', 'Акция обновлена', 'success'); setEditing(null); load(); }
    catch (e: any) { onToast('Ошибка', parseApiError(e, 'Не удалось обновить'), 'error'); }
  };
  const remove = async (id: number) => { if (!confirm('Удалить акцию?')) return; try { await apiFetch(`/panel/promotions/${id}`, { method: 'DELETE' }); onToast('Готово', 'Акция удалена', 'success'); load(); } catch { onToast('Ошибка', 'Не удалось удалить', 'error'); } };
  const toggle = async (item: PromotionItem) => { try { await apiFetch(`/panel/promotions/${item.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !item.is_active }) }); load(); } catch { onToast('Ошибка', 'Не удалось изменить статус', 'error'); } };

  const typeLabel = (t: PromotionType) => t === 'deposit_multiplier' ? 'xN к пополнению' : 'Глобальная скидка';
  const fmtExpires = (s: string | null) => { if (!s) return 'Без срока'; try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };
  const toLocal = (s: string | null) => { if (!s) return ''; try { const d = new Date(s); if (Number.isNaN(d.getTime())) return ''; const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; } catch { return ''; } };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Акции" sub="xN к пополнению — только при депозите. Глобальная скидка — на все товары без промокода." />

      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec mb-4">Новая акция</h3>
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Название" />
            <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PromotionType, value: '', min_amount: '', max_amount: '' })}><option value="deposit_multiplier">xN к пополнению</option><option value="global_discount">Глобальная скидка %</option></select>
            <input className="input" type="number" step="any" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'deposit_multiplier' ? 'Множитель (напр. 2)' : 'Скидка % (напр. 15)'} />
          </div>
          {form.type === 'deposit_multiplier' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input className="input" type="number" value={form.min_amount} onChange={(e) => setForm({ ...form, min_amount: e.target.value })} placeholder="Мин. сумма (необяз.)" />
              <input className="input" type="number" value={form.max_amount} onChange={(e) => setForm({ ...form, max_amount: e.target.value })} placeholder="Макс. сумма (необяз.)" />
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input" type="number" value={form.uses_limit} onChange={(e) => setForm({ ...form, uses_limit: e.target.value })} placeholder="Лимит использований (необяз.)" />
            <input className="input" type="datetime-local" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
          </div>
          <button className="btn solid" style={{ alignSelf: 'flex-start' }} onClick={create}>Создать</button>
        </div>
      </div>

      <div className="tbl-wrap">
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}><h3 className="h-sec">Список акций</h3></div>
        {loading ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Загрузка…</div>
          : items.length === 0 ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Акций пока нет</div>
          : <div style={{ overflowX: 'auto' }}><table className="tbl" style={{ minWidth: 900 }}>
              <thead><tr><th>Название</th><th>Тип</th><th>Значение</th><th>Диапазон</th><th>Исп.</th><th>До</th><th>Статус</th><th style={{ textAlign: 'right' }}>Действия</th></tr></thead>
              <tbody>{items.map((p) => (
                <tr key={p.id} style={!p.is_active ? { opacity: 0.5 } : undefined}>
                  <td style={{ fontWeight: 500 }}>{p.name}</td>
                  <td className="muted">{typeLabel(p.type)}</td>
                  <td style={{ fontWeight: 600 }}>{p.type === 'deposit_multiplier' ? `x${p.value}` : `−${p.value}%`}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{p.type === 'deposit_multiplier' ? ([p.min_amount != null ? `от ${p.min_amount}` : null, p.max_amount != null ? `до ${p.max_amount}` : null].filter(Boolean).join(' ') || 'любая сумма') : '—'}</td>
                  <td className="muted">{p.uses_count}{p.uses_limit != null ? ` / ${p.uses_limit}` : ''}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{fmtExpires(p.expires_at)}</td>
                  <td><button className={`badge ${p.is_active ? 'solid' : 'line'}`} onClick={() => toggle(p)}>{p.is_active ? 'Активна' : 'Выкл'}</button></td>
                  <td style={{ textAlign: 'right' }}><span className="inline-flex gap-2"><button className="icon-btn" onClick={() => setEditing({ ...p })}><Edit2 size={14} /></button><button className="icon-btn danger" onClick={() => remove(p.id)}><Trash2 size={14} /></button></span></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title="Редактировать акцию" width={520}
          footer={<><button className="btn block" onClick={() => setEditing(null)}>Отмена</button><button className="btn solid block" onClick={save}>Сохранить</button></>}>
          <div className="flex flex-col gap-3">
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Название" />
            <select className="select" value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value as PromotionType })}><option value="deposit_multiplier">xN к пополнению</option><option value="global_discount">Глобальная скидка %</option></select>
            <input className="input" type="number" step="any" value={editing.value} onChange={(e) => setEditing({ ...editing, value: Number(e.target.value) })} />
            {editing.type === 'deposit_multiplier' && (
              <div className="grid grid-cols-2 gap-3">
                <input className="input" type="number" value={editing.min_amount ?? ''} onChange={(e) => setEditing({ ...editing, min_amount: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Мин. сумма" />
                <input className="input" type="number" value={editing.max_amount ?? ''} onChange={(e) => setEditing({ ...editing, max_amount: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Макс. сумма" />
              </div>
            )}
            <input className="input" type="number" value={editing.uses_limit ?? ''} onChange={(e) => setEditing({ ...editing, uses_limit: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Лимит" />
            <input className="input" type="datetime-local" value={toLocal(editing.expires_at)} onChange={(e) => setEditing({ ...editing, expires_at: e.target.value || null })} />
            <label className="flex items-center gap-2 muted" style={{ fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={!!editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Активна</label>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ==========================================================
// 14. TRACKING LINKS
// ==========================================================

const TrackingLinksPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [links, setLinks] = useState<TrackingLink[]>([]);
  const [stats, setStats] = useState<{ total_links: number; total_clicks: number; total_unique_users: number; total_revenue: number; paid_users: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<(TrackingLink & { users?: TrackingLinkUser[] }) | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState<TrackingLink | null>(null);
  const [form, setForm] = useState({ name: '', code: '', promocode: '', welcome_message: '' });

  const fmtPct = (n: number) => `${n.toFixed(1)}%`;
  const fmtDate = (s: string) => { if (!s) return '—'; try { return new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };
  const copy = async (text: string, label = 'Ссылка') => { try { await navigator.clipboard.writeText(text); onToast('Скопировано', `${label} в буфере`, 'success'); } catch { onToast('Ошибка', 'Не удалось скопировать', 'error'); } };

  const load = async () => {
    setLoading(true);
    try {
      const [ld, sd] = await Promise.all([apiFetch('/panel/tracking-links'), apiFetch('/panel/tracking-links/stats')]);
      if (Array.isArray(ld)) setLinks(ld.map((l: any) => ({
        id: l.id, code: l.code, name: l.name || '', promocode: l.promocode || null, welcome_message: l.welcome_message || null,
        url: l.url, clicks: Number(l.clicks || 0), is_active: Boolean(l.is_active), created_at: l.created_at || '',
        unique_users: Number(l.unique_users || 0), new_users: Number(l.new_users || 0), total_revenue: Number(l.total_revenue || 0),
        paid_users: Number(l.paid_users || 0), active_subscriptions: Number(l.active_subscriptions || 0), total_keys: Number(l.total_keys || 0), conversion_rate: Number(l.conversion_rate || 0),
      })));
      if (sd) setStats(sd);
    } catch { onToast('Ошибка', 'Не удалось загрузить ссылки', 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openDetail = async (link: TrackingLink) => { setDetail(link); setDetailLoading(true); try { const d = await apiFetch(`/panel/tracking-links/${link.id}`); setDetail(d); } catch { onToast('Ошибка', 'Не удалось загрузить детали', 'error'); } finally { setDetailLoading(false); } };

  const create = async () => {
    if (!form.name.trim()) { onToast('Ошибка', 'Укажите название кампании', 'error'); return; }
    try {
      const body: Record<string, string> = { name: form.name.trim() };
      if (form.code.trim()) body.code = form.code.trim();
      if (form.promocode.trim()) body.promocode = form.promocode.trim().toUpperCase();
      if (form.welcome_message.trim()) body.welcome_message = form.welcome_message.trim();
      const res = await apiFetch('/panel/tracking-links', { method: 'POST', body: JSON.stringify(body) });
      onToast('Готово', `Ссылка создана${res.url ? `: ${res.url}` : ''}`, 'success');
      setForm({ name: '', code: '', promocode: '', welcome_message: '' }); load();
    } catch (e: any) { onToast('Ошибка', e?.message || 'Не удалось создать', 'error'); }
  };
  const remove = async (id: number) => { if (!confirm('Удалить ссылку? Статистика по ней будет потеряна.')) return; try { await apiFetch(`/panel/tracking-links/${id}`, { method: 'DELETE' }); onToast('Готово', 'Ссылка удалена', 'success'); if (detail?.id === id) setDetail(null); load(); } catch { onToast('Ошибка', 'Не удалось удалить', 'error'); } };
  const saveEdit = async () => {
    if (!editing) return;
    try { await apiFetch(`/panel/tracking-links/${editing.id}`, { method: 'PUT', body: JSON.stringify({ name: editing.name, code: editing.code, promocode: editing.promocode || '', welcome_message: editing.welcome_message || '', is_active: editing.is_active }) }); onToast('Готово', 'Ссылка обновлена', 'success'); setEditing(null); load(); }
    catch (e: any) { onToast('Ошибка', e?.message || 'Не удалось обновить', 'error'); }
  };
  const toggle = async (link: TrackingLink) => { try { await apiFetch(`/panel/tracking-links/${link.id}`, { method: 'PUT', body: JSON.stringify({ is_active: !link.is_active }) }); load(); } catch { onToast('Ошибка', 'Не удалось изменить статус', 'error'); } };

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Специальные ссылки" sub="Переходы, регистрации и оплаты рекламных кампаний" />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat title="Активных ссылок" value={stats?.total_links ?? links.length} icon={Link} />
        <Stat title="Всего переходов" value={fmtInt(stats?.total_clicks ?? 0)} icon={MousePointer} />
        <Stat title="Уникальных" value={fmtInt(stats?.total_unique_users ?? 0)} icon={Users} />
        <Stat title="Доход с кампаний" value={fmtMoney(stats?.total_revenue ?? 0)} icon={DollarSign} sub={`${stats?.paid_users ?? 0} оплатили`} />
      </div>

      <div className="card" style={{ padding: 24 }}>
        <h3 className="h-sec">Новая ссылка</h3>
        <p className="sub mt-1 mb-4">Формат: <span className="mono">t.me/{BOT_USERNAME}?start=trk_код</span></p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Название (YouTube, VK Ads…)" />
          <input className="input mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} placeholder="Код (ad, yt1…)" />
          <input className="input mono" value={form.promocode} onChange={(e) => setForm({ ...form, promocode: e.target.value.toUpperCase() })} placeholder="Промокод (необяз.)" />
          <button className="btn solid" onClick={create}>Создать ссылку</button>
        </div>
        <textarea className="textarea mono mt-3" style={{ minHeight: 72, fontSize: 13 }} value={form.welcome_message} onChange={(e) => setForm({ ...form, welcome_message: e.target.value })}
          placeholder={"Сообщение при первом переходе (необяз.) — HTML/Markdown Telegram\n<b>Привет!</b> Держи скидку 🎁"} />
        <p className="faint mt-1" style={{ fontSize: 12 }}>Отправляется только при первом переходе. Поддерживается HTML Telegram.</p>
      </div>

      <div className="tbl-wrap">
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 className="h-sec">Кампании</h3>
          <button className="icon-btn" onClick={load} title="Обновить"><RefreshCw size={15} /></button>
        </div>
        {loading ? <div className="sub" style={{ padding: 32, textAlign: 'center' }}>Загрузка…</div>
          : links.length === 0 ? <div style={{ padding: 48, textAlign: 'center' }}><Link size={36} className="faint" style={{ margin: '0 auto 12px' }} /><p className="muted">Ссылок пока нет</p><p className="sub mt-1">Создайте первую для рекламной кампании</p></div>
          : <div style={{ overflowX: 'auto' }}><table className="tbl" style={{ minWidth: 900 }}>
              <thead><tr><th>Кампания</th><th>Ссылка</th><th style={{ textAlign: 'center' }}>Переходы</th><th style={{ textAlign: 'center' }}>Уник.</th><th style={{ textAlign: 'center' }}>Новые</th><th style={{ textAlign: 'center' }}>Оплатили</th><th style={{ textAlign: 'right' }}>Доход</th><th style={{ textAlign: 'center' }}>Конв.</th><th style={{ textAlign: 'right' }}>Действия</th></tr></thead>
              <tbody>{links.map((l) => (
                <tr key={l.id} style={!l.is_active ? { opacity: 0.5 } : undefined}>
                  <td><div style={{ fontWeight: 500 }}>{l.name || l.code}</div><div className="faint mono" style={{ fontSize: 12 }}>trk_{l.code}{l.promocode ? ` · ${l.promocode}` : ''}</div></td>
                  <td><button className="btn sm" onClick={() => copy(l.url)}><Copy size={13} /> копировать</button></td>
                  <td className="muted" style={{ textAlign: 'center' }}>{l.clicks}</td>
                  <td className="muted" style={{ textAlign: 'center' }}>{l.unique_users}</td>
                  <td style={{ textAlign: 'center' }}>{l.new_users}</td>
                  <td className="muted" style={{ textAlign: 'center' }}>{l.paid_users}</td>
                  <td style={{ textAlign: 'right', fontWeight: 500 }}>{fmtMoney(l.total_revenue)}</td>
                  <td style={{ textAlign: 'center' }}><span className={`badge ${l.conversion_rate >= 10 ? 'solid' : l.conversion_rate >= 3 ? 'mute' : 'line'}`}>{fmtPct(l.conversion_rate)}</span></td>
                  <td style={{ textAlign: 'right' }}><span className="inline-flex gap-1">
                    <button className="icon-btn" onClick={() => openDetail(l)} title="Детали"><BarChart2 size={14} /></button>
                    <button className="icon-btn" onClick={() => toggle(l)} title={l.is_active ? 'Выключить' : 'Включить'}>{l.is_active ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}</button>
                    <button className="icon-btn" onClick={() => setEditing({ ...l })} title="Редактировать"><Edit2 size={14} /></button>
                    <button className="icon-btn danger" onClick={() => remove(l.id)} title="Удалить"><Trash2 size={14} /></button>
                  </span></td>
                </tr>
              ))}</tbody>
            </table></div>}
      </div>

      {editing && (
        <Modal onClose={() => setEditing(null)} title="Редактировать ссылку" width={440}
          footer={<><button className="btn block" onClick={() => setEditing(null)}>Отмена</button><button className="btn solid block" onClick={saveEdit}>Сохранить</button></>}>
          <div className="flex flex-col gap-3">
            <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Название" />
            <input className="input mono" value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.replace(/[^A-Za-z0-9_-]/g, '') })} placeholder="Код" />
            <input className="input mono" value={editing.promocode || ''} onChange={(e) => setEditing({ ...editing, promocode: e.target.value.toUpperCase() })} placeholder="Промокод" />
            <textarea className="textarea mono" style={{ minHeight: 80, fontSize: 13 }} value={editing.welcome_message || ''} onChange={(e) => setEditing({ ...editing, welcome_message: e.target.value })} placeholder={"Сообщение при первом переходе (HTML/Markdown)"} />
            <label className="flex items-center gap-2 muted" style={{ fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Ссылка активна</label>
          </div>
        </Modal>
      )}

      {detail && (
        <div className="modal-backdrop" style={{ zIndex: 60 }} onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <div>
                <div className="modal-title">{detail.name || detail.code}</div>
                <button className="btn sm mt-1" onClick={() => copy(detail.url)}><Copy size={13} /> {detail.url}</button>
              </div>
              <button className="icon-btn" onClick={() => setDetail(null)}><X size={18} /></button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" style={{ padding: 20, borderBottom: '1px solid var(--border)' }}>
              <div className="inset" style={{ padding: 12 }}><div className="sub">Переходы</div><div className="stat-value" style={{ fontSize: 20 }}>{detail.clicks}</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="sub">Уникальные</div><div className="stat-value" style={{ fontSize: 20 }}>{detail.unique_users}</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="sub">Доход</div><div className="stat-value" style={{ fontSize: 20 }}>{fmtMoney(detail.total_revenue)}</div></div>
              <div className="inset" style={{ padding: 12 }}><div className="sub">Конверсия</div><div className="stat-value" style={{ fontSize: 20 }}>{fmtPct(detail.conversion_rate)}</div></div>
            </div>
            <div className="modal-body">
              <div className="eyebrow mb-3">Пользователи по ссылке</div>
              {detailLoading ? <div className="sub" style={{ textAlign: 'center', padding: 32 }}>Загрузка…</div>
                : !detail.users?.length ? <div className="sub" style={{ textAlign: 'center', padding: 32 }}>Пока никто не перешёл</div>
                : <table className="tbl">
                    <thead><tr><th>Пользователь</th><th>Переход</th><th style={{ textAlign: 'center' }}>Новый</th><th style={{ textAlign: 'center' }}>Подписки</th><th style={{ textAlign: 'right' }}>Потратил</th></tr></thead>
                    <tbody>{detail.users.map((u) => (
                      <tr key={u.user_id}>
                        <td><div>{u.full_name || u.username || `#${u.telegram_id}`}</div><div className="faint mono" style={{ fontSize: 12 }}>{u.telegram_id}{u.username ? ` · @${u.username}` : ''}</div></td>
                        <td className="muted">{fmtDate(u.visited_at)}</td>
                        <td style={{ textAlign: 'center' }}>{u.is_new_user ? 'да' : <span className="faint">—</span>}</td>
                        <td style={{ textAlign: 'center' }}>{u.active_keys > 0 ? `${u.active_keys} акт.` : u.has_paid ? 'была' : u.trial_used ? 'триал' : <span className="faint">—</span>}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{u.total_spent > 0 ? fmtMoney(u.total_spent) : '—'}</td>
                      </tr>
                    ))}</tbody>
                  </table>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==========================================================
// 15. SQUADS
// ==========================================================

interface SquadConfig {
  id: number; squad_uuid: string; squad_name: string; squad_type: string;
  max_users: number; current_users: number; inbounds_count?: number; is_active: boolean; priority: number;
}

const SquadsPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [squads, setSquads] = useState<SquadConfig[]>([]);
  const [mapping, setMapping] = useState<{ vpn: string[]; trial: string[] }>({ vpn: [], trial: [] });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<SquadConfig | null>(null);

  const load = async () => {
    try { const d = await apiFetch('/panel/squads'); if (d) { setSquads(d.squads || []); setMapping({ vpn: d.mapping?.vpn || [], trial: d.mapping?.trial || [] }); } }
    catch { onToast('Ошибка', 'Не удалось загрузить сквады', 'error'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setSyncing(true);
    try { const r = await apiFetch('/panel/squads/sync', { method: 'POST' }); if (r?.success) { onToast('Готово', `Синхронизировано ${r.count} сквадов`, 'success'); load(); } else onToast('Ошибка', r?.error || 'Ошибка синхронизации', 'error'); }
    catch { onToast('Ошибка', 'Не удалось синхронизировать', 'error'); } finally { setSyncing(false); }
  };
  const saveSquad = async (squad: SquadConfig) => {
    try { const r = await apiFetch(`/panel/squads/${squad.squad_uuid}`, { method: 'PUT', body: JSON.stringify({ squad_name: squad.squad_name, squad_type: squad.squad_type, max_users: squad.max_users, priority: squad.priority, is_active: squad.is_active }) }); if (r?.success) { onToast('Готово', 'Сквад обновлён', 'success'); setEditing(null); load(); } }
    catch { onToast('Ошибка', 'Не удалось сохранить', 'error'); }
  };
  const saveMapping = async () => { try { const r = await apiFetch('/panel/squads/mapping', { method: 'PUT', body: JSON.stringify(mapping) }); if (r?.success) onToast('Готово', 'Привязки сохранены', 'success'); } catch { onToast('Ошибка', 'Не удалось сохранить привязки', 'error'); } };
  const toggleMapping = (type: 'vpn' | 'trial', uuid: string) => setMapping((prev) => { const cur = prev[type] || []; return { ...prev, [type]: cur.includes(uuid) ? cur.filter((u) => u !== uuid) : [...cur, uuid] }; });

  if (loading) return <div className="flex items-center justify-center" style={{ height: 240 }}><Spinner size={28} /></div>;

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Сквады" sub="Распределение нагрузки по серверам">
        <button className="btn solid" onClick={sync} disabled={syncing}>{syncing ? <Spinner size={16} /> : <RefreshCw size={16} />} Синхронизировать</button>
      </PageHead>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {squads.map((sq) => {
          const pct = sq.max_users > 0 ? Math.min(100, (sq.current_users / sq.max_users) * 100) : 0;
          return (
            <div key={sq.squad_uuid} className="card card-hover" style={{ padding: 18, opacity: sq.is_active ? 1 : 0.5 }}>
              <div className="flex justify-between items-start mb-3">
                <div><h3 style={{ fontWeight: 600 }}>{sq.squad_name}</h3><span className="badge line mt-1" style={{ marginTop: 6 }}>{sq.squad_type.toUpperCase()}</span></div>
                <button className="icon-btn" onClick={() => setEditing(sq)}><Edit2 size={15} /></button>
              </div>
              <div className="flex flex-col gap-2" style={{ fontSize: 14 }}>
                <div className="flex justify-between"><span className="muted">Пользователей</span><span style={{ fontWeight: 500 }}>{sq.current_users}{sq.max_users > 0 && ` / ${sq.max_users}`}</span></div>
                {sq.inbounds_count != null && <div className="flex justify-between"><span className="muted">Инбаундов</span><span>{sq.inbounds_count}</span></div>}
                <div className="flex justify-between"><span className="muted">Приоритет</span><span>{sq.priority}</span></div>
                {sq.max_users > 0 && <div className="meter mt-1"><i style={{ width: `${pct}%` }} /></div>}
              </div>
            </div>
          );
        })}
      </div>

      {squads.length === 0 && (
        <div className="card" style={{ padding: 32, textAlign: 'center' }}>
          <Zap size={40} className="faint" style={{ margin: '0 auto 12px' }} />
          <h3 className="h-sec mb-2">Нет сквадов</h3>
          <p className="sub mb-4">Синхронизируйте сквады с Remnawave</p>
          <button className="btn solid" onClick={sync} style={{ margin: '0 auto' }}>Синхронизировать</button>
        </div>
      )}

      {squads.length > 0 && (
        <div className="card" style={{ padding: 24 }}>
          <h3 className="h-sec mb-2">Привязка сквадов к типам подписок</h3>
          <p className="sub mb-6">Система выберет сквад с наименьшей нагрузкой из выбранных для каждого типа.</p>
          <div className="flex flex-col gap-5">
            {(['vpn', 'trial'] as const).map((type) => (
              <div key={type}>
                <h4 className="mb-3" style={{ fontWeight: 500 }}>{type === 'vpn' ? 'Подписка (VPN + обход блокировок)' : 'Пробный период'}</h4>
                <div className="flex flex-wrap gap-2">
                  {squads.filter((s) => s.is_active).map((sq) => (
                    <button key={sq.squad_uuid} className={`chip ${mapping[type]?.includes(sq.squad_uuid) ? 'on' : ''}`} onClick={() => toggleMapping(type, sq.squad_uuid)}>{sq.squad_name}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className="btn solid mt-6" onClick={saveMapping}>Сохранить привязки</button>
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)} title="Редактирование сквада" width={440}
          footer={<><button className="btn block" onClick={() => setEditing(null)}>Отмена</button><button className="btn solid block" onClick={() => saveSquad(editing)}>Сохранить</button></>}>
          <div className="flex flex-col gap-4">
            <div><label className="field-label">Название</label><input className="input" value={editing.squad_name} onChange={(e) => setEditing({ ...editing, squad_name: e.target.value })} /></div>
            <div><label className="field-label">Тип</label><select className="select" value={editing.squad_type} onChange={(e) => setEditing({ ...editing, squad_type: e.target.value })}><option value="vpn">Подписка (VPN + обход)</option><option value="trial">Trial (пробный)</option></select></div>
            <div><label className="field-label">Макс. пользователей (0 = без лимита)</label><input className="input" type="number" value={editing.max_users} onChange={(e) => setEditing({ ...editing, max_users: parseInt(e.target.value) || 0 })} /></div>
            <div><label className="field-label">Приоритет</label><input className="input" type="number" value={editing.priority} onChange={(e) => setEditing({ ...editing, priority: parseInt(e.target.value) || 0 })} /></div>
            <label className="flex items-center gap-2 muted" style={{ fontSize: 13, cursor: 'pointer' }}><input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })} /> Активен</label>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ==========================================================
// 16. BACKUPS
// ==========================================================

const BackupSettingsTab: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [enabled, setEnabled] = useState(false);
  const [interval, setInterval] = useState('12');
  const [lastBackup, setLastBackup] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadStatus = async () => {
    try { const d = await apiFetch('/panel/backups/status'); if (d) { setEnabled(d.enabled || false); setInterval(d.interval_hours?.toString() || '12'); setLastBackup(d.last_backup || null); } }
    catch (e) { console.error(e); }
  };
  useEffect(() => { loadStatus(); }, []);

  const createNow = async () => { setCreating(true); try { await apiFetch('/panel/backups/create', { method: 'POST' }); onToast('Готово', 'Копия создана и отправлена администратору', 'success'); loadStatus(); } catch { onToast('Ошибка', 'Не удалось создать копию', 'error'); } setCreating(false); };
  const saveSettings = async () => { try { await apiFetch('/panel/backups/settings', { method: 'PUT', body: JSON.stringify({ enabled, interval_hours: parseInt(interval) }) }); onToast('Готово', 'Настройки сохранены', 'success'); } catch { onToast('Ошибка', 'Не удалось сохранить', 'error'); } };

  return (
    <div className="card" style={{ padding: 24 }}>
      <h3 className="h-sec" style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)', marginBottom: 20 }}>Резервное копирование</h3>
      <div className="flex flex-col gap-5">
        <div className="inset flex items-center justify-between gap-3" style={{ padding: 14 }}>
          <div><div style={{ fontWeight: 500 }}>Автоматическое копирование</div><div className="sub mt-0.5">Копии создаются автоматически и отправляются администратору</div></div>
          <Toggle on={enabled} onChange={() => setEnabled(!enabled)} />
        </div>
        <div><label className="field-label">Частота, часов</label><input className="input" type="number" value={interval} onChange={(e) => setInterval(e.target.value)} placeholder="12" /></div>
        {lastBackup && <div className="inset" style={{ padding: 12 }}><span className="sub">Последняя копия: </span><span>{new Date(lastBackup).toLocaleString('ru-RU')}</span></div>}
        <div className="inset flex items-start gap-3" style={{ padding: 14 }}>
          <Cloud size={18} className="faint" style={{ marginTop: 2, flex: 'none' }} />
          <div><div style={{ fontWeight: 500 }}>Как это работает</div><div className="sub mt-1">Копии отправляются администратору в личные сообщения в виде архива базы данных.</div></div>
        </div>
        <div className="flex gap-3">
          <button className="btn solid block" onClick={createNow} disabled={creating}>{creating ? <Spinner size={16} /> : <Download size={16} />} Создать сейчас</button>
          <button className="btn block" onClick={saveSettings}><Save size={16} /> Сохранить настройки</button>
        </div>
      </div>
    </div>
  );
};

// ==========================================================
// 17. SETTINGS
// ==========================================================

const SettingsPage: React.FC<{ onToast: (t: string, m: string, ty: ToastType) => void }> = ({ onToast }) => {
  const [activeTab, setActiveTab] = useState<'squads' | 'backups'>('squads');
  const tabs = [{ id: 'squads', icon: Zap, label: 'Сквады' }, { id: 'backups', icon: Cloud, label: 'Резервные копии' }] as const;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      <div style={{ width: 220, flex: 'none' }} className="w-full lg:!w-[220px]">
        <div className="card" style={{ position: 'sticky', top: 80, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}><span className="h-sec">Категории</span></div>
          <div style={{ padding: 8 }} className="flex flex-col gap-1">
            {tabs.map((t) => (
              <button key={t.id} className={`nav-item ${activeTab === t.id ? 'on' : ''}`} onClick={() => setActiveTab(t.id)}><t.icon size={16} className={activeTab === t.id ? '' : 'faint'} /> {t.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1">
        {activeTab === 'squads' && <SquadsPage onToast={onToast} />}
        {activeTab === 'backups' && <BackupSettingsTab onToast={onToast} />}
      </div>
    </div>
  );
};
