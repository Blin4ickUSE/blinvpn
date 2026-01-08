#!/bin/bash

set -e

echo "=========================================="
echo "       Установочный скрипт BlinVPN        "
echo "=========================================="
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Пожалуйста, запустите скрипт с правами root (sudo)"
    exit 1
fi

# Проверка и установка зависимостей
echo "📦 Проверка зависимостей..."

# Проверка Docker
if ! command -v docker &> /dev/null; then
    echo "📥 Установка Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
fi

# Проверка Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "📥 Установка Docker Compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
fi

# Проверка Nginx
if ! command -v nginx &> /dev/null; then
    echo "📥 Установка Nginx..."
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
fi

echo "✅ Все зависимости установлены"
echo ""

# Создание .env файла
if [ ! -f .env ]; then
    echo "⚙️  Создание файла .env..."
    cp .env.example .env
    echo "📝 Пожалуйста, отредактируйте .env файл и заполните все необходимые данные"
    echo "   После этого запустите скрипт снова"
    exit 0
fi

# Запрос доменов
echo "🌐 Настройка доменов..."
read -p "Введите домен для панели управления (например: panel.yourdomain.com): " PANEL_DOMAIN
read -p "Введите домен для мини-приложения (например: app.yourdomain.com): " MINIAPP_DOMAIN
read -p "Введите домен для webhook'ов (например: webhook.yourdomain.com): " WEBHOOK_DOMAIN
read -p "Введите email для SSL сертификатов: " SSL_EMAIL

# Обновление .env
sed -i "s|PANEL_DOMAIN=.*|PANEL_DOMAIN=$PANEL_DOMAIN|g" .env
sed -i "s|MINIAPP_DOMAIN=.*|MINIAPP_DOMAIN=$MINIAPP_DOMAIN|g" .env
sed -i "s|WEBHOOK_DOMAIN=.*|WEBHOOK_DOMAIN=$WEBHOOK_DOMAIN|g" .env
sed -i "s|SSL_EMAIL=.*|SSL_EMAIL=$SSL_EMAIL|g" .env

# Запрос портов
read -p "Введите порт для панели (по умолчанию 3001): " PANEL_PORT
PANEL_PORT=${PANEL_PORT:-3001}
read -p "Введите порт для мини-приложения (по умолчанию 3000): " MINIAPP_PORT
MINIAPP_PORT=${MINIAPP_PORT:-3000}
read -p "Введите порт для webhook'ов (по умолчанию 5000): " WEBHOOK_PORT
WEBHOOK_PORT=${WEBHOOK_PORT:-5000}

sed -i "s|PANEL_PORT=.*|PANEL_PORT=$PANEL_PORT|g" .env
sed -i "s|MINIAPP_PORT=.*|MINIAPP_PORT=$MINIAPP_PORT|g" .env
sed -i "s|WEBHOOK_PORT=.*|WEBHOOK_PORT=$WEBHOOK_PORT|g" .env

# Создание Nginx конфигурации
echo "📝 Создание конфигурации Nginx..."
cat > nginx.conf <<EOF
events {
    worker_connections 1024;
}

http {
    upstream miniapp {
        server miniapp:3000;
    }
    
    upstream panel {
        server panel:3001;
    }
    
    upstream webhook {
        server webhook:5000;
    }

    upstream api {
        server api:8000;
    }
    
    # Панель управления
    server {
        listen 80;
        server_name $PANEL_DOMAIN;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://\$server_name\$request_uri;
        }
    }
    
    server {
        listen 443 ssl http2;
        server_name $PANEL_DOMAIN;
        
        ssl_certificate /etc/letsencrypt/live/$PANEL_DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$PANEL_DOMAIN/privkey.pem;
        
        location /api/ {
            proxy_pass http://api/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        location / {
            proxy_pass http://panel;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
    
    # Мини-приложение
    server {
        listen 80;
        server_name $MINIAPP_DOMAIN;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://\$server_name\$request_uri;
        }
    }
    
    server {
        listen 443 ssl http2;
        server_name $MINIAPP_DOMAIN;
        
        ssl_certificate /etc/letsencrypt/live/$MINIAPP_DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$MINIAPP_DOMAIN/privkey.pem;
        
        location /api/ {
            proxy_pass http://api/;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        location / {
            proxy_pass http://miniapp;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
    
    # Webhook'и
    server {
        listen 80;
        server_name $WEBHOOK_DOMAIN;
        
        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }
        
        location / {
            return 301 https://\$server_name\$request_uri;
        }
    }
    
    server {
        listen 443 ssl http2;
        server_name $WEBHOOK_DOMAIN;
        
        ssl_certificate /etc/letsencrypt/live/$WEBHOOK_DOMAIN/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/$WEBHOOK_DOMAIN/privkey.pem;
        
        location /yookassa {
            proxy_pass http://webhook/yookassa;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
        
        location /heleket {
            proxy_pass http://webhook/heleket;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
        
        location /platega {
            proxy_pass http://webhook/platega;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
        }
    }
}
EOF

# Получение SSL сертификатов
echo "🔒 Получение SSL сертификатов..."
mkdir -p certbot

# Получаем сертификаты для каждого домена
certbot certonly --webroot -w ./certbot --email $SSL_EMAIL --agree-tos --no-eff-email -d $PANEL_DOMAIN -d $MINIAPP_DOMAIN -d $WEBHOOK_DOMAIN || {
    echo "⚠️  Не удалось получить SSL сертификаты автоматически"
    echo "   Пожалуйста, убедитесь, что домены указывают на этот сервер"
    echo "   И запустите вручную: certbot certonly --webroot -w ./certbot -d $PANEL_DOMAIN -d $MINIAPP_DOMAIN -d $WEBHOOK_DOMAIN"
}

# Сборка и запуск контейнеров
echo "🐳 Сборка Docker образов..."
docker-compose build

echo "🚀 Запуск контейнеров..."
docker-compose up -d

echo ""
echo "=========================================="
echo "  ✅ Установка завершена!"
echo "=========================================="
echo ""
echo "📋 Информация:"
echo "   Панель управления: https://$PANEL_DOMAIN"
echo "   Мини-приложение: https://$MINIAPP_DOMAIN"
echo "   Webhook'и: https://$WEBHOOK_DOMAIN"
echo ""
echo "📝 Не забудьте:"
echo "   1. Настроить DNS записи для доменов"
echo "   2. Заполнить все данные в .env файле"
echo "   3. Перезапустить контейнеры: docker-compose restart"
echo ""

