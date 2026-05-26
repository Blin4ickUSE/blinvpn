import React from 'react';
import { AlertTriangle, MessageCircle, CheckCircle } from 'lucide-react';
import { useMiniApp, type MiniAppContextValue } from '../context/MiniAppContext';
import { AnimatedBackground, Button, Modal, MarkdownRenderer } from '../components/ui';
import { WITHDRAW_METHODS } from '../../core/constants';
import { SUPPORT_URL } from '../../api/client';

type ShellProps = { children: React.ReactNode };

export default function Shell({ children }: ShellProps) {
  const props = useMiniApp();
  const {
    userLoadFailed,
    deleteModalOpen, setDeleteModalOpen, currentDevice, confirmDeleteDevice,
    docModalOpen, setDocModalOpen, docContent,
    withdrawModalOpen, setWithdrawModalOpen, withdrawState, setWithdrawState,
    referrals, handleWithdrawNext,
    showOnboarding, onboardingStep, setOnboardingStep, setShowOnboarding, telegramId,
  } = props as MiniAppContextValue & Record<string, unknown>;

  return (
    <AnimatedBackground>
      <div className={`p-4 min-h-screen flex flex-col overflow-x-clip animate-fade-in ${userLoadFailed ? 'pointer-events-none select-none user-load-failed opacity-60' : ''}`}>
        {children}
      </div>
      {/* USER LOAD FAILED BANNER */}
      {userLoadFailed && (
        <div className="fixed inset-0 z-[200] pointer-events-auto flex items-center justify-center p-6">
          {/* Heavy backdrop blur */}
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xl" />
          <div className="relative bg-zinc-900/90 border border-zinc-700/60 rounded-3xl px-6 pt-8 pb-8 shadow-2xl w-full max-w-sm">
            {/* Icon */}
            <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
              <AlertTriangle size={30} className="text-red-400" />
            </div>
            {/* Text */}
            <h2 className="text-white text-xl font-bold text-center mb-3">
              Не удалось определить пользователя
            </h2>
            <p className="text-zinc-400 text-sm text-center leading-relaxed mb-8">
              Возможно, вы открываете приложение через сторонний браузер или произошла ошибка. Пожалуйста, откройте его через Telegram.
            </p>
            {/* Support button */}
            <a
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-4 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-2xl transition-all"
            >
              <MessageCircle size={20} />
              Поддержка
            </a>
          </div>
        </div>
      )}

      {/* MODALS */}
      
      <Modal 
        title="Удалить устройство" 
        isOpen={deleteModalOpen} 
        onClose={() => setDeleteModalOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-zinc-300">
            Вы уверены, что хотите удалить <b>{currentDevice?.name}</b>? Это действие нельзя отменить.
          </p>
          <div className="grid grid-cols-2 gap-3">
             <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>Отмена</Button>
             <Button variant="danger" onClick={confirmDeleteDevice}>Удалить</Button>
          </div>
        </div>
      </Modal>

      {/* Legal Docs Modal - New Feature */}
      <Modal
        title={docContent?.title || 'Документ'}
        isOpen={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        fullHeight
      >
        <div className="pb-6">
            <MarkdownRenderer content={docContent?.text || ''} />
        </div>
      </Modal>

      {/* WITHDRAW MODAL */}
      <Modal
        title="Вывод средств"
        isOpen={withdrawModalOpen}
        onClose={() => setWithdrawModalOpen(false)}
      >
        {withdrawState.step === 1 && (
          <div className="space-y-4">
            <div className="text-sm text-zinc-400">Доступно: <span className="text-green-500 font-bold">{referrals.partnerBalance.toFixed(2)} ₽</span></div>
            {referrals.partnerBalance < 1000 && (
              <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
                Минимумы вывода: баланс — 1₽, карта РФ — 1000₽, CryptoBot — 10₽, криптовалюта — 300₽.
              </div>
            )}
            <input
              type="number"
              placeholder="Сумма вывода"
              value={withdrawState.amount}
              onChange={(e) => setWithdrawState({ ...withdrawState, amount: e.target.value })}
              className="w-full bg-zinc-800 border border-zinc-600 rounded-xl p-3 text-white focus:border-orange-500 outline-none"
            />
            <Button onClick={handleWithdrawNext}>Далее</Button>
          </div>
        )}

        {withdrawState.step === 2 && (
          <div className="space-y-3">
            <div className="text-sm text-zinc-400 mb-2">Выберите метод:</div>
            {WITHDRAW_METHODS.map(method => (
              <button
                key={method.id}
                onClick={() => setWithdrawState({ ...withdrawState, method: method.id })}
                disabled={Number(withdrawState.amount) < method.min && method.min > 0}
                className={`w-full p-4 rounded-xl flex items-center justify-between transition-all border ${
                  withdrawState.method === method.id
                  ? 'bg-orange-600/10 border-orange-600 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-750 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-300">
                    {method.icon}
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{method.name}</div>
                    {method.min > 0 && Number(withdrawState.amount) < method.min && (
                      <div className="text-xs text-red-400">Мин. сумма {method.min} ₽</div>
                    )}
                  </div>
                </div>
                {withdrawState.method === method.id && <CheckCircle size={20} className="text-orange-500" />}
              </button>
            ))}
            <div className="pt-4 flex gap-3">
               <Button variant="secondary" onClick={() => setWithdrawState({ ...withdrawState, step: 1 })}>Назад</Button>
               <Button onClick={handleWithdrawNext}>Подтвердить</Button>
            </div>
          </div>
        )}

        {withdrawState.step === 3 && (
          <div className="space-y-4">
            {withdrawState.method === 'balance' && (
              <p className="text-zinc-300 text-center">
                Средства будут зачислены на ваш внутренний баланс моментально.
              </p>
            )}
            
            {withdrawState.method === 'card' && (
              <>
                <div className="text-sm text-zinc-400 mb-2">Заполните реквизиты:</div>
                <input
                  type="text"
                  placeholder="Номер карты"
                  value={withdrawState.cardNumber}
                  onChange={(e) => setWithdrawState({ ...withdrawState, cardNumber: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-xl p-3 text-white mb-2 focus:border-orange-500 outline-none"
                />
              </>
            )}

            {withdrawState.method === 'cryptobot' && (
              <p className="text-zinc-300 text-center">
                Для вывода в CryptoBot дополнительные реквизиты не требуются.
              </p>
            )}

            {withdrawState.method === 'crypto' && (
              <>
                <div className="text-sm text-zinc-400 mb-2">Реквизиты кошелька:</div>
                <select
                  value={withdrawState.cryptoNet}
                  onChange={(e) => setWithdrawState({ ...withdrawState, cryptoNet: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-xl p-3 text-white mb-2 focus:border-orange-500 outline-none"
                >
                  <option value="">Выберите сеть</option>
                  <option value="TON">TON</option>
                  <option value="TRC-20">TRC-20</option>
                </select>
                <input
                  type="text"
                  placeholder="Адрес кошелька"
                  value={withdrawState.cryptoAddr}
                  onChange={(e) => setWithdrawState({ ...withdrawState, cryptoAddr: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-600 rounded-xl p-3 text-white focus:border-orange-500 outline-none font-mono text-sm"
                />
              </>
            )}

            <div className="pt-4 flex gap-3">
               <Button variant="secondary" onClick={() => setWithdrawState({ ...withdrawState, step: 2 })}>Назад</Button>
               <Button onClick={handleWithdrawNext}>Подтвердить</Button>
            </div>
          </div>
        )}

        {withdrawState.step === 4 && (
          <div className="text-center py-4">
            <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto mb-4">
              <CheckCircle size={32} />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              {withdrawState.method === 'balance' ? 'Готово!' : 'Заявка принята'}
            </h3>
            <p className="text-zinc-400 text-sm mb-6">
              {withdrawState.method === 'balance' 
                ? 'Средства зачислены на ваш баланс.' 
                : 'Если нарушений нет, средства поступят в течение 3-х рабочих дней.'}
            </p>
            <Button onClick={() => setWithdrawModalOpen(false)}>Отлично</Button>
          </div>
        )}
      </Modal>

      {/* Онбординг для новых пользователей */}
      {showOnboarding && (
        <div className="fixed inset-0 z-[100] bg-zinc-950 flex flex-col animate-fade-in">
          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-6 pb-4">
            {[0, 1, 2].map(i => (
              <div 
                key={i} 
                className={`w-2 h-2 rounded-full transition-all ${i === onboardingStep ? 'bg-orange-500 w-6' : 'bg-zinc-700'}`}
              />
            ))}
          </div>
          
          {/* Content */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
            <div className={`w-24 h-24 mb-6 ${onboardingStep === 0 ? 'animate-pulse-soft' : 'animate-scale-in'}`}>
              <img
                src="/assets/logo.png"
                onError={(e) => { (e.currentTarget.style.display = 'none'); }}
                alt="БлинВПН"
                className={`w-full h-full object-contain mx-auto ${onboardingStep === 0 ? '' : 'translate-y-[-8px]'} transition-all duration-500`}
              />
            </div>
            {onboardingStep === 0 && (
              <>
                <h2 className="text-2xl font-bold text-white mb-4 animate-slide-up">Добро пожаловать в БлинВПН</h2>
                <p className="text-zinc-400 leading-relaxed">
                  Быстрый, безопасный и удобный VPN для стабильного доступа к интернету.
                </p>
              </>
            )}
            
            {onboardingStep === 1 && (
              <>
                <div className="flex gap-2 mb-4 text-xs text-zinc-300 animate-slide-up">
                  <span>Германия</span><span>•</span><span>Финляндия</span><span>•</span><span>Нидерланды</span><span>•</span><span>Россия</span><span>•</span><span>США</span>
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">Много локаций</h2>
                <p className="text-zinc-400 leading-relaxed">
                  Выбирайте удобную страну и подключайтесь к серверам с высокой скоростью.
                </p>
              </>
            )}
            
            {onboardingStep === 2 && (
              <>
                <h2 className="text-2xl font-bold text-white mb-4">Универсальный обход ограничений</h2>
                <p className="text-zinc-400 leading-relaxed">
                  Работает при мобильных ограничениях и сценариях вроде режима «беспилотной опасности».
                </p>
              </>
            )}
          </div>
          
          {/* Buttons */}
          <div className="px-6 pb-8 space-y-3">
            {onboardingStep < 2 ? (
              <>
                <button 
                  onClick={() => setOnboardingStep(prev => prev + 1)}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl font-bold transition-all hover:scale-[1.01]"
                >
                  Начнем
                </button>
                <button 
                  onClick={() => {
                    setShowOnboarding(false);
                    localStorage.setItem(`onboarding_${telegramId}`, 'true');
                  }}
                  className="w-full py-3 text-zinc-500 hover:text-zinc-300 transition-all"
                >
                  Пропустить
                </button>
              </>
            ) : (
              <button 
                onClick={() => {
                  setShowOnboarding(false);
                  localStorage.setItem(`onboarding_${telegramId}`, 'true');
                }}
                className="w-full py-4 bg-orange-600 hover:bg-orange-500 text-white rounded-2xl font-bold transition-all hover:scale-[1.01]"
              >
                Начать пользоваться
              </button>
            )}
          </div>
        </div>
      )}

    </AnimatedBackground>
  );
}
