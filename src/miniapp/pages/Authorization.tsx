import React from 'react';
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


export default function Authorization() {
  const props = useMiniApp();
  const {
    view,
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
    PRIVACY_POLICY_TEXT
  } = props as MiniAppContextValue & Record<string, unknown>;

  if (needsChannelSubscription) {
    return (
      <AnimatedBackground>
        <div className="p-4 min-h-screen flex flex-col items-center justify-center">
          <div className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-gradient-to-b from-zinc-950/90 to-black/90 p-6 shadow-2xl shadow-orange-950/25 animate-scale-in overflow-hidden relative">
            <div className="absolute -top-24 -right-24 w-72 h-72 bg-orange-600/20 blur-3xl rounded-full" />
            <div className="absolute -bottom-24 -left-24 w-72 h-72 bg-green-600/10 blur-3xl rounded-full" />

            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-orange-600/15 border border-orange-500/20 flex items-center justify-center mb-4">
                <MessageCircle size={28} className="text-orange-400" />
              </div>

              <h1 className="text-2xl font-extrabold text-white mb-2 leading-tight">
                Нужна подписка на канал
              </h1>
              <p className="text-sm text-zinc-400 mb-5 leading-relaxed">
                Это помогает нам поддерживать сервис и держать связь с пользователями. После подписки нажмите «Проверить».
              </p>

              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 mb-5">
                <div className="text-xs text-zinc-500 mb-1">Канал</div>
                <div className="text-white font-semibold">БлинВПН</div>
                <div className="text-xs text-zinc-500 mt-1">`@blinvpn`</div>
              </div>

              <div className="space-y-3">
                <a
                  href={requiredChannelLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center w-full py-4 bg-orange-600 hover:bg-orange-500 rounded-2xl text-white font-bold transition-all hover:scale-[1.01]"
                >
                  Подписаться
                </a>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    if (!telegramId) return;
                    const result = await miniApiFetch(`/user/info?telegram_id=${telegramId}&username=${encodeURIComponent(username)}`);
                    if (result && !result._needsSubscription) {
                      setNeedsChannelSubscription(false);
                      await refreshAll();
                    } else {
                      alert('Подписка пока не найдена. Если вы только что подписались — подождите 2–3 секунды и попробуйте ещё раз.');
                    }
                  }}
                >
                  Проверить подписку
                </Button>
              </div>

              <button
                className="w-full mt-4 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                onClick={() => {
                  try {
                    (window as any).Telegram?.WebApp?.openTelegramLink?.(requiredChannelLink);
                  } catch {}
                }}
              >
                Открыть в Telegram
              </button>

              <p className="text-center text-xs text-zinc-600 mt-5 px-2 leading-relaxed">
                Продолжая, вы соглашаетесь с{' '}
                <button onClick={() => openDoc("Договор оферты", publicPages.offer)} className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">договором оферты</button>
                {' '}и{' '}
                <button onClick={() => openDoc("Политика конфиденциальности", publicPages.privacy)} className="text-zinc-400 underline underline-offset-2 hover:text-zinc-200 transition-colors">политикой конфиденциальности</button>
              </p>
            </div>
          </div>
        </div>
      </AnimatedBackground>
    );
  }

  if (isBanned) {
    return (
      <AnimatedBackground>
        <div className="p-4 min-h-screen flex flex-col items-center justify-center">
          <div className="text-center px-4 animate-in fade-in duration-500">
            {/* Иконка */}
            <div className="w-24 h-24 mx-auto mb-6 rounded-full bg-red-500/10 flex items-center justify-center">
              <svg className="w-12 h-12 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            </div>
            
            {/* Заголовок */}
            <h1 className="text-2xl font-bold text-white mb-3">Доступ ограничен</h1>
            
            {/* Описание */}
            <p className="text-zinc-400 mb-6 leading-relaxed">
              Ваш аккаунт заблокирован за нарушение правил сервиса.
            </p>
            
            {/* Причина */}
            {banReason && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                <div className="text-sm text-red-400 font-medium mb-1">Причина:</div>
                <div className="text-white text-sm">{banReason}</div>
              </div>
            )}
            
            {/* Инфо блок */}
            <div className="bg-zinc-800/50 rounded-xl p-4 mb-6 text-left">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Информация
              </h3>
              <ul className="text-sm text-zinc-400 space-y-2">
                <li>• Администрация оставляет за собой право отказать в разблокировке</li>
                <li>• Подробности о причинах блокировки могут не предоставляться в целях защиты алгоритмов безопасности</li>
              </ul>
            </div>
            
            {/* Кнопка поддержки */}
            <a 
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 rounded-xl text-white font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              Связаться с поддержкой
            </a>
          </div>
        </div>
      </AnimatedBackground>
    );
  }

  return null;
}
