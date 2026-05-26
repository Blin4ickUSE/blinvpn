import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Smartphone, Monitor, Tv, CreditCard, History, 
  UserPlus, Gift, ChevronLeft, Copy, Trash2, 
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
const SUPPORT_URL: string = rawEnvMini.VITE_SUPPORT_URL || rawEnvMini.REACT_APP_SUPPORT_URL || 'https://t.me/blinteambot';
const BOT_USERNAME_MINI: string = rawEnvMini.VITE_BOT_USERNAME || rawEnvMini.REACT_APP_BOT_USERNAME || 'blinvpn_bot';

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
      if (data.required_subscription) {
        return {
          _needsSubscription: true,
          channel_link: data.channel_link || 'https://t.me',
          channel_id: data.channel_id
        };
      }
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
  devices_limit?: number;
  is_trial?: boolean;
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
  lineLabel?: string;
  ratePercent?: number;
  invitedCount?: number;
  history: ReferralTransaction[];
}

interface InstructionStep {
  title: string;
  desc: string;
  actions?: {
    label: string;
    type?: 'copy_key' | 'trigger_add' | 'nav_android' | 'nav_ios' | 'copy_plain_sub';
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
**Редакция от 10.05.2026**

Настоящий документ является официальным предложением (публичной офертой) сервиса **БлинВПН** (далее — «Исполнитель») и содержит все существенные условия предоставления услуг по предоставлению удалённого доступа к сети Интернет в соответствии с Гражданским кодексом РФ (ст. 435–444 ГК РФ) и Федеральным законом «О связи» № 126-ФЗ.

### 1. ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ

**1.1. Сервис (БлинВПН)** — программно-аппаратный комплекс, предоставляющий функционал перенаправления интернет-трафика через удалённые серверы.

**1.2. Ключ доступа (Конфигурация)** — уникальный цифровой код/файл, генерируемый Сервисом, являющийся техническим средством аутентификации Пользователя в системе.

**1.3. Стороннее ПО** — программное обеспечение третьих лиц (в т.ч. приложение «Happ», V2Ray и аналоги), устанавливаемое Пользователем на своё устройство для взаимодействия с Сервисом.

**1.4. Аномальная активность** — паттерны сетевого поведения, отклоняющиеся от стандартного профиля использования (в т.ч. массовые рассылки, сканирование портов, превышение лимитов сессий).

**1.5. Тариф** — выбранный Пользователем при покупке план подписки, определяющий количество одновременно подключаемых устройств и иные параметры услуги.

**1.6. Реферальный баланс** — внутренняя расчётная единица Сервиса, начисляемая Пользователю в рамках реферальной программы. Не является денежными средствами, электронными деньгами или иным платёжным инструментом в соответствии с законодательством РФ.

**1.7. Автоплатёж** — автоматическое списание стоимости подписки с привязанного Пользователем способа оплаты.

### 2. ПРЕДМЕТ СОГЛАШЕНИЯ

**2.1.** Исполнитель предоставляет Пользователю неисключительное право (лицензию) на использование Ключа доступа к инфраструктуре Сервиса, а Пользователь обязуется оплатить данное право в соответствии с выбранным Тарифом.

**2.2.** Доступ к Сервису предоставляется по принципу **«AS IS» («КАК ЕСТЬ»)**. Исполнитель не гарантирует совместимость Сервиса с любым конкретным программным обеспечением или устройством Пользователя.

**2.3. Момент оказания услуги.** Услуга считается оказанной в полном объёме и надлежащего качества в момент автоматической отправки Ключа доступа в интерфейсе Telegram-бота. С этого момента обязательства Исполнителя по предоставлению доступа считаются исполненными.

**2.4.** Количество устройств, на которых может быть одновременно использован Ключ доступа, определяется выбранным Пользователем Тарифом на момент покупки. Конкретное значение отображается в описании Тарифа до совершения оплаты.

### 3. ТЕХНИЧЕСКИЕ УСЛОВИЯ И ОГРАНИЧЕНИЯ

**3.1. Локации и Маршруты.** Пользователю предоставляется доступ к динамическому пулу серверов. Исполнитель вправе в одностороннем порядке, без предварительного уведомления, изменять географическое расположение серверов, IP-адреса и маршруты трафика в целях оптимизации нагрузки. Наличие конкретной страны (геолокации) не гарантируется.

**3.2. Скорость соединения.** Скорость доступа к сети Интернет через Сервис не является фиксированной и зависит от нагрузки на общий (shared) канал связи, удалённости конечного ресурса и ограничений интернет-провайдера Пользователя (в т.ч. шейпинга UDP/TCP-трафика).

**3.3. Лицензионные ограничения.** Одновременное количество подключённых устройств ограничено условиями выбранного Тарифа. Система автоматически фиксирует превышение данного лимита. При выявлении нарушения Ключ блокируется автоматически без возврата средств.

**3.4. Стороннее ПО.** Исполнитель не является разработчиком клиентских приложений (Happ и др.) и не несёт ответственности за их удаление из магазинов приложений (AppStore/Google Play), сбои в их работе или некорректные обновления.

**3.5. Ограниченная совместимость с отдельными ресурсами.** Исполнитель не гарантирует доступ через Сервис к ресурсам, которые по техническим или юридическим причинам блокируют трафик VPN-серверов. Сервис не несёт ответственности за недоступность следующих категорий ресурсов и не рассматривает их недоступность как основание для возврата средств: онлайн-казино и азартные игры; сайты категории «для взрослых» (18+); букмекерские конторы; ресурсы организаций, признанных нежелательными или запрещёнными на территории РФ; ресурсы, связанные с оборотом запрещённых веществ. Факт посещения Пользователем ресурсов из перечисленных категорий фиксируется на уровне метаданных и **автоматически лишает Пользователя права на возврат средств** по любому основанию в рамках данной подписки.

### 4. АВТОПЛАТЁЖ

**4.1.** При подключении функции автоплатежа Пользователь предоставляет Исполнителю право осуществлять регулярное списание стоимости подписки с привязанного способа оплаты без дополнительного подтверждения каждой операции.

**4.2.** Исполнитель направляет уведомление о предстоящем списании не менее чем за **24 часа** до его осуществления. Фактическое списание производится по истечении данного срока вне зависимости от того, ознакомился ли Пользователь с уведомлением.

**4.3.** Списание может производиться **частями** (в том числе несколькими транзакциями), если это обусловлено техническими ограничениями платёжного шлюза или особенностями способа оплаты Пользователя.

**4.4.** Исполнитель вправе выставлять к оплате исключительно **фактически понесённые расходы** на предоставление Услуг в расчётном периоде.

**4.5.** Пользователь вправе отключить автоплатёж в любой момент через интерфейс бота до момента отправки уведомления о предстоящем списании.

### 5. РЕГЛАМЕНТ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ (SLA)

**5.1. Плановые работы.** Исполнитель вправе проводить технические работы с полной остановкой Сервиса при условии уведомления Пользователей (в канале или боте) не менее чем за 24 часа. Продолжительность плановых работ не ограничена.

**5.2. Аварийные работы.** Допускается перерыв в предоставлении Услуг без предварительного уведомления общей продолжительностью до **100 (ста) часов в календарный месяц**. Данные перерывы не являются безусловным основанием для перерасчёта стоимости или возврата средств.

**5.3.** Блокировка доступа к Сервису со стороны государственных регуляторов (РКН) или интернет-провайдеров признаётся обстоятельством непреодолимой силы (форс-мажор) в соответствии со ст. 401 ГК РФ и исключает ответственность Исполнителя.

### 6. ПОЛИТИКА ВОЗВРАТА СРЕДСТВ (REFUND POLICY)

**6.1. Основания для возврата.**

**а) Невозможность подключения.** Если Пользователь не смог воспользоваться Сервисом по причине технической неисправности на стороне Исполнителя и Техническая поддержка не устранила проблему в течение **48 часов** с момента обращения. Пользователь обязан предоставить доказательства невозможности подключения (скриншоты, логи ошибок).

**б) Компенсация за время простоя.** Если Сервис был недоступен сверх нормы, установленной п. 5.2, Пользователь вправе потребовать пропорциональную компенсацию за подтверждённое время сверхнормативного простоя. Бремя доказывания простоя лежит на Пользователе; факт недоступности должен быть зафиксирован и передан в Техническую поддержку в течение **72 часов** с момента восстановления работы Сервиса.

