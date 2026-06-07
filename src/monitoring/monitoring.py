"""
Сервис мониторинга VPN-нод: ping, SSH-метрики, speedtest, логирование.
"""
import json
import logging
import os
import platform
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

try:
    import paramiko
except ImportError:
    paramiko = None  # type: ignore

LOG_DIR = Path(__file__).resolve().parent / 'logs'
MAX_LOG_BYTES = 15 * 1024 * 1024 * 1024  # 15 ГБ

PING_INTERVAL = 30
METRICS_INTERVAL = 60
SPEEDTEST_INTERVAL = 300

PING_SPIKE_THRESHOLD_MS = 100
PING_SPIKE_RATIO = 1.5
TRAFFIC_SPIKE_MBPS = 500

METRICS_SCRIPT = r"""#!/bin/bash
set -e
IFACE=$(ip route 2>/dev/null | awk '/default/ {print $5; exit}')
[ -z "$IFACE" ] && IFACE=$(ls /sys/class/net 2>/dev/null | grep -v lo | head -1)
CPU=$(grep 'cpu ' /proc/stat | awk '{usage=($2+$4)*100/($2+$4+$5)} END {printf "%.1f", usage}')
MEM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2}')
MEM_AVAIL=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
DISK=$(df / --output=pcent 2>/dev/null | tail -1 | tr -d ' %')
RX=0; TX=0
if [ -n "$IFACE" ] && [ -f "/sys/class/net/$IFACE/statistics/rx_bytes" ]; then
  RX=$(cat "/sys/class/net/$IFACE/statistics/rx_bytes")
  TX=$(cat "/sys/class/net/$IFACE/statistics/tx_bytes")
fi
LOAD1=$(awk '{print $1}' /proc/loadavg)
CORES=$(nproc 2>/dev/null || echo 1)
echo "{\"cpu\":$CPU,\"mem_total\":$MEM_TOTAL,\"mem_avail\":$MEM_AVAIL,\"disk\":$DISK,\"rx\":$RX,\"tx\":$TX,\"iface\":\"$IFACE\",\"load1\":$LOAD1,\"cores\":$CORES}"
"""

SPEEDTEST_INSTALL_SCRIPT = r"""#!/bin/bash
set -e
command -v speedtest >/dev/null 2>&1 && echo ookla && exit 0
command -v speedtest-cli >/dev/null 2>&1 && echo cli && exit 0
[ -x /usr/local/bin/speedtest ] && echo ookla && exit 0

ARCH=$(uname -m 2>/dev/null || echo x86_64)
case "$ARCH" in
  x86_64|amd64) ST_ARCH=linux-x86_64 ;;
  aarch64|arm64) ST_ARCH=linux-aarch64 ;;
  *) ST_ARCH=linux-x86_64 ;;
esac
TMP=/tmp/ookla-speedtest-install
rm -rf "$TMP" && mkdir -p "$TMP"
if command -v curl >/dev/null 2>&1; then
  if curl -fsSL "https://install.speedtest.net/app/cli/ookla-speedtest-1.2.0-${ST_ARCH}.tgz" -o "$TMP/s.tgz" 2>/dev/null; then
    tar -xzf "$TMP/s.tgz" -C "$TMP" 2>/dev/null || true
    BIN=$(find "$TMP" -name speedtest -type f 2>/dev/null | head -1)
    if [ -n "$BIN" ] && [ -f "$BIN" ]; then
      chmod +x "$BIN"
      cp "$BIN" /usr/local/bin/speedtest 2>/dev/null || ln -sf "$BIN" /usr/local/bin/speedtest 2>/dev/null || true
      command -v speedtest >/dev/null 2>&1 && echo ookla && exit 0
      [ -x /usr/local/bin/speedtest ] && echo ookla && exit 0
    fi
  fi
fi

if command -v pip3 >/dev/null 2>&1; then
  pip3 install -q speedtest-cli 2>/dev/null && echo cli && exit 0
fi
if command -v pip >/dev/null 2>&1; then
  pip install -q speedtest-cli 2>/dev/null && echo cli && exit 0
fi
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq 2>/dev/null || true
  apt-get install -y -qq speedtest-cli 2>/dev/null && echo cli && exit 0
fi
echo failed
exit 1
"""


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec='seconds')


