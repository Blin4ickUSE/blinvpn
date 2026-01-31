import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Smartphone, Monitor, Tv, CreditCard, History, 
  UserPlus, Gift, ChevronLeft, Copy, Trash2, Edit2, 
  CheckCircle, Clock, Globe, Shield, Zap, Plus, Sparkles,
  LogOut, Download, Apple, Command, User, ChevronDown, 
  ArrowRight, Frown, BookOpen, Crown, ChevronRight, Wallet, Sliders, X,
  Rocket, AlertTriangle, FileText, ExternalLink, MessageCircle
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
  
  // Обработка бана (статус 403)
  if (res.status === 403) {
    try {
      const data = await res.json();
      if (data.banned) {
        return { _banned: true, reason: data.reason || 'Аккаунт заблокирован' };
      }
    } catch {}
    throw new Error('Access denied');
  }
  
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
  key_uuid?: string;
  short_uuid?: string;
  key_status?: string;
  days_left?: number;
  hours_left?: number;
  is_expired?: boolean;
  expiry_date?: string;
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
  title: string;
  type: string;
  amount: number;
  income: number;
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

// Единые тарифы подписки (VPN + Обход блокировок в одном)
// Загружаются из API, fallback на дефолтные
const VPN_PLANS_DEFAULT: Plan[] = [
  { id: 'trial', duration: 'Пробный период', price: 0, highlight: false, days: 1, isTrial: true },
  { id: '1m', duration: '1 месяц', price: 199, highlight: false, days: 30 },
  { id: '3m', duration: '3 месяца', price: 499, highlight: false, days: 90 },   // -15%, вместо 597₽
  { id: '6m', duration: '6 месяцев', price: 899, highlight: true, days: 180 },  // -25%, вместо 1194₽ 👑
  { id: '1y', duration: '1 год', price: 1499, highlight: false, days: 365 },    // -35%, вместо 2388₽
];

const PRESET_AMOUNTS = [100, 250, 500, 1000, 2000, 5000];

// Платежные методы загружаются из API с комиссиями, но оставляем дефолтные
// ВРЕМЕННО: только СБП через YooKassa
const PAYMENT_METHODS_DEFAULT: PaymentMethod[] = [
  // КАРТА ВРЕМЕННО ОТКЛЮЧЕНА
  // { 
  //   id: 'card', 
  //   name: 'Банковская карта', 
  //   icon: '💳', 
  //   feePercent: 0  
  // },
  { 
    id: 'sbp', 
    name: 'СБП', 
    icon: '⚡', 
    feePercent: 0, 
    variants: [
      { id: 'platega_sbp', name: '⭐ | Platega', feePercent: 0 },
      { id: 'yookassa_sbp', name: 'YooKassa', feePercent: 0 }
    ]
  },
  { 
    id: 'card', 
    name: 'Банковская карта', 
    icon: '💳', 
    feePercent: 0, 
    variants: [
      { id: 'platega_card', name: 'Platega', feePercent: 0 }
    ]
  },
  // КРИПТОВАЛЮТА ОТКЛЮЧЕНА
  // { 
  //   id: 'crypto', 
  //   name: 'Криптовалюта', 
  //   icon: '🪙', 
  //   feePercent: 0 
  // },
];

