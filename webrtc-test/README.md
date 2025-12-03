# WebRTC Mesajlaşma Test Uygulaması

Bu uygulama, WebRTC kullanarak iki taraf arasında peer-to-peer mesajlaşma testi yapmanızı sağlar.

## Özellikler

- **STUN/TURN Sunucu Desteği**: `turn.li1.nl:3478` sunucusunu kullanır
- **Offer/Answer Modeli**: WebRTC signaling için standart offer/answer modeli
- **ICE Candidates**: Manuel ICE candidate değişimi
- **Data Channel**: Mesajlaşma için WebRTC Data Channel kullanımı
- **Gerçek Zamanlı Durum**: Bağlantı durumu, ICE durumu ve signaling durumu takibi
- **Mesajlaşma**: İki taraf arasında metin mesajlaşma

## Kullanım

### 1. Uygulamayı Açın

`index.html` dosyasını bir web tarayıcısında açın. İki farklı tarayıcı penceresi veya sekmesi kullanabilirsiniz.

### 2. Bağlantı Kurma

#### Initiator (Başlatıcı) Tarafı:

1. **"Offer Oluştur (Initiator)"** butonuna tıklayın
2. **Local SDP** alanında oluşturulan SDP'yi görürsünüz
3. **"SDP'yi Kopyala"** butonuna tıklayarak SDP'yi kopyalayın
4. **Local ICE Candidates** alanında ICE candidates görünecektir
5. **"ICE'leri Kopyala"** butonuna tıklayarak ICE candidates'ı kopyalayın
6. Bu bilgileri **Receiver** tarafına gönderin

#### Receiver (Alıcı) Tarafı:

1. Initiator'dan gelen **SDP'yi** alın
2. **Remote SDP** alanına yapıştırın
3. **"Answer Oluştur (Receiver)"** butonuna tıklayın
4. **Local SDP** alanında oluşturulan Answer SDP'sini görürsünüz
5. **"SDP'yi Kopyala"** butonuna tıklayarak Answer SDP'sini kopyalayın
6. **Local ICE Candidates** alanında ICE candidates görünecektir
7. **"ICE'leri Kopyala"** butonuna tıklayarak ICE candidates'ı kopyalayın
8. Bu bilgileri **Initiator** tarafına gönderin

### 3. SDP ve ICE Değişimi

#### Initiator Tarafı:

1. Receiver'dan gelen **Answer SDP'yi** alın
2. **Remote SDP** alanına yapıştırın
3. **"SDP'yi Ayarla"** butonuna tıklayın
4. Receiver'dan gelen **ICE candidates'ı** alın
5. **Remote ICE Candidates** alanına yapıştırın
6. **"ICE'leri Ekle"** butonuna tıklayın

#### Receiver Tarafı:

1. Initiator'dan gelen **ICE candidates'ı** alın
2. **Remote ICE Candidates** alanına yapıştırın
3. **"ICE'leri Ekle"** butonuna tıklayın

### 4. Mesajlaşma

Bağlantı kurulduktan sonra (durum "Bağlandı" olarak göründüğünde):

- Mesaj yazın ve **"Gönder"** butonuna tıklayın veya **Enter** tuşuna basın
- Gönderilen ve alınan mesajlar farklı renklerle gösterilir
- Her mesajın zaman damgası vardır

## ICE Sunucu Yapılandırması

Uygulama şu ICE sunucularını kullanır:

- **STUN**: `stun:turn.li1.nl:3478`
- **TURN (UDP)**: `turn:turn.li1.nl:3478?transport=udp`
- **TURN (TCP)**: `turn:turn.li1.nl:3478?transport=tcp`
- **Username**: `peaceast`
- **Credential**: `endoplazmikretikulum`

## Durum Göstergeleri

- **Bağlantı Durumu**: Genel bağlantı durumu
- **ICE Bağlantı Durumu**: ICE connection state (new, checking, connected, completed, failed, disconnected, closed)
- **Signaling Durumu**: Signaling state (stable, have-local-offer, have-remote-offer, have-local-pranswer, have-remote-pranswer, closed)

## Loglar

Tüm işlemler ve hatalar log bölümünde görüntülenir:
- **Info**: Bilgilendirme mesajları (mavi)
- **Success**: Başarılı işlemler (yeşil)
- **Warning**: Uyarılar (sarı)
- **Error**: Hatalar (kırmızı)

## Notlar

- Bu uygulama test amaçlıdır ve production kullanımı için tasarlanmamıştır
- SDP ve ICE candidates'ı manuel olarak kopyalayıp yapıştırmanız gerekir (gerçek bir uygulamada bu bir signaling server üzerinden otomatik yapılır)
- İki taraf da aynı ağda olabilir veya farklı ağlarda olabilir (TURN sunucusu sayesinde)
- Bağlantı kurulduktan sonra mesajlaşma başlayabilir

## Sorun Giderme

- **Bağlantı kurulamıyor**: ICE candidates'ın doğru şekilde değiştirildiğinden emin olun
- **Mesaj gönderilemiyor**: Data channel'ın açık olduğundan emin olun (durum "Bağlandı" olmalı)
- **ICE connection failed**: TURN sunucusu yapılandırmasını kontrol edin
- **SDP parse hatası**: SDP'nin tam olarak kopyalandığından ve JSON formatında olduğundan emin olun

