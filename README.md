# Ankara Atlas

Ankara devlet hastanesi konum ve kapasite senaryo laboratuvarı. React, Leaflet ve diferansiyel evrim (DE/rand/1/bin).

## Çalıştırma

Node.js 22.12+ veya 24 ile:

```sh
npm ci --cache /workspace/.npm-cache
npm run dev -- --port 3000
npm test
npm run build
```

Haritada yakınlaştırma/uzaklaştırma, tüm Ankara görünümü, nüfus talebi, aday kareler ve erişim halkaları; hastane detayları ve JSON senaryo indirme bulunur. Parametre değişimi sonucu yeniden hesaplamak gerekir. Algoritma rastlantısaldır, her çalışmada farklı sonuç verebilir.

## Modelin sınırları

Mevcut kamu ve özel hastaneler tamamen yok sayılır. `src/optimizer.js` içindeki 25 ilçe nüfusu yaklaşık örnek veridir; resmî veya güncel nüfus/yoğunluk verisi değildir. Talep ilçe merkezlerinde toplanır. 75 adet 100 × 100 metre kare sentetik adaydır; boşluk, kadastro, imar, mülkiyet veya zemin uygunluğu kontrol edilmemiştir. Gerçek boş parsel tespiti uygulanmış değildir.

Her tesis 100–500 yatak (25 adım) alabilir. Model yatak talebi nüfus × yatak/1000 ile bulunur, en yakın tesise atanır. 10.000 m² arsa üzerinde bu kapasitenin mümkün olması ayrıca kat alanı ve imar çalışması gerektirir. Maliyetler örnek M TL cinsindendir: arsa + 160 M sabit tesis + yatak × birim maliyet. İşletme maliyeti yoktur. Mesafe kuş uçuşudur, memnuniyet erişim/kapasite ile temsil edilir. Sonuçlar kesin fizibilite veya küresel optimum değildir. Amaç fonksiyonu arayüzde Modeli keşfet bölümünde açıklanır.

Gerçek kullanım için TÜİK/ADNKS nüfus ızgaraları, kadastro/yapı/imar ve yol ağı verileri ile gerçek maliyet keşfi gereklidir.

## Harita kaynakları

Döşemeler: OpenStreetMap / CARTO. Ağ gerektirir: a/b/c.basemaps.cartocdn.com. Yazı tipleri: Google Fonts (fonts.googleapis.com, fonts.gstatic.com); sistem fontu yedeği vardır.

İl sınırı: https://github.com/alpers/Turkey-Maps-GeoJSON — `tr-cities.json` dosyasından Ankara özelliği ayıklanmıştır. Apache 2.0 lisansı `public/geojson-LICENSE.txt` içindedir. Bu sınır planlama için resmî kadastro doğruluğu sağlamaz.