const WITHDRAW_METHODS = [
  { id: 'balance', name: 'На баланс', icon: <Wallet size={20} />, min: 1 },
  { id: 'card', name: 'На карту', icon: <CreditCard size={20} />, min: 200 },
  // КРИПТОВАЛЮТА ОТКЛЮЧЕНА
  // { id: 'crypto', name: 'Криптокошелек', icon: <img src="https://cryptologos.cc/logos/tether-usdt-logo.svg?v=026" className="w-5 h-5 invert" alt="USDT" />, min: 200 },
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
  const baseStyle = "w-full py-3.5 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed ripple";
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
    <button onClick={onClick} className={`${baseStyle} ${variants[variant]} ripple ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div onClick={onClick} className={`bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-5 card-hover ${className}`}>
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

  // Ban Status
  const [isBanned, setIsBanned] = useState(false);
  const [banReason, setBanReason] = useState<string>('');

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
    phone: '', 
    bank: '', 
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
  const [wizardStep, setWizardStep] = useState(1); // 1: Platform, 2: Plan (VPN/Whitelist), 3: Payment/Confirm, 4: Instructions
  const [wizardPlatform, setWizardPlatform] = useState<PlatformId>('android');
  const [wizardPlan, setWizardPlan] = useState<Plan | null>(null);
  const [wizardType] = useState<'vpn'>('vpn'); // Единая подписка
  const [useAutoPay, setUseAutoPay] = useState(false);
  const [savedPaymentMethods, setSavedPaymentMethods] = useState<any[]>([]);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState<string | null>(null);

  // Buy Device State (legacy, kept for compatibility)
  
  // Extend subscription state - для продления существующего ключа
  const [extendingDevice, setExtendingDevice] = useState<Device | null>(null);
  const [extendPlan, setExtendPlan] = useState<Plan | null>(null); 
  
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
        
        // Проверяем бан
        if (userData && userData._banned) {
          setIsBanned(true);
          setBanReason(userData.reason || 'Аккаунт заблокирован');
          return; // Не загружаем остальные данные
        }
        
        if (userData) {
          setUserId(userData.id);
          setBalance(userData.balance || 0);
          setUsername(userData.username || `User_${tgId}`);
          // Обновляем displayName: full_name из API или первоначальное значение
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
          
          // Показываем онбординг для новых пользователей (без устройств и ключей)
          const onboardingShown = localStorage.getItem(`onboarding_${tgId}`);
          if (!onboardingShown && !userData.trial_used && userData.balance === 0) {
            setShowOnboarding(true);
          }
        }

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
              { id: 'trial', duration: 'Пробный тариф', price: 0, highlight: true, days: 1, isTrial: true }
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
          added: d.added,
          key_uuid: d.key_uuid,
          short_uuid: d.short_uuid,
          key_status: d.key_status,
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

  const openEditModal = (device: Device) => {
    setCurrentDevice(device);
    setNewName(device.name);
    setEditModalOpen(true);
  };

  const saveDeviceName = async () => {
    if (!newName || newName.trim() === '' || !currentDevice || !telegramId) return;
    
    try {
      const result = await miniApiFetch(`/user/devices/${currentDevice.id}/name?telegram_id=${telegramId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: newName.trim() })
      });
      
      if (result && result.success) {
        // Обновляем локально
        setDevices(prev => prev.map(d => d.id === currentDevice.id ? { ...d, name: result.name || newName.trim() } : d));
        setEditModalOpen(false);
        setCurrentDevice(null);
      } else {
        alert(result?.error || 'Не удалось изменить имя');
      }
    } catch (e) {
      console.error('Failed to save device name', e);
      alert('Ошибка при сохранении имени');
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
    const { step, amount, method } = withdrawState;
    const numAmount = Number(amount);

    if (step === 1) {
      if (!amount || numAmount <= 0) return alert("Введите сумму");
      if (numAmount > referrals.partnerBalance) return alert("Недостаточно средств на реферальном балансе");
      setWithdrawState(prev => ({ ...prev, step: 2 }));
    } else if (step === 2) {
      if (!method) return alert("Выберите метод");
      if (method === 'card' || method === 'crypto') {
        if (numAmount < 200) return alert("Минимальная сумма вывода на карту/крипто - 200₽");
        
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
          if (!withdrawState.phone || !withdrawState.bank) return alert("Заполните все поля");
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
            setLastCardWithdrawal(new Date().toISOString());
            addHistoryItem('ref_req', 'Заявка на вывод (Карта)', 0);
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
    const price = plan.price;
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
          payload: { device, plan, price, name: `Продление VPN (${plan.duration})` }
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

    const price = wizardPlan.price;
    const name = `Подписка (${wizardPlan.duration})`;

    if (balance < price) {
      if(window.confirm(`Недостаточно средств. Пополнить баланс на ${price - balance} ₽?`)) {
        setPendingAction({
            type: 'wizard',
            payload: { wizardType: 'vpn', wizardPlan, price, name }
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
              <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 text-xs font-bold border border-red-500/20">
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
          
          <div className="w-full space-y-3">
            <Button 
                onClick={() => { setWizardStep(1); setWizardPlan(null); setView('wizard'); }}
                className="w-full"
            >
                <Shield size={20} /> Подключить VPN
            </Button>
            
            {!isTrialUsed && (
                <div className="text-center">
                    <span className="text-xs text-blue-300 font-medium bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">
                        🎁 Первые 24 часа бесплатно
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
            {devices.length > 0 && (
              <button 
                onClick={() => setView('devices')}
                className="w-full mb-4 py-3 px-4 bg-slate-800/80 hover:bg-slate-700 border border-slate-600 rounded-xl flex items-center justify-between transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Smartphone size={20} className="text-blue-400" />
                  <span className="text-white font-medium">Мои устройства</span>
                  <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">{devices.length}</span>
                </div>
                <ChevronRight size={20} className="text-slate-400" />
              </button>
            )}
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
            {/* Информация о единой подписке */}
            <div className="bg-gradient-to-r from-blue-500/20 to-purple-500/20 border border-blue-500/30 rounded-2xl p-4 mb-5">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
                        <Shield size={20} className="text-white" />
                    </div>
                    <div className="flex-1">
                        <div className="font-bold text-white text-sm mb-1">Единая подписка</div>
                        <div className="text-blue-200/80 text-xs leading-relaxed">
                            VPN + Обход блокировок операторов в одном тарифе. Работает везде!
                        </div>
                    </div>
                </div>
            </div>

            <p className="text-slate-400 text-sm mb-4">Выберите период подписки:</p>
            
            <div className="space-y-3">
                {(vpnPlans || VPN_PLANS_DEFAULT).filter(plan => !plan.isTrial || !isTrialUsed).map((plan) => (
                    <div 
                        key={plan.id}
                        onClick={() => { setWizardPlan(plan); setWizardStep(3); }}
                        className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer flex justify-between items-center card-hover ${
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
                            {plan.id === '3m' && <div className="text-xs text-green-400">-15% экономия</div>}
                            {plan.id === '6m' && <div className="text-xs text-amber-400">-25% экономия</div>}
                            {plan.id === '1y' && <div className="text-xs text-green-400">-35% экономия</div>}
                        </div>
                        <div className="text-right">
                            <div className={`font-bold text-xl ${plan.highlight ? 'text-amber-400' : 'text-white'}`}>{plan.price} ₽</div>
                            <ChevronRight size={20} className="text-slate-500 ml-auto mt-1" />
                        </div>
                    </div>
                ))}
            </div>
            
            {/* Что включено */}
            <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mt-6 space-y-2">
                <div className="text-white font-semibold text-sm mb-2">Что включено:</div>
                <div className="flex items-center gap-2">
                    <CheckCircle className="text-green-400 shrink-0" size={16} />
                    <span className="text-slate-300 text-xs">Безлимитный трафик</span>
                </div>
                <div className="flex items-center gap-2">
                    <CheckCircle className="text-green-400 shrink-0" size={16} />
                    <span className="text-slate-300 text-xs">Обход блокировок операторов</span>
                </div>
                <div className="flex items-center gap-2">
                    <CheckCircle className="text-green-400 shrink-0" size={16} />
                    <span className="text-slate-300 text-xs">Работает при «Беспилотной опасности»</span>
                </div>
            </div>
        </div>
      )}

      {wizardStep === 3 && (
        <div className="flex-1 flex flex-col">
            <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 mb-6 text-center">
                <div className="text-slate-400 mb-2">Вы подключаете</div>
                <div className="text-2xl font-bold text-white mb-6">
                    Подписка на {wizardPlan?.duration}
                </div>
                
                <div className="border-t border-slate-700 pt-4 flex justify-between items-center">
                    <span className="text-slate-400">Стоимость:</span>
                    <span className="text-xl font-bold text-white">
                        {wizardPlan?.price} ₽
                    </span>
                </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-xl mb-6 flex gap-3 items-start">
                <AlertTriangle className="text-yellow-500 shrink-0 mt-0.5" size={18} />
                <div className="text-yellow-400 text-xs leading-relaxed">
                    <strong>Важно:</strong> 1 подписка = 1 устройство. При использовании на нескольких устройствах одновременно подписка будет заблокирована.
                </div>
            </div>

            <div className="mt-auto">
                <div className="flex justify-between items-center mb-4 text-sm">
                    <span className="text-slate-400">Ваш баланс:</span>
                    <span className={`${balance < (wizardPlan?.price || 0) ? 'text-red-400' : 'text-green-400'} font-bold`}>{balance} ₽</span>
                </div>

                {balance >= (wizardPlan?.price || 0) ? (
                    <Button onClick={wizardActivate} variant={wizardPlan?.isTrial ? 'trial' : 'primary'}>
                        {wizardPlan?.isTrial ? 'Активировать бесплатно' : 'Оплатить и подключить'}
                    </Button>
                ) : (
                    <Button onClick={() => {
                        const price = wizardPlan?.price || 0;
                        setPendingAction({
                            type: 'wizard',
                            payload: { wizardType: 'vpn', wizardPlan, price, name: `Подписка (${wizardPlan?.duration})` }
                        });
                        setTopupAmount(price - balance);
                        setTopupStep(2);
                        setView('topup');
                    }}>
                        Пополнить на {(wizardPlan?.price || 0) - balance} ₽
                    </Button>
                )}
            </div>
        </div>
      )}

      {wizardStep === 4 && (
        <div className="flex-1 flex flex-col h-full animate-fade-in">
            <div className="text-center mb-6">
                <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center text-green-500 mx-auto mb-4">
                    <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold text-white animate-slide-up">Успешно!</h2>
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
        {devices.map(device => {
          const isExpired = device.is_expired === true;
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
          <div key={device.id} className={`rounded-xl p-4 border card-hover ${isExpired ? 'bg-red-900/20 border-red-500/50' : 'bg-slate-800 border-slate-700'}`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${isExpired ? 'bg-red-900/30 text-red-400' : 'bg-slate-700 text-slate-300'}`}>
                  {device.type === 'ios' || device.type === 'android' ? <Smartphone size={20} /> : <Monitor size={20} />}
                </div>
                <div>
                  <div className="font-bold text-white">
                    {device.is_trial ? 'Пробная подписка' : 'Подписка'} | #{device.id}
                  </div>
                  {timeLeftText ? (
                    <div className={`text-xs font-medium ${isExpired ? 'text-red-400' : isLowTime ? 'text-orange-400' : isForever ? 'text-yellow-400' : 'text-slate-400'}`}>
                      {timeLeftText}
                    </div>
                  ) : (
                    <div className="text-xs text-slate-500">Бессрочно</div>
                  )}
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
            {isExpired ? (
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
              <button 
                onClick={() => { setActivePlatform(device.type); setView('instruction_view'); }}
                className="w-full bg-slate-700/50 hover:bg-slate-700 py-2 rounded-lg text-sm text-blue-400 flex items-center justify-center gap-2 transition-colors border border-slate-600/50"
              >
                <BookOpen size={16} /> Инструкция по подключению
              </button>
            )}
          </div>
        );})}
        {devices.length === 0 && (
          <div className="text-center py-10 text-slate-500">Нет подключенных устройств</div>
        )}
      </div>
      <div className="mt-6 mb-4">
        <Button onClick={() => { setWizardStep(1); setWizardPlan(null); setView('wizard'); }}>
          <Plus size={20} /> Добавить устройство
        </Button>
      </div>
    </div>
  );

  // View для продления подписки - выбор тарифа
  const ExtendSubscriptionView = () => {
    const plansForExtend = vpnPlans.filter(p => !p.isTrial); // Без триала
    
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
          <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 mb-4">
            <div className="text-slate-400 text-sm mb-1">Продление ключа</div>
            <div className="text-white font-medium">
{extendingDevice.is_trial ? 'Пробная подписка' : 'Подписка'} | #{extendingDevice.id}
            </div>
          </div>
        )}
        
        <div className="flex-1">
          <div className="text-slate-400 text-sm mb-4">Выберите период продления:</div>
          <div className="grid gap-3">
            {plansForExtend.map(plan => (
              <button
                key={plan.id}
                onClick={() => setExtendPlan(plan)}
                className={`p-4 rounded-xl text-left transition-all border ${
                  extendPlan?.id === plan.id
                    ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500'
                    : 'bg-slate-800 border-slate-700 hover:bg-slate-750'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div>
                    <div className={`font-bold ${extendPlan?.id === plan.id ? 'text-blue-400' : 'text-white'}`}>
                      {plan.duration}
                    </div>
                    <div className="text-slate-500 text-sm">{plan.days} дней</div>
                  </div>
                  <div className={`text-lg font-bold ${extendPlan?.id === plan.id ? 'text-blue-400' : 'text-slate-300'}`}>
                    {plan.price} ₽
                  </div>
                </div>
              </button>
            ))}
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
            <Zap size={18} /> Продлить за {extendPlan?.price || 0} ₽
          </Button>
        </div>
      </div>
    );
  };

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
                  onClick={() => setTopupAmount(amount)}
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
                  // Используем выбранный вариант если есть, иначе выбранный метод
                  const method = paymentMethods.find(m => m.id === selectedMethod);
                  let methodKey = selectedMethod || 'yookassa_sbp';
                  
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
                    // Открываем ссылку через Telegram API (работает на телефонах)
                    try {
                      if (window.Telegram?.WebApp?.openLink) {
                        window.Telegram.WebApp.openLink(payUrl);
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

  const BuyDeviceView = () => (
    <div className="min-h-full flex flex-col">
      <Header title="Новое подключение" onBack={() => setView('devices')} />
      
      <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
        <div className="w-20 h-20 bg-blue-600/20 rounded-full flex items-center justify-center mb-6">
          <Shield size={40} className="text-blue-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Подключите защиту</h2>
        <p className="text-slate-400 mb-6 max-w-xs">
          Единая подписка включает VPN и обход блокировок операторов
        </p>
        <Button onClick={() => { setWizardStep(1); setWizardPlan(null); setView('wizard'); }}>
          Открыть мастер подключения
        </Button>
      </div>
    </div>
  );
  
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
                    const res = await miniApiFetch('/subscription/extend', {
                      method: 'POST',
                      body: JSON.stringify({
                        user_id: currentUserId,
                        key_id: payload.device.id,
                        days: payload.plan.days,
                        price: payload.price,
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
                      }),
                    });
                    
                    if (res && res.success) {
                      addHistoryItem('buy_dev', `Подключение: ${payload.name}`, -payload.price);
                      setPendingAction(null);
                      setPaymentUrl(null);
                      setActivePlatform(wizardPlatform);
                      await refreshAll();
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
            setActivePlatform(wizardPlatform);
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
    
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] animate-in zoom-in duration-300 text-center px-4">
        <div className="w-24 h-24 rounded-full bg-gradient-to-br from-blue-600/20 to-purple-600/20 flex items-center justify-center mb-8 relative">
          <div className="absolute inset-0 rounded-full border-4 border-blue-500/50 border-t-blue-500 animate-spin"></div>
          <div className="absolute inset-2 rounded-full border-4 border-purple-500/30 border-b-purple-500 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
          <CreditCard className="text-blue-400" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3">Обрабатываем платёж...</h2>
        <p className="text-slate-400 mb-2 max-w-xs">
          {pendingAction ? 'VPN подключится автоматически после оплаты' : 'Завершите оплату в открывшемся окне'}
        </p>
        <p className="text-slate-500 text-xs mb-8">
          Страница обновится автоматически
        </p>
        {paymentUrl && (
          <Button onClick={() => {
            try {
              if (window.Telegram?.WebApp?.openLink) {
                window.Telegram.WebApp.openLink(paymentUrl);
              } else {
                window.open(paymentUrl, '_blank');
              }
            } catch {
              window.open(paymentUrl, '_blank');
            }
          }}>
            <ExternalLink size={18} className="mr-2" />
            Перейти к оплате
          </Button>
        )}
        <div className="mt-4 text-xs text-slate-500">
          {checking ? 'Проверка оплаты...' : 'Автоматическая проверка каждые 3 сек.'}
        </div>
        <button 
          onClick={() => window.open(SUPPORT_URL, '_blank')} 
          className="mt-4 text-blue-500 text-sm hover:text-blue-300 font-medium flex items-center gap-2"
        >
          <MessageCircle size={16} /> Связаться с поддержкой
        </button>
        <button onClick={() => { setPaymentUrl(null); setPendingAction(null); setPollingActive(false); setView('home'); }} className="mt-3 text-slate-500 text-sm hover:text-slate-300">
          Отменить
        </button>
      </div>
    );
  };

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
              <div className="text-xl font-bold text-white">{selectedReferral.spent.toFixed(2)} ₽</div>
           </div>
           <div className="bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div className="text-xs text-slate-400 mb-1">Вы получили</div>
              <div className="text-xl font-bold text-green-500">+{selectedReferral.myProfit.toFixed(2)} ₽</div>
           </div>
        </div>

        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 px-1">История операций</h3>
        <div className="space-y-3">
           {selectedReferral.history.length > 0 ? selectedReferral.history.map((h, idx) => (
              <div key={idx} className="bg-slate-800/50 p-3 rounded-xl border border-slate-800 flex justify-between items-center">
                 <div>
                    <div className="font-medium text-slate-200">{h.title}</div>
                    <div className="text-xs text-slate-500">{h.date}</div>
                 </div>
                 <div className="text-right">
                    <div className="text-slate-300">{h.amount.toFixed(2)} ₽</div>
                    <div className="text-xs text-green-500 font-bold">+{h.income.toFixed(2)} ₽</div>
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
        <div className="text-4xl font-bold text-green-500 mb-4">{referrals.partnerBalance.toFixed(2)} ₽</div>
        
        {referrals.partnerBalance > 0 ? (
          <button 
            onClick={openWithdrawModal}
            className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-full font-bold text-sm shadow-lg shadow-green-900/40 mb-4 transition-transform active:scale-95"
          >
            Вывести средства
          </button>
        ) : (
          <div className="text-slate-500 text-sm mb-4">Пригласите друзей, чтобы заработать</div>
        )}

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
                     <div className="text-sm font-bold text-green-500">+{user.myProfit.toFixed(2)} ₽</div>
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
                      partnerBalance: data.partner_balance ?? referrals.partnerBalance,
                    });
                    if (data.last_card_withdrawal) {
                      setLastCardWithdrawal(data.last_card_withdrawal);
                    }
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

  // Страница "Доступ ограничен"
  if (isBanned) {
    return (
      <div className="max-w-md mx-auto bg-black min-h-screen relative text-slate-200 font-sans selection:bg-blue-500/30">
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
            <p className="text-slate-400 mb-6 leading-relaxed">
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
            <div className="bg-slate-800/50 rounded-xl p-4 mb-6 text-left">
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Информация
              </h3>
              <ul className="text-sm text-slate-400 space-y-2">
                <li>• Администрация оставляет за собой право отказать в разблокировке</li>
                <li>• Подробности о причинах блокировки могут не предоставляться в целях защиты алгоритмов безопасности</li>
              </ul>
            </div>
            
            {/* Кнопка поддержки */}
            <a 
              href={SUPPORT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-xl text-white font-medium transition-colors"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
              </svg>
              Связаться с поддержкой
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto bg-black min-h-screen relative text-slate-200 font-sans selection:bg-blue-500/30">
      <div className="p-4 min-h-screen flex flex-col">
        {view === 'home' && <HomeView />}
        {view === 'wizard' && <WizardView />}
        {view === 'topup' && <TopUpView />}
        {view === 'wait_payment' && <PaymentWaitView />}
        {view === 'success_payment' && <PaymentSuccessView />}
        {view === 'devices' && <DevicesView />}
        {view === 'extend_subscription' && <ExtendSubscriptionView />}
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
            <div className="text-sm text-slate-400">Доступно: <span className="text-green-500 font-bold">{referrals.partnerBalance.toFixed(2)} ₽</span></div>
            {referrals.partnerBalance < 200 && (
              <div className="p-3 bg-yellow-900/20 border border-yellow-500/30 rounded-xl text-yellow-400 text-sm">
                Минимальная сумма для вывода на карту или крипто — 200₽. На баланс можно вывести любую сумму.
              </div>
            )}
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

      {/* Онбординг для новых пользователей */}
      {showOnboarding && (
        <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
          {/* Progress dots */}
          <div className="flex justify-center gap-2 pt-6 pb-4">
            {[0, 1, 2, 3].map(i => (
              <div 
                key={i} 
                className={`w-2 h-2 rounded-full transition-all ${i === onboardingStep ? 'bg-blue-500 w-6' : 'bg-slate-700'}`}
              />
            ))}
          </div>
          
          {/* Content */}
          <div className="flex-1 flex flex-col items-center justify-center px-8 text-center">
            {onboardingStep === 0 && (
              <>
                <div className="w-24 h-24 bg-blue-600/20 rounded-full flex items-center justify-center mb-6">
                  <Shield className="text-blue-500" size={48} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">Добро пожаловать!</h2>
                <p className="text-slate-400 leading-relaxed">
                  BLIN VPN — это современный и безопасный VPN-сервис. 
                  Мы поможем вам защитить ваше интернет-соединение.
                </p>
              </>
            )}
            
            {onboardingStep === 1 && (
              <>
                <div className="w-24 h-24 bg-green-600/20 rounded-full flex items-center justify-center mb-6">
                  <Gift className="text-green-500" size={48} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">Бесплатный пробный период</h2>
                <p className="text-slate-400 leading-relaxed">
                  Попробуйте VPN абсолютно бесплатно! 
                  Активируйте 24-часовой пробный период и оцените качество сервиса.
                </p>
              </>
            )}
            
            {onboardingStep === 2 && (
              <>
                <div className="w-24 h-24 bg-purple-600/20 rounded-full flex items-center justify-center mb-6">
                  <UserPlus className="text-purple-500" size={48} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">Реферальная программа</h2>
                <p className="text-slate-400 leading-relaxed">
                  Приглашайте друзей и получайте бонусы! 
                  За каждого приглашённого друга вы получите 10% от его первого пополнения.
                </p>
              </>
            )}
            
            {onboardingStep === 3 && (
              <>
                <div className="w-24 h-24 bg-yellow-600/20 rounded-full flex items-center justify-center mb-6">
                  <Rocket className="text-yellow-500" size={48} />
                </div>
                <h2 className="text-2xl font-bold text-white mb-4">Начнём!</h2>
                <p className="text-slate-400 leading-relaxed">
                  Всё готово для начала работы. 
                  Нажмите "Подключить VPN" на главном экране, чтобы настроить защиту.
                </p>
              </>
            )}
          </div>
          
          {/* Buttons */}
          <div className="px-6 pb-8 space-y-3">
            {onboardingStep < 3 ? (
              <>
                <button 
                  onClick={() => setOnboardingStep(prev => prev + 1)}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-colors"
                >
                  Далее
                </button>
                <button 
                  onClick={() => {
                    setShowOnboarding(false);
                    localStorage.setItem(`onboarding_${telegramId}`, 'true');
                  }}
                  className="w-full py-3 text-slate-500 hover:text-slate-300 transition-colors"
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
                className="w-full py-4 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-bold transition-colors"
              >
                Начать пользоваться
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
