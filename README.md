# Snake Game - Multiplayer Backend & Frontend

2 kişilik yılan oyunu projesi. Backend Go ile, frontend Angular ile yazılmıştır.

## Proje Yapısı

```
snake/
├── backend/          # Go WebSocket server
│   ├── main.go       # Server entry point
│   ├── game.go       # Oyun mantığı ve WebSocket handler
│   ├── go.mod
│   └── Dockerfile
├── frontend/         # Angular frontend
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   ├── lobby/    # Lobby komponenti
│   │   │   │   └── game/     # Oyun komponenti
│   │   │   └── services/
│   │   │       ├── websocket.service.ts
│   │   │       └── game.service.ts
│   │   └── styles.css
│   ├── angular.json
│   └── Dockerfile
└── docker-compose.yaml
```

## Özellikler

- 2 kişilik çok oyunculu yılan oyunu
- WebSocket üzerinden gerçek zamanlı iletişim
- Eşleşme sistemi (lobby)
- Oyun isteği gönderme/kabul etme
- Hazır olma ve geri sayım sistemi
- Oyuncular birbirlerine çarpabilir
- Geniş oyun alanı (40x30 grid)

## Kurulum

### Docker ile Çalıştırma

```bash
docker-compose up --build
```

Backend: http://localhost:8080
Frontend: http://localhost:80

### Manuel Kurulum

#### Backend

```bash
cd backend
go mod download
go run main.go game.go
```

#### Frontend

```bash
cd frontend
npm install
npm start
# veya
ng serve
```

Frontend http://localhost:4200 adresinde çalışacaktır.

## WebSocket API

### Mesaj Tipleri

- `join_lobby`: Lobby'ye katıl
- `leave_lobby`: Lobby'den ayrıl
- `game_request`: Oyun isteği gönder
- `game_accept`: Oyun isteğini kabul et
- `game_reject`: Oyun isteğini reddet
- `player_ready`: Oyuncu hazır
- `player_move`: Oyuncu hareketi (direction: "up", "down", "left", "right")
- `game_update`: Oyun durumu güncellemesi
- `game_start`: Oyun başladı
- `game_over`: Oyun bitti

## Oyun Kuralları

- Her oyuncu başlangıçta 3 parçalı bir yılanla başlar
- Yem yendiğinde yılan büyür ve skor artar
- Kendine veya rakibe çarpan oyuncu kaybeder
- Oyun alanı wrap-around (kenarlardan geçiş yapılabilir)
- Ok tuşları veya WASD tuşları ile kontrol

## Frontend Özellikleri

- **Lobby Sistemi**: Kullanıcılar lobby'ye katılır ve diğer oyuncuları görür
- **Oyun İsteği**: Bir oyuncu diğerine oyun isteği gönderebilir
- **Hazır Olma**: Her iki oyuncu "Hazırım" butonuna basmalı
- **Geri Sayım**: 3-2-1 geri sayımı ile oyun başlar
- **Canvas Tabanlı Oyun**: HTML5 Canvas ile gerçek zamanlı oyun render'ı
- **Responsive Tasarım**: Mobil ve masaüstü uyumlu

## Teknolojiler

- **Backend**: Go 1.21, Gorilla WebSocket
- **Frontend**: Angular 17, TypeScript, RxJS
- **Containerization**: Docker, Docker Compose
- **Web Server**: Nginx (production frontend)