**в) Отказ в течение 72 часов («период охлаждения»).** В течение 72 часов с момента первой покупки Пользователь вправе подать заявку на возврат средств без указания причины. Данная заявка **рассматривается индивидуально**: Исполнитель вправе как удовлетворить её, так и отказать в возврате по своему усмотрению, в том числе с учётом объёма потреблённого трафика, факта успешных подключений и иных обстоятельств. Повторное обращение по данному основанию не допускается.

**6.2.** Во всех иных случаях, включая (но не ограничиваясь) низкую скорость, высокий пинг, субъективное нежелание использовать Сервис, недоступность конкретных ресурсов, несовместимость со Сторонним ПО — возврат средств **не производится**.

**6.3.** Возврат средств не производится, если в ходе проверки установлено, что Пользователь посещал ресурсы, указанные в п. 3.5 настоящей Оферты.

**6.4.** Возврат средств осуществляется тем же способом, которым была произведена оплата, в течение 10 рабочих дней с момента одобрения заявки.

### 7. ОТВЕТСТВЕННОСТЬ И ПРАВИЛА ИСПОЛЬЗОВАНИЯ

**7.1. Запрещённые действия.** Пользователю категорически запрещено: использовать торрент-клиенты (P2P-протоколы, BitTorrent и аналоги); осуществлять массовые рассылки (спам); сканировать порты, IP-адреса, осуществлять DDoS-атаки; распространять Ключ доступа третьим лицам (перепродажа, публичный доступ); использовать Сервис для действий, запрещённых законодательством Российской Федерации (в т.ч. УК РФ, КоАП РФ).

**7.2. Санкции за нарушения.** При выявлении нарушений (в т.ч. автоматическими алгоритмами анализа трафика) доступ к Услуге **приостанавливается**. Срок действия подписки в период приостановки **не продлевается и не замораживается**.

**7.3. Порядок обжалования.** Пользователь вправе подать апелляцию в Техническую поддержку в течение **7 (семи) календарных дней** с момента блокировки. Бремя доказывания отсутствия нарушений лежит на Пользователе. Администрация оставляет за собой право отказать в разблокировке без раскрытия подробностей о причинах — в целях защиты алгоритмов безопасности Сервиса.

**7.4. Чарджбэк (Chargeback).** В случае если Пользователь инициирует процедуру принудительного возврата средств через банк или платёжную систему (chargeback) без предварительного обращения в Техническую поддержку Сервиса, либо в случае признания чарджбэка необоснованным — доступ Пользователя к Сервису и Telegram-боту **блокируется навсегда** без права восстановления.

### 8. РЕФЕРАЛЬНАЯ ПРОГРАММА

**8.1.** Реферальный баланс является **внутренней расчётной единицей** Сервиса. Он не является денежными средствами, электронными деньгами, вкладом или иным финансовым инструментом. Пользователь не вносит денежные средства на реферальный баланс — он формируется исключительно за счёт начислений Исполнителя.

