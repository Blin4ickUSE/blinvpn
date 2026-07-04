"""
Отправка WARNING/ERROR логов администратору в Telegram.
Группирует одинаковые ошибки, фильтрует шум (неудачные отправки сообщений),
поддерживает исключение типов ошибок через inline-кнопку в боте.
"""
from __future__ import annotations

import hashlib
import html
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

from src.database import database

logger = logging.getLogger(__name__)

EXCLUDES_SETTING_KEY = 'admin_error_report_excludes'
FLUSH_DELAY_SEC = 30
EXCLUDES_CACHE_TTL_SEC = 5
MAX_SAMPLE_LEN = 600
MAX_USERS_SHOWN = 8

# Встроенные исключения — не слать админу (ошибки доставки сообщений и т.п.)
_BUILTIN_SKIP_SUBSTRINGS = (
    'sendmessage http',
    'sendmessage skipped',
    'failed to send notification',
    'failed to send via support bot',
    'support bot failed to send',
    'unreachable chat',
    'chat not found',
    'bot was blocked',
    'user is deactivated',
    'peer_id_invalid',
    'input user deactivated',
    'не удалось отправить',
    'failed to send message',
    'error sending to',
)

_SKIP_LOGGER_PREFIXES = (
    'src.core.admin_error_reporter',
    'urllib3',
)

_USER_PATTERNS = (
    re.compile(r'user[_\s=:]+\s*(\d+)', re.I),
    re.compile(r'user_id[_\s=:]+\s*(\d+)', re.I),
    re.compile(r'telegram_id[_\s=:]+\s*(\d+)', re.I),
    re.compile(r'\btg[_\s=:]+\s*(\d+)', re.I),
    re.compile(r'key[_\s=:]+\s*(\d+)', re.I),
)

_NORMALIZE_PATTERNS = (
    (re.compile(r'\b\d+\b'), '%N%'),
    (re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I), '%UUID%'),
)


@dataclass
class ErrorGroup:
    signature: str
    level: int
    level_name: str
    logger_name: str
    service: str
    normalized: str
    count: int = 0
    users: Set[str] = field(default_factory=set)
    samples: List[str] = field(default_factory=list)
    first_at: Optional[datetime] = None
    last_at: Optional[datetime] = None


_excluded_cache: Optional[Set[str]] = None
_excluded_cache_at: float = 0.0
_reporting = threading.local()
_handlers: List['AdminErrorReporterHandler'] = []


def _parse_excludes_raw(raw: str) -> List[Dict[str, str]]:
    import json
    data = json.loads(raw or '[]')
    if not isinstance(data, list):
        return []
    items: List[Dict[str, str]] = []
    seen: Set[str] = set()
    for entry in data:
        if isinstance(entry, str):
            sig = entry.strip()
            normalized = ''
        elif isinstance(entry, dict):
            sig = str(entry.get('signature') or entry.get('sig') or '').strip()
            normalized = str(entry.get('normalized') or entry.get('text') or '').strip()
        else:
            continue
        if not sig or sig in seen:
            continue
        seen.add(sig)
        items.append({'signature': sig, 'normalized': normalized})
    return items


def _load_exclude_items(*, fresh: bool = False) -> List[Dict[str, str]]:
    raw = database.get_system_setting(EXCLUDES_SETTING_KEY, '[]')
    try:
        return _parse_excludes_raw(raw)
    except Exception:
        return []


def _load_excludes(*, fresh: bool = False) -> Set[str]:
    return {item['signature'] for item in _load_exclude_items(fresh=fresh)}


def _save_exclude_items(items: List[Dict[str, str]]) -> bool:
    import json
    unique: Dict[str, Dict[str, str]] = {}
    for item in items:
        sig = (item.get('signature') or '').strip()
        if not sig:
            continue
        unique[sig] = {
            'signature': sig,
            'normalized': (item.get('normalized') or '').strip(),
        }
    payload = sorted(unique.values(), key=lambda x: x['signature'])
    return database.set_system_setting(EXCLUDES_SETTING_KEY, json.dumps(payload, ensure_ascii=False))


def _get_excludes() -> Set[str]:
    global _excluded_cache, _excluded_cache_at
    now = time.monotonic()
    if _excluded_cache is None or now - _excluded_cache_at > EXCLUDES_CACHE_TTL_SEC:
        _excluded_cache = _load_excludes(fresh=True)
        _excluded_cache_at = now
    return _excluded_cache


