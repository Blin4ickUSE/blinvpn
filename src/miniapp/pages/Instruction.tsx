import React, { useState, useEffect, useRef, useMemo } from 'react';
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


export default function Instruction() {
  const ctx = useMiniApp();
  return <InstructionBody {...ctx} />;
}

function InstructionBody(props: MiniAppContextValue) {
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

const InstructionView = () => {
    const pid = (activePlatform as PlatformId) || 'android';
    const platformEntries: [string, PlatformData][] = instructionPlainLinkMode
      ? PLATFORMS.filter((p) => p.id !== 'androidtv').map((p) => [p.id, INSTRUCTIONS[p.id]])
      : (Object.entries(INSTRUCTIONS) as [string, PlatformData][]);
    const steps = getInstructionSteps(pid, instructionPlainLinkMode);

    return (
      <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
        <Header title="Настройка" onBack={() => { setInstructionPlainLinkMode(false); setView('devices'); }} />

        {/* Platform selector */}
        <div className="mb-5">
          <label className="text-xs text-zinc-500 mb-2 block uppercase font-semibold tracking-wider">Ваша платформа</label>
          <div className="relative">
            <select 
              value={activePlatform}
              onChange={(e) => {
                const v = e.target.value as PlatformId;
                if (instructionPlainLinkMode && v === 'androidtv') {
                  setInstructionPlainLinkMode(false);
                }
                setActivePlatform(v);
              }}
              className="w-full appearance-none bg-zinc-800/80 border border-zinc-700 text-white py-3 pl-4 pr-10 rounded-2xl focus:outline-none focus:border-orange-500 transition-colors"
            >
              {platformEntries.map(([key, data]) => (
                <option key={key} value={key}>{data.title}</option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
              <ChevronDown size={16} />
            </div>
          </div>
        </div>

        {pid !== 'androidtv' && (
          <div className="mb-4">
            {instructionPlainLinkMode ? (
              <button
                type="button"
                onClick={() => setInstructionPlainLinkMode(false)}
                className="w-full py-2.5 px-3 rounded-xl text-sm font-semibold border border-zinc-700 bg-zinc-800/70 text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                Установка на это устройство
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setInstructionPlainLinkMode(true)}
                className="w-full py-2.5 px-3 rounded-xl text-sm font-semibold border border-orange-500/35 bg-orange-600/12 text-orange-100 hover:bg-orange-600/20 transition-colors flex items-center justify-center gap-2"
              >
                <Monitor size={18} className="text-orange-400 shrink-0" />
                Установить на другое устройство
              </button>
            )}
          </div>
        )}

        {/* Ready badge — only after purchase, not when opening from devices */}
        {!instructionSourceDeviceId && (
          <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/20 rounded-2xl px-4 py-3 mb-6">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center flex-shrink-0">
              <CheckCircle size={16} className="text-orange-400" />
            </div>
            <div>
              <div className="text-orange-300 font-semibold text-sm leading-tight">Устройство готово</div>
              <div className="text-orange-400/60 text-xs mt-0.5">Следуйте инструкции ниже для подключения.</div>
            </div>
          </div>
        )}

        {/* Steps */}
        <div className="flex-1 overflow-y-auto pb-8 space-y-3">
          {steps.map((step, idx) => (
            <div key={`${instructionPlainLinkMode ? 'plain' : 'normal'}-${activePlatform}-${idx}-${step.title}`} className="bg-zinc-800/40 border border-zinc-700/50 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-7 h-7 rounded-full bg-orange-600/20 border border-orange-500/30 flex items-center justify-center flex-shrink-0">
                  <span className="text-orange-400 text-xs font-bold">{idx + 1}</span>
                </div>
                <h3 className="font-bold text-white text-base leading-tight">{step.title}</h3>
              </div>

              <p className="text-zinc-400 text-sm leading-relaxed mb-3 pl-10">{step.desc}</p>

              {step.actions?.some((a) => a.type === 'copy_plain_sub') && (() => {
                const plain = getPlainSubscriptionUrl();
                if (!plain) {
                  return (
                    <p className="text-xs text-amber-400/90 mb-3 pl-10">
                      Ссылка не найдена для этого ключа. Обновите список устройств или обратитесь в поддержку.
                    </p>
                  );
                }
                return (
                  <div className="mb-3 ml-10 rounded-xl bg-black/55 border border-zinc-800/90 p-3">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-1.5">Ссылка подписки</div>
                    <div className="text-[11px] text-sky-300/95 break-all font-mono leading-relaxed select-all">{plain}</div>
                  </div>
                );
              })()}

              {step.actions && (
                <div className="flex flex-col gap-2 pl-10">
                  {step.actions.map((action, aIdx) => (
                    <button
                      key={aIdx}
                      onClick={async () => {
                        if (action.type === 'trigger_add') {
                          await openHappWithSubscription(instructionSourceDeviceId ?? undefined);
                        } else if (action.type === 'copy_plain_sub') {
                          const plain = getPlainSubscriptionUrl();
                          if (plain) handleCopy(plain);
                          else alert('Ссылка недоступна.');
                        } else if (action.type === 'nav_android') {
                          setActivePlatform('android');
                        } else if (action.type === 'nav_ios') {
                          setActivePlatform('ios');
                        } else if (action.url) {
                          const w = window as any;
                          if (action.url.startsWith('happ://') && w.Telegram?.WebApp?.openLink) {
                            w.Telegram.WebApp.openLink(action.url);
                          } else {
                            window.open(action.url, '_blank');
                          }
                        }
                      }}
                      className={`py-2.5 px-4 rounded-xl text-sm font-semibold text-center transition-all active:scale-[0.98] ${
                        action.primary 
                        ? 'bg-orange-600/20 text-orange-300 hover:bg-orange-600/30 border border-orange-500/30' 
                        : 'bg-zinc-700/60 text-zinc-300 hover:bg-zinc-700 border border-zinc-600/40'
                      }`}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };
  const View = InstructionView;
  return <View />;
}
