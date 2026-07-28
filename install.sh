#!/usr/bin/env bash
set -Eeuo pipefail

GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
RED=$'\033[0;31m'
NC=$'\033[0m'
BOLD=$'\033[1m'
DIM=$'\033[2m'

log_info() { echo -e "${CYAN}$1${NC}"; }
log_warn() { echo -e "${YELLOW}$1${NC}"; }
log_success() { echo -e "${GREEN}$1${NC}"; }
log_error() { echo -e "${RED}$1${NC}" >&2; }

on_error() {
    log_error "Ошибка на строке $1. Установка прервана."
}
trap 'on_error $LINENO' ERR

prompt() {
    local message="$1"
    local __var="$2"
    local value
    read -r -p "$message" value < /dev/tty
    printf -v "$__var" '%s' "$value"
}

confirm() {
    local message="$1"
    local reply
    read -r -n1 -p "$message" reply < /dev/tty || true
    echo
    [[ "$reply" =~ ^[Yy]$ ]]
}

sanitize_domain() {
    local input="$1"
    echo "$input" \
        | sed -e 's%^https\?://%%' -e 's%/.*$%%' \
        | tr -cd 'A-Za-z0-9.-' \
        | tr '[:upper:]' '[:lower:]'
}

get_server_ip() {
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    for url in \
        "https://api.ipify.org" \
        "https://ifconfig.co/ip" \
        "https://ipv4.icanhazip.com"; do
        ip=$(curl -fsS "$url" 2>/dev/null | tr -d '\r\n\t ')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    done
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
    fi
}

resolve_domain_ip() {
    local domain="$1"
    local ipv4_re='^([0-9]{1,3}\.){3}[0-9]{1,3}$'
    local ip
    ip=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | head -n1)
    if [[ $ip =~ $ipv4_re ]]; then
        echo "$ip"
        return 0
    fi
    if command -v dig >/dev/null 2>&1; then
        ip=$(dig +short A "$domain" 2>/dev/null | grep -E "$ipv4_re" | head -n1)
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    if command -v nslookup >/dev/null 2>&1; then
        ip=$(nslookup -type=A "$domain" 2>/dev/null | awk '/^Address: /{print $2; exit}')
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    return 1
}

