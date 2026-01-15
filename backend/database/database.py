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
                partner_rate INTEGER DEFAULT 10,
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
        
        # Инициализация настроек whitelist
        cursor.execute("SELECT COUNT(*) FROM whitelist_settings")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO whitelist_settings (subscription_fee, price_per_gb, min_gb, max_gb, auto_pay_enabled, auto_pay_threshold_mb)
                VALUES (100.0, 15.0, 5, 500, 1, 100)
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

# Инициализация при импорте
if __name__ != "__main__":
    init_database()
