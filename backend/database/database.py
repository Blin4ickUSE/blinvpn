"""
Модуль для работы с базой данных SQLite
Создает все необходимые таблицы и предоставляет функции для работы с данными
"""
import sqlite3
import os
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
import hashlib

logger = logging.getLogger(__name__)

DB_PATH = os.getenv('DB_PATH', 'data.db')

def get_db_connection():
    """Получить соединение с базой данных (WAL, таймаут)"""
    # Создаем директорию для базы данных, если её нет
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    # Настройки для стабильности при параллельных запросах
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn

def init_database():
    """Инициализация базы данных - создание всех таблиц"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Таблица пользователей
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                username TEXT,
                full_name TEXT,
                balance REAL DEFAULT 0,
                status TEXT DEFAULT 'Trial',
                registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                paid_until TIMESTAMP,
                referral_code TEXT UNIQUE,
                referred_by INTEGER,
                is_partner INTEGER DEFAULT 0,
                partner_rate INTEGER DEFAULT 20,
                partner_balance REAL DEFAULT 0,
                total_earned REAL DEFAULT 0,
                trial_used INTEGER DEFAULT 0,
                banned_keys_count INTEGER DEFAULT 0,
                is_banned INTEGER DEFAULT 0,
                ban_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (referred_by) REFERENCES users(id)
            )
        """)
        
        # Таблица ключей VPN
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS vpn_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                key_uuid TEXT UNIQUE,
                key_config TEXT,
                status TEXT DEFAULT 'Active',
                expiry_date TIMESTAMP,
                traffic_used REAL DEFAULT 0,
                traffic_limit REAL,
                devices_limit INTEGER DEFAULT 1,
                server_location TEXT,
                hwid_hash TEXT,
                last_used TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Таблица устройств
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                vpn_key_id INTEGER,
                name TEXT,
                platform TEXT,
                hwid_hash TEXT UNIQUE,
                added_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (vpn_key_id) REFERENCES vpn_keys(id)
            )
        """)
        
        # Таблица транзакций
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                type TEXT NOT NULL,
                amount REAL NOT NULL,
                status TEXT DEFAULT 'Pending',
                payment_method TEXT,
                payment_provider TEXT,
                payment_id TEXT,
                description TEXT,
                hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Таблица промокодов
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS promocodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                type TEXT NOT NULL,
                value TEXT NOT NULL,
                uses_count INTEGER DEFAULT 0,
                uses_limit INTEGER,
                expires_at TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                target_type TEXT DEFAULT 'all',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица использования промокодов
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS promocode_uses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                promocode_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (promocode_id) REFERENCES promocodes(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(promocode_id, user_id)
            )
        """)
        
        # Таблица тикетов поддержки
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                telegram_topic_id INTEGER,
                status TEXT DEFAULT 'Open',
                last_message TEXT,
                last_message_time TIMESTAMP,
                unread_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Таблица сообщений тикетов
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                user_id INTEGER,
                is_admin INTEGER DEFAULT 0,
                message_text TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ticket_id) REFERENCES tickets(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Таблица статистики трафика
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS traffic_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vpn_key_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                date DATE NOT NULL,
                traffic_bytes REAL DEFAULT 0,
                unique_hwids INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (vpn_key_id) REFERENCES vpn_keys(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(vpn_key_id, date)
            )
        """)
        
        # Таблица черного списка
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS blacklist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица рассылок
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS mailings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                message_text TEXT,
                target_users TEXT,
                sent_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                sent_at TIMESTAMP,
                button_type TEXT,
                button_value TEXT,
                image_url TEXT
            )
        """)
        
        # Таблица тарифных планов
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tariff_plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                plan_type TEXT NOT NULL,
                name TEXT NOT NULL,
                price REAL NOT NULL,
                duration_days INTEGER NOT NULL,
                is_active INTEGER DEFAULT 1,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица настроек whitelist bypass
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS whitelist_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_fee REAL DEFAULT 100.0,
                price_per_gb REAL DEFAULT 15.0,
                min_gb INTEGER DEFAULT 5,
                max_gb INTEGER DEFAULT 500,
                auto_pay_enabled INTEGER DEFAULT 1,
                auto_pay_threshold_mb INTEGER DEFAULT 100,
                pricing_type TEXT DEFAULT 'fixed',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица авто-скидок
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS auto_discounts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                condition_type TEXT NOT NULL,
                condition_value TEXT NOT NULL,
                discount_type TEXT NOT NULL,
                discount_value REAL NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица публичных страниц
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public_pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_type TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица настроек системы
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица комиссий платежных систем
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payment_fees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_method TEXT UNIQUE NOT NULL,
                fee_percent REAL DEFAULT 0.0,
                fee_fixed REAL DEFAULT 0.0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица сохраненных способов оплаты для рекуррентных платежей
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS saved_payment_methods (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                payment_provider TEXT NOT NULL,
                payment_method_id TEXT NOT NULL,
                payment_method_type TEXT,
                card_last4 TEXT,
                card_brand TEXT,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(user_id, payment_provider, payment_method_id)
            )
        """)
        
        # Таблица настроек платежных провайдеров (для настройки из панели)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payment_provider_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider TEXT NOT NULL,
                setting_key TEXT NOT NULL,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(provider, setting_key)
            )
        """)
        
        # Таблица настроек резервного копирования
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS backup_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                enabled INTEGER DEFAULT 0,
                interval_hours INTEGER DEFAULT 12,
                last_backup TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица конфигурации сквадов для распределения нагрузки
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS squad_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                squad_uuid TEXT NOT NULL,
                squad_name TEXT NOT NULL,
                squad_type TEXT NOT NULL,
                max_users INTEGER DEFAULT 0,
                current_users INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(squad_uuid)
            )
        """)
        
        # Таблица привязки типов подписок к сквадам
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS subscription_squad_mapping (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription_type TEXT NOT NULL,
                squad_uuid TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(subscription_type, squad_uuid)
            )
        """)
        
        # Таблица администраторов панели (логин/пароль)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS panel_admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                is_active INTEGER DEFAULT 1,
                last_login TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Таблица сессий панели
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS panel_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                session_token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES panel_admins(id)
            )
        """)
        
        # Миграция: добавляем squad_uuid в vpn_keys если его нет
        try:
            cursor.execute("ALTER TABLE vpn_keys ADD COLUMN squad_uuid TEXT")
        except sqlite3.OperationalError:
            pass
        
        # Миграция: добавляем plan_type в vpn_keys если его нет
        try:
            cursor.execute("ALTER TABLE vpn_keys ADD COLUMN plan_type TEXT DEFAULT 'vpn'")
        except sqlite3.OperationalError:
            pass
        
        # Миграция: добавляем last_ip в vpn_keys если его нет (для детекции abuse по IP)
        try:
            cursor.execute("ALTER TABLE vpn_keys ADD COLUMN last_ip TEXT")
        except sqlite3.OperationalError:
            pass
        
        # Миграция: добавляем поля в mailings если их нет
        try:
            cursor.execute("ALTER TABLE mailings ADD COLUMN button_type TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute("ALTER TABLE mailings ADD COLUMN button_value TEXT")
        except sqlite3.OperationalError:
            pass
        try:
            cursor.execute("ALTER TABLE mailings ADD COLUMN image_url TEXT")
        except sqlite3.OperationalError:
            pass
        
        # Миграция: добавляем target_type в промокоды (all/vpn/whitelist)
        try:
            cursor.execute("ALTER TABLE promocodes ADD COLUMN target_type TEXT DEFAULT 'all'")
        except sqlite3.OperationalError:
            pass
        
        # Миграция: добавляем pricing_type в whitelist_settings
        try:
            cursor.execute("ALTER TABLE whitelist_settings ADD COLUMN pricing_type TEXT DEFAULT 'fixed'")
        except sqlite3.OperationalError:
            pass
        
        # Инициализация дефолтных тарифов VPN
        cursor.execute("SELECT COUNT(*) FROM tariff_plans WHERE plan_type = 'vpn'")
        if cursor.fetchone()[0] == 0:
            default_vpn_plans = [
                ('vpn', '1 месяц', 99, 30, 1),
                ('vpn', '3 месяца', 249, 90, 2),
                ('vpn', '6 месяцев', 449, 180, 3),
                ('vpn', '1 год', 799, 365, 4),
                ('vpn', '2 года', 1199, 730, 5),
            ]
            cursor.executemany("""
                INSERT INTO tariff_plans (plan_type, name, price, duration_days, sort_order)
                VALUES (?, ?, ?, ?, ?)
            """, default_vpn_plans)
        
        # Инициализация настроек whitelist - 299₽/месяц, 100ГБ трафика
        cursor.execute("SELECT COUNT(*) FROM whitelist_settings")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO whitelist_settings (subscription_fee, price_per_gb, min_gb, max_gb, auto_pay_enabled, auto_pay_threshold_mb, pricing_type)
                VALUES (299.0, 15.0, 100, 500, 1, 100, 'fixed')
            """)
        else:
            # Обновляем существующие настройки на фиксированную цену
            cursor.execute("""
                UPDATE whitelist_settings 
                SET subscription_fee = 299.0, min_gb = 100, pricing_type = 'fixed'
                WHERE subscription_fee < 299
            """)
        
        # Инициализация публичных страниц
        cursor.execute("SELECT COUNT(*) FROM public_pages WHERE page_type = 'offer'")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO public_pages (page_type, content)
                VALUES ('offer', '')
            """)
        cursor.execute("SELECT COUNT(*) FROM public_pages WHERE page_type = 'privacy'")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO public_pages (page_type, content)
                VALUES ('privacy', '')
            """)
        
        # Инициализация комиссий (по умолчанию 0%)
        default_payment_methods = ['yookassa', 'heleket', 'platega', 'crypto']
        for method in default_payment_methods:
            cursor.execute("SELECT COUNT(*) FROM payment_fees WHERE payment_method = ?", (method,))
            if cursor.fetchone()[0] == 0:
                cursor.execute("""
                    INSERT INTO payment_fees (payment_method, fee_percent, fee_fixed)
                    VALUES (?, 0.0, 0.0)
                """, (method,))
        
        # Индексы для оптимизации
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_vpn_keys_user_id ON vpn_keys(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_vpn_keys_status ON vpn_keys(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_devices_hwid ON devices(hwid_hash)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_traffic_stats_date ON traffic_stats(date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_blacklist_telegram_id ON blacklist(telegram_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_payment_provider_settings ON payment_provider_settings(provider, setting_key)")
        
        conn.commit()
        logger.info("База данных успешно инициализирована")
    except Exception as e:
        logger.error(f"Ошибка при инициализации базы данных: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()

def create_user(telegram_id: int, username: str = None, full_name: str = None, referred_by: int = None) -> int:
    """Создать нового пользователя"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Генерируем уникальный реферальный код
        referral_code = f"REF{telegram_id}"
        
        cursor.execute("""
            INSERT INTO users (telegram_id, username, full_name, referral_code, referred_by)
            VALUES (?, ?, ?, ?, ?)
        """, (telegram_id, username, full_name, referral_code, referred_by))
        
        user_id = cursor.lastrowid
        conn.commit()
        
        # Если пользователь пришел по реферальной ссылке, обновляем статистику реферера
        # Примечание: статистика рефералов вычисляется динамически, не хранится в БД
        
        return user_id
    except sqlite3.IntegrityError:
        # Пользователь уже существует
        cursor.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
        result = cursor.fetchone()
        return result[0] if result else None
    finally:
        conn.close()

def get_user_by_telegram_id(telegram_id: int) -> Optional[Dict[str, Any]]:
    """Получить пользователя по Telegram ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Получить пользователя по ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()

def update_user_balance(user_id: int, amount: float, ensure_non_negative: bool = False) -> bool:
    """
    Обновить баланс пользователя.
    Если ensure_non_negative=True, операция не выполнится, если баланс станет отрицательным.
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("SELECT balance FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row:
            conn.rollback()
            return False
        new_balance = (row["balance"] or 0) + amount
        if ensure_non_negative and new_balance < 0:
            conn.rollback()
            return False
        cursor.execute("""
            UPDATE users 
            SET balance = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (new_balance, user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def update_user_full_name(telegram_id: int, full_name: str) -> bool:
    """Обновить полное имя пользователя (first_name из Telegram)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            UPDATE users 
            SET full_name = ?, updated_at = CURRENT_TIMESTAMP
            WHERE telegram_id = ?
        """, (full_name, telegram_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()

def get_all_users(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    """Получить всех пользователей"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM users ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
        rows = cursor.fetchall()
        return [dict(row) for row in rows] if rows else []
    finally:
        conn.close()

def hash_hwid(hwid: str) -> str:
    """Хешировать HWID для безопасного хранения"""
    return hashlib.sha256(hwid.encode()).hexdigest()

def get_system_setting(key: str, default: str = None) -> Optional[str]:
    """Получить системную настройку"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = ?", (key,))
        row = cursor.fetchone()
        return row['setting_value'] if row else default
    finally:
        conn.close()

def set_system_setting(key: str, value: str) -> bool:
    """Установить системную настройку"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (key, value))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error setting system setting {key}: {e}")
        return False
    finally:
        conn.close()

def get_default_squads(plan_type: str = 'vpn') -> List[str]:
    """Получить список UUID сквадов по умолчанию для типа подписки"""
    import json
    key = f'default_squads_{plan_type}'  # default_squads_vpn или default_squads_whitelist
    value = get_system_setting(key, '[]')
    try:
        return json.loads(value)
    except:
        return []

def set_default_squads(squad_uuids: List[str], plan_type: str = 'vpn') -> bool:
    """Установить список UUID сквадов по умолчанию для типа подписки"""
    import json
    key = f'default_squads_{plan_type}'  # default_squads_vpn или default_squads_whitelist
    # Убираем дубликаты, сохраняя порядок
    unique_uuids = list(dict.fromkeys(squad_uuids))
    return set_system_setting(key, json.dumps(unique_uuids))


# ========== Функции для рейт-лимитинга рефералов ==========

def check_referral_rate_limit(referrer_telegram_id: int, limit: int = 25, window_seconds: int = 60) -> bool:
    """
    Проверить, не превышен ли лимит рефералов для пользователя.
    
    Args:
        referrer_telegram_id: Telegram ID реферера (того, кто приглашает)
        limit: Максимальное количество рефералов в окне
        window_seconds: Временное окно в секундах
        
    Returns:
        True если можно добавить реферала, False если лимит превышен
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Считаем количество рефералов, добавленных за последние N секунд
        cutoff_time = datetime.now() - timedelta(seconds=window_seconds)
        
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM users
            WHERE referred_by = (SELECT id FROM users WHERE telegram_id = ?)
            AND registration_date > ?
        """, (referrer_telegram_id, cutoff_time.isoformat()))
        
        result = cursor.fetchone()
        count = result['count'] if result else 0
        
        return count < limit
    finally:
        conn.close()


def set_referrer_for_user(user_id: int, referrer_id: int) -> bool:
    """
    Установить реферера для пользователя (если еще не установлен).
    
    Args:
        user_id: ID пользователя
        referrer_id: ID реферера (внутренний ID, не telegram_id)
        
    Returns:
        True если реферер успешно установлен, False если уже был установлен
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Проверяем, не установлен ли уже реферер
        cursor.execute("SELECT referred_by FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        
        if not row:
            return False
        
        # Если реферер уже установлен, не меняем
        if row['referred_by'] is not None:
            return False
        
        # Устанавливаем реферера
        cursor.execute("""
            UPDATE users 
            SET referred_by = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (referrer_id, user_id))
        
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_user_by_referral_code(referral_code: str) -> Optional[Dict[str, Any]]:
    """Получить пользователя по реферальному коду"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("SELECT * FROM users WHERE referral_code = ?", (referral_code,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def credit_referral_income(user_id: int, purchase_amount: float, description: str = None) -> Optional[Dict]:
    """
    Начислить доход рефереру при покупке реферала.
    
    Args:
        user_id: ID пользователя, который совершил покупку (реферал)
        purchase_amount: Сумма покупки
        description: Описание для транзакции
        
    Returns:
        Dict с информацией о начислении или None если реферера нет
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Получаем пользователя и его реферера
        cursor.execute("""
            SELECT u.id, u.username, u.referred_by,
                   r.id as referrer_id, r.telegram_id as referrer_telegram_id,
                   r.partner_rate, r.username as referrer_username
            FROM users u
            LEFT JOIN users r ON u.referred_by = r.id
            WHERE u.id = ?
        """, (user_id,))
        
        row = cursor.fetchone()
        if not row or not row['referrer_id']:
            return None  # Нет реферера
        
        referrer_id = row['referrer_id']
        referrer_telegram_id = row['referrer_telegram_id']
        partner_rate = row['partner_rate'] or 20  # По умолчанию 20%
        referral_username = row['username'] or f"id{user_id}"
        
        # Вычисляем доход реферера
        income = purchase_amount * (partner_rate / 100)
        
        if income <= 0:
            return None
        
        # Начисляем доход рефереру
        cursor.execute("""
            UPDATE users 
            SET partner_balance = partner_balance + ?,
                total_earned = total_earned + ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (income, income, referrer_id))
        
        # Создаем транзакцию для реферера (доход)
        trans_description = description or f"Доход от реферала @{referral_username}: {partner_rate}% от {purchase_amount}₽"
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description)
            VALUES (?, 'referral_income', ?, 'Success', ?)
        """, (referrer_id, income, trans_description))
        
        conn.commit()
        
        return {
            'referrer_id': referrer_id,
            'referrer_telegram_id': referrer_telegram_id,
            'income': income,
            'rate': partner_rate,
            'purchase_amount': purchase_amount
        }
    except Exception as e:
        logger.error(f"Error crediting referral income: {e}")
        conn.rollback()
        return None
    finally:
        conn.close()


def get_referrer_info(user_id: int) -> Optional[Dict]:
    """Получить информацию о реферере пользователя"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        cursor.execute("""
            SELECT r.id, r.telegram_id, r.username, r.full_name
            FROM users u
            JOIN users r ON u.referred_by = r.id
            WHERE u.id = ?
        """, (user_id,))
        
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ========== Функции для работы со сквадами ==========

def get_all_squad_configs() -> List[Dict[str, Any]]:
    """Получить все конфигурации сквадов"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM squad_configs ORDER BY squad_type, priority DESC")
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_squads_by_type(squad_type: str) -> List[Dict[str, Any]]:
    """Получить сквады определенного типа"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT * FROM squad_configs 
            WHERE squad_type = ? AND is_active = 1
            ORDER BY priority DESC, current_users ASC
        """, (squad_type,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_squads_for_subscription(subscription_type: str) -> List[Dict[str, Any]]:
    """Получить сквады для типа подписки (vpn, whitelist, trial)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT sc.* FROM squad_configs sc
            JOIN subscription_squad_mapping ssm ON sc.squad_uuid = ssm.squad_uuid
            WHERE ssm.subscription_type = ? 
              AND ssm.is_active = 1 
              AND sc.is_active = 1
            ORDER BY sc.priority DESC, sc.current_users ASC
        """, (subscription_type,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_best_squad_for_subscription(subscription_type: str) -> Optional[Dict[str, Any]]:
    """
    Выбрать лучший сквад для новой подписки (балансировка нагрузки).
    Выбирает сквад с наименьшим количеством пользователей из доступных.
    """
    squads = get_squads_for_subscription(subscription_type)
    if not squads:
        return None
    
    # Фильтруем сквады, которые не достигли лимита
    available_squads = [s for s in squads if s['max_users'] == 0 or s['current_users'] < s['max_users']]
    if not available_squads:
        # Если все сквады заполнены, берём тот, где меньше всего пользователей
        available_squads = squads
    
    # Выбираем сквад с минимальным количеством пользователей
    return min(available_squads, key=lambda s: s['current_users'])


def update_squad_user_count(squad_uuid: str, delta: int = 1) -> bool:
    """Обновить счётчик пользователей в скваде"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE squad_configs 
            SET current_users = MAX(0, current_users + ?), updated_at = CURRENT_TIMESTAMP
            WHERE squad_uuid = ?
        """, (delta, squad_uuid))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def upsert_squad_config(squad_uuid: str, squad_name: str, squad_type: str, 
                        max_users: int = 0, priority: int = 0) -> bool:
    """Создать или обновить конфигурацию сквада"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO squad_configs (squad_uuid, squad_name, squad_type, max_users, priority)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(squad_uuid) DO UPDATE SET
                squad_name = excluded.squad_name,
                squad_type = excluded.squad_type,
                max_users = excluded.max_users,
                priority = excluded.priority,
                updated_at = CURRENT_TIMESTAMP
        """, (squad_uuid, squad_name, squad_type, max_users, priority))
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error upserting squad config: {e}")
        return False
    finally:
        conn.close()


def set_subscription_squads(subscription_type: str, squad_uuids: List[str]) -> bool:
    """Установить сквады для типа подписки"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Удаляем старые привязки
        cursor.execute("DELETE FROM subscription_squad_mapping WHERE subscription_type = ?", 
                      (subscription_type,))
        
        # Добавляем новые
        for squad_uuid in squad_uuids:
            cursor.execute("""
                INSERT INTO subscription_squad_mapping (subscription_type, squad_uuid)
                VALUES (?, ?)
            """, (subscription_type, squad_uuid))
        
        conn.commit()
        return True
    except Exception as e:
        logger.error(f"Error setting subscription squads: {e}")
        conn.rollback()
        return False
    finally:
        conn.close()


def get_subscription_squad_mapping() -> Dict[str, List[str]]:
    """Получить маппинг типов подписок на сквады"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT subscription_type, squad_uuid 
            FROM subscription_squad_mapping 
            WHERE is_active = 1
        """)
        
        result = {'vpn': [], 'whitelist': [], 'trial': []}
        for row in cursor.fetchall():
            sub_type = row['subscription_type']
            if sub_type in result:
                result[sub_type].append(row['squad_uuid'])
        return result
    finally:
        conn.close()


def sync_squad_user_counts() -> None:
    """Синхронизировать счётчики пользователей в сквадах с реальными данными"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Получаем реальные подсчёты из vpn_keys
        cursor.execute("""
            SELECT squad_uuid, COUNT(*) as cnt
            FROM vpn_keys
            WHERE squad_uuid IS NOT NULL AND status = 'Active'
            GROUP BY squad_uuid
        """)
        
        counts = {row['squad_uuid']: row['cnt'] for row in cursor.fetchall()}
        
        # Обновляем все сквады
        cursor.execute("SELECT squad_uuid FROM squad_configs")
        for row in cursor.fetchall():
            uuid = row['squad_uuid']
            count = counts.get(uuid, 0)
            cursor.execute("""
                UPDATE squad_configs 
                SET current_users = ?, updated_at = CURRENT_TIMESTAMP
                WHERE squad_uuid = ?
            """, (count, uuid))
        
        conn.commit()
        logger.info("Squad user counts synchronized")
    except Exception as e:
        logger.error(f"Error syncing squad user counts: {e}")
        conn.rollback()
    finally:
        conn.close()


# ========== Функции авторизации панели ==========

def create_panel_admin(username: str, password: str) -> Optional[int]:
    """Создать администратора панели"""
    import hashlib
    import secrets
    
    # Хешируем пароль с солью
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    full_hash = f"{salt}:{password_hash}"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO panel_admins (username, password_hash)
            VALUES (?, ?)
        """, (username, full_hash))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def verify_panel_admin(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Проверить логин/пароль администратора панели"""
    import hashlib
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT id, username, password_hash, is_active 
            FROM panel_admins 
            WHERE username = ? AND is_active = 1
        """, (username,))
        
        row = cursor.fetchone()
        if not row:
            return None
        
        # Проверяем пароль
        stored_hash = row['password_hash']
        salt, expected_hash = stored_hash.split(':', 1)
        computed_hash = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
        
        if computed_hash != expected_hash:
            return None
        
        # Обновляем время последнего входа
        cursor.execute("""
            UPDATE panel_admins 
            SET last_login = CURRENT_TIMESTAMP 
            WHERE id = ?
        """, (row['id'],))
        conn.commit()
        
        return {'id': row['id'], 'username': row['username']}
    finally:
        conn.close()


def create_panel_session(admin_id: int) -> Optional[str]:
    """Создать сессию для администратора"""
    import secrets
    
    session_token = secrets.token_urlsafe(32)
    expires_at = datetime.now() + timedelta(days=7)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Удаляем старые сессии этого админа
        cursor.execute("DELETE FROM panel_sessions WHERE admin_id = ?", (admin_id,))
        
        # Создаём новую сессию
        cursor.execute("""
            INSERT INTO panel_sessions (admin_id, session_token, expires_at)
            VALUES (?, ?, ?)
        """, (admin_id, session_token, expires_at.isoformat()))
        conn.commit()
        return session_token
    except Exception as e:
        logger.error(f"Error creating panel session: {e}")
        return None
    finally:
        conn.close()


def verify_panel_session(session_token: str) -> Optional[Dict[str, Any]]:
    """Проверить сессию панели"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT ps.*, pa.username
            FROM panel_sessions ps
            JOIN panel_admins pa ON ps.admin_id = pa.id
            WHERE ps.session_token = ? 
              AND ps.expires_at > CURRENT_TIMESTAMP
              AND pa.is_active = 1
        """, (session_token,))
        
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_panel_session(session_token: str) -> bool:
    """Удалить сессию панели (выход)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM panel_sessions WHERE session_token = ?", (session_token,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_or_create_default_admin() -> Dict[str, str]:
    """
    Получить или создать дефолтного администратора.
    Возвращает логин и пароль (пароль только при создании).
    """
    import secrets
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        # Проверяем, есть ли хоть один админ
        cursor.execute("SELECT id, username FROM panel_admins WHERE is_active = 1 LIMIT 1")
        row = cursor.fetchone()
        
        if row:
            return {'username': row['username'], 'password': None, 'exists': True}
        
        # Создаём дефолтного админа
        username = 'admin'
        password = secrets.token_urlsafe(12)
        
        admin_id = create_panel_admin(username, password)
        if admin_id:
            return {'username': username, 'password': password, 'exists': False}
        
        return {'username': None, 'password': None, 'exists': False}
    finally:
        conn.close()


def update_admin_password(admin_id: int, new_password: str) -> bool:
    """Изменить пароль администратора"""
    import hashlib
    import secrets
    
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{salt}:{new_password}".encode()).hexdigest()
    full_hash = f"{salt}:{password_hash}"
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE panel_admins 
            SET password_hash = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (full_hash, admin_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# Инициализация при импорте
if __name__ != "__main__":
    init_database()
