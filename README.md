# Ankara Atlas

Ankara için devlet hastanesi konum ve kapasite senaryo laboratuvarı. React, Leaflet ve diferansiyel evrim (DE/rand/1/bin) kullanır.

## Çalıştırma

Node.js 24 ile:

```sh
npm ci
npm run dev -- --port 3000
```

Uygulama açıldığında hazır çevrimdışı aday veri setiyle varsayılan optimizasyon otomatik çalışır; ek bir “arazi ara” işlemi yoktur. Parametre değişince **Yeniden optimize et** düğmesine basın. Aynı veri ve parametreler aynı sonucu üretir.

## Çevrimdışı harita ve 200 × 200 m ızgara

Tarayıcı harita döşemesi veya arazi API'si kullanmaz. Ankara sınırı, ana yollar, ilçe etiketleri ve uygun kareler uygulamayla paketlenir; Codespaces ağ politikasından etkilenmez. Uzak görünümde performans için kareler gizlenir, yakınlaştırınca görünür.

`.github/workflows/generate-offline-grid.yml` tek seferlik veri üretimini gerçekleştirir:

1. Geofabrik'in güncel Türkiye OSM PBF dosyasını indirir ve yayımlanan MD5 ile doğrular.
2. Ankara il sınırını, binaları, yolları ve hastane sahalarını ayırır.
3. İlçe merkezlerinin nüfusa göre belirlenen planlama çevrelerini 200 × 200 m karelere böler.
4. İl sınırı dışına taşan, bina geometrisine 5 m içinde kalan veya yol ekseni için tahmini yarı genişlik +5 m payla çakışan kareleri eler.
5. Kamu niteliği OSM etiketi/adından belirlenebilen mevcut hastane poligonlarını yeniden kullanım alanı sayar. Özel ve niteliği belirsiz hastaneler bu istisnaya girmez.
6. Sonucu `src/data/ankara-grid.json` ve yerel yol/hastane bağlamını `src/data/ankara-context.json` olarak depoya kaydeder.

Planlama yarıçapları nüfusu 400 bin ve üzerindeki ilçe merkezlerinde 15 km, 100 bin ve üzerindekilerde 8 km, 50 bin ve üzerindekilerde 6 km, diğerlerinde 4 km'dir. Bu tercih tarayıcıya yüz binlerce hücre yüklemeyi önler; tüm Ankara il yüzeyinin boş arazi envanteri değildir. Üretim tarihi, kontrol edilen kare/özellik sayıları ve kapsam kuralı uygulamada gösterilir.

## Nüfus ve optimizasyon modeli

Nüfus görünümü ısı haritası, daireler veya kapalı olarak seçilebilir. Veriler yaklaşık ilçe nüfuslarıdır; mahalle nüfus yoğunluğu değildir. Isı haritası ilçe merkezi noktalarının yumuşatılmış görselidir.

Her tesis 100–500 yatak (25 yatak adımı) alabilir. İlçeler en yakın tesise atanır. Amaç fonksiyonu yatırım maliyetini, hedef yarıçap dışındaki nüfusu, nüfus ağırlıklı kuş uçuşu mesafeyi ve kapasite açığını birlikte azaltır. Algoritma parametre ve aday veri setinden sabit tohum üretir.

## Sınırlar

“Uygun kare”, kullanılan OSM anlık görüntüsünde kayıtlı bina ve yollarla çakışma bulunmadığı anlamına gelir. OSM eksik veya eski olabilir. Sonuç fiziksel boşluk, mülkiyet, kadastro, imar, topoğrafya, zemin, afet ve çevre uygunluğu kanıtı değildir. Kamu hastanesi sınıflandırması resmî mülkiyet kaydı değildir. Nüfus ve maliyetler örnektir. Yatırım öncesinde güncel görüntü, kadastro, imar ve saha incelemesi gerekir.

Veri: © OpenStreetMap contributors, ODbL 1.0; Türkiye özütü Geofabrik. İl sınırı: `alpers/Turkey-Maps-GeoJSON`, Apache 2.0.
