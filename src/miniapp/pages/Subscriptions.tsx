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


export default function Subscriptions() {
  const ctx = useMiniApp();
  const view = ctx.view as string;
  if (view === 'extend_subscription') return <ExtendBody {...ctx} />;
  if (view === 'buy_device') return <BuyBody {...ctx} />;
  return <DevicesBody {...ctx} />;
}

function DevicesBody(props: MiniAppContextValue) {
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
  const DevicesView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="Мои устройства" onBack={() => setView('home')} />
      <div className="flex-1 space-y-4">
        {devices.map(device => {
          const isExpired = device.is_expired === true;
          const isBlocked = (device.key_status || '').toLowerCase() === 'blocked';
          // Проверка на вечную подписку (год >= 2090)
          const isForever = device.days_left !== undefined && device.days_left > 25000; // ~68 лет
          // Формируем текст оставшегося времени
          const getTimeLeftText = () => {
            if (isExpired) return 'Истекла';
            if (isForever) return '∞ Навсегда';
            if (device.days_left === undefined || device.days_left === null) return null;
            if (device.days_left > 0) return `Осталось ${device.days_left} дн.`;
            if (device.hours_left && device.hours_left > 0) return `Осталось ${device.hours_left} ч.`;
            return 'Менее часа';
          };
          const timeLeftText = getTimeLeftText();
          const isLowTime = !isExpired && !isForever && (device.days_left !== undefined && device.days_left <= 3);
          
          return (
          <div key={device.id} className={`rounded-xl p-4 border card-hover ${isBlocked ? 'bg-red-950/40 border-red-600/40' : isExpired ? 'bg-red-900/20 border-red-500/50' : 'bg-zinc-800 border-zinc-700'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isExpired ? 'bg-red-900/30 text-red-400' : 'bg-zinc-700 text-zinc-300'}`}>
                  {device.type === 'ios' || device.type === 'android' ? <Smartphone size={20} /> : <Monitor size={20} />}
                </div>
                <div>
                  <div className="font-bold text-white">
                    {device.is_trial ? 'Пробная подписка' : 'Подписка'} | #{device.id}
                  </div>
                  {isBlocked && (
                    <div className="text-xs font-semibold text-red-400 mt-0.5">
                      Ключ заблокирован
                    </div>
                  )}
                  {timeLeftText ? (
                    <div className={`text-xs font-medium ${isExpired ? 'text-red-400' : isLowTime ? 'text-orange-400' : isForever ? 'text-yellow-400' : 'text-zinc-400'}`}>
                      {timeLeftText}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">Бессрочно</div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => openDeleteModal(device)}
                  disabled={isBlocked}
                  className="p-2 rounded-lg bg-zinc-700 text-zinc-300 hover:text-white hover:bg-red-600 transition-colors disabled:opacity-40 disabled:hover:bg-zinc-700 disabled:hover:text-zinc-300"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {isBlocked ? (
              <div className="w-full bg-red-600/10 border border-red-600/20 rounded-lg p-3 text-sm text-red-300">
                Этот ключ отключён администратором. Если это ошибка — напишите в поддержку.
              </div>
            ) : isExpired ? (
              <button 
                onClick={() => { 
                  setExtendingDevice(device);
                  setExtendPlan(null);
                  setView('extend_subscription');
                }}
                className="w-full bg-red-600 hover:bg-red-500 py-2 rounded-lg text-sm text-white font-medium flex items-center justify-center gap-2 transition-colors"
              >
                <Zap size={16} /> Продлить подписку
              </button>
            ) : (
              isLowTime ? (
                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => {
                      setInstructionPlainLinkMode(false);
                      setInstructionSourceDeviceId(device.id);
                      setActivePlatform(device.type as PlatformId);
                      setView('instruction_view');
                    }}
                    className="bg-zinc-700/50 hover:bg-zinc-700 py-2.5 rounded-lg text-xs text-orange-400 flex items-center justify-center gap-1.5 transition-colors border border-zinc-600/50 font-medium"
                  >
                    <BookOpen size={15} /> Инструкция
                  </button>
                  <button 
                    onClick={() => { 
                      setExtendingDevice(device);
                      setExtendPlan(null);
                      setView('extend_subscription');
                    }}
                    className="bg-amber-600/20 hover:bg-amber-600/30 border border-amber-500/40 py-2.5 rounded-lg text-xs text-amber-300 flex items-center justify-center gap-1.5 font-medium transition-colors"
                  >
                    <Zap size={15} /> Продлить
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => {
                    setInstructionPlainLinkMode(false);
                    setInstructionSourceDeviceId(device.id);
                    setActivePlatform(device.type as PlatformId);
                    setView('instruction_view');
                  }}
                  className="w-full bg-zinc-700/50 hover:bg-zinc-700 py-2 rounded-lg text-sm text-orange-400 flex items-center justify-center gap-2 transition-colors border border-zinc-600/50"
                >
                  <BookOpen size={16} /> Инструкция по подключению
                </button>
              )
            )}
          </div>
        );})}
        {devices.length === 0 && (
          <div className="text-center py-10 text-zinc-500">Нет подключенных устройств</div>
        )}
      </div>
      <div className="mt-6 mb-4">
        <Button onClick={() => { setWizardStep(1); setWizardPlan(null); setWizardDeviceCount(2); setView('wizard'); }}>
          <Plus size={20} /> Добавить устройство
        </Button>
      </div>
    </div>
  );

  return <DevicesView />;
}

