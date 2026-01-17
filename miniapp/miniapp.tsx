import React, { useState, useEffect, useMemo } from 'react';
import { 
  Smartphone, Monitor, Tv, CreditCard, History, 
  UserPlus, Gift, ChevronLeft, Copy, Trash2, Edit2, 
  CheckCircle, Clock, Globe, Shield, Zap, Plus,
  LogOut, Download, Apple, Command, User, ChevronDown, 
  ArrowRight, Frown, BookOpen, Crown, ChevronRight, Wallet, Sliders, X,
  Rocket, AlertTriangle, FileText
} from 'lucide-react';

// ==========================================
// 0. ENV & API HELPERS
// ==========================================

declare const importMetaMini: any | undefined;

const rawEnvMini: any =
  (typeof importMetaMini !== 'undefined' && importMetaMini.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

const API_BASE_URL_MINI: string = rawEnvMini.VITE_API_URL || rawEnvMini.REACT_APP_API_URL || '/api';
const SUPPORT_URL: string = rawEnvMini.VITE_SUPPORT_URL || rawEnvMini.REACT_APP_SUPPORT_URL || 'https://t.me/iiapick';
const BOT_USERNAME_MINI: string = rawEnvMini.VITE_BOT_USERNAME || rawEnvMini.REACT_APP_BOT_USERNAME || 'blnnnbot';

async function miniApiFetch(path: string, options: RequestInit = {}): Promise<any> {
  // Всегда используем относительный путь /api - nginx проксирует на backend
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `/api${cleanPath}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ==========================================
// 1. TYPES & INTERFACES
// ==========================================

type ViewState = 
  | 'home' 
  | 'wizard' 
  | 'topup' 
  | 'wait_payment' 
  | 'success_payment' 
  | 'devices' 
  | 'buy_device' 
  | 'instruction_view' 
  | 'history' 
  | 'referral' 
  | 'referral_detail' 
  | 'promo';

type PlatformId = 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'androidtv';

interface Plan {
  id: string;
  duration: string;
  price: number;
  highlight: boolean;
  days: number;
  isTrial?: boolean;
}

interface PaymentMethodVariant {
  id: string;
  name: string;
  feePercent: number;
}

interface PaymentMethod {
  id: string;
  name: string;
  icon: string | React.ReactNode;
  feePercent: number;
  variants?: PaymentMethodVariant[];
}

interface Device {
  id: number;
  name: string;
  type: PlatformId | string;
  added: string;
}

interface HistoryItem {
  id: number;
  type: string;
  title: string;
  amount: number;
  date: string;
}

interface ReferralTransaction {
  date: string;
  action: string;
  sum: number;
  profit: number;
}

interface ReferralUser {
  id: number;
  name: string;
  date: string;
  spent: number;
  myProfit: number;
  history: ReferralTransaction[];
}

interface InstructionStep {
  title: string;
  desc: string;
  actions?: {
    label: string;
    type?: 'copy_key' | 'trigger_add' | 'nav_android' | 'nav_ios';
    url?: string;
    primary?: boolean;
  }[];
}

interface PlatformData {
  id: PlatformId;
  title: string;
  icon: React.ReactNode;
  steps: InstructionStep[];
}

// ==========================================
// 2. CONSTANTS & CONTENT
// ==========================================

const OFFER_AGREEMENT_TEXT = `
**Редакция от 01.01.2024 (Версия 2.0)**

Настоящий документ является официальным предложением (публичной офертой) сервиса **BlinVPN** (далее — «Исполнитель») и содержит все существенные условия предоставления услуг по предоставлению удаленного доступа к сети Интернет.

### 1. ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ
В целях настоящего Документа используются следующие термины:
* **1.1. Сервис (BlinVPN)** — программно-аппаратный комплекс, предоставляющий функционал перенаправления интернет-трафика через удаленные серверы.
* **1.2. Ключ доступа (Конфигурация)** — уникальный цифровой код/файл, генерируемый Сервисом, являющийся техническим средством аутентификации Пользователя в системе.
* **1.3. Стороннее ПО** — программное обеспечение третьих лиц (в т.ч. приложение «Happ», V2Ray и аналоги), устанавливаемое Пользователем на свое устройство для взаимодействия с Сервисом.
* **1.4. Аномальная активность** — паттерны сетевого поведения, отклоняющиеся от стандартного профиля использования (в т.ч. массовые рассылки, сканирование портов, превышение лимитов сессий).

### 2. ПРЕДМЕТ СОГЛАШЕНИЯ
* **2.1.** Исполнитель предоставляет Пользователю неисключительное право (лицензию) на использование Ключа доступа к инфраструктуре Сервиса, а Пользователь обязуется оплатить данное право.
* **2.2.** Доступ к Сервису предоставляется по принципу **«AS IS» («КАК ЕСТЬ»)**. Исполнитель не гарантирует совместимость Сервиса с любым конкретным программным обеспечением или устройством Пользователя.
* **2.3. Момент оказания услуги.** Услуга считается оказанной в полном объеме и надлежащего качества в момент автоматической отправки Ключа доступа в интерфейсе Telegram-бота. С этого момента обязательства Исполнителя считаются выполненными.

### 3. ТЕХНИЧЕСКИЕ УСЛОВИЯ И ОГРАНИЧЕНИЯ
* **3.1. Локации и Маршруты.** Пользователю предоставляется доступ к динамическому пулу серверов. Исполнитель вправе в одностороннем порядке, без предварительного уведомления, изменять географическое расположение серверов, IP-адреса и маршруты трафика в целях оптимизации нагрузки. Наличие конкретной страны (геолокации) не гарантируется.
* **3.2. Скорость соединения.** Скорость доступа к сети Интернет через Сервис не является фиксированной и зависит от:
    * Нагрузки на общий (shared) канал связи;
    * Удаленности конечного ресурса;
    * Ограничений интернет-провайдера Пользователя (в т.ч. шейпинга UDP/TCP трафика).
* **3.3. Лицензионные ограничения.** Один Ключ доступа предназначен для использования строго на **1 (одном) устройстве**.
    * Система автоматически фиксирует нарушение данного условия.
    * При выявлении одновременных сессий с разных устройств, Ключ блокируется автоматически.
* **3.4. Стороннее ПО.** Исполнитель не является разработчиком клиентских приложений (Happ и др.) и не несет ответственности за их удаление из магазинов приложений (AppStore/Google Play), сбои в их работе или некорректные обновления.

### 4. РЕГЛАМЕНТ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ (SLA)
* **4.1. Плановые работы.** Исполнитель вправе проводить технические работы с полной остановкой Сервиса на неограниченное время, при условии уведомления Пользователей (в канале или боте) не менее чем за 24 часа.
* **4.2. Аварийные работы.** Допускается перерыв в предоставлении Услуг без предварительного уведомления общей продолжительностью до **100 (ста) часов в календарный месяц**. Данные перерывы не являются основанием для перерасчета стоимости или возврата средств.
* **4.3.** Блокировка доступа к Сервису со стороны государственных регуляторов (РКН) или интернет-провайдеров признается обстоятельством непреодолимой силы (Форс-мажор) и исключает ответственность Исполнителя.

### 5. ПОЛИТИКА ВОЗВРАТА СРЕДСТВ (REFUND POLICY)
* **5.1.** Возврат денежных средств возможен **исключительно** при одновременном соблюдении **ВСЕХ** следующих условий:
    * а) С момента покупки прошло не более 72 часов (3 суток);
    * б) Объем потребленного трафика по Ключу составляет менее **1 (одного) Мегабайта**;
    * в) Пользователь обратился в Техническую поддержку, и специалисты Поддержки не смогли обеспечить подключение на устройстве Пользователя в течение 24 часов с момента обращения.
* **5.2.** Во всех иных случаях, включая (но не ограничиваясь) низкую скорость, высокий пинг, субъективное нежелание использовать Сервис, возврат средств **НЕ ПРОИЗВОДИТСЯ**.

### 6. ОТВЕТСТВЕННОСТЬ И ПРАВИЛА ИСПОЛЬЗОВАНИЯ
* **6.1. Запрещенные действия.** Пользователю категорически запрещено:
    * Использовать торрент-клиенты (P2P протоколы);
    * Осуществлять массовые рассылки (спам);
    * Сканировать порты, IP-адреса, осуществлять DDoS-атаки;
    * Распространять Ключ доступа третьим лицам (перепродажа, «слив» в публичный доступ).
    * Использовать Сервис для противоправных действий согласно УК РФ.
* **6.2. Санкции за нарушения.**
    * При выявлении нарушений (в т.ч. автоматическими алгоритмами анализа трафика) доступ к Услуге **приостанавливается**.
    * Срок действия подписки в период приостановки **не продлевается и не замораживается**.
* **6.3. Порядок обжалования.**
    * Пользователь имеет право подать апелляцию в Техническую поддержку в течение **7 (семи) календарных дней** с момента блокировки.
    * Бремя доказывания отсутствия нарушений лежит на Пользователе.
    * Администрация оставляет за собой право отказать в разблокировке и в предоставлении подробностей о причинах блокировки в целях защиты алгоритмов безопасности Сервиса.

### 7. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ
* **7.1.** Администрация вправе в одностороннем порядке вносить изменения в настоящую Оферту.
* **7.2.** Оплата Услуг означает полное и безоговорочное согласие с условиями настоящей Оферты.
`;

const PRIVACY_POLICY_TEXT = `
### 1. ОБЩИЕ ПОЛОЖЕНИЯ
**1.1.** Настоящая Политика регламентирует порядок сбора, обработки и хранения технических данных пользователей сервиса BlinVPN.
**1.2.** Основным приоритетом Сервиса является минимизация хранимых персональных данных при обеспечении технической стабильности и безопасности сети.

### 2. СОСТАВ СОБИРАЕМЫХ ДАННЫХ
Сервис не осуществляет сбор, хранение или анализ содержимого интернет-трафика Пользователя (Deep Packet Inspection), истории посещенных веб-ресурсов или переписки.
В целях технического обеспечения Услуг собираются следующие метаданные:

**2.1. Идентификационные данные платформы:**
* Уникальный идентификатор пользователя Telegram (Telegram ID);
* Имя пользователя (Username);
* История обращений в службу поддержки (включая переданные скриншоты и логи ошибок).

**2.2. Технические данные сессий:**
* **Объем трафика:** Учет входящих и исходящих пакетов данных (в байтах) для контроля лимитов и выявления аномальной нагрузки.
* **Аппаратные идентификаторы:** Хешированные данные об устройстве (HWID) или уникальные «отпечатки» клиента (Fingerprint). Сбор данных осуществляется исключительно с целью предотвращения мультиаккаунтинга (нарушение правила «1 ключ = 1 устройство») и борьбы с перепродажей Ключей.

