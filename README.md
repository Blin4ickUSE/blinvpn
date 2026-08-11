# 🥞 BlinVPN 2.1 (dev)

### Автоустановка

```bash
curl -sSL https://raw.githubusercontent.com/Blin4ickUSE/blinvpn/2.0-refactoring/install.sh | sudo bash
```

## Управление сервисами

```bash
# Запуск всех сервисов
docker-compose up -d

# Остановка
docker-compose down

# Просмотр логов
docker-compose logs -f

# Перезапуск конкретного сервиса
docker-compose restart bot
```