def _parse_ping_ms(output: str) -> Optional[float]:
    if not output:
        return None
    patterns = [
        r'time[=<]([\d.]+)\s*ms',
        r'Average\s*=\s*([\d.]+)ms',
        r'=\s*([\d.]+)ms',
    ]
    for pattern in patterns:
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            try:
                return float(match.group(1))
            except ValueError:
                continue
    return None


def ping_host(host: str, timeout: int = 3) -> Dict[str, Any]:
    """ICMP ping с главного сервера."""
    system = platform.system().lower()
    try:
        if system == 'windows':
            cmd = ['ping', '-n', '1', '-w', str(timeout * 1000), host]
        else:
            cmd = ['ping', '-c', '1', '-W', str(timeout), host]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout + 2,
        )
        if result.returncode == 0:
            ms = _parse_ping_ms(result.stdout)
            return {'ok': True, 'ping_ms': ms, 'error': None}
        return {'ok': False, 'ping_ms': None, 'error': 'unreachable'}
    except subprocess.TimeoutExpired:
        return {'ok': False, 'ping_ms': None, 'error': 'timeout'}
    except FileNotFoundError:
        return {'ok': False, 'ping_ms': None, 'error': 'ping_not_available'}
    except Exception as exc:
        return {'ok': False, 'ping_ms': None, 'error': str(exc)}