ensure_packages() {
    log_info "\nшаг 1: установка системных зависимостей"
    declare -A packages=(
        [git]='git'
        [docker]='docker.io'
        [docker-compose]='docker-compose'
        [nginx]='nginx'
        [curl]='curl'
        [certbot]='certbot'
        [dig]='dnsutils'
    )
    local missing=()
    for cmd in "${!packages[@]}"; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_warn "❗'$cmd' не найдена. установливаем пакет '${packages[$cmd]}'..."
            missing+=("${packages[$cmd]}")
        else
            log_success "✔ $cmd уже установлен."
        fi
    done
    if ((${#missing[@]})); then
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends "${missing[@]}"
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    else
        log_info "все необходимые пакеты уже присутствуют."
    fi
}

ensure_services() {
    for service in docker nginx; do
        if ! sudo systemctl is-active --quiet "$service"; then
            log_warn "сервис $service не запущен. запускаем..."
            sudo systemctl enable "$service"
            sudo systemctl start "$service"
        else
            log_success "✔ сервис $service активен."
        fi
    done
}

ensure_certbot_nginx() {
    log_info "\nпроверка плагина Certbot"

    local has_nginx_plugin=0
    if command -v certbot >/dev/null 2>&1; then
        if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
            has_nginx_plugin=1
        fi
    fi

    if [[ $has_nginx_plugin -eq 1 ]]; then
        log_success "✔ плагин nginx для Certbot найден."
        return
    fi

    if command -v apt-get >/dev/null 2>&1; then
        log_info "устанавливаю плагин python3-certbot-nginx..."
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        sudo apt-get update
        if sudo apt-get install -y --no-install-recommends python3-certbot-nginx; then
            if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
                log_success "✔ плагин nginx для Certbot установлен (apt)."
                unset DEBIAN_FRONTEND
                unset DEBCONF_NONINTERACTIVE_SEEN
                return
            fi
        fi
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    fi

    log_warn "пробую установить Certbot (snap) с поддержкой nginx."
    if ! command -v snap >/dev/null 2>&1; then
        export DEBIAN_FRONTEND=noninteractive
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends snapd
        unset DEBIAN_FRONTEND
    fi
    sudo snap install core || true
    sudo snap refresh core || true
    sudo snap install --classic certbot
    sudo ln -sf /snap/bin/certbot /usr/bin/certbot

    if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
        log_success "✔ плагин nginx для Certbot доступен (snap)."
        return
    fi

    log_error "❗ плагин nginx для Certbot недоступен."
    exit 1
}

SITE_ROOT="/var/www/blinvpn-site"

deploy_site_files() {
    log_info "\nпубликация лендинга в ${SITE_ROOT}"
    sudo mkdir -p "$SITE_ROOT"
    if [[ -d "src/site" ]]; then
        sudo rsync -a --delete "src/site/" "${SITE_ROOT}/" 2>/dev/null \
            || sudo cp -a src/site/. "${SITE_ROOT}/"
        if [[ -d "assets" ]]; then
            sudo mkdir -p "${SITE_ROOT}/assets"
            sudo rsync -a assets/ "${SITE_ROOT}/assets/" 2>/dev/null \
                || sudo cp -a assets/. "${SITE_ROOT}/assets/"
        fi
        sudo chown -R www-data:www-data "$SITE_ROOT" 2>/dev/null || true
        log_success "✔ файлы сайта развёрнуты."
    else
        log_warn "каталог src/site не найден — пропускаем публикацию лендинга."
    fi
}

configure_nginx() {
    local miniapp_domain="$1"
    local panel_domain="$2"
    local site_domain="$3"
    local ssl_port="$4"
    local nginx_conf="$5"
    local nginx_link="$6"

    log_info "\nнастройка Nginx с SSL на порту ${ssl_port}"
    sudo rm -f /etc/nginx/sites-enabled/default
    
    sudo tee "$nginx_conf" >/dev/null <<EOF
# Мини-приложение
server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${miniapp_domain};

    ssl_certificate /etc/letsencrypt/live/${miniapp_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${miniapp_domain}/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9741;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
        proxy_connect_timeout 15s;
    }

    location ~* \\.(js|css|woff2?|png|jpg|svg|ico)$ {
        proxy_pass http://127.0.0.1:9741;
        proxy_set_header Host \$host;
        add_header Cache-Control "public, max-age=86400";
    }

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /heleket {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /platega {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /rollypay {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /paypear {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /cryptopay {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# Панель управления
server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${panel_domain};

    ssl_certificate /etc/letsencrypt/live/${panel_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${panel_domain}/privkey.pem;

    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:9742;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# Маркетинговый сайт (статика)
server {
    listen ${ssl_port} ssl http2;
    listen [::]:${ssl_port} ssl http2;
    server_name ${site_domain};

    ssl_certificate /etc/letsencrypt/live/${site_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${site_domain}/privkey.pem;

    root ${SITE_ROOT};
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \\.(js|css|woff2?|png|jpg|jpeg|svg|ico|webp|gif)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files \$uri =404;
    }
}
EOF

    sudo rm -f "$nginx_link"
    sudo ln -s "$nginx_conf" "$nginx_link"
    sudo nginx -t
    sudo systemctl reload nginx
    log_success "✔ конфигурация Nginx обновлена."
}

# Рамка-заголовок секции
section() {
    local title="$1"
    local width=62
    local pad=$(( (width - ${#title} - 2) / 2 ))
    printf '\n'
    printf "${CYAN}╭%s╮${NC}\n" "$(printf '─%.0s' $(seq 1 $width))"
    printf "${CYAN}│${NC}%*s${BOLD}%s${NC}%*s${CYAN}│${NC}\n" \
        $((pad + 1)) "" "$title" $((width - pad - ${#title} - 1)) ""
    printf "${CYAN}╰%s╯${NC}\n" "$(printf '─%.0s' $(seq 1 $width))"
}

# Пронумерованный шаг внутри секции
step() {
    printf "  ${GREEN}%s${NC}  %s\n" "$1" "$2"
}

# Подсказка-сноска (приглушённая)
hint() {
    printf "     ${DIM}↳ %s${NC}\n" "$1"
}

create_env_file() {
    local domain="$1"
    local panel_domain="$2"
    local site_domain="$3"
    local email="$4"
    local ssl_port="$5"

    section "Настройка переменных окружения"

    # ── Основной бот ────────────────────────────────────────
    section "Основной Telegram-бот"
    prompt "  ${BOLD}Токен бота${NC}  (основной бот): " TELEGRAM_BOT_TOKEN
    prompt "  ${BOLD}ID админа${NC}   (ваш Telegram ID): " TELEGRAM_ADMIN_ID

    # ── Форум-группа уведомлений ────────────────────────────
    section "Форум-группа для служебных уведомлений"
    echo -e "  Создайте группу-форум в Telegram, добавьте бота и получите ID группы."
    echo -e "  Оставьте поле пустым — уведомления будут приходить в личку админа.\n"
    prompt "  ${BOLD}ID форум-группы${NC}  (например -1001234567890, или Enter чтобы пропустить): " NOTIFY_GROUP_ID
    if [[ -n "$NOTIFY_GROUP_ID" ]]; then
        prompt "  ${BOLD}ID ветки «Пополнения»${NC}  (message_thread_id топика): " NOTIFY_THREAD_DEPOSITS
        prompt "  ${BOLD}ID ветки «Ошибки»${NC}      (message_thread_id топика): " NOTIFY_THREAD_ERRORS
        prompt "  ${BOLD}ID ветки «Выводы»${NC}       (message_thread_id топика): " NOTIFY_THREAD_WITHDRAWALS
    else
        NOTIFY_GROUP_ID=""
        NOTIFY_THREAD_DEPOSITS=""
        NOTIFY_THREAD_ERRORS=""
        NOTIFY_THREAD_WITHDRAWALS=""
    fi

    # ── Бот поддержки ───────────────────────────────────────
    section "Бот поддержки"
    prompt "  ${BOLD}Токен бота поддержки${NC}: " SUPPORT_BOT_TOKEN
    prompt "  ${BOLD}ID группы поддержки${NC}  (например -1001234567890): " SUPPORT_GROUP_ID
    prompt "  ${BOLD}Юзернеймы админов${NC}    (без @, по умолч. blin4icks): " SUPPORT_ADMIN_USERNAME_INPUT
    SUPPORT_ADMIN_USERNAME="${SUPPORT_ADMIN_USERNAME_INPUT:-blin4icks}"

    # ── Remnawave ───────────────────────────────────────────
    section "Remnawave · панель управления VPN"
    prompt "  ${BOLD}Panel URL${NC}  (по умолч. http://localhost:3000): " REMWAVE_PANEL_URL_INPUT
    REMWAVE_PANEL_URL="${REMWAVE_PANEL_URL_INPUT:-http://localhost:3000}"
    prompt "  ${BOLD}API Token${NC}  (из панели Remnawave): " REMWAVE_API_KEY
    
    # Формируем URL с портом если не 443
    local port_suffix=""
    if [[ "$ssl_port" != "443" ]]; then
        port_suffix=":${ssl_port}"
    fi
    
    cat > .env <<EOF
# ===== телеграм =====
# оснонвой бот
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_ADMIN_ID=${TELEGRAM_ADMIN_ID}
BOT_USERNAME=blinvpn_bot
VITE_BOT_USERNAME=blinvpn_bot

# форум-группа уведомлений
NOTIFY_GROUP_ID=${NOTIFY_GROUP_ID}
NOTIFY_THREAD_DEPOSITS=${NOTIFY_THREAD_DEPOSITS}
NOTIFY_THREAD_ERRORS=${NOTIFY_THREAD_ERRORS}
NOTIFY_THREAD_WITHDRAWALS=${NOTIFY_THREAD_WITHDRAWALS}

# бот поддержки
SUPPORT_BOT_TOKEN=${SUPPORT_BOT_TOKEN}
SUPPORT_GROUP_ID=${SUPPORT_GROUP_ID}
SUPPORT_ADMIN_USERNAME=${SUPPORT_ADMIN_USERNAME}
SUPPORT_URL=https://t.me/blinteams
VITE_SUPPORT_URL=https://t.me/blinteams

# ===== remnawave =====
REMWAVE_PANEL_URL=${REMWAVE_PANEL_URL}
REMWAVE_API_KEY=${REMWAVE_API_KEY}

# ===== Платежные системы =====
# Heleket
HELEKET_API_URL=https://api.heleket.com
HELEKET_MERCHANT=
HELEKET_API_KEY=

# Platega
PLATEGA_API_URL=https://app.platega.io
PLATEGA_MERCHANT_ID=
PLATEGA_SECRET_KEY=


# ===== URLs =====
MINIAPP_URL=https://${domain}${port_suffix}
PANEL_URL=https://${panel_domain}${port_suffix}
SITE_URL=https://${site_domain}${port_suffix}
WEBHOOK_URL=https://${domain}${port_suffix}
API_URL=https://${domain}${port_suffix}/api
PLATEGA_RETURN_URL=https://${domain}${port_suffix}/success
PLATEGA_FAILED_URL=https://${domain}${port_suffix}/failed
PAYPEAR_RETURN_URL=https://${domain}${port_suffix}/success
PAYPEAR_WEBHOOK_URL=https://${domain}${port_suffix}/paypear

# Ports (внутренние)
API_PORT=8000
WEBHOOK_PORT=5000
MINIAPP_PORT=9741
PANEL_PORT=9742
SSL_PORT=${ssl_port}

# Database
DB_PATH=data/data.db

# SSL
SSL_EMAIL=${email}
PANEL_DOMAIN=${panel_domain}
SITE_DOMAIN=${site_domain}
MINIAPP_DOMAIN=${domain}
WEBHOOK_DOMAIN=${domain}
EOF

    log_success "✔ Файл .env создан."
    log_warn "\n⚠️  Платежные системы (Heleket, Platega, CryptoBot) настраиваются"
    log_warn "   в панели управления: https://${panel_domain}${port_suffix}"
}

register_telegram_webhook() {
    local bot_token="$1"
    local domain="$2"
    local ssl_port="$3"

    # По умолчанию Stars обрабатывает контейнер bot через polling (pre_checkout_query).
    # Webhook на API конфликтует: при рестарте bot вызывает deleteWebhook и оплата зависает.
    if [[ "${TELEGRAM_STARS_DELIVERY:-bot}" == "bot" ]]; then
        log_info "\nTelegram Stars: режим bot (polling), webhook на API не регистрируется."
        log_info "  Для webhook-режима задайте TELEGRAM_STARS_DELIVERY=webhook в .env"
        return 0
    fi

    if [[ -z "$bot_token" ]]; then
        log_warn "⚠️  TELEGRAM_BOT_TOKEN не задан — регистрация Telegram webhook пропущена."
        return 0
    fi

    local port_suffix=""
    if [[ "$ssl_port" != "443" ]]; then
        port_suffix=":${ssl_port}"
    fi

    local webhook_url="https://${domain}${port_suffix}/api/telegram/webhook"
    local allowed_updates='["message","callback_query","pre_checkout_query","shipping_query"]'

    log_info "\nРегистрация Telegram webhook (Telegram Stars)..."
    log_info "  URL: ${webhook_url}"

    local response http_code body
    response=$(curl -s -w "\n%{http_code}" -X POST \
        "https://api.telegram.org/bot${bot_token}/setWebhook" \
        -H "Content-Type: application/json" \
        -d "{\"url\":\"${webhook_url}\",\"allowed_updates\":${allowed_updates}}" \
        --max-time 15 2>/dev/null || true)

    body=$(echo "$response" | head -n -1)
    http_code=$(echo "$response" | tail -n1)

    if echo "$body" | grep -q '"ok":true'; then
        log_success "✔ Telegram webhook успешно зарегистрирован."
    else
        log_warn "⚠️  Не удалось зарегистрировать Telegram webhook (HTTP ${http_code})."
        log_warn "   Ответ: ${body}"
        log_warn "   Зарегистрируйте вручную:"
        log_warn "   https://api.telegram.org/bot<TOKEN>/setWebhook?url=${webhook_url}&allowed_updates=%5B%22message%22%2C%22pre_checkout_query%22%5D"
    fi
}

register_cryptopay_webhook() {
    local domain="$1"
    local ssl_port="$2"

    local port_suffix=""
    if [[ "$ssl_port" != "443" ]]; then
        port_suffix=":${ssl_port}"
    fi

    local webhook_url="https://${domain}${port_suffix}/cryptopay"

    log_info "\n${BOLD}CryptoBot (CryptoPay) webhook:${NC}"
    log_info "  Зарегистрируйте вручную в @CryptoBot → My Apps → ваше приложение → Webhooks:"
    log_info "  ${YELLOW}${webhook_url}${NC}"
}

register_paypear_webhook() {
    local domain="$1"
    local ssl_port="$2"

    local port_suffix=""
    if [[ "$ssl_port" != "443" ]]; then
        port_suffix=":${ssl_port}"
    fi

    local webhook_url="https://${domain}${port_suffix}/paypear"

    log_info "\n${BOLD}PayPear webhook (российские карты):${NC}"
    log_info "  Укажите в личном кабинете PayPear → Настройки → Webhook URL:"
    log_info "  ${YELLOW}${webhook_url}${NC}"
}

# ──────────────────────────────────────────────────────────────
#  Замена доменов / перевыпуск сертификатов (режим обновления)
# ──────────────────────────────────────────────────────────────

# Читает значение переменной из .env (последнее вхождение). Возвращает 1, если ключа нет.
get_env_var() {
    local key="$1"
    local file="${2:-.env}"
    [[ -f "$file" ]] || return 1
    local line
    line=$(grep -E "^${key}=" "$file" | tail -n1) || true
    [[ -n "$line" ]] || return 1
    printf '%s' "${line#*=}"
}

# Устанавливает (обновляет или добавляет) переменную в .env.
set_env_var() {
    local key="$1"
    local val="$2"
    local file="${3:-.env}"
    local esc="$val"
    # Экранируем спецсимволы sed для правой части (разделитель «|»).
    esc=${esc//\\/\\\\}
    esc=${esc//&/\\&}
    esc=${esc//|/\\|}
    if grep -qE "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${esc}|" "$file"
    else
        printf '%s=%s\n' "$key" "$val" >> "$file"
    fi
}

# Выпускает сертификаты Let's Encrypt для переданных доменов через webroot (порт 80).
# Существующий SSL-конфиг (порт ${SSL_PORT}) при этом остаётся активным — минимум простоя.
obtain_certificates() {
    local email="$1"; shift
    local domains=("$@")
    ((${#domains[@]})) || return 0

    local temp_conf="/tmp/blinvpn_certbot_renew.conf"
    local temp_link="/etc/nginx/sites-enabled/blinvpn-acme.conf"

    log_info "Подготовка временной конфигурации Nginx для ACME-проверки (порт 80)..."
    sudo mkdir -p /var/www/html/.well-known/acme-challenge

    local blocks="" d
    for d in "${domains[@]}"; do
        blocks+="server {
    listen 80;
    server_name ${d};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
}
"
    done
    printf '%s' "$blocks" | sudo tee "$temp_conf" >/dev/null
    sudo ln -sf "$temp_conf" "$temp_link"

    if ! sudo nginx -t; then
        log_error "Ошибка проверки конфигурации Nginx. Замена доменов прервана."
        sudo rm -f "$temp_link" "$temp_conf"
        sudo systemctl reload nginx || true
        exit 1
    fi
    sudo systemctl reload nginx

    for d in "${domains[@]}"; do
        log_info "Выпуск сертификата для ${d}..."
        if sudo certbot certonly --webroot -w /var/www/html -d "$d" \
            --email "$email" --agree-tos --non-interactive --keep-until-expiring; then
            log_success "✔ Сертификат для ${d} получен."
        else
            log_error "❗ Не удалось получить сертификат для ${d}."
            log_error "   Проверьте, что A-запись ${d} указывает на этот сервер и порт 80 открыт."
            sudo rm -f "$temp_link" "$temp_conf"
            sudo systemctl reload nginx || true
            exit 1
        fi
    done

    sudo rm -f "$temp_link" "$temp_conf"
    sudo systemctl reload nginx || true
}

# Обновляет все доменозависимые переменные в .env.
update_env_domains() {
    local miniapp="$1"
    local panel="$2"
    local site="$3"
    local ssl_port="$4"

    local port_suffix=""
    [[ "$ssl_port" != "443" ]] && port_suffix=":${ssl_port}"

    set_env_var MINIAPP_DOMAIN "$miniapp"
    set_env_var WEBHOOK_DOMAIN "$miniapp"
    set_env_var PANEL_DOMAIN   "$panel"
    set_env_var SITE_DOMAIN    "$site"

    set_env_var MINIAPP_URL        "https://${miniapp}${port_suffix}"
    set_env_var WEBHOOK_URL        "https://${miniapp}${port_suffix}"
    set_env_var API_URL            "https://${miniapp}${port_suffix}/api"
    set_env_var PANEL_URL          "https://${panel}${port_suffix}"
    set_env_var SITE_URL           "https://${site}${port_suffix}"
    set_env_var PLATEGA_RETURN_URL "https://${miniapp}${port_suffix}/success"
    set_env_var PLATEGA_FAILED_URL "https://${miniapp}${port_suffix}/failed"

    log_success "✔ .env обновлён."
}

# Интерактивная замена одного или нескольких доменов с перевыпуском сертификатов.
replace_domains_flow() {
    section "Замена доменов и перевыпуск сертификатов"

    if [[ ! -f ".env" ]]; then
        log_error "Файл .env не найден в $(pwd) — невозможно определить текущие домены."
        exit 1
    fi

    # ── Текущие значения из .env ────────────────────────────
    local cur_miniapp cur_panel cur_site cur_email cur_port
    cur_miniapp=$(get_env_var MINIAPP_DOMAIN || true)
    cur_panel=$(get_env_var PANEL_DOMAIN || true)
    cur_site=$(get_env_var SITE_DOMAIN || true)
    cur_email=$(get_env_var SSL_EMAIL || true)
    cur_port=$(get_env_var SSL_PORT || true)
    [[ -n "$cur_port" ]] || cur_port=443

    log_info "Текущие домены:"
    printf "  Мини-приложение : ${BOLD}%s${NC}\n" "${cur_miniapp:-—}"
    printf "  Панель          : ${BOLD}%s${NC}\n" "${cur_panel:-—}"
    printf "  Сайт            : ${BOLD}%s${NC}\n" "${cur_site:-—}"
    echo

    if [[ -z "$cur_email" ]]; then
        prompt "Email для Let's Encrypt (в .env не найден): " cur_email
        [[ -n "$cur_email" ]] || { log_error "Email обязателен для выпуска сертификатов."; exit 1; }
    fi

    # ── Выбор и ввод новых доменов ──────────────────────────
    local new_miniapp="$cur_miniapp" new_panel="$cur_panel" new_site="$cur_site"
    local -a changed=()     # домены, для которых нужен новый сертификат
    local -a old_domains=() # заменённые домены — кандидаты на удаление
    local tmp

    if [[ -n "$cur_miniapp" ]] && confirm "Заменить домен мини-приложения (${cur_miniapp})? (y/n): "; then
        prompt "  Новый домен мини-приложения: " tmp
        tmp=$(sanitize_domain "$tmp")
        [[ -n "$tmp" ]] || { log_error "Некорректный домен."; exit 1; }
        new_miniapp="$tmp"; changed+=("$new_miniapp"); old_domains+=("$cur_miniapp")
    fi

    if [[ -n "$cur_panel" ]] && confirm "Заменить домен панели (${cur_panel})? (y/n): "; then
        prompt "  Новый домен панели: " tmp
        tmp=$(sanitize_domain "$tmp")
        [[ -n "$tmp" ]] || { log_error "Некорректный домен."; exit 1; }
        new_panel="$tmp"; changed+=("$new_panel"); old_domains+=("$cur_panel")
    fi

    if [[ -n "$cur_site" ]] && confirm "Заменить домен сайта (${cur_site})? (y/n): "; then
        prompt "  Новый домен сайта: " tmp
        tmp=$(sanitize_domain "$tmp")
        [[ -n "$tmp" ]] || { log_error "Некорректный домен."; exit 1; }
        new_site="$tmp"; changed+=("$new_site"); old_domains+=("$cur_site")
    fi

    if ((${#changed[@]} == 0)); then
        log_warn "Ни один домен не выбран для замены. Изменений нет."
        return 0
    fi

    log_info "\nНовые домены:"
    printf "  Мини-приложение : ${BOLD}%s${NC}\n" "$new_miniapp"
    printf "  Панель          : ${BOLD}%s${NC}\n" "$new_panel"
    printf "  Сайт            : ${BOLD}%s${NC}\n" "$new_site"
    echo
    confirm "Применить замену? (y/n): " || { log_info "Отменено."; return 0; }

    # ── Проверка DNS новых доменов ──────────────────────────
    local server_ip; server_ip=$(get_server_ip || true)
    if [[ -n "$server_ip" ]]; then
        log_info "IP сервера: ${server_ip}"
        local dip
        for tmp in "${changed[@]}"; do
            dip=$(resolve_domain_ip "$tmp" || true)
            if [[ -z "$dip" ]]; then
                log_warn "Не удалось определить A-запись для ${tmp} (укажите её на ${server_ip})."
                confirm "Продолжить всё равно? (y/n): " || exit 1
            elif [[ "$dip" != "$server_ip" ]]; then
                log_warn "DNS ${tmp} → ${dip} не совпадает с IP сервера (${server_ip})."
                confirm "Продолжить всё равно? (y/n): " || exit 1
            fi
        done
    fi

    # ── Firewall: для ACME нужен порт 80 ────────────────────
    if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
        log_warn "Активен UFW — открываю порты 80 и ${cur_port}."
        sudo ufw allow 80/tcp || true
        sudo ufw allow "${cur_port}/tcp" || true
    fi

    # ── Выпуск сертификатов ─────────────────────────────────
    section "Выпуск сертификатов Let's Encrypt"
    obtain_certificates "$cur_email" "${changed[@]}"

    # ── Перегенерация конфигурации Nginx ────────────────────
    section "Обновление конфигурации Nginx"
    configure_nginx "$new_miniapp" "$new_panel" "$new_site" "$cur_port" "$NGINX_CONF" "$NGINX_LINK"

    # ── Обновление .env ─────────────────────────────────────
    section "Обновление переменных окружения (.env)"
    update_env_domains "$new_miniapp" "$new_panel" "$new_site" "$cur_port"

    # ── Перезапуск контейнеров (подхват нового .env) ────────
    section "Перезапуск Docker-контейнеров"
    if [[ -n "$(sudo docker-compose ps -q 2>/dev/null)" ]]; then
        sudo docker-compose down
    fi
    sudo docker-compose up -d --build

    # ── Перерегистрация вебхуков (если сменился домен мини-приложения) ──
    if [[ "$new_miniapp" != "$cur_miniapp" ]]; then
        section "Перерегистрация вебхуков"
        local bot_token; bot_token=$(get_env_var TELEGRAM_BOT_TOKEN || true)
        register_telegram_webhook "$bot_token" "$new_miniapp" "$cur_port"
        register_cryptopay_webhook "$new_miniapp" "$cur_port"
        register_paypear_webhook "$new_miniapp" "$cur_port"
    fi

    # ── Опциональная очистка старых сертификатов ────────────
    if ((${#old_domains[@]})) && confirm "Удалить сертификаты заменённых доменов? (y/n): "; then
        local od
        for od in "${old_domains[@]}"; do
            [[ -n "$od" ]] || continue
            # не трогаем домен, если он всё ещё используется
            if [[ "$od" == "$new_miniapp" || "$od" == "$new_panel" || "$od" == "$new_site" ]]; then
                continue
            fi
            if [[ -d "/etc/letsencrypt/live/${od}" ]]; then
                if sudo certbot delete --cert-name "$od" --non-interactive 2>/dev/null; then
                    log_info "Сертификат ${od} удалён."
                else
                    log_warn "Не удалось удалить сертификат ${od} — удалите вручную при необходимости."
                fi
            fi
        done
    fi

    # ── Итог ────────────────────────────────────────────────
    local port_suffix=""
    [[ "$cur_port" != "443" ]] && port_suffix=":${cur_port}"
    section "Замена доменов завершена"
    printf "  Сайт            : ${YELLOW}https://%s%s${NC}\n" "$new_site"    "$port_suffix"
    printf "  Мини-приложение : ${YELLOW}https://%s%s${NC}\n" "$new_miniapp" "$port_suffix"
    printf "  Панель          : ${YELLOW}https://%s%s${NC}\n" "$new_panel"   "$port_suffix"
    if [[ "$new_miniapp" != "$cur_miniapp" ]]; then
        echo
        log_warn "⚠️  Обновите Web App URL в @BotFather:"
        printf "     ${CYAN}https://%s%s${NC}\n" "$new_miniapp" "$port_suffix"
    fi
}

REPO_URL="https://github.com/Blin4ickUSE/blinvpn.git"
REPO_BRANCH="${BLINVPN_BRANCH:-2.0-refactoring}"
PROJECT_DIR="blinvpn"
NGINX_CONF="/etc/nginx/sites-available/${PROJECT_DIR}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PROJECT_DIR}.conf"

# Порт для SSL (по умолчанию 443)
SSL_PORT=443

log_success "--- Запуск скрипта установки/обновления BlinVPN ---"

# Режим обновления / обслуживания существующей установки
if [[ -f "$NGINX_CONF" ]]; then
    log_info "\nОбнаружена существующая конфигурация BlinVPN."
    if [[ ! -d "$PROJECT_DIR" ]]; then
        log_error "Конфигурация Nginx найдена, но каталог '${PROJECT_DIR}' отсутствует. Удалите $NGINX_CONF и повторите установку."
        exit 1
    fi
    cd "$PROJECT_DIR"

    section "Существующая установка — выберите действие"
    step "1)" "Обновить код и перезапустить контейнеры (по умолчанию)"
    step "2)" "Заменить домен(ы) и перевыпустить сертификаты"
    step "3)" "Выход"
    echo
    prompt "Ваш выбор [1/2/3] (Enter = 1): " ACTION_CHOICE
    ACTION_CHOICE="${ACTION_CHOICE:-1}"

    case "$ACTION_CHOICE" in
        2)
            replace_domains_flow
            exit 0
            ;;
        3)
            log_info "Выход без изменений."
            exit 0
            ;;
        *)
            log_info "\nШаг 1: обновление исходного кода"
            git fetch origin
            git reset --hard origin/"$REPO_BRANCH"
            git checkout "$REPO_BRANCH" 2>/dev/null || git checkout -b "$REPO_BRANCH" --track origin/"$REPO_BRANCH"
            git reset --hard origin/"$REPO_BRANCH"
            log_success "✔ Репозиторий обновлён."
            log_info "\nШаг 2: публикация лендинга"
            deploy_site_files

            log_info "\nШаг 3: пересборка и перезапуск контейнеров"
            sudo docker-compose down --remove-orphans
            sudo docker-compose up -d --build

            if [[ -f "$NGINX_CONF" ]]; then
                sudo nginx -t && sudo systemctl reload nginx
            fi

            log_success "\n🎉 Обновление успешно завершено!"
            exit 0
            ;;
    esac
fi

# Новая установка
log_info "\nСуществующая конфигурация не найдена. Запускается новая установка."

ensure_packages
ensure_services
ensure_certbot_nginx

log_info "\nШаг 2: клонирование репозитория"
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
    git clone --branch "$REPO_BRANCH" "$REPO_URL" "$PROJECT_DIR"
else
    log_warn "Каталог $PROJECT_DIR уже существует. Будет использована текущая версия."
fi
cd "$PROJECT_DIR"
log_success "✔ Репозиторий BlinVPN готов."

log_info "\nШаг 3: настройка домена и SSL"

prompt "Введите домен для мини-приложения (например, app.example.com): " USER_DOMAIN_INPUT
DOMAIN=$(sanitize_domain "$USER_DOMAIN_INPUT")
if [[ -z "$DOMAIN" ]]; then
    log_error "Некорректное доменное имя. Установка прервана."
    exit 1
fi

prompt "Введите домен для панели управления (например, panel.example.com): " USER_PANEL_DOMAIN_INPUT
PANEL_DOMAIN=$(sanitize_domain "$USER_PANEL_DOMAIN_INPUT")
if [[ -z "$PANEL_DOMAIN" ]]; then
    log_error "Некорректное доменное имя для панели. Установка прервана."
    exit 1
fi

prompt "Введите домен для сайта (лендинг, например blinvpn.ru): " USER_SITE_DOMAIN_INPUT
SITE_DOMAIN=$(sanitize_domain "$USER_SITE_DOMAIN_INPUT")
if [[ -z "$SITE_DOMAIN" ]]; then
    log_error "Некорректное доменное имя для сайта. Установка прервана."
    exit 1
fi

prompt "Введите email для Let's Encrypt: " EMAIL
if [[ -z "$EMAIL" ]]; then
    log_error "Email обязателен для выпуска сертификата."
    exit 1
fi

prompt "SSL порт (по умолчанию 443): " SSL_PORT_INPUT
SSL_PORT="${SSL_PORT_INPUT:-443}"

SERVER_IP=$(get_server_ip || true)
DOMAIN_IP=$(resolve_domain_ip "$DOMAIN" || true)
PANEL_DOMAIN_IP=$(resolve_domain_ip "$PANEL_DOMAIN" || true)
SITE_DOMAIN_IP=$(resolve_domain_ip "$SITE_DOMAIN" || true)

if [[ -n "$SERVER_IP" ]]; then
    log_info "IP сервера: ${SERVER_IP}"
fi

if [[ -n "$DOMAIN_IP" ]]; then
    log_info "IP домена ${DOMAIN}: ${DOMAIN_IP}"
fi

if [[ -n "$PANEL_DOMAIN_IP" ]]; then
    log_info "IP домена панели ${PANEL_DOMAIN}: ${PANEL_DOMAIN_IP}"
fi

if [[ -n "$SITE_DOMAIN_IP" ]]; then
    log_info "IP домена сайта ${SITE_DOMAIN}: ${SITE_DOMAIN_IP}"
fi

if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена ${DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        exit 1
    fi
fi

if [[ -n "$SERVER_IP" && -n "$PANEL_DOMAIN_IP" && "$SERVER_IP" != "$PANEL_DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена панели ${PANEL_DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        exit 1
    fi
fi

if [[ -n "$SERVER_IP" && -n "$SITE_DOMAIN_IP" && "$SERVER_IP" != "$SITE_DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена сайта ${SITE_DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        exit 1
    fi
fi

# Открываем порты в firewall
if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
    log_warn "Обнаружен активный UFW. Открываем порты 80 и ${SSL_PORT}."
    sudo ufw allow 80/tcp
    sudo ufw allow ${SSL_PORT}/tcp
fi

# Получаем SSL сертификаты
log_info "\nПолучение SSL сертификатов..."

# Создаем временную конфигурацию для получения сертификатов
TEMP_CONF="/tmp/blinvpn_certbot.conf"
sudo tee "$TEMP_CONF" >/dev/null <<EOF
server {
    listen 80;
    server_name ${DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://\$host:${SSL_PORT}\$request_uri;
    }
}
server {
    listen 80;
    server_name ${PANEL_DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://\$host:${SSL_PORT}\$request_uri;
    }
}
server {
    listen 80;
    server_name ${SITE_DOMAIN};
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }
    location / {
        return 301 https://\$host:${SSL_PORT}\$request_uri;
    }
}
EOF

# Убираем старые конфиги и ставим временный
sudo rm -f /etc/nginx/sites-enabled/default
sudo rm -f "$NGINX_LINK"
sudo ln -sf "$TEMP_CONF" "$NGINX_LINK"
sudo nginx -t && sudo systemctl reload nginx

# Создаем директорию для webroot
sudo mkdir -p /var/www/html/.well-known/acme-challenge

if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${DOMAIN}..."
    sudo certbot certonly --webroot -w /var/www/html -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    log_success "✔ Сертификаты Let's Encrypt для ${DOMAIN} успешно получены."
fi

if [[ -d "/etc/letsencrypt/live/${PANEL_DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${PANEL_DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${PANEL_DOMAIN}..."
    sudo certbot certonly --webroot -w /var/www/html -d "$PANEL_DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    log_success "✔ Сертификаты Let's Encrypt для ${PANEL_DOMAIN} успешно получены."
fi

if [[ -d "/etc/letsencrypt/live/${SITE_DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${SITE_DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${SITE_DOMAIN}..."
    sudo certbot certonly --webroot -w /var/www/html -d "$SITE_DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    log_success "✔ Сертификаты Let's Encrypt для ${SITE_DOMAIN} успешно получены."
fi

# Удаляем временную конфигурацию
sudo rm -f "$TEMP_CONF"

# Настраиваем финальную конфигурацию nginx и публикуем лендинг
log_info "\nШаг 4: настройка Nginx и публикация сайта"
deploy_site_files
configure_nginx "$DOMAIN" "$PANEL_DOMAIN" "$SITE_DOMAIN" "$SSL_PORT" "$NGINX_CONF" "$NGINX_LINK"

log_info "\nШаг 5: настройка переменных окружения (.env)"

if [[ -f ".env" ]]; then
    log_warn "Файл .env уже существует."
    if ! confirm "Перезаписать существующий .env? (y/n): "; then
        log_info "Используется существующий .env файл."
    else
        create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$SITE_DOMAIN" "$EMAIL" "$SSL_PORT"
    fi
else
    create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$SITE_DOMAIN" "$EMAIL" "$SSL_PORT"
fi

log_info "\nШаг 6: подготовка директорий и запуск Docker-контейнеров"
mkdir -p data
chmod 755 data

if [[ -n "$(sudo docker-compose ps -q 2>/dev/null)" ]]; then
    sudo docker-compose down
fi
sudo docker-compose up -d --build

log_info "\nШаг 7: регистрация Telegram webhook (Telegram Stars)"
register_telegram_webhook "$TELEGRAM_BOT_TOKEN" "$DOMAIN" "$SSL_PORT"

register_cryptopay_webhook "$DOMAIN" "$SSL_PORT"
register_paypear_webhook "$DOMAIN" "$SSL_PORT"

# Формируем URL с портом для вывода
PORT_SUFFIX=""
if [[ "$SSL_PORT" != "443" ]]; then
    PORT_SUFFIX=":${SSL_PORT}"
fi

printf "\n"
printf "\e[0;32m┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓\e[0m\n"
printf "\e[0;32m┃\e[0m  🎉 \e[1mУстановка BlinVPN завершена!\e[0m 🎉                        \e[0;32m┃\e[0m\n"
printf "\e[0;32m┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛\e[0m\n"
printf "\n"

printf "\e[0;32m───────────────────────────────────────────────────────────────\e[0m\n"
printf "\e[1m  Адреса\e[0m\n"
printf "\e[0;32m───────────────────────────────────────────────────────────────\e[0m\n"
printf "  Сайт:             \e[1;33mhttps://%s%s\e[0m\n"        "${SITE_DOMAIN}"  "${PORT_SUFFIX}"
printf "  Мини-приложение:  \e[1;33mhttps://%s%s\e[0m\n"        "${DOMAIN}"       "${PORT_SUFFIX}"
printf "  Панель:           \e[1;33mhttps://%s%s\e[0m\n"        "${PANEL_DOMAIN}" "${PORT_SUFFIX}"
printf "  API:              \e[1;33mhttps://%s%s/api\e[0m\n"    "${DOMAIN}"       "${PORT_SUFFIX}"
printf "\n"

printf "\e[0;32m───────────────────────────────────────────────────────────────\e[0m\n"
printf "\e[1m  Webhooks\e[0m\n"
printf "\e[0;32m───────────────────────────────────────────────────────────────\e[0m\n"
printf "  Heleket:          \e[1;33mhttps://%s%s/heleket\e[0m\n"                "${DOMAIN}" "${PORT_SUFFIX}"
printf "  Platega:          \e[1;33mhttps://%s%s/platega\e[0m\n"                "${DOMAIN}" "${PORT_SUFFIX}"
printf "  PayPear:          \e[1;33mhttps://%s%s/paypear\e[0m\n"                "${DOMAIN}" "${PORT_SUFFIX}"
printf "  Telegram Stars:   \e[1;33mhttps://%s%s/api/telegram/webhook\e[0m"     "${DOMAIN}" "${PORT_SUFFIX}"
printf "  \e[0;32m(авто)\e[0m\n"
printf "  CryptoBot:        \e[1;33mhttps://%s%s/cryptopay\e[0m\n"             "${DOMAIN}" "${PORT_SUFFIX}"
printf "\n"

printf "\e[0;32m───────────────────────────────────────────────────────────────\e[0m\n"
printf "\e[1;33m  ⚠️  Обязательно после установки\e[0m\n"
printf "\e[0;32m───────────────────────────────────────────────────────────────\e[0m\n"
printf "  1. Обновите Web App URL в BotFather:\n"
printf "     \e[0;36mhttps://%s%s\e[0m\n" "${DOMAIN}" "${PORT_SUFFIX}"
printf "  2. Проверьте настройки в файле \e[0;36m.env\e[0m\n"
printf "\n"
