#!/usr/bin/env bash
set -Eeuo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'
BOLD='\033[1m'

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
    if command -v ping >/dev/null 2>&1; then
        ip=$(ping -4 -c1 -W1 "$domain" 2>/dev/null | sed -n 's/.*(\([0-9.]*\)).*/\1/p' | head -n1)
        if [[ $ip =~ $ipv4_re ]]; then
            echo "$ip"
            return 0
        fi
    fi
    return 1
}

ensure_packages() {
    log_info "\nШаг 1: проверка и установка системных зависимостей"
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
            log_warn "Утилита '$cmd' не найдена. Будет установлен пакет '${packages[$cmd]}'."
            missing+=("${packages[$cmd]}")
        else
            log_success "✔ $cmd уже установлен."
        fi
    done
    if ((${#missing[@]})); then
        # Настройка debconf для неинтерактивной установки
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends "${missing[@]}"
        
        # Сброс переменных после установки
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    else
        log_info "Все необходимые пакеты уже присутствуют."
    fi
}

ensure_services() {
    for service in docker nginx; do
        if ! sudo systemctl is-active --quiet "$service"; then
            log_warn "Сервис $service не запущен. Включаем и запускаем..."
            sudo systemctl enable "$service"
            sudo systemctl start "$service"
        else
            log_success "✔ Сервис $service активен."
        fi
    done
}

ensure_certbot_nginx() {
    log_info "\nПроверка плагина Certbot для Nginx"

    local has_nginx_plugin=0
    if command -v certbot >/dev/null 2>&1; then
        if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
            has_nginx_plugin=1
        fi
    fi

    if [[ $has_nginx_plugin -eq 1 ]]; then
        log_success "✔ Плагин nginx для Certbot найден."
        return
    fi

    if command -v apt-get >/dev/null 2>&1; then
        log_info "Устанавливаю плагин python3-certbot-nginx (apt)..."
        # Настройка debconf для неинтерактивной установки
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        
        sudo apt-get update
        if sudo apt-get install -y --no-install-recommends python3-certbot-nginx; then
            if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
                log_success "✔ Плагин nginx для Certbot установлен (apt)."
                unset DEBIAN_FRONTEND
                unset DEBCONF_NONINTERACTIVE_SEEN
                return
            fi
        else
            log_warn "Не удалось установить python3-certbot-nginx через apt."
        fi
        
        # Сброс переменных
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    fi

    log_warn "Пробую установить Certbot (snap) с поддержкой nginx."
    if ! command -v snap >/dev/null 2>&1; then
        # Настройка debconf для неинтерактивной установки
        export DEBIAN_FRONTEND=noninteractive
        export DEBCONF_NONINTERACTIVE_SEEN=true
        
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends snapd
        
        # Сброс переменных
        unset DEBIAN_FRONTEND
        unset DEBCONF_NONINTERACTIVE_SEEN
    fi
    sudo snap install core || true
    sudo snap refresh core || true
    sudo snap install --classic certbot
    sudo ln -sf /snap/bin/certbot /usr/bin/certbot

    if certbot plugins 2>/dev/null | grep -qi 'nginx'; then
        log_success "✔ Плагин nginx для Certbot доступен (snap)."
        return
    fi

    log_error "Плагин nginx для Certbot недоступен. Невозможно продолжить выпуск сертификата с параметром --nginx."
    exit 1
}

configure_nginx() {
    local domain="$1"
    local panel_domain="$2"
    local nginx_conf="$3"
    local nginx_link="$4"

    log_info "\nШаг 4: настройка Nginx"
    sudo rm -f /etc/nginx/sites-enabled/default
    
    # Создаем nginx.conf для Docker контейнера
    cat > nginx.conf <<NGINX_EOF
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
                    '\$status \$body_bytes_sent "\$http_referer" '
                    '"\$http_user_agent" "\$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss;

    # Upstream для сервисов (через localhost, так как используется host network)
    upstream miniapp {
        server 127.0.0.1:9741;
    }

    upstream panel {
        server 127.0.0.1:3001;
    }

    upstream api {
        server 127.0.0.1:8000;
    }

    upstream webhook {
        server 127.0.0.1:5000;
    }

    # HTTP -> HTTPS redirect
    server {
        listen 80;
        listen [::]:80;
        server_name ${domain};
        return 301 https://\$host\$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name ${domain};

        ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
        include /etc/letsencrypt/options-ssl-nginx.conf;
        ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

        # API
        location /api {
            proxy_pass http://127.0.0.1:8000;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # Webhooks
        location /yookassa {
            proxy_pass http://127.0.0.1:5000;
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

        # Panel
        location /panel {
            proxy_pass http://127.0.0.1:3001;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # Miniapp
        location / {
            proxy_pass http://127.0.0.1:9741;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
}
NGINX_EOF
    
    # Создаем конфигурацию для хостового nginx
    sudo tee "$nginx_conf" >/dev/null <<EOF
# Мини-приложение (основной домен)
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # API
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Webhooks
    location /yookassa {
        proxy_pass http://127.0.0.1:5000;
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

    # Miniapp
    location / {
        proxy_pass http://127.0.0.1:9741;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# Панель управления (отдельный домен)
server {
    listen 80;
    listen [::]:80;
    server_name ${panel_domain};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${panel_domain};

    ssl_certificate /etc/letsencrypt/live/${panel_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${panel_domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Panel
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
}
EOF

    if [[ ! -L "$nginx_link" ]]; then
        sudo ln -s "$nginx_conf" "$nginx_link"
    fi
    sudo nginx -t
    sudo systemctl reload nginx
    log_success "✔ Конфигурация Nginx обновлена."
}

create_env_file() {
    local domain="$1"
    local panel_domain="$2"
    local email="$3"
    
    log_info "\nЗаполнение переменных окружения:"
    
    prompt "Telegram Bot Token (основной бот): " TELEGRAM_BOT_TOKEN
    prompt "Telegram Support Bot Token: " SUPPORT_BOT_TOKEN
    prompt "Telegram Admin ID: " TELEGRAM_ADMIN_ID
    prompt "Telegram Support Group ID: " TELEGRAM_SUPPORT_GROUP_ID
    
    prompt "Remnawave API URL (по умолчанию https://api.remnawave.com): " REMWAVE_API_URL_INPUT
    REMWAVE_API_URL="${REMWAVE_API_URL_INPUT:-https://api.remnawave.com}"
    prompt "Remnawave API Key: " REMWAVE_API_KEY
    
    prompt "YooKassa Shop ID: " YOOKASSA_SHOP_ID
    prompt "YooKassa Secret Key: " YOOKASSA_SECRET_KEY
    
    prompt "Heleket API URL (по умолчанию https://api.heleket.com): " HELEKET_API_URL_INPUT
    HELEKET_API_URL="${HELEKET_API_URL_INPUT:-https://api.heleket.com}"
    prompt "Heleket Merchant: " HELEKET_MERCHANT
    prompt "Heleket API Key: " HELEKET_API_KEY
    
    prompt "Platega API URL (по умолчанию https://api.platega.com): " PLATEGA_API_URL_INPUT
    PLATEGA_API_URL="${PLATEGA_API_URL_INPUT:-https://api.platega.com}"
    prompt "Platega Merchant ID: " PLATEGA_MERCHANT_ID
    prompt "Platega Secret Key: " PLATEGA_SECRET_KEY
    
    prompt "Panel Secret (секретный ключ для доступа к панели): " PANEL_SECRET_INPUT
    PANEL_SECRET="${PANEL_SECRET_INPUT:-$(openssl rand -hex 32)}"
    
    # Генерируем .env файл
    cat > .env <<EOF
# Telegram
TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
SUPPORT_BOT_TOKEN=${SUPPORT_BOT_TOKEN}
TELEGRAM_ADMIN_ID=${TELEGRAM_ADMIN_ID}
TELEGRAM_SUPPORT_GROUP_ID=${TELEGRAM_SUPPORT_GROUP_ID}

# Remnawave
REMWAVE_API_URL=${REMWAVE_API_URL}
REMWAVE_API_KEY=${REMWAVE_API_KEY}

# YooKassa
YOOKASSA_SHOP_ID=${YOOKASSA_SHOP_ID}
YOOKASSA_SECRET_KEY=${YOOKASSA_SECRET_KEY}

# Heleket
HELEKET_API_URL=${HELEKET_API_URL}
HELEKET_MERCHANT=${HELEKET_MERCHANT}
HELEKET_API_KEY=${HELEKET_API_KEY}

# Platega
PLATEGA_API_URL=${PLATEGA_API_URL}
PLATEGA_MERCHANT_ID=${PLATEGA_MERCHANT_ID}
PLATEGA_SECRET_KEY=${PLATEGA_SECRET_KEY}

# Panel
PANEL_SECRET=${PANEL_SECRET}

# URLs
MINIAPP_URL=https://${domain}
PANEL_URL=https://${panel_domain}
WEBHOOK_URL=https://${domain}
API_URL=https://${domain}/api

# Ports
API_PORT=8000
WEBHOOK_PORT=5000
MINIAPP_PORT=9741
PANEL_PORT=3001

# Database
DB_PATH=data/data.db

# SSL
SSL_EMAIL=${email}
PANEL_DOMAIN=${panel_domain}
MINIAPP_DOMAIN=${domain}
WEBHOOK_DOMAIN=${domain}
EOF

    log_success "✔ Файл .env создан."
}

REPO_URL="https://github.com/Blin4ickUSE/blinvpn.git"
PROJECT_DIR="blinvpn"
NGINX_CONF="/etc/nginx/sites-available/${PROJECT_DIR}.conf"
NGINX_LINK="/etc/nginx/sites-enabled/${PROJECT_DIR}.conf"

log_success "--- Запуск скрипта установки/обновления BlinVPN ---"

if [[ -f "$NGINX_CONF" ]]; then
    log_info "\nОбнаружена существующая конфигурация. Запускается режим обновления."
    if [[ ! -d "$PROJECT_DIR" ]]; then
        log_error "Конфигурация Nginx найдена, но каталог '${PROJECT_DIR}' отсутствует. Удалите $NGINX_CONF и повторите установку."
        exit 1
    fi
    cd "$PROJECT_DIR"
    log_info "\nШаг 1: обновление исходного кода"
    git pull --ff-only
    log_success "✔ Репозиторий обновлён."
    log_info "\nШаг 2: пересборка и перезапуск контейнеров"
    sudo docker-compose down --remove-orphans
    sudo docker-compose up -d --build
    log_success "\n🎉 Обновление успешно завершено!"
    exit 0
fi

log_info "\nСуществующая конфигурация не найдена. Запускается новая установка."

ensure_packages
ensure_services
ensure_certbot_nginx

log_info "\nШаг 2: клонирование репозитория"
if [[ ! -d "$PROJECT_DIR/.git" ]]; then
    git clone "$REPO_URL" "$PROJECT_DIR"
else
    log_warn "Каталог $PROJECT_DIR уже существует. Будет использована текущая версия."
fi
cd "$PROJECT_DIR"
log_success "✔ Репозиторий BlinVPN готов."

log_info "\nШаг 3: настройка домена и SSL"

prompt "Введите домен для мини-приложения (например, my-vpn-shop.com): " USER_DOMAIN_INPUT
DOMAIN=$(sanitize_domain "$USER_DOMAIN_INPUT")
if [[ -z "$DOMAIN" ]]; then
    log_error "Некорректное доменное имя. Установка прервана."
    exit 1
fi

prompt "Введите домен для панели управления (например, panel.my-vpn-shop.com): " USER_PANEL_DOMAIN_INPUT
PANEL_DOMAIN=$(sanitize_domain "$USER_PANEL_DOMAIN_INPUT")
if [[ -z "$PANEL_DOMAIN" ]]; then
    log_error "Некорректное доменное имя для панели. Установка прервана."
    exit 1
fi

prompt "Введите email для Let's Encrypt: " EMAIL
if [[ -z "$EMAIL" ]]; then
    log_error "Email обязателен для выпуска сертификата."
    exit 1
fi

SERVER_IP=$(get_server_ip || true)
DOMAIN_IP=$(resolve_domain_ip "$DOMAIN" || true)
PANEL_DOMAIN_IP=$(resolve_domain_ip "$PANEL_DOMAIN" || true)

if [[ -n "$SERVER_IP" ]]; then
    log_info "IP сервера: ${SERVER_IP}"
else
    log_warn "Не удалось автоматически определить IP сервера."
fi

if [[ -n "$DOMAIN_IP" ]]; then
    log_info "IP домена ${DOMAIN}: ${DOMAIN_IP}"
else
    log_warn "Не удалось получить IP для домена ${DOMAIN}."
fi

if [[ -n "$PANEL_DOMAIN_IP" ]]; then
    log_info "IP домена панели ${PANEL_DOMAIN}: ${PANEL_DOMAIN_IP}"
else
    log_warn "Не удалось получить IP для домена панели ${PANEL_DOMAIN}."
fi

if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена ${DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        log_info "Установка прервана пользователем."
        exit 1
    fi
fi

if [[ -n "$SERVER_IP" && -n "$PANEL_DOMAIN_IP" && "$SERVER_IP" != "$PANEL_DOMAIN_IP" ]]; then
    log_warn "DNS-запись домена панели ${PANEL_DOMAIN} не совпадает с IP этого сервера."
    if ! confirm "Продолжить установку? (y/n): "; then
        log_info "Установка прервана пользователем."
        exit 1
    fi
fi

if command -v ufw >/dev/null 2>&1 && sudo ufw status | grep -q 'Status: active'; then
    log_warn "Обнаружен активный UFW. Открываем порты 80, 443, 1488, 8443."
    sudo ufw allow 80/tcp
    sudo ufw allow 443/tcp
    sudo ufw allow 1488/tcp
    sudo ufw allow 8443/tcp
fi

# Создаем временную конфигурацию nginx для получения сертификатов
TEMP_NGINX_CONF="/tmp/blinvpn_temp_nginx.conf"
sudo tee "$TEMP_NGINX_CONF" >/dev/null <<TEMP_EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} ${PANEL_DOMAIN};
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://\$host\$request_uri;
    }
}
TEMP_EOF

# Создаем директорию для webroot
sudo mkdir -p /var/www/certbot

# Временно заменяем конфигурацию nginx
if [[ -L "$NGINX_LINK" ]]; then
    sudo rm "$NGINX_LINK"
fi
sudo ln -s "$TEMP_NGINX_CONF" "$NGINX_LINK"
sudo nginx -t && sudo systemctl reload nginx

if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${DOMAIN}..."
    sudo certbot certonly --webroot -w /var/www/certbot -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --expand
    log_success "✔ Сертификаты Let's Encrypt для ${DOMAIN} успешно получены."
fi

if [[ -d "/etc/letsencrypt/live/${PANEL_DOMAIN}" ]]; then
    log_success "✔ SSL-сертификаты для ${PANEL_DOMAIN} уже существуют."
else
    log_info "Получение SSL-сертификатов для ${PANEL_DOMAIN}..."
    # Проверяем, есть ли уже сертификат для DOMAIN
    if [[ -d "/etc/letsencrypt/live/${DOMAIN}" ]] && sudo certbot certificates 2>/dev/null | grep -q "${DOMAIN}"; then
        log_info "Создание отдельного сертификата для ${PANEL_DOMAIN}..."
        sudo certbot certonly --webroot -w /var/www/certbot -d "$PANEL_DOMAIN" --email "$EMAIL" --agree-tos --non-interactive --cert-name "${PANEL_DOMAIN}"
    else
        sudo certbot certonly --webroot -w /var/www/certbot -d "$PANEL_DOMAIN" --email "$EMAIL" --agree-tos --non-interactive
    fi
    
    if [[ -d "/etc/letsencrypt/live/${PANEL_DOMAIN}" ]]; then
        log_success "✔ Сертификаты Let's Encrypt для ${PANEL_DOMAIN} успешно получены."
    else
        log_warn "⚠ Не удалось получить сертификат для ${PANEL_DOMAIN}. Проверьте DNS записи и повторите попытку."
    fi
fi

configure_nginx "$DOMAIN" "$PANEL_DOMAIN" "$NGINX_CONF" "$NGINX_LINK"

log_info "\nШаг 5: настройка переменных окружения (.env)"

if [[ -f ".env" ]]; then
    log_warn "Файл .env уже существует."
    if ! confirm "Перезаписать существующий .env? (y/n): "; then
        log_info "Используется существующий .env файл."
    else
        log_info "Создание нового .env файла..."
        create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL"
    fi
else
    log_info "Создание .env файла..."
    create_env_file "$DOMAIN" "$PANEL_DOMAIN" "$EMAIL"
fi

log_info "\nШаг 6: подготовка директорий и запуск Docker-контейнеров"
# Создаем директорию для базы данных
mkdir -p data
chmod 755 data

if [[ -n "$(sudo docker-compose ps -q 2>/dev/null)" ]]; then
    sudo docker-compose down
fi
sudo docker-compose up -d --build

cat <<SUMMARY

${GREEN}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${NC}
${GREEN}┃${NC}  🎉 ${BOLD}Установка BlinVPN завершена!${NC} 🎉                ${GREEN}┃${NC}
${GREEN}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${NC}

${BOLD}Мини-приложение:${NC}
  ${YELLOW}https://${DOMAIN}${NC}

${BOLD}Веб‑панель:${NC}
  ${YELLOW}https://${PANEL_DOMAIN}${NC}

${BOLD}API:${NC}
  ${YELLOW}https://${DOMAIN}/api${NC}

${BOLD}Webhooks:${NC}
  YooKassa: ${YELLOW}https://${DOMAIN}/yookassa${NC}
  Heleket:  ${YELLOW}https://${DOMAIN}/heleket${NC}
  Platega:  ${YELLOW}https://${DOMAIN}/platega${NC}

${YELLOW}⚠️  Проверьте настройки в файле .env перед использованием.${NC}

SUMMARY
