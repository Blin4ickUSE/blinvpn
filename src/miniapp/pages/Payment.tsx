import React, { useState, useEffect, useRef } from 'react';
import {
  Smartphone, Monitor, Tv, CreditCard, History as HistoryIcon,
  UserPlus, Gift, ChevronLeft, Copy, Trash2,
  CheckCircle, Clock, Globe, Shield, Zap, Plus,
  Apple, Command, User, ChevronDown,
  ArrowRight, BookOpen, Crown, ChevronRight, Wallet, X,
  AlertTriangle, ExternalLink, MessageCircle
} from 'lucide-react';

import { useMiniApp, type MiniAppContextValue } from '../context/MiniAppContext';
import { Button, Card, Header, Modal, AnimatedBackground } from '../components/ui';


export default function Payment() {
  const ctx = useMiniApp();
  const view = ctx.view as string;
  if (view === 'wait_payment') return <PaymentWaitBody {...ctx} />;
  if (view === 'success_payment') return <PaymentSuccessBody {...ctx} />;
  return <TopUpBody {...ctx} />;
}

function TopUpBody(props: MiniAppContextValue) {
  const { view,
    setView,
    balance,
    setBalance,
    nextDiscountPercent,
    setNextDiscountPercent,
    referralInviteDiscountActive,
    setReferralInviteDiscountActive,
    isTrialUsed,
    setIsTrialUsed,
    userId,
    setUserId,
    telegramId,
    setTelegramId,
    username,
    setUsername,
    displayName,
    setDisplayName,
    userPhotoUrl,
    setUserPhotoUrl,
    history,
    setHistory,
    devices,
    setDevices,
    deviceKeys,
    setDeviceKeys,
    deleteModalOpen,
    setDeleteModalOpen,
    withdrawModalOpen,
    setWithdrawModalOpen,
    docModalOpen,
    setDocModalOpen,
    docContent,
    setDocContent,
    publicPages,
    setPublicPages,
    currentDevice,
    setCurrentDevice,
    isBanned,
    setIsBanned,
    banReason,
    setBanReason,
    userLoadFailed,
    setUserLoadFailed,
    needsChannelSubscription,
    setNeedsChannelSubscription,
    requiredChannelLink,
    setRequiredChannelLink,
    showOnboarding,
    setShowOnboarding,
    onboardingStep,
    setOnboardingStep,
    referrals,
    setReferrals,
    referralList,
    setReferralList,
    selectedReferral,
    setSelectedReferral,
    lastCardWithdrawal,
    setLastCardWithdrawal,
    withdrawState,
    setWithdrawState,
    topupStep,
    setTopupStep,
    topupAmount,
    setTopupAmount,
    selectedMethod,
    setSelectedMethod,
    selectedVariant,
    setSelectedVariant,
    paymentMethods,
    setPaymentMethods,
    paymentUrl,
    setPaymentUrl,
    pendingAction,
    setPendingAction,
    vpnPlans,
    setVpnPlans,
    wizardStep,
    setWizardStep,
    wizardDeviceCount,
    setWizardDeviceCount,
    successInstructionPlatform,
    setSuccessInstructionPlatform,
    wizardSuccessPlainDevice,
    setWizardSuccessPlainDevice,
    wizardPlan,
    setWizardPlan,
    useAutoPay,
    setUseAutoPay,
    savedPaymentMethods,
    setSavedPaymentMethods,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
    extendingDevice,
    setExtendingDevice,
    extendPlan,
    setExtendPlan,
    extendDeviceCount,
    setExtendDeviceCount,
    activePlatform,
    setActivePlatform,
    instructionPlainLinkMode,
    setInstructionPlainLinkMode,
    instructionSourceDeviceId,
    setInstructionSourceDeviceId,
    waitForTelegramUser,
    refreshDevices,
    refreshUserData,
    refreshAll,
    ensureUserId,
    getHappEncryptedLink,
    openHappWithSubscription,
    confirmDeleteDevice,
    handleWithdrawNext,
    extendSubscription,
    wizardActivate,
    formatMoney,
    applyNextDiscount,
    applyReferralInviteFirst,
    priceAfterReferralOnly,
    priceFinal,
    addHistoryItem,
    getPlainSubscriptionUrl,
    handleCopy,
    openDoc,
    openDeleteModal,
    openWithdrawModal,
    getPaymentTotal,
    miniApiFetch,
    SUPPORT_URL,
    BOT_USERNAME_MINI,
    PRESET_AMOUNTS,
    VPN_PLANS_DEFAULT,
    PAYMENT_METHODS_DEFAULT,
    WITHDRAW_METHODS,
    PLATFORMS,
    INSTRUCTIONS,
    normalizedDevicesCount,
    computePlanPrice,
    getInstructionSteps,
    Button,
    Card,
    Header,
    Modal,
    MarkdownRenderer,
    AnimatedBackground,
    OFFER_AGREEMENT_TEXT,
    PRIVACY_POLICY_TEXT } = props as MiniAppContextValue & Record<string, unknown>;
  const TopUpView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header 
        title={topupStep === 1 ? "Сумма пополнения" : "Способ оплаты"} 
        onBack={() => {
          if (topupStep === 2) setTopupStep(1);
          else setView('home');
        }} 
      />
      
      {topupStep === 1 && (
        <>
          <div className="flex-1">
            <div className="text-center py-6">
               <div className="text-zinc-400 text-sm mb-2">Выберите сумму</div>
               <div className="text-5xl font-bold text-white tracking-tight">
                 {topupAmount > 0 ? topupAmount : 0}<span className="text-zinc-600 text-3xl ml-1">₽</span>
               </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {PRESET_AMOUNTS.map(amount => (
                <button
                  key={amount}
                  onClick={() => setTopupAmount(amount)}
                  className={`py-4 rounded-xl text-sm font-bold transition-all border ${
                    topupAmount === amount 
                    ? 'bg-orange-600 text-white border-orange-500 shadow-lg shadow-orange-900/40 transform scale-105' 
                    : 'bg-zinc-800 text-zinc-300 border-zinc-700 hover:bg-zinc-700'
                  }`}
                >
                  {amount} ₽
                </button>
              ))}
            </div>
          </div>
          
          <div className="mt-6 mb-4">
            <Button 
              disabled={!topupAmount || topupAmount < 1 || topupAmount > 100000}
              onClick={() => {
                if (topupAmount < 1) {
                  alert('Минимальная сумма пополнения: 1₽');
                  return;
                }
                if (topupAmount > 100000) {
                  alert('Максимальная сумма пополнения: 100,000₽');
                  return;
                }
                setTopupStep(2);
              }}
            >
              Далее <ArrowRight size={18} />
            </Button>
          </div>
        </>
      )}

      {topupStep === 2 && (
        <>
          <div className="flex-1 space-y-3">
             <div className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-700 mb-6 space-y-2">
                <div className="flex justify-between items-center text-sm">
                   <span className="text-zinc-400">Сумма:</span>
                   <span className="text-white">{topupAmount} ₽</span>
                </div>
                {selectedMethod && (
                  <div className="flex justify-between items-center text-sm">
                     <span className="text-zinc-400">Комиссия ({
                        (() => {
                            const method = paymentMethods.find(m => m.id === selectedMethod);
                            if (method?.variants && selectedVariant) {
                                return method.variants.find(v => v.id === selectedVariant)?.feePercent;
                            }
                            return method?.feePercent;
                        })()
                     }%):</span>
                     <span className="text-zinc-300">+{
                        (() => {
                           const total = getPaymentTotal();
                           return (total - topupAmount).toFixed(1).replace(/\.0$/, '');
                        })()
                     } ₽</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-zinc-700 font-bold text-lg">
                   <span className="text-white">Итого к оплате:</span>
                   <span className="text-orange-400">{getPaymentTotal()} ₽</span>
                </div>
             </div>

            {paymentMethods.map(method => (
              <div key={method.id} className="relative">
                  <button
                    onClick={() => { 
                        setSelectedMethod(method.id);
                        if (method.variants && method.variants.length > 0) {
                            setSelectedVariant(method.variants[0].id);
                        } else {
                            setSelectedVariant(null);
                        }
                    }}
                    className={`w-full p-4 rounded-xl flex items-center justify-between transition-all border ${
                      selectedMethod === method.id
                      ? 'bg-orange-600/10 border-orange-600 text-white'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 flex items-center justify-center shrink-0">{method.icon}</div>
                      <span className="font-medium text-left">
                        <div className="leading-tight">{method.name}</div>
                        <div className="text-xs text-zinc-500 font-normal mt-0.5">
                           {method.variants ? 'Выберите провайдера' : (method.feePercent === 0 ? 'Без комиссии' : `Комиссия ${method.feePercent}%`)}
                        </div>
                      </span>
                    </div>
                    {selectedMethod === method.id && <CheckCircle size={22} className="text-orange-500 fill-orange-500/20" />}
                  </button>
                  
                  {selectedMethod === method.id && method.variants && (
                      <div className="mt-2 pl-12 pr-4 pb-2 animate-in slide-in-from-top-2">
                          <select 
                            value={selectedVariant || ''}
                            onChange={(e) => setSelectedVariant(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-600 rounded-lg p-2 text-sm text-white focus:border-orange-500 outline-none"
                            onClick={(e) => e.stopPropagation()}
                          >
                              {method.variants.map(v => (
                                  <option key={v.id} value={v.id}>
                                      {v.name}
                                  </option>
                              ))}
                          </select>
                      </div>
                  )}
              </div>
            ))}
          </div>

          <div className="mt-8 mb-4">
            <Button 
              disabled={!selectedMethod}
              onClick={async () => {
                if (!userId) {
                  alert('Пользователь не загружен, попробуйте позже');
                  return;
                }
                try {
                  const total = getPaymentTotal();
                  // Используем выбранный вариант если есть, иначе выбранный метод
                  const method = paymentMethods.find(m => m.id === selectedMethod);
                  let methodKey = selectedMethod || 'rollypay_sbp';
                  
                  // Если у метода есть варианты и выбран вариант - используем его
                  if (method?.variants && selectedVariant) {
                    methodKey = selectedVariant;
                  }
                  
                  const res = await miniApiFetch('/payment/create', {
                    method: 'POST',
                    body: JSON.stringify({
                      user_id: userId,
                      amount: total,
                      method: methodKey
                    }),
                  });

                  const payUrl = res.confirmation_url || res.payment_url;
                  if (payUrl) {
                    setPaymentUrl(payUrl);
                    // Открываем оплату в Telegram. Для Stars используем openInvoice.
                    try {
                      const tg: any = (window as any).Telegram?.WebApp;
                      if (methodKey === 'tg_stars' && typeof tg?.openInvoice === 'function') {
                        tg.openInvoice(payUrl, (status: string) => {
                          if (status === 'failed') {
                            alert('Оплата не прошла. Попробуйте ещё раз или выберите другой способ.');
                          }
                          // status === 'paid' — баланс проверится на экране ожидания оплаты
                        });
                      } else if (typeof tg?.openLink === 'function') {
                        tg.openLink(payUrl);
                      } else {
                        window.open(payUrl, '_blank');
                      }
                    } catch {
                      window.open(payUrl, '_blank');
                    }
                  }
                  setView('wait_payment');
                } catch (e) {
                  console.error(e);
                  alert('Не удалось создать платёж, попробуйте позже');
                }
              }}
            >
              Оплатить {getPaymentTotal()} ₽
            </Button>
          </div>
        </>
      )}
    </div>
  );

  const View = TopUpView;
  return <View />;
}

function PaymentWaitBody(props: MiniAppContextValue) {
  const { view,
    setView,
    balance,
    setBalance,
    nextDiscountPercent,
    setNextDiscountPercent,
    referralInviteDiscountActive,
    setReferralInviteDiscountActive,
    isTrialUsed,
    setIsTrialUsed,
    userId,
    setUserId,
    telegramId,
    setTelegramId,
    username,
    setUsername,
    displayName,
    setDisplayName,
    userPhotoUrl,
    setUserPhotoUrl,
    history,
    setHistory,
    devices,
    setDevices,
    deviceKeys,
    setDeviceKeys,
    deleteModalOpen,
    setDeleteModalOpen,
    withdrawModalOpen,
    setWithdrawModalOpen,
    docModalOpen,
    setDocModalOpen,
    docContent,
    setDocContent,
    publicPages,
    setPublicPages,
    currentDevice,
    setCurrentDevice,
    isBanned,
    setIsBanned,
    banReason,
    setBanReason,
    userLoadFailed,
    setUserLoadFailed,
    needsChannelSubscription,
    setNeedsChannelSubscription,
    requiredChannelLink,
    setRequiredChannelLink,
    showOnboarding,
    setShowOnboarding,
    onboardingStep,
    setOnboardingStep,
    referrals,
    setReferrals,
    referralList,
    setReferralList,
    selectedReferral,
    setSelectedReferral,
    lastCardWithdrawal,
    setLastCardWithdrawal,
    withdrawState,
    setWithdrawState,
    topupStep,
    setTopupStep,
    topupAmount,
    setTopupAmount,
    selectedMethod,
    setSelectedMethod,
    selectedVariant,
    setSelectedVariant,
    paymentMethods,
    setPaymentMethods,
    paymentUrl,
    setPaymentUrl,
    pendingAction,
    setPendingAction,
    vpnPlans,
    setVpnPlans,
    wizardStep,
    setWizardStep,
    wizardDeviceCount,
    setWizardDeviceCount,
    successInstructionPlatform,
    setSuccessInstructionPlatform,
    wizardSuccessPlainDevice,
    setWizardSuccessPlainDevice,
    wizardPlan,
    setWizardPlan,
    useAutoPay,
    setUseAutoPay,
    savedPaymentMethods,
    setSavedPaymentMethods,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
    extendingDevice,
    setExtendingDevice,
    extendPlan,
    setExtendPlan,
    extendDeviceCount,
    setExtendDeviceCount,
    activePlatform,
    setActivePlatform,
    instructionPlainLinkMode,
    setInstructionPlainLinkMode,
    instructionSourceDeviceId,
    setInstructionSourceDeviceId,
    waitForTelegramUser,
    refreshDevices,
    refreshUserData,
    refreshAll,
    ensureUserId,
    getHappEncryptedLink,
    openHappWithSubscription,
    confirmDeleteDevice,
    handleWithdrawNext,
    extendSubscription,
    wizardActivate,
    formatMoney,
    applyNextDiscount,
    applyReferralInviteFirst,
    priceAfterReferralOnly,
    priceFinal,
    addHistoryItem,
    getPlainSubscriptionUrl,
    handleCopy,
    openDoc,
    openDeleteModal,
    openWithdrawModal,
    getPaymentTotal,
    miniApiFetch,
    SUPPORT_URL,
    BOT_USERNAME_MINI,
    PRESET_AMOUNTS,
    VPN_PLANS_DEFAULT,
    PAYMENT_METHODS_DEFAULT,
    WITHDRAW_METHODS,
    PLATFORMS,
    INSTRUCTIONS,
    normalizedDevicesCount,
    computePlanPrice,
    getInstructionSteps,
    Button,
    Card,
    Header,
    Modal,
    MarkdownRenderer,
    AnimatedBackground,
    OFFER_AGREEMENT_TEXT,
    PRIVACY_POLICY_TEXT } = props as MiniAppContextValue & Record<string, unknown>;
  const PaymentWaitView = () => {
    const [checking, setChecking] = useState(false);
    const [pollingActive, setPollingActive] = useState(false);
    const checkingRef = useRef(false);
    
    const doPaymentCheck = async () => {
      if (checkingRef.current) return;
      checkingRef.current = true;
      setChecking(true);
      
      try {
        const oldBalance = balance;
        const result = await refreshUserData();
        const newBalance = result?.balance ?? oldBalance;
        
        if (newBalance > oldBalance) {
          const depositAmount = newBalance - oldBalance;
          addHistoryItem('deposit', 'Пополнение баланса', depositAmount);
          setPollingActive(false);
          
          // Если была отложенная покупка - выполняем её
          if (pendingAction) {
            const action = pendingAction;
            const payload = action.payload;
            
            // Проверяем, достаточно ли средств теперь
            if (newBalance >= payload.price) {
              try {
                const currentUserId = await ensureUserId();
                if (currentUserId) {
                  // Если это продление существующей подписки
                  if (action.type === 'extend' && payload.device && payload.plan) {
                    const extDevices = payload.devices ?? normalizedDevicesCount(payload.device.devices_limit || 2);
                    const res = await miniApiFetch('/subscription/extend', {
                      method: 'POST',
                      body: JSON.stringify({
                        user_id: currentUserId,
                        key_id: payload.device.id,
                        days: payload.plan.days,
                        price: payload.price,
                        devices: extDevices,
                      }),
                    });
                    
                    if (res && res.success) {
                      addHistoryItem('extend', `Продление подписки (${payload.plan.duration})`, -payload.price);
                      setPendingAction(null);
                      setPaymentUrl(null);
                      setExtendingDevice(null);
                      setExtendPlan(null);
                      await refreshAll();
                      setView('devices');
                      return;
                    }
                  } else {
                    // Создаём новую подписку
                    const res = await miniApiFetch('/subscription/create', {
                      method: 'POST',
                      body: JSON.stringify({
                        user_id: currentUserId,
                        days: payload.wizardPlan?.days || 30,
                        type: 'vpn',
                        price: payload.price,
                        devices: payload.wizardDeviceCount ?? 2,
                      }),
                    });
                    
                    if (res && res.success) {
                      addHistoryItem('buy_dev', `Подключение: ${payload.name}`, -payload.price);
                      setPendingAction(null);
                      setPaymentUrl(null);
                      await refreshAll();
                      setInstructionSourceDeviceId(null);
                      setWizardSuccessPlainDevice(false);
                      setWizardStep(4);
                      setView('wizard');
                      return;
                    }
                  }
                }
              } catch (e) {
                console.error('Failed to process pending action after payment', e);
              }
            }
            
            // Если не удалось выполнить действие - просто переходим к инструкциям
            setPendingAction(null);
            setPaymentUrl(null);
            setInstructionPlainLinkMode(false);
            setActivePlatform(successInstructionPlatform);
            await refreshDevices();
            setView('instruction_view');
          } else {
            // Просто пополнение баланса - на главную
            setPaymentUrl(null);
            await refreshAll();
            setView('home');
          }
        }
      } finally {
        checkingRef.current = false;
        setChecking(false);
      }
    };
    
    // Автоматическая проверка баланса каждые 3 секунды
    useEffect(() => {
      if (!pollingActive) return;
      
      const interval = setInterval(() => {
        doPaymentCheck();
      }, 3000);
      
      return () => clearInterval(interval);
    }, [pollingActive]);
    
    // Запускаем polling при открытии страницы
    useEffect(() => {
      setPollingActive(true);
      return () => setPollingActive(false);
    }, []);
    
    const openPayment = () => {
      if (!paymentUrl) return;
      try {
        if (window.Telegram?.WebApp?.openLink) {
          window.Telegram.WebApp.openLink(paymentUrl);
        } else {
          window.open(paymentUrl, '_blank');
        }
      } catch {
        window.open(paymentUrl, '_blank');
      }
    };

    return (
      <div className="flex flex-col min-h-[calc(100vh-2rem)] animate-in fade-in duration-300">

        {/* Шапка с крестиком — как Header в других экранах */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => { setPaymentUrl(null); setPendingAction(null); setPollingActive(false); setView('home'); }}
            className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-300 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
          <h1 className="text-2xl font-bold text-white">Оплата</h1>
        </div>

        {/* Карточка — как Card в остальном приложении */}
        <div className="bg-zinc-900 backdrop-blur-md border border-zinc-700/80 rounded-2xl p-6 flex flex-col items-center text-center mb-4">

          {/* Спиннер */}
          <div className="relative w-16 h-16 mb-5">
            <div className="absolute inset-0 rounded-full border-2 border-zinc-700" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-orange-500 animate-spin" />
            <div className="absolute inset-0 flex items-center justify-center">
              <CreditCard size={22} className="text-zinc-400" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-white mb-2">Ожидаем оплату</h2>
          <p className="text-zinc-400 text-sm leading-relaxed max-w-[240px]">
            {pendingAction
              ? 'VPN активируется сразу после оплаты'
              : 'Завершите оплату в открывшемся окне'}
          </p>

          {checking && (
            <div className="flex items-center gap-2 mt-4">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
              <span className="text-xs text-zinc-500">Проверяем...</span>
            </div>
          )}
        </div>

        {/* Кнопки — стандартный Button из приложения */}
        <div className="space-y-3 mt-2">
          {paymentUrl && (
            <Button onClick={openPayment}>
              <ExternalLink size={16} />
              Перейти к оплате
            </Button>
          )}
          <Button variant="secondary" onClick={() => window.open(SUPPORT_URL, '_blank')}>
            <MessageCircle size={16} />
            Поддержка
          </Button>
        </div>

      </div>
    );
  };

  const View = PaymentWaitView;
  return <View />;
}

function PaymentSuccessBody(props: MiniAppContextValue) {
  const { view,
    setView,
    balance,
    setBalance,
    nextDiscountPercent,
    setNextDiscountPercent,
    referralInviteDiscountActive,
    setReferralInviteDiscountActive,
    isTrialUsed,
    setIsTrialUsed,
    userId,
    setUserId,
    telegramId,
    setTelegramId,
    username,
    setUsername,
    displayName,
    setDisplayName,
    userPhotoUrl,
    setUserPhotoUrl,
    history,
    setHistory,
    devices,
    setDevices,
    deviceKeys,
    setDeviceKeys,
    deleteModalOpen,
    setDeleteModalOpen,
    withdrawModalOpen,
    setWithdrawModalOpen,
    docModalOpen,
    setDocModalOpen,
    docContent,
    setDocContent,
    publicPages,
    setPublicPages,
    currentDevice,
    setCurrentDevice,
    isBanned,
    setIsBanned,
    banReason,
    setBanReason,
    userLoadFailed,
    setUserLoadFailed,
    needsChannelSubscription,
    setNeedsChannelSubscription,
    requiredChannelLink,
    setRequiredChannelLink,
    showOnboarding,
    setShowOnboarding,
    onboardingStep,
    setOnboardingStep,
    referrals,
    setReferrals,
    referralList,
    setReferralList,
    selectedReferral,
    setSelectedReferral,
    lastCardWithdrawal,
    setLastCardWithdrawal,
    withdrawState,
    setWithdrawState,
    topupStep,
    setTopupStep,
    topupAmount,
    setTopupAmount,
    selectedMethod,
    setSelectedMethod,
    selectedVariant,
    setSelectedVariant,
    paymentMethods,
    setPaymentMethods,
    paymentUrl,
    setPaymentUrl,
    pendingAction,
    setPendingAction,
    vpnPlans,
    setVpnPlans,
    wizardStep,
    setWizardStep,
    wizardDeviceCount,
    setWizardDeviceCount,
    successInstructionPlatform,
    setSuccessInstructionPlatform,
    wizardSuccessPlainDevice,
    setWizardSuccessPlainDevice,
    wizardPlan,
    setWizardPlan,
    useAutoPay,
    setUseAutoPay,
    savedPaymentMethods,
    setSavedPaymentMethods,
    selectedPaymentMethodId,
    setSelectedPaymentMethodId,
    extendingDevice,
    setExtendingDevice,
    extendPlan,
    setExtendPlan,
    extendDeviceCount,
    setExtendDeviceCount,
    activePlatform,
    setActivePlatform,
    instructionPlainLinkMode,
    setInstructionPlainLinkMode,
    instructionSourceDeviceId,
    setInstructionSourceDeviceId,
    waitForTelegramUser,
    refreshDevices,
    refreshUserData,
    refreshAll,
    ensureUserId,
    getHappEncryptedLink,
    openHappWithSubscription,
    confirmDeleteDevice,
    handleWithdrawNext,
    extendSubscription,
    wizardActivate,
    formatMoney,
    applyNextDiscount,
    applyReferralInviteFirst,
    priceAfterReferralOnly,
    priceFinal,
    addHistoryItem,
    getPlainSubscriptionUrl,
    handleCopy,
    openDoc,
    openDeleteModal,
    openWithdrawModal,
    getPaymentTotal,
    miniApiFetch,
    SUPPORT_URL,
    BOT_USERNAME_MINI,
    PRESET_AMOUNTS,
    VPN_PLANS_DEFAULT,
    PAYMENT_METHODS_DEFAULT,
    WITHDRAW_METHODS,
    PLATFORMS,
    INSTRUCTIONS,
    normalizedDevicesCount,
    computePlanPrice,
    getInstructionSteps,
    Button,
    Card,
    Header,
    Modal,
    MarkdownRenderer,
    AnimatedBackground,
    OFFER_AGREEMENT_TEXT,
    PRIVACY_POLICY_TEXT } = props as MiniAppContextValue & Record<string, unknown>;
  const PaymentSuccessView = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] animate-in zoom-in duration-500 text-center px-4">
      <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6 text-green-500">
        <CheckCircle size={48} />
      </div>
      <h2 className="text-3xl font-bold text-white mb-2">Успешно!</h2>
      <p className="text-zinc-400 mb-8">Баланс пополнен на {topupAmount} ₽.</p>
      <Button onClick={async () => {
        setTopupAmount(0);
        setSelectedMethod(null);
        setTopupStep(1);
        // Обновляем данные пользователя с сервера
        await refreshUserData();
        setView('home');
      }}>
        Вернуться в кабинет
      </Button>
    </div>
  );

  const View = PaymentSuccessView;
  return <View />;
}