**8.2.** Исполнитель оставляет за собой право в любой момент без предварительного уведомления: изменять процент вознаграждения по реферальной программе; приостанавливать или полностью отключать реферальную программу для отдельного Пользователя или всех Пользователей; аннулировать начисленный Реферальный баланс полностью или частично; **отказать в выплате** средств с Реферального баланса без объяснения причин.

**8.3.** Исполнитель вправе отказать в выплате Реферального баланса в случае, если в действиях Пользователя выявлены признаки недобросовестного использования реферальной программы, в том числе: самореферирование (регистрация повторных учётных записей с целью начисления вознаграждения самому себе), использование автоматизированных средств генерации переходов, создание фиктивных подписок, а также иные действия, направленные на искусственное увеличение начислений в обход установленного порядка.

**8.4.** Участие в реферальной программе не порождает у Пользователя каких-либо имущественных прав требования к Исполнителю.

### 9. ОТВЕТСТВЕННОЕ ИСПОЛЬЗОВАНИЕ И СООТВЕТСТВИЕ ЗАКОНОДАТЕЛЬСТВУ РФ

**9.1.** Сервис БлинВПН функционирует на территории Российской Федерации в соответствии с действующим законодательством, в том числе с требованиями Федерального закона № 149-ФЗ «Об информации, информационных технологиях и о защите информации» и нормативными актами Роскомнадзора.

**9.2.** Сервис не предназначен и не может быть использован для обхода законно установленных ограничений доступа к информации, введённых уполномоченными государственными органами Российской Федерации на основании судебных решений или иных правовых актов.

**9.3.** Пользователь самостоятельно несёт ответственность за законность своих действий при использовании Сервиса в соответствии с нормами УК РФ, КоАП РФ и иными применимыми нормативными актами. Исполнитель не является соисполнителем, пособником или организатором противоправных действий Пользователя.

### 10. ЗАКЛЮЧИТЕЛЬНЫЕ ПОЛОЖЕНИЯ

**10.1.** Исполнитель вправе в одностороннем порядке вносить изменения в настоящую Оферту. Новая редакция вступает в силу с момента её публикации. Продолжение использования Сервиса после публикации изменений означает согласие Пользователя с обновлёнными условиями.

**10.2.** Оплата Услуг означает полное и безоговорочное согласие Пользователя с условиями настоящей Оферты (акцепт оферты в соответствии со ст. 438 ГК РФ).

**10.3.** Все споры решаются в претензионном порядке; срок ответа на претензию — 30 календарных дней. При невозможности урегулирования — в судебном порядке по месту нахождения Исполнителя.
`;

const PRIVACY_POLICY_TEXT = `
**Редакция от 10.05.2026**

Настоящая Политика конфиденциальности разработана в соответствии с требованиями Федерального закона № 152-ФЗ «О персональных данных» и регламентирует порядок сбора, обработки и хранения данных пользователей сервиса БлинВПН.

### 1. ОБЩИЕ ПОЛОЖЕНИЯ

**1.1.** Настоящая Политика регламентирует порядок сбора, обработки и хранения технических данных пользователей сервиса БлинВПН.

**1.2.** Основным приоритетом Сервиса является минимизация хранимых персональных данных при обеспечении технической стабильности и безопасности сети.

**1.3.** Используя Сервис, Пользователь выражает согласие на обработку данных, предусмотренных настоящей Политикой, в соответствии со ст. 9 Федерального закона № 152-ФЗ.

### 2. СОСТАВ СОБИРАЕМЫХ ДАННЫХ

Сервис **не осуществляет** сбор, хранение или анализ содержимого интернет-трафика Пользователя (Deep Packet Inspection), истории посещённых веб-ресурсов или содержания переписки.

**2.1. Идентификационные данные платформы:** уникальный идентификатор пользователя Telegram (Telegram ID); имя пользователя (Username); история обращений в службу поддержки (включая переданные скриншоты и логи ошибок).

**2.2. Технические данные сессий:** учёт входящих и исходящих пакетов данных (в байтах) для контроля лимитов и выявления аномальной нагрузки; временны́е метки сессий, категории запрашиваемых ресурсов (на уровне домена/IP, без содержимого) — в целях применения условий п. 3.5 Оферты; хешированные данные об устройстве (HWID) или уникальные «отпечатки» клиента (Fingerprint) — исключительно в целях соблюдения лимита устройств по Тарифу и предотвращения перепродажи Ключей.

**2.3. Платёжные данные:** ID транзакции, сумма, метод оплаты. Полные данные банковских карт Сервисом не обрабатываются и не хранятся (обработка производится на стороне платёжных шлюзов).

**2.4. Реферальные данные:** история начислений и выплат Реферального баланса, связанные с Пользователем идентификаторы рефералов.

### 3. ЦЕЛИ ОБРАБОТКИ И ХРАНЕНИЯ

**3.1.** Автоматическая выдача и ротация цифровых ключей, контроль лимитов устройств по Тарифу.

**3.2.** Мониторинг нагрузки на сеть и предотвращение аномальной активности.

**3.3.** Выявление нарушений Условий использования (сканирование портов, спам-активность, P2P-трафик) на основе анализа метаданных.

**3.4.** Фиксация фактов посещения категорий ресурсов, указанных в п. 3.5 Оферты, — в целях применения условий об ограничении права на возврат средств.

**3.5.** Исполнение обязательств по автоплатежу и учёт Реферального баланса.

### 4. ПЕРЕДАЧА ДАННЫХ И ВЗАИМОДЕЙСТВИЕ С ТРЕТЬИМИ ЛИЦАМИ

**4.1.** Сервис не передаёт данные третьим лицам в коммерческих или маркетинговых целях.