**2.3. Платежные данные:**
* ID транзакции, сумма, метод оплаты. Полные данные банковских карт не обрабатываются и не хранятся Сервисом (обработка производится на стороне платежных шлюзов).

### 3. ЦЕЛИ ОБРАБОТКИ И ХРАНЕНИЯ
**3.1.** Обеспечение автоматической выдачи и ротации цифровых ключей.
**3.2.** Автоматический мониторинг нагрузки на сеть и предотвращение перегрузок (DDoS).
**3.3.** Выявление нарушений Условий использования (сканирование портов, спам-активность) на основе анализа метаданных трафика.

### 4. ПЕРЕДАЧА ДАННЫХ И ВЗАИМОДЕЙСТВИЕ С ТРЕТЬИМИ ЛИЦАМИ
**4.1.** Сервис не передает данные третьим лицам в коммерческих или маркетинговых целях.
**4.2.** Раскрытие накопленных метаданных государственным органам возможно исключительно при наличии вступившего в законную силу судебного акта, оформленного в соответствии с процессуальным законодательством РФ, и врученного Администрации Сервиса надлежащим образом.

### 5. ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ
**5.1.** Пользователь осознает, что использование сети Интернет связано с рисками. Сервис не несет ответственности за перехват данных, произошедший на устройстве Пользователя или на узлах сети, не контролируемых Сервисом.
`;

// VPN планы загружаются из API, но оставляем дефолтные для fallback
const VPN_PLANS_DEFAULT: Plan[] = [
  { id: 'trial', duration: 'Пробный тариф', price: 0, highlight: true, days: 1, isTrial: true }, // 24 часа = 1 день
  { id: '1m', duration: '1 месяц', price: 99, highlight: false, days: 30 },
  { id: '3m', duration: '3 месяца', price: 249, highlight: false, days: 90 },
  { id: '6m', duration: '6 месяцев', price: 449, highlight: false, days: 180 },
  { id: '1y', duration: '1 ГОД', price: 799, highlight: true, days: 365 },
  { id: '2y', duration: '2 ГОДА', price: 1199, highlight: false, days: 730 },
];

const PRESET_AMOUNTS = [100, 250, 500, 1000, 2000, 5000]; // Минимум 50₽, максимум 100,000₽

/**
 * Рассчитывает цену за whitelist bypass: абонентская плата (100₽) + 15₽/ГБ
 * Диапазон: 5-500 ГБ
 */
function calculateWhitelistPrice(gb: number, subscriptionFee: number = 100, pricePerGb: number = 15): number {
  if (gb < 5) gb = 5;
  if (gb > 500) gb = 500;
  
  return subscriptionFee + (gb * pricePerGb);
}

// Платежные методы загружаются из API с комиссиями, но оставляем дефолтные
const PAYMENT_METHODS_DEFAULT: PaymentMethod[] = [
  { 
    id: 'card', 
    name: 'Банковская карта', 
    icon: '💳', 
    feePercent: 0  // Без комиссии по умолчанию
  },
  { 
    id: 'sbp', 
    name: 'СБП', 
    icon: '⚡', 
    feePercent: 0, 
    variants: [
      { id: 'platega', name: 'Platega', feePercent: 0 },
      { id: 'yookassa', name: 'YooKassa', feePercent: 0 }
    ]
  },
  { 
    id: 'crypto', 
    name: 'Криптовалюта', 
    icon: '🪙', 
    feePercent: 0 
  },
];

const WITHDRAW_METHODS = [
  { id: 'balance', name: 'На баланс', icon: <Wallet size={20} />, min: 0 },
  { id: 'card', name: 'На карту', icon: <CreditCard size={20} />, min: 1 },
  { id: 'crypto', name: 'Криптокошелек', icon: <img src="https://cryptologos.cc/logos/tether-usdt-logo.svg?v=026" className="w-5 h-5 invert" alt="USDT" />, min: 1 },
];

const PLATFORMS: { id: PlatformId; name: string; icon: React.ReactNode }[] = [
  { id: 'android', name: 'Android', icon: <Smartphone size={32} /> },
  { id: 'ios', name: 'iOS (iPhone)', icon: <Apple size={32} /> },
  { id: 'windows', name: 'Windows PC', icon: <Monitor size={32} /> },
  { id: 'macos', name: 'MacOS', icon: <Command size={32} /> },
  { id: 'linux', name: 'Linux', icon: <Monitor size={32} /> },
  { id: 'androidtv', name: 'Android TV', icon: <Tv size={32} /> },
];

const INSTRUCTIONS: Record<string, PlatformData> = {
  android: {
    id: 'android',
    title: 'Android',
    icon: <Smartphone size={20} />,
    steps: [
      {
        title: '1. Установка приложения',
        desc: 'Установите приложение из Google Play или скачайте APK.',
        actions: [
          { label: 'Google Play', url: 'https://play.google.com/store/apps/details?id=com.happproxy', primary: true },
          { label: 'Скачать .APK', url: 'https://github.com/Happ-proxy/happ-android/releases/latest/download/Happ.apk', primary: false }
        ]
      },
      {
        title: '2. Добавляем подписку',
        desc: 'Нажмите кнопку ниже, чтобы добавить подписку в приложение.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
        ]
      },
      {
        title: '3. Обновляем и подключаемся',
        desc: 'В приложении нажмите кнопку обновления (🔄) и выберите локацию.'
      }
    ]
  },
  ios: {
    id: 'ios',
    title: 'iOS (iPhone/iPad)',
    icon: <Apple size={20} />,
    steps: [
      {
        title: '1. Установка приложения',
        desc: 'Установите приложение из App Store.',
        actions: [
          { label: 'App Store', url: 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973', primary: true }
        ]
      },
      {
        title: '2. Добавляем подписку',
        desc: 'Нажмите кнопку ниже для автоматического добавления.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
        ]
      },
      {
        title: '3. Подключение',
        desc: 'Нажмите (🔄) в приложении, выберите сервер и подключитесь.',
        actions: [
          { label: 'Подключиться!', url: 'happ://connect', primary: true }
        ]
      }
    ]
  },
  windows: {
    id: 'windows',
    title: 'Windows',
    icon: <Monitor size={20} />,
    steps: [
      {
        title: '1. Установка',
        desc: 'Скачайте и установите .EXE файл.',
        actions: [
          { label: 'Скачать .EXE', url: 'https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe', primary: true }
        ]
      },
      {
        title: '2. Копирование ключа',
        desc: 'Скопируйте ваш персональный ключ доступа.',
        actions: [
          { label: 'Скопировать ключ', type: 'copy_key', primary: true }
        ]
      },
      {
        title: '3. Настройка',
        desc: 'Вставьте скопированный ключ в приложение и подключитесь.'
      }
    ]
  },
  macos: {
    id: 'macos',
    title: 'MacOS',
    icon: <Command size={20} />,
    steps: [
      {
        title: '1. Установка',
        desc: 'Установите через AppStore.',
        actions: [
          { label: 'App Store', url: 'https://apps.apple.com/ru/app/happ-proxy-utility-plus/id6746188973', primary: true }
        ]
      },
      {
        title: '2. Ключ доступа',
        desc: 'Скопируйте ключ и вставьте его в приложении.',
        actions: [
          { label: 'Скопировать ключ', type: 'copy_key', primary: true }
        ]
      }
    ]
  },
  linux: {
    id: 'linux',
    title: 'Linux',
    icon: <Monitor size={20} />, 
    steps: [
      {
        title: '1. Установка',
        desc: 'Скачайте релиз с GitHub.',
        actions: [
          { label: 'GitHub Releases', url: 'https://github.com/Happ-proxy/happ-desktop/releases/', primary: true }
        ]
      },
      {
        title: '2. Ключ доступа',
        desc: 'Скопируйте ключ и вставьте его в приложении.',
        actions: [
          { label: 'Скопировать ключ', type: 'copy_key', primary: true }
        ]
      }
    ]
  },
  androidtv: {
    id: 'androidtv',
    title: 'Android TV',
    icon: <Tv size={20} />,
    steps: [
      {
        title: '1. Подготовка',
        desc: 'Сначала добавьте ключ на свой смартфон.',
        actions: [
          { label: 'Инструкция Android', type: 'nav_android', primary: false },
          { label: 'Инструкция iOS', type: 'nav_ios', primary: false }
        ]
      },
      {
        title: '2. Установка на TV',
        desc: 'Найдите "Happ" в Google Play на телевизоре и установите.'
      },
      {
        title: '3. Синхронизация',
        desc: 'На TV: нажмите "+" -> "Добавить подписку". На телефоне: "+" -> "QR-код". Отсканируйте код.'
      }
    ]
  }
};

// ==========================================
// 3. UI COMPONENTS
// ==========================================

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'trial' | 'gold';
}

const Button: React.FC<ButtonProps> = ({ children, onClick, variant = 'primary', className = '', disabled = false }) => {
  const baseStyle = "w-full py-3.5 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/40",
    secondary: "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700",
    outline: "border-2 border-blue-600/30 text-blue-400 hover:bg-blue-600/10",
    danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20",
    ghost: "text-slate-400 hover:text-white hover:bg-slate-800/50",
    trial: "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg shadow-purple-900/40 hover:brightness-110",
    gold: "bg-gradient-to-r from-amber-500 to-yellow-600 text-white shadow-lg shadow-amber-900/40"
  };

  return (
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div onClick={onClick} className={`bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-5 ${className}`}>
    {children}
  </div>
);

const Header: React.FC<{ title: string, onBack?: () => void }> = ({ title, onBack }) => (
  <div className="flex items-center gap-3 mb-6">
    {onBack && (
      <button onClick={onBack} className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-slate-300 hover:text-white transition-colors">
        <ChevronLeft size={22} />
      </button>
    )}
    <h1 className="text-2xl font-bold text-white">{title}</h1>
  </div>
);

const Modal: React.FC<{ title: string, isOpen: boolean, onClose: () => void, children: React.ReactNode, fullHeight?: boolean }> = ({ title, isOpen, onClose, children, fullHeight = false }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose}></div>
      <div className={`relative bg-slate-900 border border-slate-700 w-full max-w-sm rounded-2xl p-6 shadow-2xl transform transition-all scale-100 flex flex-col ${fullHeight ? 'h-[85vh]' : 'max-h-[90vh]'}`}>
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto custom-scrollbar flex-1 pr-1">
            {children}
        </div>
      </div>
    </div>
  );
};

// Simple Markdown Renderer for Legal Docs
const MarkdownRenderer: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n');
  return (
    <div className="space-y-3 text-slate-300 text-sm leading-relaxed">
      {lines.map((line, idx) => {
        if (line.startsWith('### ')) {
          return <h3 key={idx} className="text-lg font-bold text-white mt-4 mb-2">{line.replace('### ', '')}</h3>;
        }
        if (line.startsWith('**') && !line.includes('**', 2)) {
          // Headers that are just bold lines or similar
          return <p key={idx} className="font-bold text-white">{line.replace(/\*\*/g, '')}</p>;
        }
        if (line.startsWith('* ')) {
           // List items
           const cleanLine = line.replace('* ', '');
           // Simple bold parser for inside line
           const parts = cleanLine.split('**');
           return (
             <div key={idx} className="flex gap-2 pl-2">
                <span className="text-blue-500 mt-1.5">•</span>
                <span>
                    {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-slate-200">{part}</strong> : part))}
                </span>
             </div>
           );
        }
        // Paragraphs with inline bold
        const parts = line.split('**');
        return (
            <p key={idx} className={line.trim() === '' ? 'h-2' : ''}>
                {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-slate-200">{part}</strong> : part))}
            </p>
        );
      })}
    </div>
  );
};


// ==========================================
// 4. MAIN APPLICATION
// ==========================================

export default function App() {
  // --- STATE ---
  const [view, setView] = useState<ViewState>('home'); 
  const [balance, setBalance] = useState<number>(0);
  const [isTrialUsed, setIsTrialUsed] = useState<boolean>(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [telegramId, setTelegramId] = useState<number | null>(null);
  const [username, setUsername] = useState<string>('User');
  const [displayName, setDisplayName] = useState<string>('User'); // first_name для отображения
  const [userPhotoUrl, setUserPhotoUrl] = useState<string | null>(null);
  
  // Data
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceKeys, setDeviceKeys] = useState<Map<number, string>>(new Map()); // key: device_id, value: key_config
  
  // Modal States
  const [editModalOpen, setEditModalOpen] = useState(false);
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
  const [newName, setNewName] = useState('');

  // Referral Data
  const [referrals, setReferrals] = useState({ count: 0, earned: 0 });
  const [referralList, setReferralList] = useState<ReferralUser[]>([]);
  const [selectedReferral, setSelectedReferral] = useState<ReferralUser | null>(null);
  const [withdrawState, setWithdrawState] = useState({ 
    step: 1, 
    amount: '', 
    method: null as string | null, 
    phone: '', 
    bank: '', 
    cryptoNet: '', 
    cryptoAddr: '',
    lastCardWithdraw: null as number | null
  });

  // TopUp State
  const [topupStep, setTopupStep] = useState(1); 
  const [topupAmount, setTopupAmount] = useState(0);
  const [customAmount, setCustomAmount] = useState('');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>(PAYMENT_METHODS_DEFAULT);
  
  // Pending Purchase
  const [pendingAction, setPendingAction] = useState<{ type: string, payload: any } | null>(null);

  // Connection Wizard State
  const [wizardStep, setWizardStep] = useState(1); // 1: Platform, 2: Plan (VPN/Whitelist), 3: Payment/Confirm, 4: Instructions
  const [wizardPlatform, setWizardPlatform] = useState<PlatformId>('android');
  const [wizardPlan, setWizardPlan] = useState<Plan | null>(null);
  const [wizardType, setWizardType] = useState<'vpn' | 'whitelist'>('vpn'); 
  const [whitelistGB, setWhitelistGB] = useState(10); 
  const [useAutoPay, setUseAutoPay] = useState(false);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);

  // Buy Device State (Legacy for whitelist tab)
  const [buyTab, setBuyTab] = useState<'vpn' | 'whitelist'>('vpn'); 
  
  // Instructions State
  const [activePlatform, setActivePlatform] = useState<string>('android');

  // Detect Platform & load user on Mount
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    let detected: PlatformId = 'android';
    if (ua.includes('iphone') || ua.includes('ipad')) detected = 'ios';
    else if (ua.includes('android')) detected = 'android';
    else if (ua.includes('win')) detected = 'windows';
    else if (ua.includes('mac')) detected = 'macos';
    else if (ua.includes('linux')) detected = 'linux';
    
    setActivePlatform(detected);
    setWizardPlatform(detected);

    // Определяем Telegram ID и username из Telegram WebApp
    let tgId: number | null = null;
    let tgUsername: string = '';
    let tgFirstName: string = '';
    let referralId: number | null = null;
    const win: any = window as any;
    
    if (win.Telegram?.WebApp?.initDataUnsafe?.user) {
      const tgUser = win.Telegram.WebApp.initDataUnsafe.user;
      tgId = Number(tgUser.id);
      tgUsername = tgUser.username || '';
      tgFirstName = tgUser.first_name || '';
      
      // Получаем URL аватарки пользователя из Telegram WebApp
      if (tgUser.photo_url) {
        setUserPhotoUrl(tgUser.photo_url);
      }
      
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
      win.Telegram.WebApp.expand();
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
      return;
    }

    setTelegramId(tgId);
    if (tgUsername) setUsername(tgUsername);
    // Устанавливаем displayName: приоритет first_name, затем username
    setDisplayName(tgFirstName || tgUsername || 'User');

    (async () => {
      try {
        // Пользователь (автоматически создается если не существует)
        // Передаем реферальный ID и first_name если есть
        let userUrl = `/user/info?telegram_id=${tgId}&username=${encodeURIComponent(tgUsername)}`;
        if (tgFirstName) {
          userUrl += `&first_name=${encodeURIComponent(tgFirstName)}`;
        }
        if (referralId) {
          userUrl += `&ref=${referralId}`;
        }
        const userData = await miniApiFetch(userUrl);
        if (userData) {
          setUserId(userData.id);
          setBalance(userData.balance || 0);
          setUsername(userData.username || `User_${tgId}`);
          // Обновляем displayName: full_name из API или первоначальное значение
          setDisplayName(userData.full_name || tgFirstName || userData.username || `User_${tgId}`);
          setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
          setReferrals({
            count: userData.referrals_count || 0,
            earned: userData.referral_earned || userData.partner_balance || 0,
          });
        }

        // Устройства
        const devicesData = await miniApiFetch(`/user/devices?telegram_id=${tgId}`);
        if (Array.isArray(devicesData)) {
          const devicesList: Device[] = devicesData.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: d.type,
            added: d.added
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
      } catch (err) {
        console.error('Ошибка загрузки данных:', err);
      }
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
          added: d.added
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

  const refreshUserData = async () => {
    if (!telegramId) return;
    try {
      const userData = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
      if (userData) {
        setBalance(userData.balance || 0);
        setUserId(userData.id);
        setUsername(userData.username || `User_${telegramId}`);
        setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
        setReferrals({
          count: userData.referrals_count || 0,
          earned: userData.referral_earned || userData.partner_balance || 0,
        });
      }
    } catch (e) {
      console.error('Failed to refresh user data', e);
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
        setIsTrialUsed(userData.trial_used === 1 || userData.trial_used === true);
        return userData.id;
      }
    } catch (e) {
      console.error('Failed to ensure userId', e);
    }
    return null;
  };

  // RSA-4096 Public Key for fallback encryption
  const RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAlBetA0wjbaj+h7oJ/d/h
pNrXvAcuhOdFGEFcfCxSWyLzWk4SAQ05gtaEGZyetTax2uqagi9HT6lapUSUe2S8
nMLJf5K+LEs9TYrhhBdx/B0BGahA+lPJa7nUwp7WfUmSF4hir+xka5ApHjzkAQn6
cdG6FKtSPgq1rYRPd1jRf2maEHwiP/e/jqdXLPP0SFBjWTMt/joUDgE7v/IGGB0L
Q7mGPAlgmxwUHVqP4bJnZ//5sNLxWMjtYHOYjaV+lixNSfhFM3MdBndjpkmgSfmg
D5uYQYDL29TDk6Eu+xetUEqry8ySPjUbNWdDXCglQWMxDGjaqYXMWgxBA1UKjUBW
wbgr5yKTJ7mTqhlYEC9D5V/LOnKd6pTSvaMxkHXwk8hBWvUNWAxzAf5JZ7EVE3jt
0j682+/hnmL/hymUE44yMG1gCcWvSpB3BTlKoMnl4yrTakmdkbASeFRkN3iMRewa
IenvMhzJh1fq7xwX94otdd5eLB2vRFavrnhOcN2JJAkKTnx9dwQwFpGEkg+8U613
+Tfm/f82l56fFeoFN98dD2mUFLFZoeJ5CG81ZeXrH83niI0joX7rtoAZIPWzq3Y1
Zb/Zq+kK2hSIhphY172Uvs8X2Qp2ac9UoTPM71tURsA9IvPNvUwSIo/aKlX5KE3I
VE0tje7twWXL5Gb1sfcXRzsCAwEAAQ==
-----END PUBLIC KEY-----`;

  // Получить Happ зашифрованную ссылку
  const getHappEncryptedLink = async (subscriptionUrl: string): Promise<string | null> => {
    // Сначала пробуем API
    try {
      const response = await fetch('https://crypto.happ.su/api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: subscriptionUrl })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && (data.link || data.url)) {
          return data.link || data.url;
        }
      }
    } catch (e) {
      console.error('API encryption failed, trying local RSA:', e);
    }
    
    // Fallback на локальное RSA шифрование
    try {
      const pemToArrayBuffer = (pem: string) => {
        const b64 = pem
          .replace(/-----BEGIN PUBLIC KEY-----/, '')
          .replace(/-----END PUBLIC KEY-----/, '')
          .replace(/\s/g, '');
        const binary = atob(b64);
        const buffer = new ArrayBuffer(binary.length);
        const view = new Uint8Array(buffer);
        for (let i = 0; i < binary.length; i++) {
          view[i] = binary.charCodeAt(i);
        }
        return buffer;
      };

      const keyBuffer = pemToArrayBuffer(RSA_PUBLIC_KEY);
      const publicKey = await crypto.subtle.importKey(
        'spki',
        keyBuffer,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        false,
        ['encrypt']
      );
      
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(subscriptionUrl);
      
      // RSA-OAEP with SHA-256: max ~446 bytes for 4096-bit key
      const maxChunkSize = 446;
      const chunks: Uint8Array[] = [];
      
      for (let i = 0; i < dataBuffer.length; i += maxChunkSize) {
        const chunk = dataBuffer.slice(i, i + maxChunkSize);
        const encryptedChunk = await crypto.subtle.encrypt(
          { name: 'RSA-OAEP' },
          publicKey,
          chunk
        );
        chunks.push(new Uint8Array(encryptedChunk));
      }
      
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      
      // URL-safe base64
      const base64 = btoa(String.fromCharCode(...combined))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
      
      return 'happ://crypt4/' + base64;
    } catch (e) {
      console.error('Local RSA encryption failed:', e);
      return null;
    }
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
      handleCopy(subscriptionUrl);
      alert('Не удалось зашифровать ссылку. Ключ скопирован в буфер обмена.');
      return;
    }
    
    // Telegram не позволяет открывать не-HTTPS ссылки напрямую,
    // поэтому используем редирект-страницу на том же домене
    // Передаём и зашифрованную ссылку, и оригинальную для копирования
    const redirectUrl = `${window.location.origin}/redirect.html?redirect=${encodeURIComponent(encryptedLink)}&original=${encodeURIComponent(subscriptionUrl)}`;
    console.log('Redirect URL:', redirectUrl);
    console.log('Encrypted link:', encryptedLink);
    console.log('Original URL:', subscriptionUrl);
    
    // Сначала пробуем открыть зашифрованную ссылку напрямую через iframe
    // Это работает для кастомных протоколов в некоторых браузерах
    try {
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      iframe.src = encryptedLink;
      document.body.appendChild(iframe);
      console.log('Tried iframe method');
      
      // Удаляем iframe через секунду
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    } catch (e) {
      console.log('Iframe method failed:', e);
    }
    
    // Параллельно открываем редирект-страницу как fallback
    const win = window as any;
    if (win.Telegram?.WebApp?.openLink) {
      // openLink открывает во внешнем браузере
      console.log('Using Telegram.WebApp.openLink');
      win.Telegram.WebApp.openLink(redirectUrl);
    } else {
      // Fallback - открываем в текущем окне
      console.log('Using window.location.href fallback');
      window.location.href = redirectUrl;
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

  const openEditModal = (device: Device) => {
    setCurrentDevice(device);
    setNewName(device.name);
    setEditModalOpen(true);
  };

  const saveDeviceName = () => {
    if (newName && newName.trim() !== '' && currentDevice) {
      setDevices(prev => prev.map(d => d.id === currentDevice.id ? { ...d, name: newName } : d));
      setEditModalOpen(false);
      setCurrentDevice(null);
    }
  };

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
    setWithdrawState(prev => ({ ...prev, step: 1, amount: '', method: null })); 
    setWithdrawModalOpen(true);
  };

  const handleWithdrawNext = async () => {
    const { step, amount, method, lastCardWithdraw } = withdrawState;
    const numAmount = Number(amount);

    if (step === 1) {
      if (!amount || numAmount <= 0) return alert("Введите сумму");
      if (numAmount > referrals.earned) return alert("Недостаточно средств на реферальном балансе");
      setWithdrawState(prev => ({ ...prev, step: 2 }));
    } else if (step === 2) {
      if (!method) return alert("Выберите метод");
      if (method === 'card' || method === 'crypto') {
        if (numAmount < 1) return alert("Минимальная сумма вывода на карту/крипто - 1₽");
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
          if (!withdrawState.phone || !withdrawState.bank) return alert("Заполните все поля");
          
          const now = Date.now();
          if (lastCardWithdraw && now - lastCardWithdraw < 24 * 60 * 60 * 1000) {
             return alert("Вывод на карту доступен не чаще 1 раза в 24 часа.");
          }
          
          requestData.phone = withdrawState.phone;
          requestData.bank = withdrawState.bank;
        } else if (method === 'crypto') {
          if (!withdrawState.cryptoNet || !withdrawState.cryptoAddr) return alert("Заполните все поля");
          
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
            addHistoryItem('ref_req', 'Заявка на вывод (Карта)', 0);
            setWithdrawState(prev => ({ ...prev, lastCardWithdraw: Date.now() }));
          } else if (method === 'crypto') {
            addHistoryItem('ref_req', 'Заявка на вывод (Crypto)', 0);
          }
          
          setReferrals(prev => ({ ...prev, earned: prev.earned - numAmount }));
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

  const buyWhitelist = async () => {
    let finalGB = whitelistGB;
    if (finalGB < 5) finalGB = 5;
    else if (finalGB > 500) finalGB = 500;

    if (finalGB !== whitelistGB) setWhitelistGB(finalGB);

    let price = calculateWhitelistPrice(finalGB);
    let name = `Whitelist (${finalGB} ГБ)`;
    
    // Автоплатежи не добавляют цену, они просто сохраняют способ оплаты

    if (balance < price) {
      if(window.confirm(`Недостаточно средств. Стоимость: ${price} ₽. Ваш баланс: ${balance} ₽. Пополнить баланс?`)) {
        setPendingAction({
            type: 'legacy_whitelist',
            payload: { whitelistGB: finalGB, useAutoPay, selectedPaymentMethodId, price, name } 
        });
        setTopupAmount(price - balance);
        setTopupStep(1); 
        setView('topup');
      }
      return;
    }
    
    // Получаем userId если еще не загружен
    const currentUserId = await ensureUserId();
    if (!currentUserId) {
      alert('Не удалось загрузить данные пользователя. Попробуйте перезагрузить приложение.');
      return;
    }
    
    try {
      const res = await miniApiFetch('/subscription/create', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUserId,
          days: 30,
          type: 'whitelist',
          whitelist_gb: finalGB,
          price: price,
        }),
      });
      
      if (res && res.success) {
        addHistoryItem('buy_dev', name, -price);
        await refreshAll();
        setView('instruction_view');
      } else {
        alert(res?.error || 'Ошибка создания подписки');
      }
    } catch (e) {
      console.error('Failed to create subscription', e);
      alert('Ошибка создания подписки');
    }
  }

  const wizardActivate = async () => {
    let price = 0;
    let name = '';

    // Получаем userId если еще не загружен
    const currentUserId = await ensureUserId();
    if (!currentUserId) {
      alert('Не удалось загрузить данные пользователя. Попробуйте перезагрузить приложение.');
      return;
    }

    if (wizardType === 'vpn') {
        if (!wizardPlan) return;
        if (wizardPlan.isTrial) {
            // Активируем триал через API
            try {
              const res = await miniApiFetch('/subscription/create', {
                method: 'POST',
                body: JSON.stringify({
                  user_id: currentUserId,
                  days: wizardPlan.days || 1,
                  type: 'vpn',
                  is_trial: true,
                  price: 0,
                }),
              });
              
              if (res && res.success) {
                setIsTrialUsed(true);
                addHistoryItem('trial', 'Активация пробного периода', 0);
                await refreshAll();
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
        price = wizardPlan.price;
        name = `VPN (${wizardPlan.duration})`;
    } else {
        price = calculateWhitelistPrice(whitelistGB);
        name = `Whitelist (${whitelistGB} ГБ)`;
    }

    if (balance < price) {
      if(window.confirm(`Недостаточно средств. Пополнить баланс на ${price - balance} ₽?`)) {
        setPendingAction({
            type: 'wizard',
            payload: { wizardType, wizardPlan, whitelistGB, useAutoPay, selectedPaymentMethodId, price, name }
        });
        setTopupAmount(price - balance);
        setTopupStep(1); 
        setView('topup');
      }
      return;
    }

    // Если используется автоплатеж для whitelist, создаем платеж с сохраненным способом оплаты
    if (wizardType === 'whitelist' && useAutoPay && selectedPaymentMethodId) {
      try {
        await miniApiFetch('/subscription/create', {
          method: 'POST',
          body: JSON.stringify({
            user_id: currentUserId,
            days: 30,
            type: 'whitelist',
            whitelist_gb: whitelistGB,
            use_auto_pay: true,
            payment_method_id: selectedPaymentMethodId,
            price: price,
          }),
        });
        addHistoryItem('buy_dev', name, -price);
        await refreshAll();
        setWizardStep(4);
      } catch (e) {
        console.error('Failed to create subscription with auto pay', e);
        alert('Ошибка создания подписки с автоплатежом');
      }
      return;
    }
    
    try {
      const res = await miniApiFetch('/subscription/create', {
        method: 'POST',
        body: JSON.stringify({
          user_id: currentUserId,
          days: wizardType === 'vpn' ? wizardPlan?.days : 30,
          type: wizardType,
          whitelist_gb: wizardType === 'whitelist' ? whitelistGB : undefined,
          price: price,
        }),
      });
      
      if (res && res.success) {
        addHistoryItem('buy_dev', `Подключение: ${name}`, -price);
        await refreshAll();
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
    if (!selectedMethod) return topupAmount;
    const method = paymentMethods.find(m => m.id === selectedMethod);
    if (!method) return topupAmount;
    
    let fee = method.feePercent;
    
    // Check if variants exist and one is selected
    if (method.variants && selectedVariant) {
        const v = method.variants.find(v => v.id === selectedVariant);
        if (v) fee = v.feePercent;
    }

    const feeAmount = topupAmount * (fee / 100);
    return topupAmount + feeAmount;
  };

  // --- VIEWS ---

  const HomeView = () => (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center py-2">
        <div className="flex items-center gap-3">
          {userPhotoUrl ? (
            <img 
              src={userPhotoUrl} 
              alt={displayName} 
              className="w-10 h-10 rounded-full object-cover shadow-lg shadow-blue-500/20"
            />
          ) : (
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-full flex items-center justify-center font-bold text-lg text-white shadow-lg shadow-blue-500/20">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-xs text-slate-400 font-medium">Добро пожаловать</div>
            <div className="font-bold text-slate-100">{displayName}</div>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 border border-slate-700 shadow-2xl">
        <div className="absolute top-0 right-0 w-40 h-40 bg-blue-600/10 blur-[60px] rounded-full pointer-events-none"></div>
        <div className="relative z-10">
          <div className="flex justify-between items-start mb-2">
            <span className="text-slate-400 text-sm font-medium flex items-center gap-2">
              <CreditCard size={14} /> Баланс счёта
            </span>
            {balance <= 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-xs font-bold border border-red-500/20 animate-pulse">
                Низкий баланс
              </span>
            )}
          </div>
          <div className={`text-4xl font-black mb-6 tracking-tight ${balance <= 0 ? 'text-red-500' : 'text-white'}`}>
            {formatMoney(balance)}
          </div>
          <div className="flex gap-3 mb-4">
            <Button onClick={() => { setTopupStep(1); setView('topup'); }} className="flex-1">
              <Zap size={18} fill="currentColor" /> Пополнить
            </Button>
            <button onClick={() => setView('history')} className="w-14 bg-slate-700/50 hover:bg-slate-700 rounded-xl flex items-center justify-center text-slate-300 border border-slate-600 transition-colors">
              <History size={20} />
            </button>
          </div>
          
          <div className="w-full">
            <button 
                onClick={() => { setWizardStep(1); setWizardPlan(null); setWizardType('vpn'); setView('wizard'); }}
                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white py-4 rounded-xl font-bold shadow-lg shadow-blue-900/50 flex items-center justify-center gap-2 active:scale-95 transition-all text-lg"
            >
                <Rocket size={24} /> Подключить VPN
            </button>
            {!isTrialUsed && (
                <div className="text-center mt-2">
                    <span className="text-xs text-blue-300 font-medium bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                        🎁 Дарим 24 часа бесплатно
                    </span>
                </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card onClick={() => setView('devices')} className="cursor-pointer hover:border-blue-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-blue-600/10 text-blue-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Monitor size={20} />
          </div>
          <div className="font-bold text-slate-200">Устройства</div>
          <div className="text-xs text-slate-500 mt-1">{devices.length} активно</div>
        </Card>
        <Card onClick={() => setView('referral')} className="cursor-pointer hover:border-green-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <UserPlus size={20} />
          </div>
          <div className="font-bold text-slate-200">Рефералы</div>
          <div className="text-xs text-slate-500 mt-1">Заработать ₽</div>
        </Card>
        <Card onClick={() => setView('promo')} className="cursor-pointer hover:border-purple-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Gift size={20} />
          </div>
          <div className="font-bold text-slate-200">Промокод</div>
          <div className="text-xs text-slate-500 mt-1">Активировать</div>
        </Card>
        <Card onClick={() => window.open(SUPPORT_URL, '_blank')} className="cursor-pointer hover:border-orange-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Globe size={20} />
          </div>
          <div className="font-bold text-slate-200">Поддержка</div>
          <div className="text-xs text-slate-500 mt-1">Чат в Telegram</div>
        </Card>
      </div>

      <Card className="mt-3 !py-3 px-4 flex flex-col items-center justify-center gap-2 min-h-[80px]">
         <div className="text-slate-500 text-[10px] font-bold uppercase tracking-widest">О проекте</div>
         <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-slate-400">
            <button onClick={() => window.open('https://t.me/blinvpn', '_blank')} className="hover:text-blue-400 transition-colors">Наш канал</button>
            <button onClick={() => openDoc("Договор оферты", publicPages.offer)} className="hover:text-blue-400 transition-colors">Договор оферты</button>
            <button onClick={() => openDoc("Политика конфиденциальности", publicPages.privacy)} className="hover:text-blue-400 transition-colors">Политика конфиденциальности</button>
         </div>
      </Card>
    </div>
  );

  const WizardView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header 
        title={
            wizardStep === 1 ? "Выберите устройство" : 
            wizardStep === 2 ? "Настройка тарифа" : 
            wizardStep === 3 ? "Подтверждение" : "Настройка"
        } 
        onBack={() => {
            if (wizardStep === 1) setView('home');
            else setWizardStep(prev => prev - 1);
        }} 
      />

      {wizardStep === 1 && (
        <div className="flex-1">
            <p className="text-slate-400 text-sm mb-6 text-center">На каком устройстве вы планируете использовать VPN?</p>
            <div className="grid grid-cols-2 gap-4">
                {PLATFORMS.map(p => (
                    <button 
                        key={p.id}
                        onClick={() => { setWizardPlatform(p.id); setWizardStep(2); }}
                        className="bg-slate-800 border-2 border-slate-700 hover:border-blue-500 hover:bg-slate-750 p-6 rounded-2xl flex flex-col items-center gap-4 transition-all"
                    >
                        <div className="text-slate-300">{p.icon}</div>
                        <span className="font-bold text-white">{p.name}</span>
                    </button>
                ))}
            </div>
        </div>
      )}

      {wizardStep === 2 && (
        <div className="flex-1 flex flex-col">
            <div className="bg-slate-800 p-1 rounded-xl flex gap-1 mb-6">
                <button 
                onClick={() => setWizardType('vpn')} 
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    wizardType === 'vpn' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                >
                VPN
                </button>
                <button 
                onClick={() => setWizardType('whitelist')} 
                className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                    wizardType === 'whitelist' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
                }`}
                >
                Обход белых списков
                </button>
            </div>

            {wizardType === 'vpn' ? (
                <div className="space-y-3">
                    <p className="text-slate-400 text-sm mb-2">Выберите период защиты для <b>{PLATFORMS.find(p => p.id === wizardPlatform)?.name}</b>:</p>
                    {(VPN_PLANS_DEFAULT || []).filter(plan => !plan.isTrial || !isTrialUsed).map(plan => (
                        <div 
                            key={plan.id}
                            onClick={() => { setWizardPlan(plan); setWizardStep(3); }}
                            className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer flex justify-between items-center ${
                                plan.isTrial ? 'border-purple-500 bg-purple-900/20' : 
                                (plan.highlight ? 'border-amber-500/50 bg-gradient-to-r from-amber-900/20 to-transparent' : 'border-slate-800 bg-slate-800/50 hover:border-slate-600')
                            }`}
                        >
                            <div>
                                <div className={`font-bold text-lg ${plan.highlight ? 'text-amber-400 flex items-center gap-2' : 'text-white'}`}>
                                    {plan.duration}
                                    {plan.highlight && <Crown size={18} fill="currentColor" />}
                                </div>
                                {plan.isTrial && <div className="text-xs text-purple-300">Попробуйте бесплатно</div>}
                            </div>
                            <div className="text-right">
                                <div className={`font-bold text-xl ${plan.highlight ? 'text-amber-400' : 'text-white'}`}>{plan.price} ₽</div>
                                <ChevronRight size={20} className="text-slate-500 ml-auto mt-1" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex-1 flex flex-col">
                    <p className="text-slate-400 text-sm mb-4">Настройте объем трафика для обхода белых списков:</p>
                    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 mb-6">
                        <div className="flex justify-between items-end mb-4">
                        <span className="text-slate-300 font-medium">Объем трафика</span>
                        <div className="flex items-baseline gap-1">
                            <input 
                                type="number" 
                                value={whitelistGB}
                                onChange={(e) => {
                                    let val = Number(e.target.value);
                                    if (val > 500) val = 500;
                                    if (val < 0) val = 0;
                                    setWhitelistGB(val);
                                }}
                                onBlur={() => {
                                  let val = whitelistGB;
                                  if(val < 5) val = 5; 
                                  if(val > 500) val = 500;
                                  setWhitelistGB(val);
                                }}
                                className="w-20 bg-slate-900 border border-slate-600 rounded-lg p-2 text-right text-white font-bold focus:border-blue-500 outline-none"
                            />
                            <span className="text-slate-500 font-bold">ГБ</span>
                        </div>
                        </div>
                        
                        <div className="relative w-full h-6 flex items-center">
                            <input 
                                type="range" 
                                min="5" 
                                max="500"
                                value={whitelistGB}
                                onChange={(e) => setWhitelistGB(Number(e.target.value))}
                                className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer z-20 opacity-0"
                            />
                            <div className="w-full h-2 bg-slate-700 rounded-lg absolute overflow-hidden">
                                <div 
                                    className="h-full bg-blue-600 rounded-lg" 
                                    style={{ width: `${((whitelistGB - 5) / 495) * 100}%` }}
                                ></div>
                            </div>
                            <div 
                                className="w-6 h-6 bg-white rounded-full shadow-lg absolute pointer-events-none transition-transform"
                                style={{ left: `calc(${((whitelistGB - 5) / 495) * 100}% - 12px)` }}
                            ></div>
                        </div>

                        <div className="flex justify-between text-xs text-slate-500 mt-2">
                        <span>5 ГБ</span> 
                        <span>500 ГБ</span>
                        </div>
                    </div>

                    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-4">
                        <div className="flex justify-between items-center mb-2">
                            <div>
                                <div className="text-slate-400 text-sm">Абонентская плата</div>
                            </div>
                            <div className="text-lg font-bold text-white">100 ₽</div>
                        </div>
                        <div className="flex justify-between items-center mb-2">
                            <div>
                                <div className="text-slate-400 text-sm">Трафик ({whitelistGB} ГБ × 15₽)</div>
                            </div>
                            <div className="text-lg font-bold text-white">{whitelistGB * 15} ₽</div>
                        </div>
                        <div className="border-t border-slate-700 pt-2 flex justify-between items-center">
                            <div>
                                <div className="text-slate-300 text-sm font-bold">Итого</div>
                            </div>
                            <div className="text-2xl font-bold text-white">{calculateWhitelistPrice(whitelistGB)} ₽</div>
                        </div>
                    </div>

                    <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-6">
                        <div className="text-sm text-slate-400 mb-3 font-bold">Автоплатежи:</div>
                        <>
                            {savedPaymentMethods.length > 0 && (
                                    <div className="mb-3 space-y-2">
                                        {savedPaymentMethods.map((method) => (
                                            <div key={method.id} className="flex items-center justify-between p-3 bg-slate-900 rounded-lg border border-slate-700">
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="radio"
                                                        name="saved_payment"
                                                        checked={selectedPaymentMethodId === method.payment_method_id}
                                                        onChange={() => {
                                                            setSelectedPaymentMethodId(method.payment_method_id);
                                                            setUseAutoPay(true);
                                                        }}
                                                        className="w-4 h-4 text-blue-600"
                                                    />
                                                    <div>
                                                        <div className="text-white font-medium">
                                                            {method.card_brand || 'Карта'} *{method.card_last4 || '****'}
                                                        </div>
                                                        <div className="text-xs text-slate-500">Сохраненная карта</div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={async (e) => {
                                                        e.stopPropagation();
                                                        if (window.confirm('Удалить сохраненную карту?')) {
                                                            try {
                                                                await miniApiFetch(`/user/payment-methods/${method.id}?telegram_id=${telegramId}`, {
                                                                    method: 'DELETE'
                                                                });
                                                                setSavedPaymentMethods(prev => prev.filter(m => m.id !== method.id));
                                                                if (selectedPaymentMethodId === method.payment_method_id) {
                                                                    setSelectedPaymentMethodId(null);
                                                                    setUseAutoPay(false);
                                                                }
                                                            } catch (e) {
                                                                console.error('Failed to delete payment method', e);
                                                            }
                                                        }
                                                    }}
                                                    className="text-red-400 hover:text-red-300 p-1"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <label className="flex items-center justify-between cursor-pointer">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useAutoPay && !selectedPaymentMethodId ? 'bg-blue-600 border-blue-600' : 'border-slate-500'}`}>
                                            {useAutoPay && !selectedPaymentMethodId && <CheckCircle size={14} className="text-white" />}
                                        </div>
                                        <div>
                                            <div className="text-white font-medium">Сохранить карту для автоплатежей</div>
                                            <div className="text-xs text-slate-500">При следующей оплате карта будет сохранена</div>
                                        </div>
                                    </div>
                                    <input 
                                        type="checkbox" 
                                        className="hidden" 
                                        checked={useAutoPay && !selectedPaymentMethodId} 
                                        onChange={() => {
                                            if (!selectedPaymentMethodId) {
                                                setUseAutoPay(!useAutoPay);
                                            }
                                        }}
                                    />
                                </label>
                        </>
                    </div>

                    <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl mb-6 flex gap-3 items-start">
                        <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
                        <div className="text-red-400 text-xs leading-relaxed">
                            Обход белых списков является эксперементальной функцией и может быть нестабильным в некоторых регионах!
                        </div>
                    </div>

                    <Button onClick={() => {
                        if (whitelistGB < 5) setWhitelistGB(5);
                        setWizardStep(3);
                    }}>Продолжить</Button>
                </div>
            )}
        </div>
      )}

      {wizardStep === 3 && (
        <div className="flex-1 flex flex-col">
            <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 mb-6 text-center">
                <div className="text-slate-400 mb-2">Вы подключаете</div>
                <div className="text-2xl font-bold text-white mb-6">
                    {wizardType === 'vpn' ? wizardPlan?.duration : `Whitelist (${whitelistGB} ГБ)`}
                    {wizardType !== 'vpn' && useAutoPay && <div className="text-sm text-blue-400 mt-1">+ Автоплатежи</div>}
                </div>
                
                <div className="border-t border-slate-700 pt-4 flex justify-between items-center">
                    <span className="text-slate-400">Стоимость:</span>
                    <span className="text-xl font-bold text-white">
                        {wizardType === 'vpn' ? wizardPlan?.price : calculateWhitelistPrice(whitelistGB)} ₽
                    </span>
                </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl mb-6 flex gap-3 items-start">
                <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={18} />
                <div className="text-yellow-400 text-xs leading-relaxed">
                    <strong>Важно:</strong> 1 подписка может использоваться только на 1 устройстве. При попытке использовать на нескольких устройствах одновременно подписка будет заблокирована.
                </div>
            </div>

            <div className="mt-auto">
                <div className="flex justify-between items-center mb-4 text-sm">
                    <span className="text-slate-400">Ваш баланс:</span>
                    <span className={`${balance < (wizardType === 'vpn' ? (wizardPlan?.price || 0) : calculateWhitelistPrice(whitelistGB)) ? 'text-red-400' : 'text-green-400'} font-bold`}>{balance} ₽</span>
                </div>

                {balance >= (wizardType === 'vpn' ? (wizardPlan?.price || 0) : calculateWhitelistPrice(whitelistGB)) ? (
                    <Button onClick={wizardActivate} variant={wizardType === 'vpn' && wizardPlan?.isTrial ? 'trial' : 'primary'}>
                        {wizardType === 'vpn' && wizardPlan?.isTrial ? 'Активировать бесплатно' : 'Оплатить и подключить'}
                    </Button>
                ) : (
                    <Button onClick={() => {
                        const price = wizardType === 'vpn' ? (wizardPlan?.price || 0) : calculateWhitelistPrice(whitelistGB);
                        setPendingAction({
                            type: 'wizard',
                            payload: { wizardType, wizardPlan, whitelistGB, useAutoPay, selectedPaymentMethodId, price, name: wizardType === 'vpn' ? `VPN (${wizardPlan?.duration})` : `Whitelist (${whitelistGB} ГБ)` }
                        });
                        setTopupAmount(price - balance);
                        setTopupStep(1); 
                        setView('topup');
                    }}>
                        Пополнить на {(wizardType === 'vpn' ? (wizardPlan?.price || 0) : calculateWhitelistPrice(whitelistGB)) - balance} ₽
                    </Button>
                )}
            </div>
        </div>
      )}

      {wizardStep === 4 && (
        <div className="flex-1 flex flex-col h-full">
            <div className="text-center mb-6">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto mb-4">
                    <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold text-white">Успешно!</h2>
                <p className="text-slate-400">Подписка активирована. Настройте ваше устройство:</p>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-800/50 rounded-2xl p-4 border border-slate-700">
                {INSTRUCTIONS[wizardPlatform].steps.map((step, idx) => (
                    <div key={idx} className="relative pl-6 border-l-2 border-slate-700 pb-6 last:border-0 last:pb-0">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-slate-900 border-2 border-blue-500"></div>
                        <h3 className="font-bold text-white text-md mb-1 leading-none">{step.title}</h3>
                        <p className="text-slate-400 text-xs mb-3 leading-relaxed">{step.desc}</p>
                        
                        {step.actions && (
                            <div className="flex flex-col gap-2">
                            {step.actions.map((action, aIdx) => (
                                <button
                                key={aIdx}
                                onClick={async () => {
                                    if (action.type === 'copy_key') {
                                        // Получаем ключ первого активного устройства или показываем сообщение
                                        const activeDevice = devices.find(d => d.id);
                                        if (activeDevice && deviceKeys.has(activeDevice.id)) {
                                            handleCopy('', activeDevice.id);
                                        } else {
                                            alert('У вас нет активных устройств с ключами. Сначала создайте подписку.');
                                        }
                                    } else if (action.type === 'trigger_add') {
                                        // Открываем Happ с зашифрованной ссылкой
                                        await openHappWithSubscription();
                                    } else if (action.url) {
                                        window.open(action.url, '_blank');
                                    }
                                }}
                                className={`py-2 px-3 rounded-lg text-xs font-semibold text-center transition-colors ${
                                    action.primary 
                                    ? 'bg-blue-600 text-white hover:bg-blue-500' 
                                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
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

  const DevicesView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="Мои устройства" onBack={() => setView('home')} />
      <div className="flex-1 space-y-4">
        {devices.map(device => (
          <div key={device.id} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-slate-300">
                  {device.type === 'ios' || device.type === 'android' ? <Smartphone size={20} /> : <Monitor size={20} />}
                </div>
                <div>
                  <div className="font-bold text-white">{device.name}</div>
                  <div className="text-xs text-slate-500">Добавлен: {device.added}</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => openEditModal(device)}
                  className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:text-white hover:bg-blue-600 transition-colors"
                >
                  <Edit2 size={16} />
                </button>
                <button 
                  onClick={() => openDeleteModal(device)}
                  className="p-2 rounded-lg bg-slate-700 text-slate-300 hover:text-white hover:bg-red-600 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            <button 
              onClick={() => { setActivePlatform(device.type); setView('instruction_view'); }}
              className="w-full bg-slate-700/50 hover:bg-slate-700 py-2 rounded-lg text-sm text-blue-400 flex items-center justify-center gap-2 transition-colors border border-slate-600/50"
            >
              <BookOpen size={16} /> Инструкция по подключению
            </button>
          </div>
        ))}
        {devices.length === 0 && (
          <div className="text-center py-10 text-slate-500">Нет подключенных устройств</div>
        )}
      </div>
      <div className="mt-6 mb-4">
        <Button onClick={() => { setWizardStep(1); setWizardPlan(null); setWizardType('vpn'); setView('wizard'); }}>
          <Plus size={20} /> Добавить устройство
        </Button>
      </div>
    </div>
  );

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
               <div className="text-slate-400 text-sm mb-2">Введите или выберите сумму</div>
               <div className="text-5xl font-bold text-white tracking-tight">
                 {topupAmount > 0 ? topupAmount : 0}<span className="text-slate-600 text-3xl ml-1">₽</span>
               </div>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-6">
              {PRESET_AMOUNTS.map(amount => (
                <button
                  key={amount}
                  onClick={() => { setTopupAmount(amount); setCustomAmount(''); }}
                  className={`py-4 rounded-xl text-sm font-bold transition-all border ${
                    topupAmount === amount 
                    ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/40 transform scale-105' 
                    : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  {amount} ₽
                </button>
              ))}
            </div>
            
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">₽</span>
              <input
                type="number"
                placeholder="Другая сумма..."
                value={customAmount}
                onChange={(e) => { 
                  setCustomAmount(e.target.value); 
                  setTopupAmount(Number(e.target.value)); 
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl p-4 pl-10 text-white focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-slate-600"
              />
            </div>
          </div>
          
          <div className="mt-6 mb-4">
            <Button 
              disabled={!topupAmount || topupAmount < 50 || topupAmount > 100000}
              onClick={() => {
                if (topupAmount < 50) {
                  alert('Минимальная сумма пополнения: 50₽');
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
             <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-6 space-y-2">
                <div className="flex justify-between items-center text-sm">
                   <span className="text-slate-400">Сумма:</span>
                   <span className="text-white">{topupAmount} ₽</span>
                </div>
                {selectedMethod && (
                  <div className="flex justify-between items-center text-sm">
                     <span className="text-slate-400">Комиссия ({
                        (() => {
                            const method = paymentMethods.find(m => m.id === selectedMethod);
                            if (method?.variants && selectedVariant) {
                                return method.variants.find(v => v.id === selectedVariant)?.feePercent;
                            }
                            return method?.feePercent;
                        })()
                     }%):</span>
                     <span className="text-slate-300">+{
                        (() => {
                           const total = getPaymentTotal();
                           return (total - topupAmount).toFixed(1).replace(/\.0$/, '');
                        })()
                     } ₽</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t border-slate-700 font-bold text-lg">
                   <span className="text-white">Итого к оплате:</span>
                   <span className="text-blue-400">{getPaymentTotal()} ₽</span>
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
                      ? 'bg-blue-600/10 border-blue-600 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{method.icon}</span>
                      <span className="font-medium text-left">
                        <div className="leading-tight">{method.name}</div>
                        <div className="text-xs text-slate-500 font-normal mt-0.5">
                           {method.variants ? 'Выберите провайдера' : (method.feePercent === 0 ? 'Без комиссии' : `Комиссия ${method.feePercent}%`)}
                        </div>
                      </span>
                    </div>
                    {selectedMethod === method.id && <CheckCircle size={22} className="text-blue-500 fill-blue-500/20" />}
                  </button>
                  
                  {selectedMethod === method.id && method.variants && (
                      <div className="mt-2 pl-12 pr-4 pb-2 animate-in slide-in-from-top-2">
                          <select 
                            value={selectedVariant || ''}
                            onChange={(e) => setSelectedVariant(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-sm text-white focus:border-blue-500 outline-none"
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
                  let methodKey = 'yookassa';
                  if (selectedMethod === 'crypto') methodKey = 'heleket';
                  if (selectedMethod === 'sbp' && selectedVariant === 'platega') methodKey = 'platega';

                  // Проверяем, нужно ли сохранить способ оплаты (только для YooKassa, не для крипты)
                  const savePaymentMethod = selectedMethod !== 'crypto' && useAutoPay && !selectedPaymentMethodId;
                  
                  const res = await miniApiFetch('/payment/create', {
                    method: 'POST',
                    body: JSON.stringify({
                      user_id: userId,
                      amount: total,
                      method: methodKey,
                      provider: selectedVariant,
                      save_payment_method: savePaymentMethod
                    }),
                  });

                  // Если способ оплаты сохранен, обновляем список
                  if (res.payment_method_id && res.payment_method_saved) {
                    // Перезагружаем список сохраненных способов оплаты
                    const methods = await miniApiFetch(`/user/payment-methods?telegram_id=${telegramId}`);
                    if (Array.isArray(methods)) {
                      setSavedPaymentMethods(methods);
                    }
                  }

                  const payUrl = res.confirmation_url || res.payment_url;
                  if (payUrl) {
                    window.open(payUrl, '_blank');
                  }
                  setView('wait_payment');
                } catch (e) {
                  console.error(e);
                  alert('Не удалось создать платёж, попробуйте другой метод');
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

  const BuyDeviceView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="Новое подключение" onBack={() => setView('devices')} />
      
      <div className="bg-slate-800 p-1 rounded-xl flex gap-1 mb-6">
        <button 
          onClick={() => setBuyTab('vpn')} 
          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
            buyTab === 'vpn' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          VPN
        </button>
        <button 
          onClick={() => setBuyTab('whitelist')} 
          className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
            buyTab === 'whitelist' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
          }`}
        >
          Обход белых списков
        </button>
      </div>

      {buyTab === 'vpn' ? (
        <div className="flex-1 flex flex-col">
           <div className="text-center py-10 opacity-70">
                <p className="mb-4">Для подключения VPN мы рекомендуем использовать мастер настройки.</p>
                <Button onClick={() => { setWizardStep(1); setWizardPlan(null); setView('wizard'); }}>
                    Открыть мастер подключения
                </Button>
           </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          <div className="text-sm text-slate-400 mb-3 px-1 uppercase font-bold tracking-wider">Настройка трафика</div>
          
          <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 mb-6">
            <div className="flex justify-between items-end mb-4">
               <span className="text-slate-300 font-medium">Объем трафика</span>
               <div className="flex items-baseline gap-1">
                  <input 
                    type="number" 
                    value={whitelistGB}
                    onChange={(e) => {
                        let val = Number(e.target.value);
                        if (val > 500) val = 500;
                        if (val < 0) val = 0;
                        setWhitelistGB(val);
                    }}
                    onBlur={() => {
                      let val = whitelistGB;
                      if (val < 5) val = 5;
                      if (val > 500) val = 500;
                      setWhitelistGB(val);
                    }}
                    className="w-20 bg-slate-900 border border-slate-600 rounded-lg p-2 text-right text-white font-bold focus:border-blue-500 outline-none"
                  />
                  <span className="text-slate-500 font-bold">ГБ</span>
               </div>
            </div>
            
            <div className="relative w-full h-6 flex items-center">
                <input 
                    type="range" 
                    min="5" 
                    max="500" 
                    value={whitelistGB}
                    onChange={(e) => setWhitelistGB(Number(e.target.value))}
                    className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer z-20 opacity-0"
                />
                <div className="w-full h-2 bg-slate-700 rounded-lg absolute overflow-hidden">
                    <div 
                        className="h-full bg-blue-600 rounded-lg" 
                        style={{ width: `${((whitelistGB - 5) / 495) * 100}%` }}
                    ></div>
                </div>
                <div 
                    className="w-6 h-6 bg-white rounded-full shadow-lg absolute pointer-events-none transition-transform"
                    style={{ left: `calc(${((whitelistGB - 5) / 495) * 100}% - 12px)` }}
                ></div>
            </div>

            <div className="flex justify-between text-xs text-slate-500 mt-2">
              <span>5 ГБ</span>
              <span>500 ГБ</span>
            </div>
          </div>

          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-4 flex justify-between items-center">
             <div>
               <div className="text-slate-400 text-sm">Стоимость</div>
               <div className="text-xs text-slate-500">Прогрессивная цена</div>
             </div>
             <div className="text-2xl font-bold text-white">{calculateWhitelistPrice(whitelistGB)} ₽</div>
          </div>

          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-6">
             <div className="text-sm text-slate-400 mb-3 font-bold">Автоплатежи:</div>
             <label className="flex items-center justify-between cursor-pointer">
                 <div className="flex items-center gap-3">
                     <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${useAutoPay && !selectedPaymentMethodId ? 'bg-blue-600 border-blue-600' : 'border-slate-500'}`}>
                         {useAutoPay && !selectedPaymentMethodId && <CheckCircle size={14} className="text-white" />}
                     </div>
                     <div>
                         <div className="text-white font-medium">Сохранить карту для автоплатежей</div>
                         <div className="text-xs text-slate-500">Рекуррентные платежи</div>
                     </div>
                 </div>
                 <input type="checkbox" className="hidden" checked={useAutoPay && !selectedPaymentMethodId} onChange={() => {
                     if (!selectedPaymentMethodId) {
                         setUseAutoPay(!useAutoPay);
                     }
                 }} />
             </label>
          </div>

          <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-xl mb-6 flex gap-3 items-start">
              <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
              <div className="text-red-400 text-xs leading-relaxed">
                  Обход белых списков является эксперементальной функцией и может быть нестабильным в некоторых регионах!
              </div>
          </div>

          <div className="mt-auto pb-4 pt-4 border-t border-slate-800">
             <div className="flex justify-between items-center mb-4 text-sm">
               <span className="text-slate-400">Ваш баланс:</span>
               <span className={`${balance < calculateWhitelistPrice(whitelistGB) ? 'text-red-400' : 'text-green-400'} font-bold`}>{balance} ₽</span>
             </div>
             <Button 
                onClick={buyWhitelist}
                variant={balance < calculateWhitelistPrice(whitelistGB) ? "secondary" : "primary"}
             >
                {balance < calculateWhitelistPrice(whitelistGB)
                    ? "Недостаточно средств" 
                    : `Купить за ${calculateWhitelistPrice(whitelistGB)} ₽`
                }
             </Button>
             {balance < calculateWhitelistPrice(whitelistGB) && (
               <button onClick={() => { setTopupAmount(calculateWhitelistPrice(whitelistGB) - balance); setTopupStep(1); setView('topup'); }} className="w-full mt-3 text-blue-500 text-sm font-medium hover:underline">
                 Пополнить баланс
               </button>
             )}
          </div>
        </div>
      )}
    </div>
  );
  
  const PaymentWaitView = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] animate-in zoom-in duration-300 text-center px-4">
      <div className="w-20 h-20 rounded-full bg-blue-600/10 flex items-center justify-center mb-6 relative">
        <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"></div>
        <div className="font-bold text-blue-500 text-lg">...</div>
      </div>
      <h2 className="text-2xl font-bold text-white mb-2">Ожидание оплаты</h2>
      <p className="text-slate-400 mb-8 max-w-xs">
        Перейдите по ссылке оплаты и завершите платеж. После успешного зачисления баланс обновится автоматически.
      </p>
      <Button onClick={async () => {
        const oldBalance = balance;
        await refreshUserData();
        // Если баланс изменился - добавляем в историю
        if (balance !== oldBalance) {
          addHistoryItem('deposit', 'Пополнение баланса', balance - oldBalance);
        }
        setView('home');
      }}>
        Проверить оплату
      </Button>
      <button onClick={() => setView('home')} className="mt-4 text-slate-500 text-sm hover:text-slate-300">
        Отменить
      </button>
    </div>
  );

  const PaymentSuccessView = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] animate-in zoom-in duration-500 text-center px-4">
      <div className="w-24 h-24 rounded-full bg-green-500/20 flex items-center justify-center mb-6 text-green-500">
        <CheckCircle size={48} />
      </div>
      <h2 className="text-3xl font-bold text-white mb-2">Успешно!</h2>
      <p className="text-slate-400 mb-8">Баланс пополнен на {topupAmount} ₽.</p>
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

  const InstructionView = () => {
    const currentInstr = INSTRUCTIONS[activePlatform] || INSTRUCTIONS['android'];

    return (
      <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
        <Header title="Настройка" onBack={() => setView('devices')} />

        <div className="mb-6 relative">
          <label className="text-xs text-slate-500 mb-2 block uppercase font-bold tracking-wider">Ваша платформа</label>
          <div className="relative">
            <select 
              value={activePlatform}
              onChange={(e) => setActivePlatform(e.target.value as PlatformId)}
              className="w-full appearance-none bg-slate-800 border border-slate-700 text-white py-3 pl-4 pr-10 rounded-xl focus:outline-none focus:border-blue-500"
            >
              {Object.entries(INSTRUCTIONS).map(([key, data]) => (
                <option key={key} value={key}>{data.title}</option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <ChevronDown size={18} />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-8 space-y-6">
          <div className="bg-blue-600/10 border border-blue-600/20 p-4 rounded-xl flex gap-3 mb-6">
             <div className="text-blue-500 mt-0.5"><CheckCircle size={20} /></div>
             <div>
               <div className="font-bold text-blue-400 text-sm">Устройство готово</div>
               <div className="text-blue-400/70 text-xs">Следуйте инструкции ниже для подключения.</div>
             </div>
          </div>

          {currentInstr.steps.map((step, idx) => (
            <div key={idx} className="relative pl-6 border-l-2 border-slate-700 pb-2 last:border-0">
              <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-slate-900 border-2 border-blue-500"></div>
              <h3 className="font-bold text-white text-lg mb-2 leading-none">{step.title}</h3>
              <p className="text-slate-400 text-sm mb-4 leading-relaxed">{step.desc}</p>
              
              {step.actions && (
                <div className="flex flex-col gap-2">
                  {step.actions.map((action, aIdx) => (
                    <button
                      key={aIdx}
                      onClick={async () => {
                        if (action.type === 'copy_key') {
                          // Получаем ключ устройства для текущей платформы
                          const deviceForPlatform = devices.find(d => d.type === activePlatform);
                          if (deviceForPlatform && deviceKeys.has(deviceForPlatform.id)) {
                            handleCopy('', deviceForPlatform.id);
                          } else {
                            alert('У вас нет активных устройств с ключами для этой платформы. Сначала создайте подписку.');
                          }
                        } else if (action.type === 'nav_android') {
                          setActivePlatform('android');
                        } else if (action.type === 'nav_ios') {
                          setActivePlatform('ios');
                        } else if (action.type === 'trigger_add') {
                          // Открываем Happ с зашифрованной ссылкой
                          await openHappWithSubscription();
                        } else if (action.url) {
                          window.open(action.url, '_blank');
                        }
                      }}
                      className={`py-3 px-4 rounded-xl text-sm font-semibold text-center transition-colors ${
                        action.primary 
                        ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 border border-blue-600/30' 
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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

  const HistoryView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="История" onBack={() => setView('home')} />
      <div className="space-y-3">
        {history.map(item => (
          <div key={item.id} className="bg-slate-800/50 p-4 rounded-xl border border-slate-800 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center ${item.amount > 0 ? 'bg-green-500/10 text-green-500' : (item.amount < 0 ? 'bg-red-500/10 text-red-500' : 'bg-slate-700 text-slate-400')}`}>
                {item.amount > 0 ? <Download size={18} /> : (item.amount < 0 ? <LogOut size={18} /> : <Clock size={18} />)}
              </div>
              <div>
                <div className="font-medium text-slate-200">{item.title}</div>
                <div className="text-xs text-slate-500">{item.date}</div>
              </div>
            </div>
            <div className={`font-bold ${item.amount > 0 ? 'text-green-500' : (item.amount < 0 ? 'text-slate-200' : 'text-slate-400')}`}>
              {item.amount > 0 ? '+' : ''}{item.amount !== 0 ? formatMoney(item.amount) : '0 ₽'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const ReferralDetailView = () => {
    if (!selectedReferral) return null;
    return (
     <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
        <Header title={selectedReferral.name} onBack={() => setView('referral')} />
        
        <div className="grid grid-cols-2 gap-4 mb-6">
           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="text-xs text-slate-400 mb-1">Потратил всего</div>
              <div className="text-xl font-bold text-white">{selectedReferral.spent} ₽</div>
           </div>
           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="text-xs text-slate-400 mb-1">Вы получили</div>
              <div className="text-xl font-bold text-green-500">+{selectedReferral.myProfit} ₽</div>
           </div>
        </div>

        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">История операций</h3>
        <div className="space-y-3">
           {selectedReferral.history.length > 0 ? selectedReferral.history.map((h, idx) => (
              <div key={idx} className="bg-slate-800/50 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                 <div>
                    <div className="font-medium text-slate-200">{h.action}</div>
                    <div className="text-xs text-slate-500">{h.date}</div>
                 </div>
                 <div className="text-right">
                    <div className="text-slate-300">{h.sum} ₽</div>
                    <div className="text-xs text-green-500 font-bold">+{h.profit} ₽</div>
                 </div>
              </div>
           )) : (
              <div className="text-slate-500 text-center py-4">Нет операций</div>
           )}
        </div>
     </div>
    );
  };

  const ReferralView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="Реферальная программа" onBack={() => setView('home')} />
      
      <div className="bg-gradient-to-br from-green-900/40 to-slate-900 border border-green-500/20 p-6 rounded-2xl mb-6 text-center">
        <div className="text-slate-400 text-sm mb-1">Доступно для вывода</div>
        <div className="text-4xl font-bold text-green-500 mb-4">{formatMoney(referrals.earned)}</div>
        
        <button 
          onClick={openWithdrawModal}
          className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-full font-bold text-sm shadow-lg shadow-green-900/40 mb-4 transition-transform active:scale-95"
        >
          Вывести средства
        </button>

        <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
          <div>
            <div className="text-xl font-bold text-white">{referrals.count}</div>
            <div className="text-xs text-slate-500">Приглашено</div>
          </div>
          <div>
            <div className="text-xl font-bold text-white">20%</div>
            <div className="text-xs text-slate-500">Ваш доход</div>
          </div>
        </div>
      </div>

      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 mb-6">
        <label className="text-xs text-slate-500 mb-2 block uppercase font-bold tracking-wider">Ваша ссылка</label>
        <div className="flex gap-2">
          <div className="bg-slate-900 flex-1 p-3 rounded-lg text-slate-300 font-mono text-sm truncate">
            {telegramId ? `https://t.me/${BOT_USERNAME_MINI}?start=ref${telegramId}` : 'Загрузка...'}
          </div>
          <button
            onClick={() => {
              if (telegramId) {
                handleCopy(`https://t.me/${BOT_USERNAME_MINI}?start=ref${telegramId}`);
              }
            }}
            className="bg-blue-600 px-4 rounded-lg text-white hover:bg-blue-500"
          >
            <Copy size={18} />
          </button>
        </div>
      </div>
      
      <div>
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">Приглашенные пользователи</h3>
        <div className="space-y-2 pb-6">
          {referralList.length === 0 ? (
            <div className="text-center py-8 bg-slate-800/30 rounded-xl border border-slate-800">
              <UserPlus size={32} className="text-slate-600 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">У вас пока нет рефералов</p>
              <p className="text-slate-600 text-xs mt-1">Поделитесь ссылкой выше, чтобы приглашать друзей</p>
            </div>
          ) : (
            referralList.map(user => (
              <button 
                 key={user.id} 
                 onClick={() => { setSelectedReferral(user); setView('referral_detail'); }}
                 className="w-full bg-slate-800/50 border border-slate-800 p-3 rounded-xl flex justify-between items-center hover:bg-slate-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-400">
                    <User size={14} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-slate-200">{user.name}</div>
                    <div className="text-[10px] text-slate-500">{user.date}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                   <div className="text-right">
                     <div className="text-xs text-slate-500">Доход</div>
                     <div className="text-sm font-bold text-green-500">+{user.myProfit} ₽</div>
                   </div>
                   <ChevronRight size={16} className="text-slate-600" />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const PromoView = () => {
    const [code, setCode] = useState('');
    return (
      <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
        <Header title="Промокод" onBack={() => setView('home')} />
        <div className="flex-1 flex flex-col justify-center items-center px-4 pb-20">
          <div className="w-20 h-20 bg-purple-500/10 rounded-full flex items-center justify-center text-purple-500 mb-6">
            <Gift size={40} />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Активация бонуса</h2>
          <p className="text-slate-400 text-center text-sm mb-8">
            Введите промокод для получения скидки.
          </p>
          <input 
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PROMO2025"
            className="w-full bg-slate-800 border border-slate-600 rounded-xl p-4 text-center text-2xl font-mono text-white tracking-widest uppercase focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none mb-4 placeholder:text-slate-700"
          />
          <Button 
            disabled={!code} 
            onClick={async () => {
              if (!userId) {
                alert('Пользователь не загружен, попробуйте позже');
                return;
              }
              try {
                const res = await miniApiFetch('/promocode/apply', {
                  method: 'POST',
                  body: JSON.stringify({ user_id: userId, code }),
                });
                if (res.success) {
                  alert(res.message || 'Промокод успешно применён');
                  // Обновим баланс и реферальную статистику
                  if (telegramId) {
                    const data = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
                    setBalance(data.balance ?? balance);
                    setReferrals({
                      count: data.referrals_count ?? referrals.count,
                      earned: data.referral_earned ?? referrals.earned,
                    });
                  }
                } else {
                  alert(res.error || 'Промокод не найден');
                }
              } catch (e) {
                console.error(e);
                alert('Ошибка применения промокода');
              } finally {
                setCode('');
              }
            }}
          >
            Активировать
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-md mx-auto bg-black min-h-screen relative text-slate-200 font-sans selection:bg-blue-500/30">
      <div className="p-4 min-h-screen flex flex-col">
        {view === 'home' && <HomeView />}
        {view === 'wizard' && <WizardView />}
        {view === 'topup' && <TopUpView />}
        {view === 'wait_payment' && <PaymentWaitView />}
        {view === 'success_payment' && <PaymentSuccessView />}
        {view === 'devices' && <DevicesView />}
        {view === 'buy_device' && <BuyDeviceView />}
        {view === 'instruction_view' && <InstructionView />}
        {view === 'history' && <HistoryView />}
        {view === 'referral' && <ReferralView />}
        {view === 'referral_detail' && <ReferralDetailView />}
        {view === 'promo' && <PromoView />}
      </div>
      
      {/* MODALS */}
      
      <Modal 
        title="Изменить имя" 
        isOpen={editModalOpen} 
        onClose={() => setEditModalOpen(false)}
      >
        <div className="space-y-4">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:border-blue-500 outline-none"
            placeholder="Название устройства"
            autoFocus
          />
          <Button onClick={saveDeviceName}>Сохранить</Button>
        </div>
      </Modal>

      <Modal 
        title="Удалить устройство" 
        isOpen={deleteModalOpen} 
        onClose={() => setDeleteModalOpen(false)}
      >
        <div className="space-y-4">
          <p className="text-slate-300">
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
            <div className="text-sm text-slate-400">Доступно: <span className="text-green-500 font-bold">{referrals.earned} ₽</span></div>
            <input
              type="number"
              placeholder="Сумма вывода"
              value={withdrawState.amount}
              onChange={(e) => setWithdrawState({ ...withdrawState, amount: e.target.value })}
              className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:border-blue-500 outline-none"
            />
            <Button onClick={handleWithdrawNext}>Далее</Button>
          </div>
        )}

        {withdrawState.step === 2 && (
          <div className="space-y-3">
            <div className="text-sm text-slate-400 mb-2">Выберите метод:</div>
            {WITHDRAW_METHODS.map(method => (
              <button
                key={method.id}
                onClick={() => setWithdrawState({ ...withdrawState, method: method.id })}
                disabled={Number(withdrawState.amount) < method.min && method.min > 0}
                className={`w-full p-4 rounded-xl flex items-center justify-between transition-all border ${
                  withdrawState.method === method.id
                  ? 'bg-blue-600/10 border-blue-600 text-white'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-750 disabled:opacity-50 disabled:cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-slate-300">
                    {method.icon}
                  </div>
                  <div className="text-left">
                    <div className="font-medium">{method.name}</div>
                    {method.min > 0 && Number(withdrawState.amount) < method.min && (
                      <div className="text-xs text-red-400">Мин. сумма {method.min} ₽</div>
                    )}
                  </div>
                </div>
                {withdrawState.method === method.id && <CheckCircle size={20} className="text-blue-500" />}
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
              <p className="text-slate-300 text-center">
                Средства будут зачислены на ваш внутренний баланс моментально.
              </p>
            )}
            
            {withdrawState.method === 'card' && (
              <>
                <div className="text-sm text-slate-400 mb-2">Заполните реквизиты:</div>
                <input
                  type="tel"
                  placeholder="+7 9xx xxx xx xx"
                  value={withdrawState.phone}
                  onChange={(e) => setWithdrawState({ ...withdrawState, phone: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white mb-2 focus:border-blue-500 outline-none"
                />
                <input
                  type="text"
                  placeholder="Название банка (Сбер, Тинькофф...)"
                  value={withdrawState.bank}
                  onChange={(e) => setWithdrawState({ ...withdrawState, bank: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:border-blue-500 outline-none"
                />
              </>
            )}

            {withdrawState.method === 'crypto' && (
              <>
                <div className="text-sm text-slate-400 mb-2">Реквизиты кошелька:</div>
                <input
                  type="text"
                  placeholder="Сеть (TRC-20, BEP-20...)"
                  value={withdrawState.cryptoNet}
                  onChange={(e) => setWithdrawState({ ...withdrawState, cryptoNet: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white mb-2 focus:border-blue-500 outline-none"
                />
                <input
                  type="text"
                  placeholder="Адрес кошелька"
                  value={withdrawState.cryptoAddr}
                  onChange={(e) => setWithdrawState({ ...withdrawState, cryptoAddr: e.target.value })}
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl p-3 text-white focus:border-blue-500 outline-none font-mono text-sm"
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
            <p className="text-slate-400 text-sm mb-6">
              {withdrawState.method === 'balance' 
                ? 'Средства зачислены на ваш баланс.' 
                : 'Если нарушений нет, средства поступят в течение 3-х рабочих дней.'}
            </p>
            <Button onClick={() => setWithdrawModalOpen(false)}>Отлично</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
