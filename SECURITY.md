# Güvenlik

Bu uygulama istemci tarafında çalışan bir senaryo prototipidir. Kullanıcı hesabı, veritabanı veya API anahtarı gerektirmez. Nüfus ve aday alan verileri uygulamayla birlikte gelen örnek verilerdir.

- API anahtarları, parolalar ve kişisel verileri depoya eklemeyin. `.env` ve yerel anahtar dosyaları Git dışında tutulur.
- Vite `VITE_*` değişkenleri tarayıcı paketine gömülür; bunlara gizli bilgi koymayın. Harici servis anahtarı gerekirse sunucu tarafında saklayın.
- `npm run dev` geliştirme içindir. Üretimde `npm run build` çıktısını HTTPS destekleyen statik barındırmada yayımlayın; geliştirme sunucusunu internete açmayın.
- Harita ve arazi verileri uygulamayla paketlenir; tarayıcı OpenStreetMap/Overpass servisine bağlanmaz. Google Fonts erişilemezse sistem yazı tipi kullanılır. Uygulama cihaz konumu istemez ve senaryoyu bir sunucuya göndermez.
- Tek seferlik GitHub Actions üretimi Geofabrik OSM dosyasını yayımlanan MD5 ile doğrular. OSM verisi fiziksel boşluk veya resmî imar doğruluğu garantisi sağlamaz.
- Bağımlılıkları düzenli olarak `npm audit` ile kontrol edin. Sıfır bulgu, tüm güvenlik açıklarının yokluğu anlamına gelmez.

Güvenlik açığı bildirirken herkese açık issue içine anahtar, parola veya kişisel veri koymayın. GitHub özel güvenlik bildirimini etkinse kullanın.