**4.2.** Раскрытие накопленных метаданных государственным органам возможно исключительно при наличии вступившего в законную силу судебного акта, оформленного в соответствии с процессуальным законодательством РФ и врученного Администрации Сервиса надлежащим образом.

**4.3.** В целях обработки платежей данные передаются платёжным шлюзам, с которыми у Исполнителя заключены соответствующие соглашения о конфиденциальности.

### 5. СРОКИ ХРАНЕНИЯ ДАННЫХ

**5.1.** Технические данные сессий хранятся в течение **90 календарных дней** с момента завершения подписки, после чего удаляются.

**5.2.** Данные обращений в службу поддержки хранятся в течение **1 года**.

**5.3.** Платёжные метаданные хранятся в течение срока, предусмотренного применимым законодательством РФ о бухгалтерском учёте.

**5.4.** В отношении заблокированных Пользователей (в т.ч. по основанию чарджбэка) данные могут храниться бессрочно — в целях предотвращения повторной регистрации.

### 6. ПРАВА ПОЛЬЗОВАТЕЛЯ

**6.1.** В соответствии с Федеральным законом № 152-ФЗ Пользователь вправе: запросить сведения об обрабатываемых персональных данных; потребовать исправления неточных данных; потребовать удаления данных (за исключением случаев, когда обработка необходима для исполнения договора или соблюдения законодательных требований).

**6.2.** Для реализации прав необходимо обратиться в Техническую поддержку через Telegram-бот.

### 7. ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ

**7.1.** Пользователь осознаёт, что использование сети Интернет сопряжено с рисками. Сервис не несёт ответственности за перехват данных, произошедший на устройстве Пользователя или на узлах сети, не контролируемых Сервисом.

**7.2.** Сервис не несёт ответственности за последствия использования Стороннего ПО, в т.ч. утечку данных через клиентские приложения третьих лиц.

### 8. ФАЙЛЫ COOKIE И ВЕБ-ТЕХНОЛОГИИ ОТСЛЕЖИВАНИЯ

**8.1.** Настоящий раздел применяется к веб-сайту Сервиса (если таковой используется Пользователем) и не распространяется на взаимодействие с Сервисом исключительно через Telegram-бот.

**8.2.** При посещении веб-сайта Сервиса могут использоваться следующие категории файлов cookie: **необходимые (технические)** — обеспечивают базовое функционирование сайта, не требуют согласия и не могут быть отключены; **аналитические** — собирают обезличенную статистику посещений, устанавливаются только при наличии согласия Пользователя; **функциональные** — запоминают пользовательские настройки, устанавливаются только при наличии согласия Пользователя.

**8.3.** Сервис **не использует** рекламные, маркетинговые или кросс-сайтовые cookie, а также не передаёт данные cookie рекламным сетям или агрегаторам.

**8.4.** Пользователь вправе управлять настройками cookie через встроенные инструменты браузера или через баннер управления согласием при первом посещении сайта. Срок хранения аналитических и функциональных cookie не превышает **12 месяцев**.

### 9. ИЗМЕНЕНИЕ ПОЛИТИКИ

