# Güvenlik

Bu uygulama istemci tarafında çalışan bir senaryo prototipidir. Kullanıcı hesabı, veritabanı veya API anahtarı gerektirmez. Nüfus ve aday alan verileri uygulamayla birlikte gelen örnek verilerdir.

- API anahtarları, parolalar ve kişisel verileri depoya eklemeyin. `.env` ve yerel anahtar dosyaları Git dışında tutulur.
- Vite `VITE_*` değişkenleri tarayıcı paketine gömülür; bunlara gizli bilgi koymayın. Harici servis anahtarı gerekirse sunucu tarafında saklayın.
- `npm run dev` geliştirme içindir. Üretimde `npm run build` çıktısını HTTPS destekleyen statik barındırmada yayımlayın; geliştirme sunucusunu internete açmayın.
- Harita döşemeleri CARTO/OpenStreetMap kaynaklarından, fontlar Google Fonts üzerinden yüklenir. Bu sağlayıcılar tarayıcının IP adresi ve talep bilgilerini görebilir. Harita kaydırılırken istenen döşemeler görüntülenen bölgeyi belirtir. Uygulama cihaz konumu istemez ve senaryoyu bir sunucuya göndermez.
- Bağımlılıkları düzenli olarak `npm audit` ile kontrol edin. Sıfır bulgu, tüm güvenlik açıklarının yokluğu anlamına gelmez.

Güvenlik açığı bildirirken herkese açık issue içine anahtar, parola veya kişisel veri koymayın. GitHub özel güvenlik bildirimini etkinse kullanın.
