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


export default function CreateSubscription() {
  const ctx = useMiniApp();
  return <CreateSubscriptionBody {...ctx} />;
}

function CreateSubscriptionBody(props: MiniAppContextValue) {
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

const WizardView = () => {
    const payableTotal = wizardPlan ? priceFinal(wizardPlan, wizardDeviceCount) : 0;
    return (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header 
        title={
            wizardStep === 1 ? 'Тариф и устройства' :
            wizardStep === 2 ? 'Подтверждение' :
            wizardStep === 3 ? 'Оплата' :
            'Успешно'
        } 
        onBack={() => {
            if (wizardStep === 1) setView('home');
            else setWizardStep(prev => prev - 1);
        }} 
      />

      {wizardStep === 1 && (
        <div className="flex-1 flex flex-col">
            {devices.length > 0 && (
              <button 
                onClick={() => setView('devices')}
                className="w-full mb-4 py-3 px-4 bg-zinc-900/80 hover:bg-zinc-800 border border-zinc-800 rounded-xl flex items-center justify-between transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Smartphone size={20} className="text-orange-400" />
                  <span className="text-white font-medium">Мои устройства</span>
                  <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full">{devices.length}</span>
                </div>
                <ChevronRight size={20} className="text-zinc-400" />
              </button>
            )}

            {(wizardPlan == null || !wizardPlan.isTrial) && (
              <div className="bg-black/60 border border-zinc-900 rounded-2xl p-4 mb-5">
                <div className="text-xs uppercase tracking-wider text-zinc-500 mb-2 font-bold">Количество устройств</div>
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-bold hover:bg-orange-600/80 transition-colors disabled:opacity-40"
                    disabled={wizardDeviceCount <= 2}
                    onClick={() => setWizardDeviceCount(c => Math.max(2, c - 1))}
                  >−</button>
                  <div className="text-center flex-1">
                    <div className="text-3xl font-black text-white">{wizardDeviceCount}</div>
                    
                  </div>
                  <button
                    type="button"
                    className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 text-white font-bold hover:bg-orange-600/80 transition-colors"
                    onClick={() => setWizardDeviceCount(c => Math.min(20, c + 1))}
                  >+</button>
                </div>
              </div>
            )}

            {referralInviteDiscountActive && (
              <div className="text-center text-xs text-emerald-400/90 mb-3 font-medium">
                −10% на первую покупку по реферальной ссылке уже учтена в ценах
              </div>
            )}

            <div className="space-y-3 flex-1">
                {(vpnPlans || VPN_PLANS_DEFAULT).filter(plan => !plan.isTrial || !isTrialUsed).map((plan) => {
                    const days = plan.days ?? (plan as any).duration_days;
                    const discountText = days === 90 ? '-16%' : days === 180 ? '-24%' : days === 365 ? '-33%' : null;
                    const shown = priceFinal(plan, wizardDeviceCount);
                    const prePromo = !plan.isTrial && nextDiscountPercent > 0 ? priceAfterReferralOnly(plan, wizardDeviceCount) : null;
                    return (
                    <div 
                        key={plan.id}
                        onClick={() => { setWizardPlan(plan); setWizardStep(2); }}
                        className={`relative p-3 rounded-xl border transition-all cursor-pointer flex justify-between items-center card-hover ${
                            plan.isTrial ? 'border-orange-500/60 bg-orange-950/20' :
                            (plan.highlight ? 'border-amber-500/50 bg-zinc-950/70 hover:border-amber-500/70' : 'border-zinc-900 bg-zinc-950/70 hover:border-orange-600/35')
                        }`}
                    >
                        <div>
                            <div className={`font-bold text-lg ${plan.highlight ? 'text-amber-400 flex items-center gap-2' : 'text-white'}`}>
                                {plan.duration}
                                {plan.highlight && <Crown size={18} fill="currentColor" />}
                            </div>
                            {discountText && <div className={`text-xs font-medium ${days === 180 ? 'text-amber-400' : 'text-green-400'}`}>{discountText}</div>}
                        </div>
                        <div className="text-right">
                            {plan.isTrial ? (
                              <div className="font-bold text-xl text-white">0 ₽</div>
                            ) : prePromo != null && prePromo !== shown ? (
                              <div className="flex items-baseline gap-2">
                                <span className="text-sm font-semibold text-zinc-500 line-through decoration-zinc-500/70 decoration-2 tabular-nums">{prePromo} ₽</span>
                                <span className={`font-bold text-xl tabular-nums ${plan.highlight ? 'text-amber-400' : 'text-white'}`}>{shown} ₽</span>
                              </div>
                            ) : (
                              <div className={`font-bold text-xl ${plan.highlight ? 'text-amber-400' : 'text-white'}`}>{shown} ₽</div>
                            )}
                            <ChevronRight size={20} className="text-zinc-500 ml-auto mt-1" />
                        </div>
                    </div>
                );})}
            </div>
        </div>
      )}

      {wizardStep === 2 && wizardPlan && (
        <div className="flex-1 flex flex-col">
            <div className="bg-zinc-950 p-6 rounded-2xl border border-zinc-900 mb-6 text-center">
                <div className="text-zinc-400 mb-2">{wizardPlan.isTrial ? 'Пробный период' : 'Вы подключаете'}</div>
                <div className="text-2xl font-bold text-white mb-4">
                    {wizardPlan.duration}
                </div>
                {!wizardPlan.isTrial && (
                  <div className="text-sm text-zinc-500 mb-4">Устройств в подписке: <span className="text-orange-400 font-semibold">{wizardDeviceCount}</span></div>
                )}
                <div className="border-t border-zinc-800 pt-4 flex justify-between items-center">
                    <span className="text-zinc-400">Итого:</span>
                    {!wizardPlan.isTrial && nextDiscountPercent > 0 ? (
                      <div className="flex items-baseline gap-2.5">
                        <span className="text-lg font-semibold text-zinc-500 line-through decoration-zinc-500/60 decoration-2 tabular-nums">
                          {priceAfterReferralOnly(wizardPlan, wizardDeviceCount)} ₽
                        </span>
                        <span className="text-2xl font-black text-white tracking-tight tabular-nums">{payableTotal} ₽</span>
                      </div>
                    ) : (
                      <span className="text-xl font-bold text-white tabular-nums">{payableTotal} ₽</span>
                    )}
                </div>
            </div>

            <div className="mt-auto space-y-3">
                <div className="flex justify-between items-center mb-4 text-sm">
                    <span className="text-zinc-400">Баланс:</span>
                    <span className={`${balance < payableTotal ? 'text-red-400' : 'text-green-400'} font-bold`}>{balance} ₽</span>
                </div>
                <Button onClick={() => setWizardStep(3)} variant={wizardPlan.isTrial ? 'trial' : 'primary'} className="w-full">
                  Дальше
                </Button>
            </div>
        </div>
      )}

      {wizardStep === 3 && wizardPlan && (
        <div className="flex-1 flex flex-col justify-center">
            <div className="mt-auto">
                <div className="flex justify-between items-center mb-6 text-lg">
                  <span className="text-zinc-400">К оплате</span>
                  {!wizardPlan.isTrial && nextDiscountPercent > 0 ? (
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-base font-semibold text-zinc-500 line-through decoration-zinc-500/60 decoration-2 tabular-nums">
                        {priceAfterReferralOnly(wizardPlan, wizardDeviceCount)} ₽
                      </span>
                      <span className="font-black text-white text-2xl tracking-tight tabular-nums">{payableTotal} ₽</span>
                    </div>
                  ) : (
                    <span className="font-black text-white text-2xl tabular-nums">{payableTotal} ₽</span>
                  )}
                </div>
                <div className="flex justify-between items-center mb-4 text-sm">
                    <span className="text-zinc-400">Ваш баланс:</span>
                    <span className={`${balance < payableTotal ? 'text-red-400' : 'text-green-400'} font-bold`}>{balance} ₽</span>
                </div>

                {balance >= payableTotal ? (
                    <Button onClick={wizardActivate} variant={wizardPlan.isTrial ? 'trial' : 'primary'}>
                        {wizardPlan.isTrial ? 'Активировать бесплатно' : 'Оплатить с баланса'}
                    </Button>
                ) : (
                    <Button onClick={() => {
                        const price = payableTotal;
                        setPendingAction({
                            type: 'wizard',
                            payload: { wizardType: 'vpn', wizardPlan, wizardDeviceCount, price, name: `Подписка (${wizardPlan.duration})` }
                        });
                        setTopupAmount(price - balance);
                        setTopupStep(2);
                        setView('topup');
                    }}>
                        Пополнить на {payableTotal - balance} ₽
                    </Button>
                )}
            </div>
        </div>
      )}

      {wizardStep === 4 && (
        <div className="flex-1 flex flex-col h-full animate-fade-in">
            <div className="text-center mb-4">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto mb-4 ring-2 ring-green-500/20">
                    <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold text-white animate-slide-up">Успешно!</h2>
                <p className="text-zinc-400 text-sm px-2">Подписка активирована. Выберите устройство и откройте инструкцию:</p>
            </div>

            <div className="mb-3">
              <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2 block">Устройство для настройки</label>
              <div className="relative">
                <select
                  value={successInstructionPlatform}
                  onChange={(e) => {
                    const v = e.target.value as PlatformId;
                    if (wizardSuccessPlainDevice && v === 'androidtv') {
                      setWizardSuccessPlainDevice(false);
                    }
                    setSuccessInstructionPlatform(v);
                  }}
                  className="w-full appearance-none bg-black border border-zinc-800 text-white py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:border-orange-500"
                >
                  {(wizardSuccessPlainDevice ? PLATFORMS.filter((p) => p.id !== 'androidtv') : PLATFORMS).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-400">
                  <ChevronDown size={18} />
                </div>
              </div>
            </div>

            {successInstructionPlatform !== 'androidtv' && (
              <button
                type="button"
                onClick={() => setWizardSuccessPlainDevice((v) => !v)}
                className={`w-full mb-3 py-2.5 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                  wizardSuccessPlainDevice
                    ? 'border-orange-500/40 bg-orange-600/10 text-orange-200'
                    : 'border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300'
                }`}
              >
                {wizardSuccessPlainDevice
                  ? 'Вернуться к обычной установке (кнопка в Happ)'
                  : 'Поставить на другое устройство — по ссылке'}
              </button>
            )}

            <div className="flex-1 overflow-y-auto bg-zinc-950/70 rounded-2xl p-4 border border-zinc-900 min-h-[200px]">
                {getInstructionSteps(successInstructionPlatform, wizardSuccessPlainDevice).map((step, idx) => (
                    <div key={idx} className="relative pl-6 border-l-2 border-zinc-800 pb-6 last:border-0 last:pb-0">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-black border-2 border-orange-600"></div>
                        <h3 className="font-bold text-white text-md mb-1 leading-none">{step.title}</h3>
                        <p className="text-zinc-400 text-xs mb-3 leading-relaxed">{step.desc}</p>

                        {step.actions?.some((a) => a.type === 'copy_plain_sub') && (() => {
                          const plain = getPlainSubscriptionUrl();
                          if (!plain) {
                            return (
                              <p className="text-xs text-amber-400/90 mb-3">
                                Ссылка появится после синхронизации. Зайдите в «Мои устройства» и откройте инструкцию оттуда.
                              </p>
                            );
                          }
                          return (
                            <div className="mb-3 rounded-xl bg-black/60 border border-zinc-800/90 p-3 shadow-inner">
                              <div className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mb-1.5">Ссылка подписки</div>
                              <div className="text-[11px] text-sky-300/95 break-all font-mono leading-relaxed select-all">{plain}</div>
                            </div>
                          );
                        })()}

                        {step.actions && (
                            <div className="flex flex-col gap-2">
                            {step.actions.map((action, aIdx) => (
                                <button
                                key={aIdx}
                                onClick={async () => {
                                    if (action.type === 'trigger_add') {
                                        await openHappWithSubscription();
                                    } else if (action.type === 'copy_plain_sub') {
                                      const plain = getPlainSubscriptionUrl();
                                      if (plain) handleCopy(plain);
                                      else alert('Ссылка ещё не загружена. Попробуйте через несколько секунд или откройте «Мои устройства».');
                                    } else if (action.url) {
                                        const w = window as any;
                                        if (action.url.startsWith('happ://') && w.Telegram?.WebApp?.openLink) {
                                          w.Telegram.WebApp.openLink(action.url);
                                        } else {
                                          window.open(action.url, '_blank');
                                        }
                                    }
                                }}
                                className={`py-2 px-3 rounded-lg text-xs font-semibold text-center transition-colors ${
                                    action.primary 
                                    ? 'bg-orange-600 text-white hover:bg-orange-500' 
                                    : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800 border border-zinc-800'
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

            <Button className="mt-4" variant="secondary" onClick={() => setView('home')}>
                На главную
            </Button>
        </div>
      )}
    </div>
    );
  };
  const View = WizardView;
  return <View />;
}