def _is_excluded(signature: str) -> bool:
    sig = (signature or '').strip()
    if not sig:
        return False
    return sig in _load_excludes(fresh=True)


def invalidate_excludes_cache() -> None:
    global _excluded_cache, _excluded_cache_at
    _excluded_cache = None
    _excluded_cache_at = 0.0


def list_error_excludes() -> List[Dict[str, str]]:
    """Список исключённых типов ошибок."""
    return _load_exclude_items(fresh=True)


def _drop_pending_group(signature: str) -> None:
    sig = (signature or '').strip()
    if not sig:
        return
    for handler in _handlers:
        with handler._lock:
            handler._groups.pop(sig, None)


def exclude_signature(signature: str, normalized: str = None) -> bool:
    """Добавить сигнатуру ошибки в исключения (вызывается из бота)."""
    sig = (signature or '').strip()
    if not sig:
        return False
    items = _load_exclude_items(fresh=True)
    if any(item['signature'] == sig for item in items):
        invalidate_excludes_cache()
        _drop_pending_group(sig)
        return True
    items.append({
        'signature': sig,
        'normalized': (normalized or '').strip(),
    })
    try:
        ok = _save_exclude_items(items)
        invalidate_excludes_cache()
        if ok:
            _drop_pending_group(sig)
        return ok
    except Exception as e:
        logger.error('Failed to save error exclude %s: %s', sig, e)
        return False


def include_signature(signature: str) -> bool:
    """Убрать сигнатуру из исключений."""
    sig = (signature or '').strip()
    if not sig:
        return False
    items = _load_exclude_items(fresh=True)
    filtered = [item for item in items if item['signature'] != sig]
    if len(filtered) == len(items):
        return False
    try:
        ok = _save_exclude_items(filtered)
        invalidate_excludes_cache()
        return ok
    except Exception as e:
        logger.error('Failed to remove error exclude %s: %s', sig, e)
        return False


def normalize_message(text: str) -> str:
    result = (text or '').strip()
    for pattern, repl in _NORMALIZE_PATTERNS:
        result = pattern.sub(repl, result)
    return result


def compute_signature(level_name: str, logger_name: str, message: str) -> str:
    first_line = (message or '').split('\n', 1)[0]
    normalized = normalize_message(first_line)
    payload = f'{level_name}|{logger_name}|{normalized}'
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:12]


def extract_users(text: str) -> Set[str]:
    users: Set[str] = set()
    for pattern in _USER_PATTERNS:
        for match in pattern.finditer(text or ''):
            users.add(match.group(1))
    return users


def _should_skip(record: logging.LogRecord, message: str) -> bool:
    if record.levelno < logging.WARNING:
        return True

    logger_name = record.name or ''
    for prefix in _SKIP_LOGGER_PREFIXES:
        if logger_name.startswith(prefix):
            return True

    haystack = f'{message} {logger_name}'.lower()
    for marker in _BUILTIN_SKIP_SUBSTRINGS:
        if marker in haystack:
            return True

    return False


def _record_message(record: logging.LogRecord) -> str:
    msg = record.getMessage()
    if record.exc_info:
        import traceback
        msg = f'{msg}\n{"".join(traceback.format_exception(*record.exc_info))}'
    return msg.strip()


def _format_admin_message(group: ErrorGroup) -> str:
    icon = '🔴' if group.level >= logging.ERROR else '⚠️'
    level_label = 'ERROR' if group.level >= logging.ERROR else 'WARNING'

    lines = [
        f'{icon} <b>{level_label}</b> · <code>{html.escape(group.service)}</code>',
        f'<b>{html.escape(group.normalized[:200])}</b>',
        '',
        f'Кол-во: <b>{group.count}</b>',
        f'Модуль: <code>{html.escape(group.logger_name)}</code>',
    ]

    if group.first_at and group.last_at:
        fmt = '%d.%m %H:%M:%S'
        if group.first_at.date() == group.last_at.date() and group.first_at == group.last_at:
            lines.append(f'Время: {group.first_at.strftime(fmt)} UTC')
        else:
            lines.append(
                f'Период: {group.first_at.strftime(fmt)} — {group.last_at.strftime(fmt)} UTC'
            )

    if group.users:
        shown = sorted(group.users, key=lambda x: int(x) if x.isdigit() else x)[:MAX_USERS_SHOWN]
        extra = len(group.users) - len(shown)
        users_text = ', '.join(shown)
        if extra > 0:
            users_text += f' (+{extra})'
        lines.append(f'Пользователи: <code>{html.escape(users_text)}</code>')

    sample = group.samples[-1] if group.samples else group.normalized
    if len(sample) > MAX_SAMPLE_LEN:
        sample = sample[:MAX_SAMPLE_LEN] + '…'
    lines.extend(['', 'Пример:', f'<pre>{html.escape(sample)}</pre>'])

    return '\n'.join(lines)