**9.1.** Исполнитель вправе в одностороннем порядке вносить изменения в настоящую Политику. Актуальная редакция всегда доступна через интерфейс Telegram-бота. Продолжение использования Сервиса после публикации изменений означает согласие Пользователя с обновлённой Политикой.
`;

// Единые тарифы подписки (VPN + Обход блокировок в одном)
// Загружаются из API, fallback на дефолтные
const VPN_PLANS_DEFAULT: Plan[] = [
  { id: 'trial', duration: 'Пробный период', price: 0, highlight: false, days: 3, isTrial: true },
  { id: '1m', duration: '1 месяц', price: 99, highlight: false, days: 30 },
  { id: '3m', duration: '3 месяца', price: 249, highlight: false, days: 90 },
  { id: '6m', duration: '6 месяцев', price: 449, highlight: true, days: 180 },
  { id: '1y', duration: '1 год', price: 799, highlight: false, days: 365 },
];

const PRESET_AMOUNTS = [100, 250, 500, 1000, 2000, 5000];

const PLAN_EXTRA_DEVICE_PRICE: Record<number, number> = {
  30: 50,
  90: 150,
  180: 300,
  365: 600,
};

function normalizedDevicesCount(devices: number): number {
  return Math.max(2, Math.min(20, Math.floor(devices)));
}

function computePlanPrice(plan: Plan, devices: number): number {
  if (plan.isTrial) return 0;
  const d = normalizedDevicesCount(devices);
  const extra = PLAN_EXTRA_DEVICE_PRICE[plan.days] ?? 50;
  return plan.price + (d - 1) * extra;
}

// Платежные методы загружаются из API с комиссиями, но оставляем дефолтные
const PAYMENT_METHODS_DEFAULT: PaymentMethod[] = [
  {
    id: 'rollypay_sbp',
    name: 'СБП',
    icon: <img src="https://i.imgur.com/pu9w7tE.png" className="w-8 h-8 object-contain" alt="СБП" />,
    feePercent: 7
  },
  { id: 'platega_card_ru', name: 'Российские карты', icon: <img src="https://i.imgur.com/CE6Q9yJ.png" className="w-8 h-8 object-contain" alt="МИР" />, feePercent: 8 },
  { id: 'platega_card_intl', name: 'Иностранные карты', icon: <img src="https://upload.wikimedia.org/wikipedia/commons/2/2a/Mastercard-logo.svg" className="w-8 h-8 object-contain" alt="Card" />, feePercent: 15 },
  {
    id: 'tg_stars',
    name: 'Telegram Stars',
    icon: <img src="https://i.imgur.com/Yu8PZ7N.png" className="w-8 h-8 object-contain" alt="Telegram Stars" />,
    feePercent: 0
  },
  {
    id: 'heleket',
    name: 'Криптовалюта',
    icon: <img src="https://i.imgur.com/bdC3E81.png" className="w-8 h-8 object-contain rounded-md" alt="Heleket" />,
    feePercent: 1
  },
  {
    id: 'cryptopay',
    name: 'CryptoBot',
    icon: <img src="https://i.imgur.com/gmtauym.png" className="w-8 h-8 object-contain rounded-md" alt="CryptoBot" />,
    feePercent: 3
  },
];

const WITHDRAW_METHODS = [
  { id: 'balance', name: 'На баланс', icon: <Wallet size={20} />, min: 1 },
  { id: 'card', name: 'На карту РФ', icon: <CreditCard size={20} />, min: 1000 },
  { id: 'cryptobot', name: 'CryptoBot', icon: <img src="https://cryptologos.cc/logos/tether-usdt-logo.svg?v=026" className="w-5 h-5 invert" alt="USDT" />, min: 10 },
  { id: 'crypto', name: 'Криптовалюта', icon: <img src="https://cryptologos.cc/logos/tether-usdt-logo.svg?v=026" className="w-5 h-5 invert" alt="USDT" />, min: 300 },
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
        title: '2. Добавление подписки',
        desc: 'Нажмите кнопку ниже — подписка добавится в приложение автоматически.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
        ]
      },
      {
        title: '3. Настройка',
        desc: 'В приложении обновите подписку и подключитесь.'
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
        title: '2. Добавление подписки',
        desc: 'Нажмите кнопку ниже — подписка добавится в приложение автоматически.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
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
        title: '2. Добавление подписки',
        desc: 'Нажмите кнопку ниже — подписка добавится в приложение автоматически.',
        actions: [
          { label: 'Добавить подписку', type: 'trigger_add', primary: true }
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

/** Инструкции: обычный режим или «другое устройство» (ссылка без шифрования). TV — только обычный. */
function getInstructionSteps(platformId: PlatformId, plainSecondDevice: boolean): InstructionStep[] {
  const pack = INSTRUCTIONS[platformId] || INSTRUCTIONS.android;
  if (!plainSecondDevice || platformId === 'androidtv') {
    return pack.steps;
  }
  switch (platformId) {
    case 'android':
      return [
        pack.steps[0],
        {
          title: '2. Ссылка подписки',
          desc: 'Скопируйте ссылку ниже — она понадобится в приложении Happ.',
          actions: [{ label: 'Скопировать ссылку', type: 'copy_plain_sub', primary: true }],
        },
        {
          title: '3. Вставка в Happ',
          desc: 'Откройте Happ, нажмите «+» вверху и выберите «Вставить из буфера обмена».',
        },
        pack.steps[2],
      ];
    case 'ios':
      return [
        pack.steps[0],
        {
          title: '2. Ссылка подписки',
          desc: 'Скопируйте ссылку ниже.',
          actions: [{ label: 'Скопировать ссылку', type: 'copy_plain_sub', primary: true }],
        },
        {
          title: '3. Вставка в Happ',
          desc: 'В приложении нажмите «+» и выберите «Вставить из буфера обмена».',
        },
        {
          title: '4. Подключение',
          desc: 'Нажмите «🔄» в Happ, выберите сервер и подключитесь.',
          actions: [{ label: 'Подключиться!', url: 'happ://connect', primary: true }],
        },
      ];
    case 'windows':
      return [
        pack.steps[0],
        {
          title: pack.steps[1].title,
          desc: 'Скопируйте ссылку подписки ниже. В Happ нажмите «+» — при необходимости вставьте ссылку из буфера.',
          actions: [{ label: 'Скопировать ссылку', type: 'copy_plain_sub', primary: true }],
        },
        pack.steps[2],
      ];
    case 'macos':
    case 'linux':
      return [
        pack.steps[0],
        {
          title: pack.steps[1].title,
          desc: 'Скопируйте ссылку подписки ниже. В Happ нажмите «+» — при необходимости вставьте ссылку из буфера.',
          actions: [{ label: 'Скопировать ссылку', type: 'copy_plain_sub', primary: true }],
        },
        {
          title: '3. Настройка',
          desc: 'В приложении обновите подписку (🔄) и подключитесь.',
        },
      ];
    default:
      return pack.steps;
  }
}

// ==========================================
// 3. UI COMPONENTS
// ==========================================

const AnimatedBackground: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="max-w-md mx-auto min-h-screen w-full relative text-zinc-200 font-sans selection:bg-orange-500/30 tg-safe-padding overflow-x-clip" style={{ background: '#000', isolation: 'isolate', paddingTop: '56px' }}>
    <style>{`
      @keyframes drift1 {
        0%   { transform: translate(0px, 0px); }
        25%  { transform: translate(30px, 50px); }
        50%  { transform: translate(-20px, 90px); }
        75%  { transform: translate(40px, 40px); }
        100% { transform: translate(0px, 0px); }
      }
      @keyframes drift2 {
        0%   { transform: translate(0px, 0px); }
        30%  { transform: translate(-40px, -60px); }
        60%  { transform: translate(20px, -100px); }
        100% { transform: translate(0px, 0px); }
      }
      .mb-orb {
        position: absolute;
        border-radius: 50%;
        pointer-events: none;
        z-index: 0;
      }
      .mb-orb-1 {
        width: 380px; height: 380px;
        top: -120px; left: -100px;
        background: radial-gradient(circle at 50% 50%,
          rgba(234,88,12,0.13) 0%,
          rgba(194,65,12,0.06) 45%,
          transparent 70%);
        filter: blur(40px);
        animation: drift1 35s ease-in-out infinite;
      }
      .mb-orb-2 {
        width: 420px; height: 420px;
        bottom: -80px; right: -140px;
        background: radial-gradient(circle at 50% 50%,
          rgba(249,115,22,0.10) 0%,
          rgba(234,88,12,0.04) 45%,
          transparent 70%);
        filter: blur(50px);
        animation: drift2 45s ease-in-out infinite;
      }
      .user-load-failed button,
      .user-load-failed a[class*="rounded"] {
        background: #3f3f46 !important;
        background-image: none !important;
        color: #71717a !important;
        box-shadow: none !important;
        border-color: #52525b !important;
        cursor: not-allowed !important;
        opacity: 0.6 !important;
      }
    `}</style>
    <div className="mb-orb mb-orb-1" />
    <div className="mb-orb mb-orb-2" />
    <div style={{ position: 'relative', zIndex: 1 }}>
      {children}
    </div>
  </div>
);

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost' | 'trial' | 'gold';
}

const Button: React.FC<ButtonProps> = ({ children, onClick, variant = 'primary', className = '', disabled = false }) => {
  const baseStyle = "w-full py-3.5 rounded-xl font-semibold transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed ripple";
  const variants = {
    primary: "bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-black/60",
    secondary: "bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800",
    outline: "border-2 border-orange-500/40 text-orange-400 hover:bg-orange-500/10",
    danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20",
    ghost: "text-zinc-400 hover:text-white hover:bg-zinc-900/80",
    trial: "bg-gradient-to-r from-purple-600 to-orange-500 text-white shadow-lg shadow-purple-900/40 hover:brightness-110",
    gold: "bg-gradient-to-r from-amber-500 to-yellow-600 text-white shadow-lg shadow-amber-900/40"
  };

  return (
    <button type="button" onClick={onClick} className={`${baseStyle} ${variants[variant]} ripple ${className}`} disabled={disabled}>
      {children}
    </button>
  );
};

const Card: React.FC<{ children: React.ReactNode, className?: string, onClick?: () => void }> = ({ children, className = '', onClick }) => (
  <div onClick={onClick} className={`bg-zinc-900 backdrop-blur-md border border-zinc-700/80 rounded-2xl p-5 card-hover ${className}`}>
    {children}
  </div>
);

const Header: React.FC<{ title: string, onBack?: () => void }> = ({ title, onBack }) => (
  <div className="flex items-center gap-3 mb-6">
    {onBack && (
      <button onClick={onBack} className="w-10 h-10 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-300 hover:text-white transition-colors">
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
      <div className={`relative bg-black border border-zinc-900 w-full max-w-sm rounded-2xl p-6 shadow-2xl shadow-orange-950/20 transform transition-all scale-100 flex flex-col ${fullHeight ? 'h-[85vh]' : 'max-h-[90vh]'}`}>
        <div className="flex justify-between items-center mb-4 shrink-0">
          <h3 className="text-xl font-bold text-white">{title}</h3>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white">
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
    <div className="space-y-3 text-zinc-300 text-sm leading-relaxed">
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
                <span className="text-orange-500 mt-1.5">•</span>
                <span>
                    {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-zinc-200">{part}</strong> : part))}
                </span>
             </div>
           );
        }
        // Paragraphs with inline bold
        const parts = line.split('**');
        return (
            <p key={idx} className={line.trim() === '' ? 'h-2' : ''}>
                {parts.map((part, pIdx) => (pIdx % 2 === 1 ? <strong key={pIdx} className="text-zinc-200">{part}</strong> : part))}
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

  // --- VIEWS ---

  const HomeView = () => (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-center py-2">
        <div className="flex items-center gap-3">
          {userPhotoUrl ? (
            <img 
              src={userPhotoUrl} 
              alt={displayName} 
              className="w-10 h-10 rounded-full object-cover shadow-lg shadow-orange-500/20"
              onError={() => setUserPhotoUrl(null)}
            />
          ) : (
            <div className="w-10 h-10 bg-zinc-900 border border-zinc-700 rounded-full flex items-center justify-center font-bold text-lg text-zinc-600 shadow-lg">
              {displayName === '???' ? '?' : displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-xs text-zinc-400 font-medium">Добро пожаловать</div>
            <div className="font-bold text-zinc-100">{displayName}</div>
          </div>
        </div>
      </div>

      <div className="relative overflow-hidden bg-gradient-to-br from-zinc-900 via-zinc-950 to-black rounded-3xl p-6 border border-zinc-700/70 shadow-2xl shadow-orange-950/30">
        <div className="relative z-10">
          <div className="flex justify-between items-start mb-2">
            <span className="text-zinc-400 text-sm font-medium flex items-center gap-2">
              <CreditCard size={14} /> Баланс счёта
            </span>
          </div>
          <div className={`text-4xl font-black mb-6 tracking-tight ${balance < 0 ? 'text-red-500' : 'text-white'}`}>
            {formatMoney(balance)}
          </div>
          <div className="flex gap-3 mb-4">
            <Button onClick={() => { setTopupStep(1); setView('topup'); }} className="flex-1">
              <Zap size={18} fill="currentColor" /> Пополнить
            </Button>
            <button onClick={() => setView('history')} className="w-14 bg-zinc-700/50 hover:bg-zinc-700 rounded-xl flex items-center justify-center text-zinc-300 border border-zinc-600 transition-colors">
              <History size={20} />
            </button>
          </div>
          
          <div className="w-full space-y-3">
            <Button 
                onClick={() => { setWizardStep(1); setWizardPlan(null); setWizardDeviceCount(2); setView('wizard'); }}
                className="w-full"
            >
                <Shield size={20} /> Подключить VPN
            </Button>
            
            {!isTrialUsed && (
                <div className="text-center">
                    <span className="text-xs text-orange-300 font-medium bg-orange-500/10 px-3 py-1 rounded-full border border-orange-500/20">
                        🎁 Первые 3 дня бесплатно
                    </span>
                </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card onClick={() => setView('devices')} className="cursor-pointer hover:border-orange-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-orange-600/10 text-orange-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Monitor size={20} />
          </div>
          <div className="font-bold text-zinc-200">Устройства</div>
          <div className="text-xs text-zinc-500 mt-1">{devices.length} активно</div>
        </Card>
        <Card onClick={() => setView('referral')} className="cursor-pointer hover:border-green-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-green-500/10 text-green-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <UserPlus size={20} />
          </div>
          <div className="font-bold text-zinc-200">Рефералы</div>
          <div className="text-xs text-zinc-500 mt-1">Заработать ₽</div>
        </Card>
        <Card onClick={() => setView('promo')} className="cursor-pointer hover:border-purple-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Gift size={20} />
          </div>
          <div className="font-bold text-zinc-200">Промокод</div>
          <div className="text-xs text-zinc-500 mt-1">Активировать</div>
        </Card>
        <Card onClick={() => window.open(SUPPORT_URL, '_blank')} className="cursor-pointer hover:border-orange-500/50 transition-colors group">
          <div className="w-10 h-10 rounded-full bg-orange-500/10 text-orange-500 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
            <Globe size={20} />
          </div>
          <div className="font-bold text-zinc-200">Поддержка</div>
          <div className="text-xs text-zinc-500 mt-1">Чат в Telegram</div>
        </Card>
      </div>

      <Card className="mt-3 !py-3 px-4 flex flex-col items-center justify-center gap-2 min-h-[80px]">
         <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest">О проекте</div>
         <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-xs font-medium text-zinc-400">
            <button onClick={() => window.open('https://t.me/blinvpn', '_blank')} className="hover:text-orange-400 transition-colors">Наш канал</button>
            <button onClick={() => openDoc("Договор оферты", publicPages.offer)} className="hover:text-orange-400 transition-colors">Договор оферты</button>
            <button onClick={() => openDoc("Политика конфиденциальности", publicPages.privacy)} className="hover:text-orange-400 transition-colors">Политика конфиденциальности</button>
         </div>
      </Card>
    </div>
  );

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

  // View для продления подписки - выбор тарифа
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

  const HistoryView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="История" onBack={() => setView('home')} />
      {history.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 mb-4">
            <Clock size={28} />
          </div>
          <div className="text-zinc-300 font-medium text-lg mb-2">История пуста</div>
          <div className="text-zinc-500 text-sm">Здесь появятся ваши пополнения и списания</div>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map(item => (
            <div key={item.id} className="bg-zinc-800/50 p-4 rounded-xl border border-zinc-800 flex justify-between items-center">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${item.amount > 0 ? 'bg-green-500/10 text-green-500' : (item.amount < 0 ? 'bg-red-500/10 text-red-500' : 'bg-zinc-700 text-zinc-400')}`}>
                  {item.amount > 0 ? <Download size={18} /> : (item.amount < 0 ? <LogOut size={18} /> : <Clock size={18} />)}
                </div>
                <div>
                  <div className="font-medium text-zinc-200">{item.title}</div>
                  <div className="text-xs text-zinc-500">{item.date}</div>
                </div>
              </div>
              <div className={`font-bold ${item.amount > 0 ? 'text-green-500' : (item.amount < 0 ? 'text-zinc-200' : 'text-zinc-400')}`}>
                {item.amount > 0 ? '+' : ''}{item.amount !== 0 ? formatMoney(item.amount) : '0 ₽'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const ReferralDetailView = () => {
    if (!selectedReferral) return null;
    return (
     <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
        <Header title={selectedReferral.name} onBack={() => setView('referral')} />
        
        <div className="grid grid-cols-2 gap-4 mb-6">
           <div className="bg-zinc-800 p-4 rounded-xl border border-zinc-700">
              <div className="text-xs text-zinc-400 mb-1">Потратил всего</div>
              <div className="text-xl font-bold text-white">{selectedReferral.spent.toFixed(2)} ₽</div>
           </div>
           <div className="bg-zinc-800 p-4 rounded-xl border border-zinc-700">
              <div className="text-xs text-zinc-400 mb-1">Вы получили</div>
              <div className="text-xl font-bold text-green-500">+{selectedReferral.myProfit.toFixed(2)} ₽</div>
           </div>
        </div>

        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 px-1">История операций</h3>
        <div className="space-y-3">
           {selectedReferral.history.length > 0 ? selectedReferral.history.map((h, idx) => (
              <div key={idx} className="bg-zinc-800/50 p-3 rounded-xl border border-zinc-800 flex justify-between items-center">
                 <div>
                    <div className="font-medium text-zinc-200">{h.title}</div>
                    <div className="text-xs text-zinc-500">{h.date}</div>
                 </div>
                 <div className="text-right">
                    <div className="text-zinc-300">{h.amount.toFixed(2)} ₽</div>
                    <div className="text-xs text-green-500 font-bold">+{h.income.toFixed(2)} ₽</div>
                 </div>
              </div>
           )) : (
              <div className="text-zinc-500 text-center py-4">Нет операций</div>
           )}
        </div>
     </div>
    );
  };

  const ReferralView = () => (
    <div className="min-h-full flex flex-col animate-in slide-in-from-right duration-300">
      <Header title="Реферальная программа" onBack={() => setView('home')} />
      
      <div className="bg-gradient-to-br from-green-900/40 to-black border border-green-500/20 p-6 rounded-2xl mb-6 text-center">
        <div className="text-zinc-400 text-sm mb-1">Доступно для вывода</div>
        <div className="text-4xl font-bold text-green-500 mb-4">{referrals.partnerBalance.toFixed(2)} ₽</div>
        
        {referrals.partnerBalance > 0 ? (
          <button 
            onClick={openWithdrawModal}
            className="bg-green-600 hover:bg-green-500 text-white px-6 py-2 rounded-full font-bold text-sm shadow-lg shadow-green-900/40 mb-4 transition-transform active:scale-95"
          >
            Вывести средства
          </button>
        ) : (
          <div className="text-zinc-500 text-sm mb-4">Пригласите друзей, чтобы заработать</div>
        )}

        <div className="grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
          <div>
            <div className="text-xl font-bold text-white">{referrals.count}</div>
            <div className="text-xs text-zinc-500">Приглашено</div>
          </div>
          <div>
            <div className="text-xl font-bold text-white">20%</div>
            <div className="text-xs text-zinc-500">С покупок друга</div>
          </div>
        </div>
        <p className="mt-4 text-left text-xs text-zinc-400 leading-relaxed border-t border-white/5 pt-3">
          Вы получаете <span className="text-emerald-400/95 font-semibold">20%</span> с оплат ваших рефералов и ещё <span className="text-emerald-400/95 font-semibold">5%</span>, если они приведут своих.
        </p>
      </div>

      <div className="bg-zinc-800 p-4 rounded-xl border border-zinc-700 mb-6">
        <label className="text-xs text-zinc-500 mb-2 block uppercase font-bold tracking-wider">Ваша ссылка</label>
        <div className="flex gap-2">
          <div className="bg-zinc-900 flex-1 p-3 rounded-lg text-zinc-300 font-mono text-sm truncate">
            {telegramId ? `https://t.me/${BOT_USERNAME_MINI}?start=ref${telegramId}` : 'Загрузка...'}
          </div>
          <button
            onClick={() => {
              if (telegramId) {
                handleCopy(`https://t.me/${BOT_USERNAME_MINI}?start=ref${telegramId}`);
              }
            }}
            className="bg-orange-600 px-4 rounded-lg text-white hover:bg-orange-500"
          >
            <Copy size={18} />
          </button>
        </div>
      </div>
      
      <div>
        <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-wider mb-3 px-1">Приглашенные пользователи</h3>
        <div className="space-y-2 pb-6">
          {referralList.length === 0 ? (
            <div className="text-center py-8 bg-zinc-800/30 rounded-xl border border-zinc-800">
              <UserPlus size={32} className="text-zinc-600 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">У вас пока нет рефералов</p>
              <p className="text-zinc-600 text-xs mt-1">Поделитесь ссылкой выше, чтобы приглашать друзей</p>
            </div>
          ) : (
            referralList.map(user => (
              <button 
                 key={user.id} 
                 onClick={() => { setSelectedReferral(user); setView('referral_detail'); }}
                 className="w-full bg-zinc-800/50 border border-zinc-800 p-3 rounded-xl flex justify-between items-center hover:bg-zinc-800 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center text-zinc-400">
                    <User size={14} />
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-bold text-zinc-200">{user.name}</div>
                    <div className="text-[10px] text-zinc-500">
                      {user.date}
                      {typeof user.invitedCount === 'number' && user.invitedCount > 0 && (
                        <span className="ml-2 text-zinc-400">• Пригласил еще {user.invitedCount} человек</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                   <div className="text-right">
                     <div className="text-xs text-zinc-500">Доход</div>
                     <div className="text-sm font-bold text-green-500">+{(user.myProfit ?? 0).toFixed(2)} ₽</div>
                   </div>
                   <ChevronRight size={16} className="text-zinc-600" />
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
          <p className="text-zinc-400 text-center text-sm mb-8">
            Введите промокод для получения скидки.
          </p>
          <input 
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="PROMO2025"
            className="w-full bg-zinc-800 border border-zinc-600 rounded-xl p-4 text-center text-2xl font-mono text-white tracking-widest uppercase focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none mb-4 placeholder:text-zinc-700"
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
                  if (res.needs_subscription_create && res.subscription_days) {
                    const d = Number(res.subscription_days) || 0;
                    if (d > 0) {
                      setWizardPlan({ id: `promo_${d}`, duration: `Промокод: ${d} дней`, price: 0, highlight: true, days: d, isTrial: false });
                      setWizardDeviceCount(2);
                      setWizardStep(2); // сразу на подтверждение
                      setView('wizard');
                    }
                  }
                  // Обновим баланс и реферальную статистику
                  if (telegramId) {
                    const data = await miniApiFetch(`/user/info?telegram_id=${telegramId}`);
                    setBalance(data.balance ?? balance);
                    setNextDiscountPercent(Number(data.next_discount_percent || 0) || 0);
                    setReferralInviteDiscountActive(!!data.referral_invite_discount_active);
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

  return (
    <AnimatedBackground>
      <div className={`p-4 min-h-screen flex flex-col overflow-x-clip animate-fade-in ${userLoadFailed ? 'pointer-events-none select-none user-load-failed opacity-60' : ''}`}>
        {view === 'home' && <HomeView />}
        {view === 'wizard' && <WizardView />}
        {view === 'topup' && <TopUpView />}
        {view === 'wait_payment' && <PaymentWaitView />}
        {view === 'success_payment' && <PaymentSuccessView />}
        {view === 'devices' && <DevicesView />}
        {view === 'extend_subscription' && <ExtendSubscriptionView />}
        {view === 'buy_device' && <BuyDeviceView />}
        {view === 'instruction_view' && <InstructionView key="instruction" />}
        {view === 'history' && <HistoryView />}
        {view === 'referral' && <ReferralView />}
        {view === 'referral_detail' && <ReferralDetailView />}
        {view === 'promo' && <PromoView />}
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