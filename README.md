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

Önce **Aday arazileri tara** düğmesine basın. Uygulama Overpass üzerinden OSM boş/geliştirilmemiş arazi ve kamu hastanesi poligonlarını alır, kaynak sahaların çevresindeki engellerle 100 × 100 m kareleri karşılaştırır. Tarama birkaç dakika sürebilir. Yeterli aday bulunduğunda hastane sayısını seçip optimizasyonu başlatın. Veri hatasında veya yetersiz aday sayısında uydurma konum üretilmez; hastane sayısını azaltın veya taramayı yeniden deneyin. Kamu hastanesi sahalarını yeniden kullan seçeneği varsayılan olarak açıktır; değişince yeniden tarama gerekir.

Haritada yakınlaştırma/uzaklaştırma, tüm Ankara görünümü, nüfus talebi, aday kareler ve erişim halkaları; hastane detayları, OSM kaynak bağlantıları ve JSON senaryo indirme bulunur. JSON dosyası aday geometrilerini ve kaynak/veri tarihlerini de içerir. Aynı parametreler **ve aynı aday verisi** aynı sonucu verir. OSM verisi değişirse yeni taramanın sonucu değişebilir.

## Modelin sınırları

Mevcut hastanelerin sunduğu sağlık hizmeti tamamen yok sayılır. `src/optimizer.js` içindeki 25 ilçe nüfusu yaklaşık örnek veridir; resmî veya güncel nüfus/yoğunluk verisi değildir. Talep ilçe merkezlerinde toplanır.

Eski 75 sentetik aday kaldırılmıştır. Adaylar yalnızca OSM'de `landuse=greenfield/brownfield` olarak işaretlenmiş poligonlardan ve isteğe bağlı kamu hastanesi sahalarından türetilir. Tek başına bina kaydı olmaması boşluk sayılmaz. Her kare kaynak poligonun ve Ankara il sınırının tamamen içinde kalmalıdır; poligon delikleri de hesaba katılır. Kareler birbirleriyle çakışmaz.

Kayıtlı bina geometrisine 5 m, yol eksenine bilinen/tahmini yarı yol genişliği +5 m tampon uygulanır. Yolun yalnız köşeleri değil tüm geometrisi sınanır. Su, orman, tarım, park, korunan alan ve diğer kayıtlı kullanımlar elenir. Hastane yeniden kullanımında yalnız aynı kamu hastanesi poligonu içinde kalan binalar, otoparklar ve iç servis/yaya yolları kaldırılabilir varsayılır. Ana yollar ve dış binalar muaf değildir. Özel veya kamu niteliği etiket/ad üzerinden belirlenemeyen hastaneler dahil edilmez. Kamu niteliği ad/etiket çıkarımıdır, resmî mülkiyet doğrulaması değildir.

Overpass istekleri seri ve aralıklı yürütülür. HTTP 429/502/503/504, bağlantı hatası veya zaman aşımında uygulama üç farklı Overpass sunucusunu en fazla iki tur dener; deneme ve sunucu adı arayüzde gösterilir. Tüm sunucular başarısızsa eksik veriyle aday üretilmez. 5 km²'den büyük kaynaklar ve ilk 60 kaynağı aşanlar taranmaz. Kaynak başına yaklaşık 2.500 merkez örneklenir. Atlanan kaynaklar ve bina/yol/diğer engel ret sayıları arayüzde ve JSON'da raporlanır. Tarama tüm Ankara'daki uygun yerleri bulmayı garanti etmez. Eksik geometri veya sorgular arasında kaynak geometrisinin değişmesi halinde tarama tamamlanmış sayılmaz.

**OSM arazi taraması, gerçek boş parsel tespiti veya yapılaşma izni değildir.** Veriler eksik/eski olabilir. Brownfield kirlenmiş/eski kullanım kalıntıları içerebilir. Fiziksel boşluk, yasal/mülkiyet durumu, topoğrafya ve imar için güncel görüntü, kadastro ve saha incelemesi gerekir. Kaynağı belirsiz yerler boş diye sunulmaz.

Her tesis 100–500 yatak (25 adım) alabilir. Model yatak talebi nüfus × yatak/1000 ile bulunur, en yakın tesise atanır. 10.000 m² arsa üzerinde bu kapasitenin mümkün olması ayrıca kat alanı ve imar çalışması gerektirir. Maliyetler örnek M TL cinsindendir: arsa + 160 M sabit tesis + yatak × birim maliyet. İşletme maliyeti yoktur. Mesafe kuş uçuşudur, memnuniyet erişim/kapasite ile temsil edilir. Sonuçlar kesin fizibilite veya küresel optimum değildir. Amaç fonksiyonu arayüzde Modeli keşfet bölümünde açıklanır.

Gerçek kullanım için TÜİK/ADNKS nüfus ızgaraları, kadastro/yapı/imar ve yol ağı verileri ile gerçek maliyet keşfi gereklidir.

## Harita kaynakları

Döşemeler: © OpenStreetMap contributors. Arazi verisi: OpenStreetMap/Overpass, ODbL 1.0 (https://www.openstreetmap.org/copyright). API anahtarı gerekmez; `tile.openstreetmap.org` ve `overpass-api.de` ağ erişimi gerekir. Canlı veriler depoya gömülmez. Kamu API'si hız/yük sınırlamalarına tabidir. Yazı tipleri: Google Fonts (fonts.googleapis.com, fonts.gstatic.com); sistem fontu yedeği vardır.

İl sınırı: https://github.com/alpers/Turkey-Maps-GeoJSON — `tr-cities.json` dosyasından Ankara özelliği ayıklanmıştır. Apache 2.0 lisansı `public/geojson-LICENSE.txt` içindedir. Bu sınır planlama için resmî kadastro doğruluğu sağlamaz.
