import React, { useState, useEffect, useMemo, useRef, createContext, useContext } from 'react';
import { miniApiFetch, SUPPORT_URL, BOT_USERNAME_MINI } from '../../api/client';
import type { ViewState, Plan, PaymentMethod, Device, HistoryItem, ReferralUser, PlatformId } from '../../core/types';
import {
  OFFER_AGREEMENT_TEXT, PRIVACY_POLICY_TEXT, VPN_PLANS_DEFAULT, PAYMENT_METHODS_DEFAULT,
  PRESET_AMOUNTS, WITHDRAW_METHODS, PLATFORMS, INSTRUCTIONS,
  normalizedDevicesCount, computePlanPrice, getInstructionSteps,
} from '../../core/constants';
import {
  Button, Card, Header, Modal, MarkdownRenderer, AnimatedBackground,
} from '../components/ui';

export type MiniAppContextValue = Record<string, unknown>;

export const MiniAppContext = createContext<MiniAppContextValue | null>(null);

export function useMiniApp(): MiniAppContextValue {
  const ctx = useContext(MiniAppContext);
  if (!ctx) throw new Error('useMiniApp must be used within MiniAppProvider');
  return ctx;
}

export function MiniAppProvider({ children }: { children: React.ReactNode }) {
  const [view, setView] = useState<ViewState>('home'); 
  const [balance, setBalance] = useState<number>(0);
  const [nextDiscountPercent, setNextDiscountPercent] = useState<number>(0);
  const [referralInviteDiscountActive, setReferralInviteDiscountActive] = useState(false);
  const [isTrialUsed, setIsTrialUsed] = useState<boolean>(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [username, setUsername] = useState<string>('???');
  const [displayName, setDisplayName] = useState<string>('???'); // first_name для отображения
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  
  // Data
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceKeys, setDeviceKeys] = useState<Map<number, string>>(new Map()); // key: device_id, value: key_config
  
  // Modal States
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false); 
  // Legal Docs Modal
  const [docModalOpen, setDocModalOpen] = useState(false);
  const [docContent, setDocContent] = useState<{ title: string, text: string } | null>(null);
  const [publicPages, setPublicPages] = useState<{ offer: string, privacy: string }>({
    offer: OFFER_AGREEMENT_TEXT,
    privacy: PRIVACY_POLICY_TEXT
  });

  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);

  // Ban Status
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string>('');
  const [userLoadFailed, setUserLoadFailed] = useState(false);
  const [needsChannelSubscription, setNeedsChannelSubscription] = useState(false);
  const [requiredChannelLink, setRequiredChannelLink] = useState<string>('https://t.me/blinvpn');

  // Onboarding (Tutorial)
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);

  // Referral Data
  const [referrals, setReferrals] = useState({ count: 0, earned: 0, partnerBalance: 0 });
  const [referralList, setReferralList] = useState<ReferralUser[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<ReferralUser | null>(null);
  const [lastCardWithdrawal, setLastCardWithdrawal] = useState<string | null>(null);
  const [withdrawState, setWithdrawState] = useState({ 
    step: 1, 
    amount: '', 
    method: null as string | null, 
    cardNumber: '',
    cryptoNet: '', 
    cryptoAddr: '',
  });

  // TopUp State
  const [topupStep, setTopupStep] = useState(1); 
  const [topupAmount, setTopupAmount] = useState(0);
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(PAYMENT_METHODS_DEFAULT);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null); // URL для оплаты
  
  // Pending Purchase
  const [pendingAction, setPendingAction] = useState<{ type: string, payload: any } | null>(null);

  // VPN Plans - загружаются из API, fallback на дефолтные
  const [vpnPlans, setVpnPlans] = useState<Plan[]>(VPN_PLANS_DEFAULT);

  // Connection Wizard State
  const [wizardStep, setWizardStep] = useState(1); // 1: тариф + устройства, 2: подтверждение, 3: оплата, 4: успех + инструкция
  const [wizardDeviceCount, setWizardDeviceCount] = useState(2);
  const [successInstructionPlatform, setSuccessInstructionPlatform] = useState<PlatformId>('android');
  const [wizardSuccessPlainDevice, setWizardSuccessPlainDevice] = useState(false);
  const [wizardPlan, setWizardPlan] = useState<Plan | null>(null);
  const [wizardType] = useState<'vpn'>('vpn'); // Единая подписка
  const [useAutoPay, setUseAutoPay] = useState(false);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);

  // Buy Device State (legacy, kept for compatibility)
  
  // Extend subscription state - для продления существующего ключа
  const [extendingDevice, setExtendingDevice] = useState<Device | null>(null);
  const [extendPlan, setExtendPlan] = useState<Plan | null>(null);
  const [extendDeviceCount, setExtendDeviceCount] = useState(2);

  useEffect(() => {
    if (extendingDevice) {
      setExtendDeviceCount(normalizedDevicesCount(extendingDevice.devices_limit || 2));
    }
  }, [extendingDevice]);

  // Instructions State
  const [activePlatform, setActivePlatform] = useState<string>('android');
  const [instructionPlainLinkMode, setInstructionPlainLinkMode] = useState(false);
  const [instructionSourceDeviceId, setInstructionSourceDeviceId] = useState<number | null>(null);

  // Detect Platform & load user on Mount
  useEffect(() => {
    const win: any = window as any;

    const waitForTelegramUser = async (maxMs = 4000): Promise<any | null> => {
      const step = 100;
      for (let t = 0; t < maxMs; t += step) {
        const user = win.Telegram?.WebApp?.initDataUnsafe?.user;
        if (user) return user;
        await new Promise((r) => setTimeout(r, step));
      }
      return win.Telegram?.WebApp?.initDataUnsafe?.user || null;
    };

    (async () => {
    const ua = navigator.userAgent.toLowerCase();
    let detected: PlatformId = 'android';
    if (ua.includes('iphone') || ua.includes('ipad')) detected = 'ios';
    else if (ua.includes('android')) detected = 'android';
    else if (ua.includes('win')) detected = 'windows';
    else if (ua.includes('mac')) detected = 'macos';
    else if (ua.includes('linux')) detected = 'linux';
    
    setActivePlatform(detected);
    setSuccessInstructionPlatform(detected);

    // Определяем Telegram ID и username из Telegram WebApp
    let tgId: number | null = null;
    let tgUsername: string = '';
    let tgFirstName: string = '';
    let referralId: number | null = null;
    
    const tgUser = await waitForTelegramUser();
    if (tgUser) {
      tgId = Number(tgUser.id);
      tgUsername = tgUser.username || '';
      tgFirstName = tgUser.first_name || '';
      
      // Извлекаем реферальный ID из start_param (формат: ref123456789)
      const startParam = win.Telegram.WebApp.initDataUnsafe?.start_param;
      if (startParam && typeof startParam === 'string') {
        const refMatch = startParam.match(/ref(\d+)/);
        if (refMatch) {
          referralId = parseInt(refMatch[1], 10);
          // Нельзя быть своим собственным рефералом
          if (referralId === tgId) {
            referralId = null;
          }
        }
      }
      
      // Уведомляем Telegram что приложение готово
      win.Telegram.WebApp.ready();
      try { win.Telegram.WebApp.expand(); } catch {}
      try {
        if (typeof win.Telegram.WebApp.requestFullscreen === 'function') {
          win.Telegram.WebApp.requestFullscreen();
        }
      } catch {}
      try {
        if (typeof win.Telegram.WebApp.disableVerticalSwipes === 'function') {
          win.Telegram.WebApp.disableVerticalSwipes();
        }
      } catch {}
    } else {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = params.get('telegram_id');
      if (fromQuery) tgId = Number(fromQuery);
      tgUsername = params.get('username') || '';
      tgFirstName = params.get('first_name') || '';
      // Также проверяем ref параметр из URL
      const refParam = params.get('ref');
      if (refParam) {
        referralId = parseInt(refParam, 10);
        if (isNaN(referralId) || referralId === tgId) {
          referralId = null;
        }
      }
    }
    
    if (!tgId) {
      console.error('Telegram ID не определен. Приложение работает только через Telegram.');
      setUserLoadFailed(true);
      return;
    }

    setTelegramId(tgId);
    if (tgUsername) setUsername(tgUsername);
    // Устанавливаем displayName: приоритет first_name, затем username
    setDisplayName(tgFirstName || tgUsername || '???');

    // Аватар через наш API (Telegram CDN в РФ часто недоступен)
    (async () => {
      try {
        const initData = win.Telegram?.WebApp?.initData || '';
        const headers: Record<string, string> = {};
        if (initData) headers['X-Telegram-Init-Data'] = initData;
        const res = await fetch(`/api/user/avatar?telegram_id=${tgId}`, { headers });
        if (res.ok) {
          const blob = await res.blob();
          setUserPhotoUrl(URL.createObjectURL(blob));
        }
      } catch {
        /* fallback: буква в круге */
      }
    })();

    (async () => {
      let userData: any = null;
      try {
        // Пользователь (автоматически создается если не существует)
        let userUrl = `/user/info?telegram_id=${tgId}&username=${encodeURIComponent(tgUsername)}`;
        if (tgFirstName) {
          userUrl += `&first_name=${encodeURIComponent(tgFirstName)}`;
        }
        if (referralId) {
          userUrl += `&ref=${referralId}`;
        }
        userData = await miniApiFetch(userUrl);
      } catch (err) {
        console.error('Ошибка загрузки профиля:', err);
        setUserLoadFailed(true);
        return;
      }

      if (userData && userData._needsSubscription) {
        setNeedsChannelSubscription(true);
        setRequiredChannelLink(userData.channel_link || 'https://t.me');
        return;
      }

      if (userData && userData._banned) {
        setIsBanned(true);
        setBanReason(userData.reason || 'Аккаунт заблокирован');
        return;
      }

      if (!userData || !userData.id) {
        console.error('Профиль не получен от API');
        setUserLoadFailed(true);
        return;
      }

      setUserId(userData.id);
      setBalance(userData.balance || 0);
      setNextDiscountPercent(Number(userData.next_discount_percent || 0) || 0);
      setReferralInviteDiscountActive(!!userData.referral_invite_discount_active);
      setUsername(userData.username || `User_${tgId}`);
      setDisplayName(userData.full_name || tgFirstName || userData.username || `User_${tgId}`);
      setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
      setReferrals({
        count: userData.referrals_count || 0,
        earned: userData.referral_earned || 0,
        partnerBalance: userData.partner_balance || 0,
      });
      if (userData.last_card_withdrawal) {
        setLastCardWithdrawal(userData.last_card_withdrawal);
      }

      const onboardingShown = localStorage.getItem(`onboarding_${tgId}`);
      if (!onboardingShown && (userData.is_new_user || (!userData.trial_used && (userData.balance || 0) <= 0))) {
        setShowOnboarding(true);
      }

      try {
        // Устройства
        const devicesData = await miniApiFetch(`/user/devices?telegram_id=${tgId}`);
        if (Array.isArray(devicesData)) {
          const devicesList: Device[] = devicesData.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            added: d.added,
            key_uuid: d.key_uuid,
            short_uuid: d.short_uuid,
            key_status: d.key_status,
            is_trial: d.plan_type === 'trial',
            days_left: d.days_left,
            hours_left: d.hours_left,
            is_expired: d.is_expired,
            expiry_date: d.expiry_date
          }));
          setDevices(devicesList);
          
          const keysMap = new Map<number, string>();
          devicesData.forEach((d: any) => {
            if (d.key_config) {
              keysMap.set(d.id, d.key_config);
            }
          });
          setDeviceKeys(keysMap);
        }

        // Если API не пометил is_new_user, но устройств нет — тоже показываем первичную инструкцию.
        const onboardingShown2 = localStorage.getItem(`onboarding_${tgId}`);
        if (!onboardingShown2 && Array.isArray(devicesData) && devicesData.length === 0) {
          setShowOnboarding(true);
        }

        // История
        const historyData = await miniApiFetch(`/user/history?telegram_id=${tgId}`);
        if (Array.isArray(historyData)) {
          setHistory(historyData);
        }

        // Публичные страницы (оферта и политика)
        try {
          const publicPagesData = await miniApiFetch('/public-pages');
          if (publicPagesData) {
            setPublicPages({
              offer: publicPagesData.offer?.content || OFFER_AGREEMENT_TEXT,
              privacy: publicPagesData.privacy?.content || PRIVACY_POLICY_TEXT
            });
          }
        } catch (e) {
          console.error('Failed to load public pages, using defaults', e);
        }

        // Загружаем тарифы из API
        try {
          const tariffsData = await miniApiFetch('/tariffs');
          if (Array.isArray(tariffsData) && tariffsData.length > 0) {
            // Конвертируем формат API в формат Plan
            const plans: Plan[] = [
              // Всегда добавляем триал первым
              { id: 'trial', duration: 'Пробный тариф', price: 0, highlight: true, days: 3, isTrial: true }
            ];
            tariffsData.forEach((t: any) => {
              if (t.plan_type === 'vpn' && t.is_active) {
                plans.push({
                  id: `plan_${t.id}`,
                  duration: t.name,
                  price: t.price,
                  highlight: t.duration_days === 365, // Выделяем годовой план
                  days: t.duration_days,
                  isTrial: false
                });
              }
            });
            if (plans.length > 1) {
              setVpnPlans(plans);
            }
          }
        } catch (e) {
          console.error('Failed to load tariffs, using defaults', e);
        }
      } catch (err) {
        console.error('Ошибка загрузки устройств/истории:', err);
      }
    })();
    })();
  }, []);
  
  // Load referrals list
  useEffect(() => {
    if (!telegramId) return;
    (async () => {
      try {
        const data = await miniApiFetch(`/user/referrals?telegram_id=${telegramId}`);
        if (Array.isArray(data)) {
          setReferralList(data);
        }
      } catch (e) {
        console.error('Failed to load referrals list', e);
      }
    })();
  }, [telegramId]);
  
  // Helpers
  const formatMoney = (val: number) => new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(val);
  const applyNextDiscount = (price: number): number => {
    if (!nextDiscountPercent || nextDiscountPercent <= 0) return price;
    if (price <= 0) return price;
    return Math.max(0, Math.round(price * (100 - nextDiscountPercent) / 100));
  };

  const applyReferralInviteFirst = (price: number): number => {
    if (!referralInviteDiscountActive || price <= 0) return price;
    return Math.max(0, Math.round(price * 0.9));
  };

  const priceAfterReferralOnly = (plan: Plan | null, devices: number): number => {
    if (!plan || plan.isTrial) return 0;
    return applyReferralInviteFirst(computePlanPrice(plan, devices));
  };

  const priceFinal = (plan: Plan | null, devices: number): number => {
    return applyNextDiscount(priceAfterReferralOnly(plan, devices));
  };
  
  const addHistoryItem = (type: string, title: string, amount: number) => {
    const newItem: HistoryItem = {
      id: Date.now(),
      type,
      title,
      amount,
      date: new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    };
    setHistory(prev => [newItem, ...prev]);
  };

  const refreshDevices = async () => {
    if (!telegramId) return;
    try {
      const devicesData = await miniApiFetch(`/user/devices?telegram_id=${telegramId}`);
      if (Array.isArray(devicesData)) {
        const devicesList: Device[] = devicesData.map((d: any) => ({
          id: d.id,
          name: d.name,
          type: d.type,
          added: d.added,
          key_uuid: d.key_uuid,
          short_uuid: d.short_uuid,
          key_status: d.key_status,
          is_trial: d.plan_type === 'trial',
          days_left: d.days_left,
          hours_left: d.hours_left,
          is_expired: d.is_expired,
          expiry_date: d.expiry_date
        }));
        setDevices(devicesList);

        const keysMap = new Map<number, string>();
        devicesData.forEach((d: any) => {
          if (d.key_config) {
            keysMap.set(d.id, d.key_config);
          }
        });
        setDeviceKeys(keysMap);
      }
    } catch (e) {
      console.error('Failed to refresh devices', e);
    }
  };

  const refreshUserData = async (): Promise<{ balance: number } | null> => {
    if (!telegramId) return null;
    try {
      const userData = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
      if (userData) {
        const newBalance = userData.balance || 0;
        setBalance(newBalance);
        setUserId(userData.id);
        setUsername(userData.username || `User_${telegramId}`);
        setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
        setNextDiscountPercent(Number(userData.next_discount_percent || 0) || 0);
        setReferralInviteDiscountActive(!!userData.referral_invite_discount_active);
        setReferrals({
          count: userData.referrals_count || 0,
          earned: userData.referral_earned || 0,
          partnerBalance: userData.partner_balance || 0,
        });
        if (userData.last_card_withdrawal) {
          setLastCardWithdrawal(userData.last_card_withdrawal);
        }
        return { balance: newBalance };
      }
      return null;
    } catch (e) {
      console.error('Failed to refresh user data', e);
      return null;
    }
  };

  const refreshAll = async () => {
    await Promise.all([
      refreshUserData(),
      refreshDevices(),
    ]);
  };

  // Получить userId, если еще не загружен
  const ensureUserId = async (): Promise<number | null> => {
    if (userId) return userId;
    if (!telegramId) return null;
    
    try {
      const userData = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
      if (userData && userData.id) {
        setUserId(userData.id);
        setBalance(userData.balance || 0);
        setNextDiscountPercent(Number(userData.next_discount_percent || 0) || 0);
        setReferralInviteDiscountActive(!!userData.referral_invite_discount_active);
        setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
        return userData.id;
      }
    } catch (e) {
      console.error('Failed to ensure userId', e);
    }
    return null;
  };

  // Получить Happ зашифрованную ссылку через наш бэкенд (который проксирует на crypto.happ.su)
  const getHappEncryptedLink = async (subscriptionUrl: string): Promise<string | null> => {
    try {
      const response = await fetch('/api/encrypt-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: subscriptionUrl })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.encrypted_link) {
          console.log('Got encrypted link:', data.encrypted_link);
          return data.encrypted_link;
        }
      }
      const errorText = await response.text();
      console.error('Encryption API failed:', response.status, errorText);
      return null;
    } catch (e) {
      console.error('Encryption API error:', e);
      return null;
    }
  };

  const getPlainSubscriptionUrl = (deviceId?: number | null): string | null => {
    const resolvedId =
      deviceId ??
      instructionSourceDeviceId ??
      devices.find((d) => deviceKeys.has(d.id))?.id ??
      null;
    if (resolvedId != null && deviceKeys.has(resolvedId)) {
      return deviceKeys.get(resolvedId) || null;
    }
    const first = devices.find((d) => deviceKeys.has(d.id));
    if (first && deviceKeys.has(first.id)) return deviceKeys.get(first.id) || null;
    return null;
  };

  // Открыть Happ с зашифрованной ссылкой через редирект-страницу
  const openHappWithSubscription = async (deviceId?: number) => {
    console.log('openHappWithSubscription called, deviceId:', deviceId);
    console.log('Available devices:', devices);
    console.log('Device keys:', Array.from(deviceKeys.entries()));
    
    let subscriptionUrl: string | null = null;
    
    // Получаем URL подписки из deviceKeys
    if (deviceId && deviceKeys.has(deviceId)) {
      subscriptionUrl = deviceKeys.get(deviceId) || null;
    } else {
      // Пробуем найти активное устройство с ключом
      const activeDevice = devices.find(d => deviceKeys.has(d.id));
      if (activeDevice) {
        subscriptionUrl = deviceKeys.get(activeDevice.id) || null;
        console.log('Found active device:', activeDevice.id, 'with URL:', subscriptionUrl);
      }
    }
    
    if (!subscriptionUrl) {
      console.log('No subscription URL found');
      alert('У вас нет активных подписок. Сначала создайте подписку.');
      return;
    }
    
    // Шифруем ссылку
    console.log('Encrypting URL:', subscriptionUrl);
    const encryptedLink = await getHappEncryptedLink(subscriptionUrl);
    console.log('Encrypted link:', encryptedLink);
    
    if (!encryptedLink) {
      alert('Не удалось зашифровать ссылку. Попробуйте позже.');
      return;
    }
    
    // Telegram не позволяет открывать не-HTTPS ссылки напрямую,
    // поэтому используем редирект через API
    const redirectUrl = `${window.location.origin}/api/redirect?url=${encodeURIComponent(encryptedLink)}`;
    console.log('Opening redirect URL:', redirectUrl);
    
    // Открываем редирект-страницу
    const win = window as any;
    if (win.Telegram?.WebApp?.openLink) {
      // openLink открывает во внешнем браузере - там сработает редирект на happ://
      win.Telegram.WebApp.openLink(redirectUrl);
    } else {
      // Fallback - открываем в новом окне
      window.open(redirectUrl, '_blank');
    }
  };

  const handleCopy = (text: string, deviceId?: number) => {
    try {
      // Если передан deviceId, пытаемся получить реальный ключ из deviceKeys
      let keyToCopy = text;
      if (deviceId && deviceKeys.has(deviceId)) {
        keyToCopy = deviceKeys.get(deviceId)!;
      }
      
      const el = document.createElement('textarea');
      el.value = keyToCopy;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      alert('Скопировано в буфер!');
    } catch (e) {
      console.error(e);
      alert('Ошибка копирования. Пожалуйста, выделите и скопируйте текст вручную.');
    }
  };

  const openDoc = (title: string, text: string) => {
      setDocContent({ title, text });
      setDocModalOpen(true);
  };

  // --- LOGIC: MODAL HANDLERS ---

  const openDeleteModal = (device: Device) => {
    setCurrentDevice(device);
    setDeleteModalOpen(true);
  };

  const confirmDeleteDevice = async () => {
    if (!currentDevice || !telegramId) return;
    
    try {
      // Удаляем на сервере
      const result = await miniApiFetch(`/user/devices/${currentDevice.id}?telegram_id=${telegramId}`, {
        method: 'DELETE'
      });
      
      if (result && result.success) {
        // Обновляем локально
        setDevices(prev => prev.filter(d => d.id !== currentDevice.id));
        setDeviceKeys(prev => {
          const newMap = new Map(prev);
          newMap.delete(currentDevice.id);
          return newMap;
        });
        addHistoryItem('device_del', `Удалено устройство: ${currentDevice.name}`, 0);
      } else {
        alert(result?.error || 'Не удалось удалить устройство');
        // Обновляем список устройств с сервера на случай рассинхронизации
        refreshDevices();
      }
    } catch (e) {
      console.error('Failed to delete device', e);
      alert('Ошибка при удалении устройства');
      // Обновляем список устройств с сервера
      refreshDevices();
    }
    
    setDeleteModalOpen(false);
    setCurrentDevice(null);
  };

  // --- LOGIC: WITHDRAWAL ---

  const openWithdrawModal = () => {
    setWithdrawState({
      step: 1,
      amount: '',
      method: null,
      cardNumber: '',
      cryptoNet: '',
      cryptoAddr: '',
    });
    setWithdrawModalOpen(true);
  };

  const handleWithdrawNext = async () => {
    const { step, amount, method } = withdrawState;
    const numAmount = Number(amount);

    if (step === 1) {
      if (!amount || numAmount <= 0) return alert("Введите сумму");
      if (numAmount > referrals.partnerBalance) return alert("Недостаточно средств на реферальном балансе");
      setWithdrawState(prev => ({ ...prev, step: 2 }));
    } else if (step === 2) {
      if (!method) return alert("Выберите метод");
      if (method === 'card' || method === 'crypto' || method === 'cryptobot') {
        const minAmount = method === 'card' ? 1000 : (method === 'cryptobot' ? 10 : 300);
        if (numAmount < minAmount) return alert(`Минимальная сумма вывода: ${minAmount}₽`);
        
        // Проверка 30-дневного лимита для карты
        if (method === 'card' && lastCardWithdrawal) {
          const lastDate = new Date(lastCardWithdrawal);
          const now = new Date();
          const daysSince = Math.floor((now.getTime() - lastDate.getTime()) / (24 * 60 * 60 * 1000));
          if (daysSince < 30) {
            const daysLeft = 30 - daysSince;
            return alert(`Вывод на карту доступен не чаще 1 раза в 30 дней. Осталось дней: ${daysLeft}`);
          }
        }
      }
      setWithdrawState(prev => ({ ...prev, step: 3 }));
    } else if (step === 3) {
      // Отправляем запрос на сервер для обработки вывода
      try {
        const requestData: any = {
          telegram_id: telegramId,
          amount: numAmount,
          method: method,
        };
        
        if (method === 'card') {
          if (!withdrawState.cardNumber) return alert("Укажите номер карты");
          requestData.card_number = withdrawState.cardNumber.replace(/\s+/g, '');
        } else if (method === 'cryptobot') {
          // Дополнительные данные не требуются
        } else if (method === 'crypto') {
          if (!withdrawState.cryptoNet || !withdrawState.cryptoAddr) return alert("Заполните все поля");
          if (withdrawState.cryptoNet === 'TRC-20' && !/^T/i.test(withdrawState.cryptoAddr.trim())) {
            return alert("Для сети TRC-20 адрес должен начинаться с буквы T");
          }
          requestData.crypto_net = withdrawState.cryptoNet;
          requestData.crypto_addr = withdrawState.cryptoAddr;
        }
        
        const result = await miniApiFetch('/user/withdraw', {
          method: 'POST',
          body: JSON.stringify(requestData),
        });
        
        if (result && result.success) {
          if (method === 'balance') {
            setBalance(prev => prev + numAmount);
            addHistoryItem('ref_out', 'Вывод на баланс', numAmount);
          } else if (method === 'card') {
            setLastCardWithdrawal(new Date().toISOString());
            addHistoryItem('ref_req', 'Заявка на вывод (Карта)', 0);
          } else if (method === 'cryptobot') {
            addHistoryItem('ref_req', 'Заявка на вывод (CryptoBot)', 0);
          } else if (method === 'crypto') {
            addHistoryItem('ref_req', 'Заявка на вывод (Crypto)', 0);
          }
          
          setReferrals(prev => ({ ...prev, partnerBalance: prev.partnerBalance - numAmount }));
          setWithdrawState(prev => ({ ...prev, step: 4 }));
        } else {
          alert(result?.error || 'Не удалось выполнить вывод');
        }
      } catch (e) {
        console.error('Withdrawal error:', e);
        alert('Ошибка при выводе средств');
      }
    }
  };

  // Функция продления существующей подписки
  const extendSubscription = async (device: Device, plan: Plan) => {
    const minDevs = normalizedDevicesCount(device.devices_limit || 2);
    const devs = Math.max(minDevs, extendDeviceCount);
    const price = priceFinal(plan, devs);
    const currentUserId = await ensureUserId();
    
    if (!currentUserId) {
      alert('Не удалось загрузить данные пользователя. Попробуйте перезагрузить приложение.');
      return;
    }
    
    if (balance < price) {
      // Недостаточно средств - переходим к пополнению
      if(window.confirm(`Недостаточно средств. Стоимость: ${price} ₽. Ваш баланс: ${balance} ₽. Пополнить баланс?`)) {
        setPendingAction({
          type: 'extend',
          payload: { device, plan, price, name: `Продление VPN (${plan.duration})`, devices: devs }
        });
        setTopupAmount(price - balance);
        setTopupStep(2);
        setView('topup');
      }
      return;
    }
    
    try {
      const res = await miniApiFetch('/subscription/extend', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUserId,
          key_id: device.id,
          days: plan.days,
          price: price,
          devices: devs,
        }),
      });
      
      if (res && res.success) {
        addHistoryItem('extend', `Продление подписки (${plan.duration})`, -price);
        await refreshAll();
        setExtendingDevice(null);
        setExtendPlan(null);
        setView('devices');
        alert('Подписка успешно продлена!');
      } else {
        alert(res?.error || 'Не удалось продлить подписку');
      }
    } catch (e) {
      console.error('Failed to extend subscription', e);
      alert('Ошибка продления подписки');
    }
  };

  const wizardActivate = async () => {
    if (!wizardPlan) return;

    // Получаем userId если еще не загружен
    const currentUserId = await ensureUserId();
    if (!currentUserId) {
      alert('Не удалось загрузить данные пользователя. Попробуйте перезагрузить приложение.');
      return;
    }

    // Активируем триал
    if (wizardPlan.isTrial) {
      try {
        const res = await miniApiFetch('/subscription/create', {
          method: 'POST',
          body: JSON.stringify({
            user_id: currentUserId,
            days: wizardPlan.days || 1,
            type: 'vpn',
            is_trial: true,
            price: 0,
            devices: 2,
          }),
        });
        
        if (res && res.success) {
          setIsTrialUsed(true);
          addHistoryItem('trial', 'Активация пробного периода', 0);
          await refreshAll();
          setInstructionSourceDeviceId(null);
          setWizardSuccessPlainDevice(false);
          setWizardStep(4);
        } else {
          alert(res?.error || 'Ошибка активации пробного периода');
        }
      } catch (e) {
        console.error('Failed to activate trial', e);
        alert('Ошибка активации пробного периода');
      }
      return;
    }

    const price = priceFinal(wizardPlan, wizardDeviceCount);
    const name = `Подписка (${wizardPlan.duration})`;

    if (balance < price) {
      if(window.confirm(`Недостаточно средств. Пополнить баланс на ${price - balance} ₽?`)) {
        setPendingAction({
            type: 'wizard',
            payload: { wizardType: 'vpn', wizardPlan, wizardDeviceCount, price, name }
        });
        setTopupAmount(price - balance);
        setTopupStep(2);
        setView('topup');
      }
      return;
    }
    
    try {
      const res = await miniApiFetch('/subscription/create', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUserId,
          days: wizardPlan.days,
          type: 'vpn',
          price: price,
          devices: wizardDeviceCount,
        }),
      });
      
      if (res && res.success) {
        addHistoryItem('buy_dev', `Подключение: ${name}`, -price);
        await refreshAll();
        setInstructionSourceDeviceId(null);
        setWizardSuccessPlainDevice(false);
        setWizardStep(4);
      } else {
        alert(res?.error || 'Не удалось создать подписку');
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка при создании подписки');
    }
  };

  const getPaymentTotal = () => {
    // Комиссию добавляет платёжная система, мы создаём платеж ровно на сумму пользователя.
    return topupAmount;
  };


  const contextValue: MiniAppContextValue = {
    view: view,
    setView: setView,
    balance: balance,
    setBalance: setBalance,
    nextDiscountPercent: nextDiscountPercent,
    setNextDiscountPercent: setNextDiscountPercent,
    referralInviteDiscountActive: referralInviteDiscountActive,
    setReferralInviteDiscountActive: setReferralInviteDiscountActive,
    isTrialUsed: isTrialUsed,
    setIsTrialUsed: setIsTrialUsed,
    userId: userId,
    setUserId: setUserId,
    telegramId: telegramId,
    setTelegramId: setTelegramId,
    username: username,
    setUsername: setUsername,
    displayName: displayName,
    setDisplayName: setDisplayName,
    userPhotoUrl: userPhotoUrl,
    setUserPhotoUrl: setUserPhotoUrl,
    history: history,
    setHistory: setHistory,
    devices: devices,
    setDevices: setDevices,
    deviceKeys: deviceKeys,
    setDeviceKeys: setDeviceKeys,
    deleteModalOpen: deleteModalOpen,
    setDeleteModalOpen: setDeleteModalOpen,
    withdrawModalOpen: withdrawModalOpen,
    setWithdrawModalOpen: setWithdrawModalOpen,
    docModalOpen: docModalOpen,
    setDocModalOpen: setDocModalOpen,
    docContent: docContent,
    setDocContent: setDocContent,
    publicPages: publicPages,
    setPublicPages: setPublicPages,
    currentDevice: currentDevice,
    setCurrentDevice: setCurrentDevice,
    isBanned: isBanned,
    setIsBanned: setIsBanned,
    banReason: banReason,
    setBanReason: setBanReason,
    userLoadFailed: userLoadFailed,
    setUserLoadFailed: setUserLoadFailed,
    needsChannelSubscription: needsChannelSubscription,
    setNeedsChannelSubscription: setNeedsChannelSubscription,
    requiredChannelLink: requiredChannelLink,
    setRequiredChannelLink: setRequiredChannelLink,
    showOnboarding: showOnboarding,
    setShowOnboarding: setShowOnboarding,
    onboardingStep: onboardingStep,
    setOnboardingStep: setOnboardingStep,
    referrals: referrals,
    setReferrals: setReferrals,
    referralList: referralList,
    setReferralList: setReferralList,
    selectedReferral: selectedReferral,
    setSelectedReferral: setSelectedReferral,
    lastCardWithdrawal: lastCardWithdrawal,
    setLastCardWithdrawal: setLastCardWithdrawal,
    withdrawState: withdrawState,
    setWithdrawState: setWithdrawState,
    topupStep: topupStep,
    setTopupStep: setTopupStep,
    topupAmount: topupAmount,
    setTopupAmount: setTopupAmount,
    selectedMethod: selectedMethod,
    setSelectedMethod: setSelectedMethod,
    selectedVariant: selectedVariant,
    setSelectedVariant: setSelectedVariant,
    paymentMethods: paymentMethods,
    setPaymentMethods: setPaymentMethods,
    paymentUrl: paymentUrl,
    setPaymentUrl: setPaymentUrl,
    pendingAction: pendingAction,
    setPendingAction: setPendingAction,
    vpnPlans: vpnPlans,
    setVpnPlans: setVpnPlans,
    wizardStep: wizardStep,
    setWizardStep: setWizardStep,
    wizardDeviceCount: wizardDeviceCount,
    setWizardDeviceCount: setWizardDeviceCount,
    successInstructionPlatform: successInstructionPlatform,
    setSuccessInstructionPlatform: setSuccessInstructionPlatform,
    wizardSuccessPlainDevice: wizardSuccessPlainDevice,
    setWizardSuccessPlainDevice: setWizardSuccessPlainDevice,
    wizardPlan: wizardPlan,
    setWizardPlan: setWizardPlan,
    useAutoPay: useAutoPay,
    setUseAutoPay: setUseAutoPay,
    savedPaymentMethods: savedPaymentMethods,
    setSavedPaymentMethods: setSavedPaymentMethods,
    selectedPaymentMethodId: selectedPaymentMethodId,
    setSelectedPaymentMethodId: setSelectedPaymentMethodId,
    extendingDevice: extendingDevice,
    setExtendingDevice: setExtendingDevice,
    extendPlan: extendPlan,
    setExtendPlan: setExtendPlan,
    extendDeviceCount: extendDeviceCount,
    setExtendDeviceCount: setExtendDeviceCount,
    activePlatform: activePlatform,
    setActivePlatform: setActivePlatform,
    instructionPlainLinkMode: instructionPlainLinkMode,
    setInstructionPlainLinkMode: setInstructionPlainLinkMode,
    instructionSourceDeviceId: instructionSourceDeviceId,
    setInstructionSourceDeviceId: setInstructionSourceDeviceId,
    waitForTelegramUser: waitForTelegramUser,
    refreshDevices: refreshDevices,
    refreshUserData: refreshUserData,
    refreshAll: refreshAll,
    ensureUserId: ensureUserId,
    getHappEncryptedLink: getHappEncryptedLink,
    openHappWithSubscription: openHappWithSubscription,
    confirmDeleteDevice: confirmDeleteDevice,
    handleWithdrawNext: handleWithdrawNext,
    extendSubscription: extendSubscription,
    wizardActivate: wizardActivate,
    formatMoney: formatMoney,
    applyNextDiscount: applyNextDiscount,
    applyReferralInviteFirst: applyReferralInviteFirst,
    priceAfterReferralOnly: priceAfterReferralOnly,
    priceFinal: priceFinal,
    addHistoryItem: addHistoryItem,
    getPlainSubscriptionUrl: getPlainSubscriptionUrl,
    handleCopy: handleCopy,
    openDoc: openDoc,
    openDeleteModal: openDeleteModal,
    openWithdrawModal: openWithdrawModal,
    getPaymentTotal: getPaymentTotal,
    miniApiFetch: miniApiFetch,
    SUPPORT_URL: SUPPORT_URL,
    BOT_USERNAME_MINI: BOT_USERNAME_MINI,
    PRESET_AMOUNTS: PRESET_AMOUNTS,
    VPN_PLANS_DEFAULT: VPN_PLANS_DEFAULT,
    PAYMENT_METHODS_DEFAULT: PAYMENT_METHODS_DEFAULT,
    WITHDRAW_METHODS: WITHDRAW_METHODS,
    PLATFORMS: PLATFORMS,
    INSTRUCTIONS: INSTRUCTIONS,
    normalizedDevicesCount: normalizedDevicesCount,
    computePlanPrice: computePlanPrice,
    getInstructionSteps: getInstructionSteps,
    Button: Button,
    Card: Card,
    Header: Header,
    Modal: Modal,
    MarkdownRenderer: MarkdownRenderer,
    AnimatedBackground: AnimatedBackground,
    OFFER_AGREEMENT_TEXT: OFFER_AGREEMENT_TEXT,
    PRIVACY_POLICY_TEXT: PRIVACY_POLICY_TEXT
  };
  return (
    <MiniAppContext.Provider value={contextValue}>
      {children}
    </MiniAppContext.Provider>
  );
}
