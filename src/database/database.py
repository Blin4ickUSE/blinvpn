"""
Модуль для работы с базой данных SQLite
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
    """Получить соединение с базой данных"""
    db_dir = os.path.dirname(os.path.abspath(DB_PATH))
    if db_dir and not os.path.exists(db_dir):
        os.makedirs(db_dir, exist_ok=True)
    
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn


def init_database():
    """Инициализация базы данных"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    try:
        # Пользователи
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
                partner_rate INTEGER DEFAULT 25,
                second_level_rate INTEGER DEFAULT 5,
                third_level_rate INTEGER DEFAULT 2,
                next_discount_percent INTEGER DEFAULT 0,
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

        # Миграция: next_discount_percent
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN next_discount_percent INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN second_level_rate INTEGER DEFAULT 5")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN third_level_rate INTEGER DEFAULT 2")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN first_start_at TIMESTAMP")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE users ADD COLUMN discount_offer_expires_at TIMESTAMP")
        except Exception:
            pass
        
        # VPN ключи
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
                last_ip TEXT,
                squad_uuid TEXT,
                plan_type TEXT DEFAULT 'vpn',
                custom_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        
        # Миграция: добавляем custom_name если колонка не существует
        try:
            cursor.execute("ALTER TABLE vpn_keys ADD COLUMN custom_name TEXT")
        except:
            pass  # Колонка уже существует
        
        # Транзакции
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
        
        # Промокоды
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
        
        # Использование промокодов
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

        # Специальные отслеживающие ссылки (непривязанные рефералки)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS tracking_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT,
                promocode TEXT,
                clicks INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Статистика трафика
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS traffic_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vpn_key_id INTEGER,
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
        
        # Черный список
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS blacklist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Рассылки
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

        # Сообщения рассылок (для чтения/удаления ранее отправленного)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS mailing_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mailing_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                telegram_message_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (mailing_id) REFERENCES mailings(id) ON DELETE CASCADE
            )
        """)
        
        # Тарифные планы
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
        
        # Настройки whitelist
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
        
        # Авто-скидки
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
        
        # Публичные страницы
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS public_pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                page_type TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Системные настройки
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Комиссии платежных систем
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS payment_fees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                payment_method TEXT UNIQUE NOT NULL,
                fee_percent REAL DEFAULT 0.0,
                fee_fixed REAL DEFAULT 0.0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Сохраненные способы оплаты
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
        
        # Настройки провайдеров
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
        
        # Настройки бэкапов
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS backup_settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                enabled INTEGER DEFAULT 0,
                interval_hours INTEGER DEFAULT 12,
                last_backup TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Конфигурация сквадов
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS squad_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                squad_uuid TEXT UNIQUE NOT NULL,
                squad_name TEXT NOT NULL,
                squad_type TEXT NOT NULL,
                max_users INTEGER DEFAULT 0,
                current_users INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                priority INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Привязка подписок к сквадам
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
        
        # Администраторы панели
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
        
        # Сессии панели
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

        # Одноразовые коды подтверждения входа в панель
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS panel_login_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id INTEGER NOT NULL,
                temp_token TEXT UNIQUE NOT NULL,
                code TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                expires_at TIMESTAMP NOT NULL,
                used INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (admin_id) REFERENCES panel_admins(id)
            )
        """)

        # Brute-force защита логина панели по IP
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS panel_ip_blocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ip_address TEXT UNIQUE NOT NULL,
                failed_count INTEGER DEFAULT 0,
                blocked_until TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Индексы
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_vpn_keys_user_id ON vpn_keys(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_vpn_keys_status ON vpn_keys(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_vpn_keys_key_uuid ON vpn_keys(key_uuid)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_traffic_stats_date ON traffic_stats(date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_blacklist_telegram_id ON blacklist(telegram_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_panel_ip_blocks_ip ON panel_ip_blocks(ip_address)")
        
        conn.commit()
        
        # Дефолтные тарифы (единая подписка: 199/499/899/1499₽)
        cursor.execute("SELECT COUNT(*) FROM tariff_plans WHERE plan_type = 'vpn'")
        if cursor.fetchone()[0] == 0:
            default_plans = [
                ('vpn', '1 месяц', 99, 30, 1),
                ('vpn', '3 месяца', 249, 90, 2),
                ('vpn', '6 месяцев', 449, 180, 3),
                ('vpn', '1 год', 799, 365, 4),
            ]
            cursor.executemany("""
                INSERT INTO tariff_plans (plan_type, name, price, duration_days, sort_order)
                VALUES (?, ?, ?, ?, ?)
            """, default_plans)
        else:
            # Миграция: обновить цены существующих VPN-тарифов
            price_map = {
                30: (99, '1 месяц'),
                90: (249, '3 месяца'),
                180: (449, '6 месяцев'),
                365: (799, '1 год'),
            }
            for days, (price, name) in price_map.items():
                cursor.execute("""
                    UPDATE tariff_plans SET price = ?, name = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE plan_type = 'vpn' AND duration_days = ?
                """, (price, name, days))
            # Добавить план "6 месяцев", если его нет
            cursor.execute("SELECT COUNT(*) FROM tariff_plans WHERE plan_type = 'vpn' AND duration_days = 180")
            if cursor.fetchone()[0] == 0:
                cursor.execute("""
                    INSERT INTO tariff_plans (plan_type, name, price, duration_days, sort_order)
                    VALUES ('vpn', '6 месяцев', 449, 180, 3)
                """)
        
        # Реферальная ставка 25%: обновить существующих партнёров с 20% на 25%
        cursor.execute("UPDATE users SET partner_rate = 25 WHERE partner_rate = 20")
        
        # Настройки whitelist
        cursor.execute("SELECT COUNT(*) FROM whitelist_settings")
        if cursor.fetchone()[0] == 0:
            cursor.execute("""
                INSERT INTO whitelist_settings (subscription_fee, price_per_gb, min_gb, max_gb, pricing_type)
                VALUES (299.0, 15.0, 100, 500, 'fixed')
            """)
        
        # Публичные страницы
        for page_type in ['offer', 'privacy']:
            cursor.execute("SELECT COUNT(*) FROM public_pages WHERE page_type = ?", (page_type,))
            if cursor.fetchone()[0] == 0:
                cursor.execute("INSERT INTO public_pages (page_type, content) VALUES (?, '')", (page_type,))
        
        # Комиссии
        for method in ['heleket', 'platega', 'crypto']:
            cursor.execute("SELECT COUNT(*) FROM payment_fees WHERE payment_method = ?", (method,))
            if cursor.fetchone()[0] == 0:
                cursor.execute("INSERT INTO payment_fees (payment_method) VALUES (?)", (method,))
        
        conn.commit()
        logger.info("Database initialized")
        
    except Exception as e:
        logger.error(f"Database init error: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


# ===== ПОЛЬЗОВАТЕЛИ =====

def create_user(telegram_id: int, username: str = None, full_name: str = None, referred_by: int = None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        referral_code = f"REF{telegram_id}"
        cursor.execute("""
            INSERT INTO users (telegram_id, username, full_name, referral_code, referred_by)
            VALUES (?, ?, ?, ?, ?)
        """, (telegram_id, username, full_name, referral_code, referred_by))
        user_id = cursor.lastrowid
        conn.commit()
        return user_id
    except sqlite3.IntegrityError:
        cursor.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,))
        row = cursor.fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def get_user_by_telegram_id(telegram_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def update_user_balance(user_id: int, amount: float, ensure_non_negative: bool = False) -> bool:
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
        cursor.execute("UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                      (new_balance, user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def ensure_first_start_at(user_id: int) -> None:
    """Зафиксировать время первого /start (только один раз)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE users SET first_start_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND (first_start_at IS NULL OR first_start_at = '')
            """,
            (user_id,),
        )
        conn.commit()
    finally:
        conn.close()


def clear_expired_discount_offers() -> None:
    """Сбросить просроченную 24ч скидку, сохранив метку что оффер уже был."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE users SET next_discount_percent = 0, updated_at = CURRENT_TIMESTAMP
            WHERE discount_offer_expires_at IS NOT NULL
              AND datetime(discount_offer_expires_at) < datetime('now')
              AND next_discount_percent > 0
            """
        )
        conn.commit()
    finally:
        conn.close()


def get_effective_discount_percent(user: Dict[str, Any]) -> int:
    """Активная скидка: промокод без срока или 24ч-оффер, если не истёк."""
    from datetime import datetime, timedelta
    try:
        pct = int(user.get('next_discount_percent') or 0)
    except Exception:
        pct = 0
    if pct <= 0:
        return 0
    expires_raw = user.get('discount_offer_expires_at')
    if not expires_raw:
        return pct
    try:
        exp = datetime.fromisoformat(str(expires_raw).replace('Z', '+00:00').replace('+00:00', ''))
        if getattr(exp, 'tzinfo', None):
            off = exp.utcoffset()
            exp = exp.replace(tzinfo=None) - (timedelta(seconds=off.total_seconds()) if off else timedelta(0))
        if datetime.utcnow() >= exp:
            return 0
    except Exception:
        return 0
    return pct


def grant_24h_discount_offer(user_id: int) -> str:
    """Выдать одноразовую скидку 10% на 24 часа. Возвращает ISO expiry (UTC)."""
    from datetime import datetime, timedelta
    expires = (datetime.utcnow() + timedelta(hours=24)).isoformat()
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            UPDATE users
            SET next_discount_percent = 10,
                discount_offer_expires_at = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (expires, user_id),
        )
        conn.commit()
    finally:
        conn.close()
    return expires


def discount_offer_was_sent(user: Dict[str, Any]) -> bool:
    """Оффер уже выдавался (запись в transactions или активный срок скидки)."""
    user_id = user.get('id')
    if user_id:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute(
                "SELECT 1 FROM transactions WHERE user_id = ? AND type = 'discount_offer_24h' LIMIT 1",
                (int(user_id),),
            )
            if cursor.fetchone():
                return True
        finally:
            conn.close()
    return bool(user.get('discount_offer_expires_at'))


def user_has_active_subscription(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT 1 FROM vpn_keys
            WHERE user_id = ? AND status = 'Active'
              AND expiry_date IS NOT NULL
              AND datetime(expiry_date) > datetime('now')
            LIMIT 1
            """,
            (user_id,),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def user_in_grace_period(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT 1 FROM vpn_keys WHERE user_id = ? AND status = 'Expired' LIMIT 1",
            (user_id,),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def get_user_last_subscription_expiry_iso(user_id: int):
    """Последняя дата окончания подписки (активная, grace или из архива транзакций)."""
    from datetime import datetime
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT MAX(expiry_date) AS exp FROM vpn_keys
            WHERE user_id = ? AND expiry_date IS NOT NULL
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row and row['exp']:
            return row['exp']
        cursor.execute(
            """
            SELECT description FROM transactions
            WHERE user_id = ? AND type = 'key_deleted_unpaid'
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id,),
        )
        trow = cursor.fetchone()
        if trow and trow['description']:
            import re
            m = re.search(r'expiry=([^|]+)', str(trow['description']))
            if m:
                return m.group(1).strip()
        return None
    finally:
        conn.close()


def user_ever_had_vpn_key(user_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT 1 FROM vpn_keys WHERE user_id = ? LIMIT 1", (user_id,))
        return cursor.fetchone() is not None
    finally:
        conn.close()


def user_ever_had_subscription(user_id: int) -> bool:
    """Была ли подписка (включая удалённую после grace)."""
    if user_ever_had_vpn_key(user_id):
        return True
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT 1 FROM transactions
            WHERE user_id = ? AND type IN (
                'key_deleted_unpaid', 'subscription', 'subscription_extend', 'trial'
            )
            LIMIT 1
            """,
            (user_id,),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def get_last_trial_expiry_iso(user_id: int):
    """Дата окончания последнего триала (из ключей или транзакции + 3 дня)."""
    from datetime import datetime, timedelta
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT MAX(expiry_date) AS exp FROM vpn_keys
            WHERE user_id = ? AND plan_type = 'trial' AND expiry_date IS NOT NULL
            """,
            (user_id,),
        )
        row = cursor.fetchone()
        if row and row['exp']:
            return row['exp']
        cursor.execute(
            """
            SELECT created_at FROM transactions
            WHERE user_id = ? AND type = 'trial'
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id,),
        )
        trow = cursor.fetchone()
        if not trow or not trow['created_at']:
            return None
        try:
            started = datetime.fromisoformat(
                str(trow['created_at']).replace('Z', '+00:00').replace('+00:00', '')
            )
            if getattr(started, 'tzinfo', None):
                off = started.utcoffset()
                started = started.replace(tzinfo=None) - (
                    timedelta(seconds=off.total_seconds()) if off else timedelta(0)
                )
            return (started + timedelta(days=3)).isoformat()
        except Exception:
            return None
    finally:
        conn.close()


def update_user_full_name(telegram_id: int, full_name: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?",
                      (full_name, telegram_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def update_user_username(telegram_id: int, username: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE users SET username = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?",
                      (username, telegram_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_all_users(limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users ORDER BY id DESC LIMIT ? OFFSET ?", (limit, offset))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


# ===== VPN КЛЮЧИ =====

def get_user_vpn_keys(user_id: int) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM vpn_keys WHERE user_id = ? ORDER BY created_at DESC", (user_id,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_vpn_key_by_uuid(key_uuid: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM vpn_keys WHERE key_uuid = ?", (key_uuid,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_vpn_key_by_id(key_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM vpn_keys WHERE id = ?", (key_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_vpn_key(user_id: int, key_uuid: str, key_config: str = None,
                   plan_type: str = 'vpn', expiry_date: str = None,
                   traffic_limit: float = None, squad_uuid: str = None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO vpn_keys (user_id, key_uuid, key_config, plan_type, expiry_date, traffic_limit, squad_uuid)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (user_id, key_uuid, key_config, plan_type, expiry_date, traffic_limit, squad_uuid))
        key_id = cursor.lastrowid
        conn.commit()
        return key_id
    finally:
        conn.close()


def update_vpn_key(key_id: int, **kwargs) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        allowed = ['status', 'expiry_date', 'traffic_used', 'traffic_limit', 'key_config',
                   'last_used', 'last_ip', 'squad_uuid', 'plan_type', 'hwid_hash', 'devices_limit', 'custom_name']
        updates = []
        values = []
        for k, v in kwargs.items():
            if k in allowed:
                updates.append(f"{k} = ?")
                values.append(v)
        if not updates:
            return False
        values.append(key_id)
        cursor.execute(f"UPDATE vpn_keys SET {', '.join(updates)} WHERE id = ?", values)
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def delete_vpn_key(key_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM vpn_keys WHERE id = ?", (key_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def update_vpn_key_traffic(key_uuid: str, traffic_used: float) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE vpn_keys SET traffic_used = ? WHERE key_uuid = ?", (traffic_used, key_uuid))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def count_user_active_keys(user_id: int, plan_type: str = None) -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if plan_type:
            cursor.execute("""
                SELECT COUNT(*) FROM vpn_keys 
                WHERE user_id = ? AND status = 'Active' AND plan_type = ?
            """, (user_id, plan_type))
        else:
            cursor.execute("SELECT COUNT(*) FROM vpn_keys WHERE user_id = ? AND status = 'Active'", (user_id,))
        return cursor.fetchone()[0]
    finally:
        conn.close()


def get_all_vpn_keys(limit: int = 100, offset: int = 0, plan_type: str = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        if plan_type:
            cursor.execute("""
                SELECT vk.*, u.telegram_id, u.username 
                FROM vpn_keys vk LEFT JOIN users u ON vk.user_id = u.id
                WHERE vk.plan_type = ? ORDER BY vk.id DESC LIMIT ? OFFSET ?
            """, (plan_type, limit, offset))
        else:
            cursor.execute("""
                SELECT vk.*, u.telegram_id, u.username 
                FROM vpn_keys vk LEFT JOIN users u ON vk.user_id = u.id
                ORDER BY vk.id DESC LIMIT ? OFFSET ?
            """, (limit, offset))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


# ===== СИСТЕМНЫЕ НАСТРОЙКИ =====

def hash_hwid(hwid: str) -> str:
    return hashlib.sha256(hwid.encode()).hexdigest()


def get_system_setting(key: str, default: str = None) -> Optional[str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT setting_value FROM system_settings WHERE setting_key = ?", (key,))
        row = cursor.fetchone()
        return row['setting_value'] if row else default
    finally:
        conn.close()


def set_system_setting(key: str, value: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT OR REPLACE INTO system_settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        """, (key, value))
        conn.commit()
        return True
    except:
        return False
    finally:
        conn.close()


def get_default_squads(plan_type: str = 'vpn') -> List[str]:
    import json
    value = get_system_setting(f'default_squads_{plan_type}', '[]')
    try:
        return json.loads(value)
    except:
        return []


def set_default_squads(squad_uuids: List[str], plan_type: str = 'vpn') -> bool:
    import json
    return set_system_setting(f'default_squads_{plan_type}', json.dumps(list(dict.fromkeys(squad_uuids))))


# ===== РЕФЕРАЛЫ =====

def check_referral_rate_limit(referrer_telegram_id: int, limit: int = 25, window_seconds: int = 60) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cutoff = datetime.now() - timedelta(seconds=window_seconds)
        cursor.execute("""
            SELECT COUNT(*) FROM users
            WHERE referred_by = (SELECT id FROM users WHERE telegram_id = ?)
            AND registration_date > ?
        """, (referrer_telegram_id, cutoff.isoformat()))
        return cursor.fetchone()[0] < limit
    finally:
        conn.close()


def set_referrer_for_user(user_id: int, referrer_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT referred_by FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        if not row or row['referred_by'] is not None:
            return False
        cursor.execute("UPDATE users SET referred_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                      (referrer_id, user_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_user_by_referral_code(referral_code: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM users WHERE referral_code = ?", (referral_code,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# Доп. оплата за устройства (как в мини-приложении)
_PLAN_EXTRA_DEVICE_PRICE = {30: 50, 90: 150, 180: 300, 365: 600}


def compute_vpn_subscription_price(days: int, devices: int) -> Optional[float]:
    """Цена подписки VPN по тарифу из БД + доп. устройства. None — нет подходящего плана."""
    d = max(2, min(20, int(devices)))
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT price FROM tariff_plans
            WHERE plan_type = 'vpn' AND is_active = 1 AND duration_days = ?
            LIMIT 1
            """,
            (int(days),),
        )
        row = cursor.fetchone()
        if not row:
            return None
        base = float(row["price"] or 0)
        extra = float(_PLAN_EXTRA_DEVICE_PRICE.get(int(days), 50))
        return round(base + (d - 1) * extra, 2)
    finally:
        conn.close()


def user_has_paid_subscription_purchase(user_id: int) -> bool:
    """Была ли у пользователя платная покупка/продление подписки (после оплаты)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            """
            SELECT 1 FROM transactions
            WHERE user_id = ? AND type IN ('subscription', 'subscription_extend')
            LIMIT 1
            """,
            (user_id,),
        )
        return cursor.fetchone() is not None
    finally:
        conn.close()


def _referral_income_description(
    line: int, rate_pct: int, buyer_user_id: int, purchase_amount: float, note: str = ""
) -> str:
    """Стабильный формат для поиска дохода по рефералу (line + buyer_user_id)."""
    tag = f"line={line}|buyer_user_id={buyer_user_id}|{rate_pct}% от {purchase_amount:g}₽"
    return f"{note}|{tag}" if note else tag


def sum_referral_income_from_buyer(
    referrer_user_id: int,
    buyer_user_id: int,
    line: int = 1,
    buyer_username: str | None = None,
    buyer_full_name: str | None = None,
) -> float:
    """Сумма реферального дохода с покупок конкретного приглашённого (1-я или 2-я линия)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    rid = int(referrer_user_id)
    bid = int(buyer_user_id)
    try:
        if line == 1:
            line_sql = "AND (description LIKE '%line=1|%' OR description NOT LIKE '%line=2|%')"
        else:
            line_sql = "AND (description LIKE '%line=2|%' OR description LIKE '%2-й линии%')"

        cursor.execute(
            f"""
            SELECT COALESCE(SUM(amount), 0) AS total
            FROM transactions
            WHERE user_id = ? AND type = 'referral_income'
              AND description LIKE ?
              {line_sql}
            """,
            (rid, f"%buyer_user_id={bid}%"),
        )
        row = cursor.fetchone()
        total = float(row["total"] or 0) if row else 0.0
        if total > 0:
            return total

        patterns = []
        if buyer_username:
            uname = str(buyer_username).lstrip("@").strip()
            if uname:
                patterns.extend([f"%@{uname}%", f"%реферала%{uname}%", f"%{uname}%"])
        if buyer_full_name:
            fname = str(buyer_full_name).strip()
            if fname:
                patterns.append(f"%{fname}%")

        for pat in patterns:
            if line == 1:
                cursor.execute(
                    """
                    SELECT COALESCE(SUM(amount), 0) AS total
                    FROM transactions
                    WHERE user_id = ? AND type = 'referral_income'
                      AND description LIKE ?
                      AND description NOT LIKE '%line=2|%'
                    """,
                    (rid, pat),
                )
            else:
                cursor.execute(
                    """
                    SELECT COALESCE(SUM(amount), 0) AS total
                    FROM transactions
                    WHERE user_id = ? AND type = 'referral_income'
                      AND (description LIKE '%line=2|%' OR description LIKE '%2-й линии%')
                      AND description LIKE ?
                    """,
                    (rid, pat),
                )
            legacy = cursor.fetchone()
            val = float(legacy["total"] or 0) if legacy else 0.0
            if val > 0:
                return val

        return 0.0
    finally:
        conn.close()


def credit_referral_income(user_id: int, purchase_amount: float, description: str = None) -> Optional[Dict]:
    """Начисляет 20% прямому рефереру покупателя и 5% (или second_level_rate) рефереру 2-й линии."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("BEGIN IMMEDIATE")
        cursor.execute("""
            SELECT u.id AS buyer_id, u.username AS buyer_username,
                   r1.id AS l1_id, r1.telegram_id AS l1_tg,
                   r2.id AS l2_id, r2.telegram_id AS l2_tg,
                   COALESCE(r2.second_level_rate, 5) AS l2_rate_pct
            FROM users u
            LEFT JOIN users r1 ON u.referred_by = r1.id
            LEFT JOIN users r2 ON r1.referred_by = r2.id
            WHERE u.id = ?
        """, (user_id,))
        row = cursor.fetchone()
        if not row or not row["l1_id"]:
            conn.rollback()
            return None

        first_level_income = purchase_amount * 0.20
        if first_level_income <= 0:
            conn.rollback()
            return None

        l1_id = int(row["l1_id"])
        l2_id = row["l2_id"]
        buyer_id = int(row["buyer_id"])
        try:
            l2_rate = int(row["l2_rate_pct"] or 5)
        except (TypeError, ValueError):
            l2_rate = 5
        l2_rate = max(0, min(100, l2_rate))

        cursor.execute("""
            UPDATE users SET partner_balance = partner_balance + ?,
                           total_earned = total_earned + ?,
                           updated_at = CURRENT_TIMESTAMP WHERE id = ?
        """, (first_level_income, first_level_income, l1_id))

        note_l1 = description or "Доход 1-й линии"
        desc_l1 = _referral_income_description(1, 20, buyer_id, purchase_amount, note_l1)
        cursor.execute("""
            INSERT INTO transactions (user_id, type, amount, status, description)
            VALUES (?, 'referral_income', ?, 'Success', ?)
        """, (l1_id, first_level_income, desc_l1))

        second_line = None
        # 2-я линия: upline прямого реферера (не платим покупателю и не дублируем l1)
        if l2_id is not None and int(l2_id) != l1_id and int(l2_id) != buyer_id and l2_rate > 0:
            second_level_income = round(purchase_amount * (l2_rate / 100.0), 2)
            if second_level_income > 0:
                desc_l2 = _referral_income_description(
                    2, l2_rate, buyer_id, purchase_amount, "Доход 2-й линии"
                )
                cursor.execute("""
                    UPDATE users SET partner_balance = partner_balance + ?,
                                   total_earned = total_earned + ?,
                                   updated_at = CURRENT_TIMESTAMP WHERE id = ?
                """, (second_level_income, second_level_income, int(l2_id)))
                cursor.execute("""
                    INSERT INTO transactions (user_id, type, amount, status, description)
                    VALUES (?, 'referral_income', ?, 'Success', ?)
                """, (int(l2_id), second_level_income, desc_l2))
                second_line = {
                    "referrer_id": int(l2_id),
                    "referrer_telegram_id": row["l2_tg"],
                    "income": second_level_income,
                    "rate": l2_rate,
                }
                logger.info(
                    "Referral 2nd line credited: buyer=%s l1=%s l2=%s amount=%s",
                    user_id, l1_id, int(l2_id), second_level_income,
                )
        elif row["l1_id"] is not None and l2_id is None:
            logger.info(
                "Referral 2nd line skipped: buyer=%s direct_referrer=%s has no referred_by (upline).",
                user_id, l1_id,
            )

        conn.commit()
        return {
            "referrer_id": l1_id,
            "referrer_telegram_id": row["l1_tg"],
            "income": first_level_income,
            "rate": 20,
            "purchase_amount": purchase_amount,
            "second_line": second_line,
        }
    except Exception as e:
        logger.error(f"Referral income error: {e}")
        try:
            conn.rollback()
        except Exception:
            pass
        return None
    finally:
        conn.close()


def get_referrer_info(user_id: int) -> Optional[Dict]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT r.id, r.telegram_id, r.username, r.full_name
            FROM users u JOIN users r ON u.referred_by = r.id WHERE u.id = ?
        """, (user_id,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ===== СКВАДЫ =====

def get_all_squad_configs() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT * FROM squad_configs ORDER BY squad_type, priority DESC")
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_squads_for_subscription(subscription_type: str) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT sc.* FROM squad_configs sc
            JOIN subscription_squad_mapping ssm ON sc.squad_uuid = ssm.squad_uuid
            WHERE ssm.subscription_type = ? AND ssm.is_active = 1 AND sc.is_active = 1
            ORDER BY sc.priority DESC, sc.current_users ASC
        """, (subscription_type,))
        return [dict(row) for row in cursor.fetchall()]
    finally:
        conn.close()


def get_best_squad_for_subscription(subscription_type: str) -> Optional[Dict[str, Any]]:
    squads = get_squads_for_subscription(subscription_type)
    if not squads:
        return None
    available = [s for s in squads if s['max_users'] == 0 or s['current_users'] < s['max_users']]
    if not available:
        available = squads
    return min(available, key=lambda s: s['current_users'])


def update_squad_user_count(squad_uuid: str, delta: int = 1) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE squad_configs SET current_users = MAX(0, current_users + ?),
                                    updated_at = CURRENT_TIMESTAMP WHERE squad_uuid = ?
        """, (delta, squad_uuid))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def upsert_squad_config(squad_uuid: str, squad_name: str, squad_type: str,
                        max_users: int = 0, priority: int = 0) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO squad_configs (squad_uuid, squad_name, squad_type, max_users, priority)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(squad_uuid) DO UPDATE SET
                squad_name = excluded.squad_name, squad_type = excluded.squad_type,
                max_users = excluded.max_users, priority = excluded.priority,
                updated_at = CURRENT_TIMESTAMP
        """, (squad_uuid, squad_name, squad_type, max_users, priority))
        conn.commit()
        return True
    except:
        return False
    finally:
        conn.close()


def sync_squad_user_counts() -> None:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT squad_uuid, COUNT(*) as cnt FROM vpn_keys 
            WHERE squad_uuid IS NOT NULL AND status = 'Active' GROUP BY squad_uuid
        """)
        counts = {row['squad_uuid']: row['cnt'] for row in cursor.fetchall()}
        
        cursor.execute("SELECT squad_uuid FROM squad_configs")
        for row in cursor.fetchall():
            cursor.execute("UPDATE squad_configs SET current_users = ?, updated_at = CURRENT_TIMESTAMP WHERE squad_uuid = ?",
                          (counts.get(row['squad_uuid'], 0), row['squad_uuid']))
        conn.commit()
    except Exception as e:
        logger.error(f"Sync squad counts error: {e}")
        conn.rollback()
    finally:
        conn.close()


def get_subscription_squad_mapping() -> Dict[str, List[str]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT subscription_type, squad_uuid FROM subscription_squad_mapping WHERE is_active = 1")
        result = {'vpn': [], 'whitelist': [], 'trial': []}
        for row in cursor.fetchall():
            if row['subscription_type'] in result:
                result[row['subscription_type']].append(row['squad_uuid'])
        return result
    finally:
        conn.close()


def set_subscription_squads(subscription_type: str, squad_uuids: List[str]) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM subscription_squad_mapping WHERE subscription_type = ?", (subscription_type,))
        for uuid in squad_uuids:
            cursor.execute("INSERT INTO subscription_squad_mapping (subscription_type, squad_uuid) VALUES (?, ?)",
                          (subscription_type, uuid))
        conn.commit()
        return True
    except:
        conn.rollback()
        return False
    finally:
        conn.close()


# ===== АВТОРИЗАЦИЯ ПАНЕЛИ =====

def create_panel_admin(username: str, password: str) -> Optional[int]:
    import secrets
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO panel_admins (username, password_hash) VALUES (?, ?)",
                      (username, f"{salt}:{password_hash}"))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()


def verify_panel_admin(username: str, password: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, username, password_hash, is_active FROM panel_admins WHERE username = ? AND is_active = 1",
                      (username,))
        row = cursor.fetchone()
        if not row:
            return None
        
        salt, expected = row['password_hash'].split(':', 1)
        computed = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
        if computed != expected:
            return None
        
        cursor.execute("UPDATE panel_admins SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (row['id'],))
        conn.commit()
        return {'id': row['id'], 'username': row['username']}
    finally:
        conn.close()


def create_panel_session(admin_id: int) -> Optional[str]:
    import secrets
    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(days=7)
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM panel_sessions WHERE admin_id = ?", (admin_id,))
        cursor.execute("INSERT INTO panel_sessions (admin_id, session_token, expires_at) VALUES (?, ?, ?)",
                      (admin_id, token, expires.isoformat()))
        conn.commit()
        return token
    except:
        return None
    finally:
        conn.close()


def verify_panel_session(session_token: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT ps.*, pa.username FROM panel_sessions ps
            JOIN panel_admins pa ON ps.admin_id = pa.id
            WHERE ps.session_token = ? AND ps.expires_at > CURRENT_TIMESTAMP AND pa.is_active = 1
        """, (session_token,))
        row = cursor.fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def delete_panel_session(session_token: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM panel_sessions WHERE session_token = ?", (session_token,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def get_or_create_default_admin() -> Dict[str, str]:
    import secrets
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, username FROM panel_admins WHERE is_active = 1 LIMIT 1")
        row = cursor.fetchone()
        if row:
            return {'username': row['username'], 'password': None, 'exists': True}
        
        username = 'admin'
        password = secrets.token_urlsafe(12)
        admin_id = create_panel_admin(username, password)
        if admin_id:
            return {'username': username, 'password': password, 'exists': False}
        return {'username': None, 'password': None, 'exists': False}
    finally:
        conn.close()


def update_admin_password(admin_id: int, new_password: str) -> bool:
    import secrets
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256(f"{salt}:{new_password}".encode()).hexdigest()
    
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE panel_admins SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                      (f"{salt}:{password_hash}", admin_id))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def panel_is_ip_blocked(ip_address: str) -> Dict[str, Any]:
    """Проверить, заблокирован ли IP для входа в панель"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT failed_count, blocked_until FROM panel_ip_blocks WHERE ip_address = ?",
            (ip_address,),
        )
        row = cursor.fetchone()
        if not row:
            return {"blocked": False, "failed_count": 0, "blocked_until": None}
        blocked_until = row["blocked_until"]
        if blocked_until:
            try:
                # SQLite timestamp as string
                until_dt = datetime.fromisoformat(str(blocked_until).replace("Z", "+00:00").replace("+00:00", ""))
                if until_dt > datetime.utcnow():
                    return {"blocked": True, "failed_count": int(row["failed_count"] or 0), "blocked_until": str(blocked_until)}
            except Exception:
                # If cannot parse - treat as blocked
                return {"blocked": True, "failed_count": int(row["failed_count"] or 0), "blocked_until": str(blocked_until)}
        return {"blocked": False, "failed_count": int(row["failed_count"] or 0), "blocked_until": str(blocked_until) if blocked_until else None}
    finally:
        conn.close()


def panel_record_login_failure(ip_address: str, *, max_attempts: int = 5, block_minutes: int = 15) -> Dict[str, Any]:
    """Увеличить счётчик ошибок логина; при достижении max_attempts — блокировать IP"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT failed_count, blocked_until FROM panel_ip_blocks WHERE ip_address = ?",
            (ip_address,),
        )
        row = cursor.fetchone()
        failed = int(row["failed_count"] or 0) if row else 0
        failed += 1
        blocked_until = None
        if failed >= max_attempts:
            blocked_until = (datetime.utcnow() + timedelta(minutes=block_minutes)).isoformat()
        if row:
            cursor.execute(
                """
                UPDATE panel_ip_blocks
                SET failed_count = ?, blocked_until = COALESCE(?, blocked_until), updated_at = CURRENT_TIMESTAMP
                WHERE ip_address = ?
                """,
                (failed, blocked_until, ip_address),
            )
        else:
            cursor.execute(
                """
                INSERT INTO panel_ip_blocks (ip_address, failed_count, blocked_until)
                VALUES (?, ?, ?)
                """,
                (ip_address, failed, blocked_until),
            )
        conn.commit()
        return {"failed_count": failed, "blocked_until": blocked_until}
    finally:
        conn.close()


def panel_reset_login_failures(ip_address: str) -> None:
    """Сбросить счётчик ошибок логина для IP"""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE panel_ip_blocks SET failed_count = 0, blocked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE ip_address = ?",
            (ip_address,),
        )
        conn.commit()
    finally:
        conn.close()


# Инициализация при импорте
if __name__ != "__main__":
    init_database()