class AdminErrorReporterHandler(logging.Handler):
    """Группирует одинаковые WARNING/ERROR и отправляет админу одним сообщением."""

    def __init__(self, service_name: str):
        super().__init__(level=logging.WARNING)
        self.service_name = service_name
        self._lock = threading.Lock()
        self._groups: Dict[str, ErrorGroup] = {}
        self._flush_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self.setFormatter(logging.Formatter('%(message)s'))

    def start(self) -> None:
        if self._flush_thread and self._flush_thread.is_alive():
            return
        self._stop_event.clear()
        self._flush_thread = threading.Thread(
            target=self._flush_loop,
            name=f'admin-error-flush-{self.service_name}',
            daemon=True,
        )
        self._flush_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._flush_thread:
            self._flush_thread.join(timeout=2)
        self._flush_all()

    def emit(self, record: logging.LogRecord) -> None:
        if getattr(_reporting, 'active', False):
            return
        try:
            message = _record_message(record)
            if _should_skip(record, message):
                return

            signature = compute_signature(record.levelname, record.name, message)
            if signature in _get_excludes():
                return

            now = datetime.now(timezone.utc)
            with self._lock:
                group = self._groups.get(signature)
                if group is None:
                    group = ErrorGroup(
                        signature=signature,
                        level=record.levelno,
                        level_name=record.levelname,
                        logger_name=record.name,
                        service=self.service_name,
                        normalized=normalize_message(message.split('\n', 1)[0]),
                    )
                    self._groups[signature] = group

                group.count += 1
                group.last_at = now
                if group.first_at is None:
                    group.first_at = now
                group.users.update(extract_users(message))
                if len(group.samples) < 3:
                    group.samples.append(message.split('\n', 1)[0])
                elif group.samples:
                    group.samples[-1] = message.split('\n', 1)[0]
        except Exception:
            self.handleError(record)

    def _flush_loop(self) -> None:
        while not self._stop_event.wait(5):
            self._flush_ready()

    def _flush_ready(self) -> None:
        now = datetime.now(timezone.utc)
        to_flush: List[ErrorGroup] = []
        with self._lock:
            ready_sigs = []
            for sig, group in self._groups.items():
                if group.last_at and (now - group.last_at).total_seconds() >= FLUSH_DELAY_SEC:
                    ready_sigs.append(sig)
            for sig in ready_sigs:
                to_flush.append(self._groups.pop(sig))

        for group in to_flush:
            self._send_group(group)

    def _flush_all(self) -> None:
        with self._lock:
            groups = list(self._groups.values())
            self._groups.clear()
        for group in groups:
            self._send_group(group)

    def _send_group(self, group: ErrorGroup) -> None:
        if group.count <= 0:
            return
        if _is_excluded(group.signature):
            return
        try:
            from src.core import core

            text = _format_admin_message(group)
            reply_markup = {
                'inline_keyboard': [[
                    {'text': '🚫 Исключить', 'callback_data': f'err_excl:{group.signature}'},
                ]],
            }
            _reporting.active = True
            try:
                core.send_notification_to_admin(text, reply_markup=reply_markup)
            finally:
                _reporting.active = False
        except Exception as e:
            logger.debug('Admin error report failed: %s', e)


def attach_admin_error_reporter(service_name: str) -> AdminErrorReporterHandler:
    """Подключить handler к root logger (один раз на процесс)."""
    root = logging.getLogger()
    for handler in root.handlers:
        if isinstance(handler, AdminErrorReporterHandler):
            if handler not in _handlers:
                _handlers.append(handler)
            return handler

    reporter = AdminErrorReporterHandler(service_name)
    root.addHandler(reporter)
    if reporter not in _handlers:
        _handlers.append(reporter)
    reporter.start()
    return reporter


def setup_service_logging(service_name: str, level: int = logging.INFO) -> None:
    """Единая настройка логирования для сервисов проекта."""
    logging.basicConfig(
        level=level,
        format='%(asctime)s %(name)s %(levelname)s: %(message)s',
        force=True,
    )
    attach_admin_error_reporter(service_name)