function ExtendBody(props: MiniAppContextValue) {
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
  const ExtendSubscriptionView = () => {
    const plansForExtend = vpnPlans.filter(p => !p.isTrial); // Без триала
    const extMinCnt = extendingDevice ? normalizedDevicesCount(extendingDevice.devices_limit || 2) : 2;
    const extPricingCnt = Math.max(extMinCnt, extendDeviceCount);
    const priceForExtend = (p: Plan) => priceFinal(p, extPricingCnt);

    return (
      <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
        <Header 
          title="Продление подписки" 
          onBack={() => {
            setExtendingDevice(null);
            setExtendPlan(null);
            setView('devices');
          }} 
        />
        
        {extendingDevice && (
          <div className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-700 mb-4">
            <div className="text-zinc-400 text-sm mb-1">Продление ключа</div>
            <div className="text-white font-medium">
{extendingDevice.is_trial ? 'Пробная подписка' : 'Подписка'} | #{extendingDevice.id}
            </div>
          </div>
        )}
        
        <div className="flex-1">
          <div className="bg-black/60 border border-zinc-900 rounded-2xl p-4 mb-4">
            <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-bold">Устройств в подписке</div>
            <div className="text-[11px] text-zinc-500 mb-3">Можно только увеличить (сейчас в ключе: {extMinCnt}).</div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-bold hover:bg-orange-600/80 transition-colors disabled:opacity-40"
                disabled={!extendingDevice || extendDeviceCount <= extMinCnt}
                onClick={() => setExtendDeviceCount(c => Math.max(extMinCnt, c - 1))}
              >−</button>
              <div className="text-center flex-1">
                <div className="text-3xl font-black text-white">{extendDeviceCount}</div>
                <div className="text-[11px] text-zinc-500 mt-1">мин. {extMinCnt}, макс. 20</div>
              </div>
              <button
                type="button"
                className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-bold hover:bg-orange-600/80 transition-colors"
                onClick={() => setExtendDeviceCount(c => Math.min(20, c + 1))}
              >+</button>
            </div>
          </div>
          <div className="text-xs text-zinc-500 mb-2">
            Цена продления считается по выбранному числу устройств (<span className="text-orange-400 font-semibold">{extPricingCnt}</span>).
          </div>
          <div className="text-zinc-400 text-sm mb-4">Выберите период продления:</div>
          <div className="grid gap-3">
            {plansForExtend.map(plan => {
              const fin = priceForExtend(plan);
              const pre = nextDiscountPercent > 0 ? priceAfterReferralOnly(plan, extPricingCnt) : null;
              return (
              <button
                key={plan.id}
                onClick={() => setExtendPlan(plan)}
                className={`p-4 rounded-xl text-left transition-all border ${
                  extendPlan?.id === plan.id
                    ? 'bg-orange-600/20 border-orange-500 ring-1 ring-orange-500'
                    : 'bg-zinc-800 border-zinc-700 hover:bg-zinc-750'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className={`font-bold ${extendPlan?.id === plan.id ? 'text-orange-400' : 'text-white'}`}>
                      {plan.duration}
                    </div>
                    <div className="text-zinc-500 text-sm">{plan.days} дней</div>
                  </div>
                  <div className={`text-right ${extendPlan?.id === plan.id ? 'text-orange-400' : 'text-zinc-300'}`}>
                    {pre != null && pre !== fin ? (
                      <div className="flex flex-col items-end gap-0.5">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-semibold text-zinc-500 line-through tabular-nums">{pre} ₽</span>
                          <span className="text-lg font-bold tabular-nums">{fin} ₽</span>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/85">−{nextDiscountPercent}%</span>
                      </div>
                    ) : (
                      <div className="text-lg font-bold tabular-nums">{fin} ₽</div>
                    )}
                  </div>
                </div>
              </button>
            );})}
          </div>
        </div>
        
        <div className="mt-6 mb-4">
          <Button 
            disabled={!extendPlan || !extendingDevice}
            onClick={() => {
              if (extendPlan && extendingDevice) {
                extendSubscription(extendingDevice, extendPlan);
              }
            }}
          >
            <Zap size={18} /> Продлить за {extendPlan ? priceForExtend(extendPlan) : 0} ₽
          </Button>
        </div>
      </div>
    );
  };

  return <ExtendSubscriptionView />;
}

function BuyBody(props: MiniAppContextValue) {
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
  const BuyDeviceView = () => (
    <div className="min-h-full flex flex-col">
      <Header title="Новое подключение" onBack={() => setView('devices')} />
      
      <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
        <div className="w-20 h-20 bg-orange-600/20 rounded-full flex items-center justify-center mb-6">
          <Shield size={40} className="text-orange-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Подключите защиту</h2>
        <p className="text-zinc-400 mb-6 max-w-xs">
          Единая подписка включает VPN и обход блокировок операторов
        </p>
        <Button onClick={() => { setWizardStep(1); setWizardPlan(null); setWizardDeviceCount(2); setView('wizard'); }}>
          Открыть мастер подключения
        </Button>
      </div>
    </div>
  );

  return <BuyDeviceView />;
}