class LogManager:
    """JSONL-логи с ротацией до 15 ГБ."""

    def __init__(self, log_dir: Path = LOG_DIR, max_bytes: int = MAX_LOG_BYTES):
        self.log_dir = log_dir
        self.max_bytes = max_bytes
        self._lock = threading.Lock()
        self.log_dir.mkdir(parents=True, exist_ok=True)

    def append(self, node_id: int, record: Dict[str, Any]) -> None:
        with self._lock:
            node_dir = self.log_dir / f'node_{node_id}'
            node_dir.mkdir(parents=True, exist_ok=True)
            day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            path = node_dir / f'metrics_{day}.jsonl'
            line = json.dumps(record, ensure_ascii=False) + '\n'
            with open(path, 'a', encoding='utf-8') as fh:
                fh.write(line)
            self._enforce_limit()

    def _total_size(self) -> int:
        total = 0
        for root, _dirs, files in os.walk(self.log_dir):
            for name in files:
                try:
                    total += os.path.getsize(os.path.join(root, name))
                except OSError:
                    pass
        return total

    def _enforce_limit(self) -> None:
        if self._total_size() <= self.max_bytes:
            return
        files: List[tuple[float, str]] = []
        for root, _dirs, names in os.walk(self.log_dir):
            for name in names:
                path = os.path.join(root, name)
                try:
                    files.append((os.path.getmtime(path), path))
                except OSError:
                    pass
        files.sort()
        for _mtime, path in files:
            if self._total_size() <= self.max_bytes:
                break
            try:
                os.remove(path)
                logger.info('Monitoring log rotated: removed %s', path)
            except OSError as exc:
                logger.warning('Failed to remove log %s: %s', path, exc)

    def read_history(
        self,
        node_id: int,
        metric_type: Optional[str] = None,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        node_dir = self.log_dir / f'node_{node_id}'
        if not node_dir.exists():
            return []
        files = sorted(node_dir.glob('metrics_*.jsonl'), reverse=True)
        records: List[Dict[str, Any]] = []
        for path in files:
            try:
                with open(path, 'r', encoding='utf-8') as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            rec = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if metric_type:
                            rec_type = rec.get('type')
                            if metric_type == 'speedtest':
                                if rec_type not in ('speedtest', 'speedtest_error'):
                                    continue
                            elif rec_type != metric_type:
                                continue
                        records.append(rec)
            except OSError:
                continue
            if len(records) >= limit:
                break
        records.sort(key=lambda r: r.get('ts', ''), reverse=True)
        return records[:limit]

    def get_storage_info(self) -> Dict[str, Any]:
        total = self._total_size()
        return {
            'used_bytes': total,
            'max_bytes': self.max_bytes,
            'used_percent': round(total / self.max_bytes * 100, 2) if self.max_bytes else 0,
        }


class SSHClient:
    """SSH-подключение к ноде."""

    def __init__(self, host: str, port: int, username: str, password: str):
        self.host = host
        self.port = port
        self.username = username
        self.password = password

    def _connect(self) -> 'paramiko.SSHClient':
        if paramiko is None:
            raise RuntimeError('paramiko не установлен')
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(
            self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            timeout=20,
            banner_timeout=20,
            auth_timeout=20,
            look_for_keys=False,
            allow_agent=False,
        )
        return client

    def run(self, command: str, timeout: int = 120) -> tuple[int, str, str]:
        client = self._connect()
        try:
            _stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode('utf-8', errors='replace').strip()
            err = stderr.read().decode('utf-8', errors='replace').strip()
            code = stdout.channel.recv_exit_status()
            return code, out, err
        finally:
            client.close()

    @staticmethod
    def _extract_json(text: str) -> Dict[str, Any]:
        text = (text or '').strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            start = text.find('{')
            end = text.rfind('}')
            if start >= 0 and end > start:
                return json.loads(text[start:end + 1])
        raise ValueError('JSON не найден в ответе speedtest')

    def ensure_speedtest(self) -> str:
        code, out, err = self.run(f'bash -s <<\'SCRIPT\'\n{SPEEDTEST_INSTALL_SCRIPT}\nSCRIPT', timeout=240)
        lines = [line.strip() for line in (out or '').splitlines() if line.strip()]
        tool = lines[-1] if lines else ''
        if code == 0 and tool in ('ookla', 'cli'):
            return tool
        raise RuntimeError(err or out or 'Не удалось установить speedtest')

    def collect_metrics(self) -> Dict[str, Any]:
        code, out, err = self.run(f'bash -s <<\'SCRIPT\'\n{METRICS_SCRIPT}\nSCRIPT', timeout=30)
        if code != 0 or not out:
            raise RuntimeError(err or 'Пустой ответ метрик')
        data = json.loads(out)
        data['mem_used_percent'] = round(
            (1 - data['mem_avail'] / data['mem_total']) * 100, 1
        ) if data.get('mem_total') else 0
        return data

    def _parse_speedtest_result(self, raw: Dict[str, Any], tool: str) -> Dict[str, Any]:
        if tool == 'ookla':
            dl = float(raw.get('download', {}).get('bandwidth', 0) or 0) * 8 / 1_000_000
            ul = float(raw.get('upload', {}).get('bandwidth', 0) or 0) * 8 / 1_000_000
            ping_ms = raw.get('ping', {}).get('latency')
            jitter = raw.get('ping', {}).get('jitter')
        else:
            dl = float(raw.get('download', 0) or 0) / 1_000_000
            ul = float(raw.get('upload', 0) or 0) / 1_000_000
            ping_ms = raw.get('ping')
            jitter = None
        return {
            'download_mbps': round(dl, 2),
            'upload_mbps': round(ul, 2),
            'ping_ms': round(float(ping_ms), 2) if ping_ms is not None else None,
            'jitter_ms': round(float(jitter), 2) if jitter is not None else None,
            'tool': tool,
        }

    def run_speedtest(self, tool: str) -> Dict[str, Any]:
        if tool == 'ookla':
            commands = [
                'speedtest --accept-license --accept-gdpr --format=json -p no',
                'speedtest -f json -p no',
                '/usr/local/bin/speedtest --accept-license --accept-gdpr --format=json -p no',
            ]
        else:
            commands = [
                'speedtest-cli --json',
                'python3 -m speedtest --json',
            ]

        last_err = ''
        for cmd in commands:
            code, out, err = self.run(cmd, timeout=180)
            if out and '{' in out:
                try:
                    raw = self._extract_json(out)
                    return self._parse_speedtest_result(raw, tool)
                except Exception as exc:
                    last_err = str(exc)
                    continue
            last_err = err or out or f'exit {code}'

        if tool == 'ookla':
            return self.run_speedtest('cli')
        raise RuntimeError(last_err or 'Speedtest failed')


class NodeWorker:
    """Фоновый воркер для одной ноды."""

    def __init__(
        self,
        node_id: int,
        config: Dict[str, Any],
        log_manager: LogManager,
        event_callback,
    ):
        self.node_id = node_id
        self.config = config
        self.log_manager = log_manager
        self.event_callback = event_callback
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._state: Dict[str, Any] = {
            'node_id': node_id,
            'name': config.get('name'),
            'host': config.get('host'),
            'online': False,
            'ping_ms': None,
            'last_ping_at': None,
            'last_ping_ok': None,
            'ping_failures': 0,
            'cpu_percent': None,
            'mem_percent': None,
            'disk_percent': None,
            'rx_bytes': None,
            'tx_bytes': None,
            'rx_mbps': None,
            'tx_mbps': None,
            'iface': None,
            'load1': None,
            'speedtest': None,
            'last_speedtest_at': None,
            'ssh_ok': False,
            'ssh_error': None,
            'last_metrics_at': None,
            'speedtest_tool': None,
            'speedtest_error': None,
            'speedtest_running': False,
            'updated_at': _utc_now(),
        }
        self._prev_traffic: Optional[tuple[int, int, float]] = None
        self._baseline_ping: Optional[float] = None
        self._was_online = True
        self._speedtest_tool: Optional[str] = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._run,
            name=f'monitor-node-{self.node_id}',
            daemon=True,
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def get_state(self) -> Dict[str, Any]:
        with self._lock:
            return dict(self._state)

    def update_config(self, config: Dict[str, Any]) -> None:
        with self._lock:
            self.config = config
            self._state['name'] = config.get('name')
            self._state['host'] = config.get('host')

    def _update_state(self, **kwargs) -> None:
        with self._lock:
            self._state.update(kwargs)
            self._state['updated_at'] = _utc_now()

    def _log(self, metric_type: str, data: Dict[str, Any]) -> None:
        record = {'ts': _utc_now(), 'type': metric_type, 'node_id': self.node_id, 'data': data}
        self.log_manager.append(self.node_id, record)

    def _emit_event(self, event_type: str, message: str, details: Optional[Dict] = None) -> None:
        try:
            self.event_callback(self.node_id, event_type, message, details or {})
        except Exception as exc:
            logger.warning('Event callback error: %s', exc)

    def _ssh(self) -> SSHClient:
        return SSHClient(
            host=self.config['host'],
            port=int(self.config.get('ssh_port') or 22),
            username=self.config['ssh_user'],
            password=self.config['ssh_password'],
        )

    def _handle_ping(self, now: float) -> None:
        host = self.config['host']
        result = ping_host(host)
        ts = _utc_now()
        self._log('ping', result)
        if result['ok']:
            ping_ms = result.get('ping_ms')
            self._update_state(
                online=True,
                ping_ms=ping_ms,
                last_ping_at=ts,
                last_ping_ok=True,
                ping_failures=0,
            )
            if not self._was_online:
                self._emit_event('recovery', f'Нода {host} снова отвечает на ping', {'ping_ms': ping_ms})
                self._was_online = True
            if ping_ms is not None:
                if self._baseline_ping is None:
                    self._baseline_ping = ping_ms
                elif ping_ms > PING_SPIKE_THRESHOLD_MS and ping_ms > self._baseline_ping * PING_SPIKE_RATIO:
                    self._emit_event(
                        'ping_spike',
                        f'Рост пинга на {host}: {ping_ms:.0f} мс (база {self._baseline_ping:.0f} мс)',
                        {'ping_ms': ping_ms, 'baseline_ms': self._baseline_ping},
                    )
                self._baseline_ping = self._baseline_ping * 0.9 + ping_ms * 0.1
        else:
            failures = self._state.get('ping_failures', 0) + 1
            self._update_state(
                online=False,
                last_ping_at=ts,
                last_ping_ok=False,
                ping_failures=failures,
            )
            if self._was_online:
                self._emit_event(
                    'downtime',
                    f'Нода {host} не отвечает на ping',
                    {'error': result.get('error')},
                )
                self._was_online = False

    def _handle_metrics(self, now: float) -> None:
        try:
            ssh = self._ssh()
            metrics = ssh.collect_metrics()
            rx = int(metrics.get('rx') or 0)
            tx = int(metrics.get('tx') or 0)
            rx_mbps = None
            tx_mbps = None
            if self._prev_traffic:
                prev_rx, prev_tx, prev_t = self._prev_traffic
                dt = max(now - prev_t, 1)
                rx_mbps = round((rx - prev_rx) * 8 / dt / 1_000_000, 2)
                tx_mbps = round((tx - prev_tx) * 8 / dt / 1_000_000, 2)
                if rx_mbps > TRAFFIC_SPIKE_MBPS:
                    self._emit_event(
                        'traffic_spike',
                        f'Высокий входящий трафик на {self.config["host"]}: {rx_mbps:.0f} Мбит/с',
                        {'rx_mbps': rx_mbps, 'iface': metrics.get('iface')},
                    )
            self._prev_traffic = (rx, tx, now)
            metrics['rx_mbps'] = rx_mbps
            metrics['tx_mbps'] = tx_mbps
            self._log('system', metrics)
            self._update_state(
                ssh_ok=True,
                ssh_error=None,
                cpu_percent=metrics.get('cpu'),
                mem_percent=metrics.get('mem_used_percent'),
                disk_percent=metrics.get('disk'),
                rx_bytes=rx,
                tx_bytes=tx,
                rx_mbps=rx_mbps,
                tx_mbps=tx_mbps,
                iface=metrics.get('iface'),
                load1=metrics.get('load1'),
                last_metrics_at=_utc_now(),
            )
        except Exception as exc:
            logger.warning('SSH metrics error node %s: %s', self.node_id, exc)
            self._update_state(ssh_ok=False, ssh_error=str(exc))
            self._log('ssh_error', {'error': str(exc)})

    def _handle_speedtest(self) -> None:
        self._update_state(speedtest_running=True, speedtest_error=None)
        try:
            ssh = self._ssh()
            if not self._speedtest_tool:
                self._speedtest_tool = ssh.ensure_speedtest()
            result = ssh.run_speedtest(self._speedtest_tool)
            self._log('speedtest', result)
            self._update_state(
                speedtest=result,
                last_speedtest_at=_utc_now(),
                speedtest_tool=self._speedtest_tool,
                speedtest_error=None,
                speedtest_running=False,
            )
        except Exception as exc:
            logger.warning('Speedtest error node %s: %s', self.node_id, exc)
            self._speedtest_tool = None
            self._log('speedtest_error', {'error': str(exc)})
            self._update_state(speedtest_error=str(exc), speedtest_running=False)

    def _run(self) -> None:
        last_ping = 0.0
        last_metrics = 0.0
        last_speedtest = 0.0
        logger.info('Monitoring started for node %s (%s)', self.node_id, self.config.get('host'))
        while not self._stop.is_set():
            now = time.monotonic()
            try:
                if now - last_ping >= PING_INTERVAL:
                    self._handle_ping(now)
                    last_ping = now
                if now - last_metrics >= METRICS_INTERVAL:
                    self._handle_metrics(now)
                    last_metrics = now
                if now - last_speedtest >= SPEEDTEST_INTERVAL:
                    self._handle_speedtest()
                    last_speedtest = now
            except Exception as exc:
                logger.error('Monitor loop error node %s: %s', self.node_id, exc)
            self._stop.wait(5)
        logger.info('Monitoring stopped for node %s', self.node_id)


class MonitoringService:
    """Глобальный сервис мониторинга."""

    def __init__(self):
        self.log_manager = LogManager()
        self._workers: Dict[int, NodeWorker] = {}
        self._lock = threading.Lock()
        self._started = False

    def _on_event(self, node_id: int, event_type: str, message: str, details: Dict) -> None:
        from src.database import database
        database.create_monitoring_event(node_id, event_type, message, details)

    def start(self) -> None:
        if self._started:
            return
        from src.database import database
        nodes = database.get_monitoring_nodes(active_only=True)
        with self._lock:
            for node in nodes:
                self._start_worker(node)
            self._started = True
        logger.info('Monitoring service started (%d nodes)', len(nodes))

    def _start_worker(self, node: Dict[str, Any]) -> None:
        node_id = node['id']
        if node_id in self._workers:
            self._workers[node_id].stop()
        worker = NodeWorker(node_id, node, self.log_manager, self._on_event)
        self._workers[node_id] = worker
        worker.start()

    def stop_worker(self, node_id: int) -> None:
        with self._lock:
            worker = self._workers.pop(node_id, None)
        if worker:
            worker.stop()

    def reload_node(self, node_id: int) -> None:
        from src.database import database
        node = database.get_monitoring_node(node_id)
        if not node:
            self.stop_worker(node_id)
            return
        if node.get('is_active'):
            with self._lock:
                self._start_worker(node)
        else:
            self.stop_worker(node_id)

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            nodes = [w.get_state() for w in self._workers.values()]
        return {
            'nodes': sorted(nodes, key=lambda n: n.get('node_id', 0)),
            'storage': self.log_manager.get_storage_info(),
            'intervals': {
                'ping_sec': PING_INTERVAL,
                'metrics_sec': METRICS_INTERVAL,
                'speedtest_sec': SPEEDTEST_INTERVAL,
            },
        }

    def get_node_status(self, node_id: int) -> Optional[Dict[str, Any]]:
        worker = self._workers.get(node_id)
        if worker:
            return worker.get_state()
        return None

    def get_history(
        self,
        node_id: int,
        metric_type: Optional[str] = None,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        return self.log_manager.read_history(node_id, metric_type, limit)


monitoring_service = MonitoringService()
