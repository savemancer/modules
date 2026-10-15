# Деплой публичной части (Docker + Nginx Proxy Manager)

Из этого репозитория поднимаются два контейнера в Docker-сети `edge` (портов наружу не публикуют):

| Контейнер | Домен | Что отдаёт |
|---|---|---|
| `savemancer-cdn` | `cdn.savemancer.com` | `registry.json` и бандлы модулей — их загружает сайт |
| `savemancer-devkit` | `dev.savemancer.com` | Devkit для авторов модулей (необязательно) |

Образ CDN собирается только если проходят `npm run check` (валидация, типы, тесты).

## Первый запуск

```sh
git clone https://github.com/savemancer/modules.git savemancer-modules
cd savemancer-modules
docker network inspect edge >/dev/null || docker network create edge
docker compose up -d --build
docker compose ps    # оба healthy
```

## Nginx Proxy Manager

Proxy Hosts → Add Proxy Host (SSL: Let's Encrypt, Force SSL, HTTP/2):

| Domain | Forward Hostname | Port |
|---|---|---|
| `cdn.savemancer.com` | `savemancer-cdn` | 80 |
| `dev.savemancer.com` | `savemancer-devkit` | 80 |

## Обновление после мёржа модуля

```sh
git pull
docker compose up -d --build cdn
```

Основной сайт и API разворачиваются из приватного репозитория — см. его README.
