# safeR5 — Laboratuvar rehberi

## Kurum ve takvim ayarı

Kullanıcı/host sayısı ve zaman aralığı CLI/API üzerinden yapılandırılabilir:

```sh
PYTHONPATH=backend/src .venv/bin/python -m safer5 lab generate --seed 51 --n-events 3000 --users 12 --hosts 7 --start '2026-03-01T00:00:00Z' --duration-hours 2
```

Kullanıcı sayısı 2–256, host sayısı 4–256, bölme süresi 1–24 saattir. Host alt sınırı dört hedefli senaryoyu korur. Tarih saat dilimi içermelidir; UTC'ye dönüştürülür. Eğitim, doğrulama ve test başlangıçları ikişer gün arayla ayrılır; belirtilen süre her bölmeye ayrı uygulanır. Arayüzün hızlı üretim formu varsayılan kurum ve takvimi kullanır.

## Güvenli ve tekrarlanabilir veri

Laboratuvar işletim sistemi servislerini değiştirmez, gerçek ağlara saldırmaz ve log içeriğindeki komutları çalıştırmaz. Özel IP adresleri ve `example.test` adlarıyla olay verisi üretir. Tek profil `demo`dur; tohum ve olay sayısı yapılandırılabilir.

Her veri kümesi `train`, `validation`, `test` bölümlerinden oluşur. `--n-events` **bölüm başına** olay sayısıdır; 2.400 seçimi toplam 7.200 olay oluşturur. Tarihler sırasıyla 1, 3 ve 5 Ocak 2026 UTC'den başlar; her bölüm yaklaşık 12 saatlik bir aralık kullanır. Bölümler farklı rastgele diziler kullanır. Aynı tohum ve yapılandırma aynı içerik hash'lerini verir; farklı tohum yeni yerleşim ve olay çeşitliliği üretir. Aynı veri yeniden kaydedildiğinde aynı yönetilen veri kümesi kullanılır.

Eğitim bölümü normal davranış içerir. Doğrulama ve testte normal davranışla birlikte üç senaryo ailesi bulunur:

| Aile | Kaynaklarda görülen örüntü |
| --- | --- |
| Hesap kötüye kullanımı | Başarısız girişler, ardından başarılı giriş ve ayrıcalıklı işlemler |
| Sunucular arası ilerleme | Aynı kullanıcının farklı hostlarda oturumları ve uzak çalıştırma olayları |
| Veri sızdırma belirtileri | Arşivleme ve uzun sorgu adlarıyla yoğun DNS hareketi |

Normal bakım örnekleri de arşivleme, ayrıcalıklı işlemler ve uzun DNS adları içerir. Böylece bu davranışlar tek başına saldırı cevabını vermez; normal örneklerde yanlış alarmlar ortaya çıkabilir. Saldırı ve normal davranış aynı kullanıcı/host uzayını paylaşır. Kayıtlarındaki kimlikler saldırı adımı etiketi taşımaz.

## Arayüz akışı

**Genel bakış → Demo deneyi başlat** ilk, kayıpsız deneyi üretir. Ayrı bir veri kümesi hazırlamak için **Veri laboratuvarı** ekranında tohum ve bölüm başına olay sayısını girip **Veri kümesi üret** düğmesine basın. Arayüz, 600–100.000 olaylık bölüm boyutunu sunar; API/CLI şeması 300–1.000.000 aralığını kabul eder. Bu üst sınırların varlığı, o hacmin bu makinede ölçüldüğü anlamına gelmez.

**Deney tasarımı** ekranında üretilen veri kümesini seçin. Yeni demo seçeneği boş bırakılan bir `dataset_id` ile yeni üretim yapar. Aynı girdiyle karşılaştırma için geçmişteki veri kümesini seçerek tohum, kaynaklar ve kayıp ayarlarını kaydedin. Tam görünüm, seçilen kaynakların kayıp uygulanmadan önceki test olaylarıdır.

## Komut satırından üretim ve kontrol

Proje kökünde:

```sh
PYTHONPATH=backend/src .venv/bin/python -m safer5 --root data lab generate --profile demo --seed 42 --n-events 2400
```

Çıktıdaki `id` veri kümesi kimliğidir. Manifesti kontrol etmek için bu kimliği yerine yazın:

```sh
PYTHONPATH=backend/src .venv/bin/python -m safer5 lab validate --manifest data/datasets/VERI_KIMLIGI/manifest.json
PYTHONPATH=backend/src .venv/bin/python -m safer5 --root data experiment run --config configs/demo.json
```

`configs/demo.json` DNS kaynağının tamamen kesilmesini tanımlar. `dataset_id: null` olduğundan kendi demosunu üretir. Önceden oluşturduğunuz veri için yapılandırmanın kopyasında gerçek kimliği kullanın. `seed`, kayıp modeli, kaynaklar, bütçe ve yanlış pozitif sınırı sonuçta saklanır. Zaman girdileri açık saat dilimli olmalıdır; arayüzde zaman aralığı alanları UTC olarak yorumlanır.

## Dosyalar ve cevap sınırı

Veriler varsayılan olarak `data/` altında tutulur:

```text
data/
  metadata.sqlite3
  datasets/<id>/
    manifest.json
    train|validation|test/
      raw.jsonl
      events.jsonl
      events.parquet
      truth.json
  experiments/<id>/
    observed.parquet
    result.json
    config.json
    model.pkl
    model_manifest.json
  staging/
```

`raw.jsonl` özgün üretilmiş kayıttır. Normalleştirilmiş Event içindeki `raw_ref`, dosya kimliği, 1'den başlayan satır ve dosya SHA256'sını taşır. Ground truth ayrı `truth.json` dosyasındadır; dedektörün fonksiyonuna verilmez. Deney kaybı özgün dosyayı düzenlemek yerine ayrı `observed.parquet` görünümü oluşturur. Arayüzün olay ve delil uçları yalnız bu gözlenen test verisini sunar.

`result.json` girdi/yapılandırma/kaynak/model hash'leri, sürümler, tohum, kayıp manifesti ve ölçülen çalışma bilgilerini taşır. `model.pkl` uygulamanın kendi ürettiği artefakttır; kullanıcıdan model dosyası yükleme akışı yoktur. Deney başına model yeniden kurulur; o deneyin tam/kayıplı karşılaştırmasında aynı model kullanılır.

## Dış veri

Arayüzdeki JSONL importu normalleştirilmiş Event nesneleri ister ve 5 MiB ile sınırlıdır. API'nin toplam istek gövdesi sınırı 20.000.000 bayttır; veri deposunun içerik sınırı 20 MiB'dir. Geçersiz satırlar karantinaya ayrılır; hiç geçerli olay yoksa veri kümesi oluşturulmaz. Fiziksel satırlar korunur. Aynı içerik ikinci kez import edilince yeni kopya üretilmez. İçe aktarma, özgün dosyaya geri dönüş için kendi yönetilen olay/dosya referanslarını oluşturur.

Bu import ground truth kabul etmez. Normal veya saldırı olduğu bilinmeyen olaylar otomatik normal sayılmaz; başarı metriği ve kaynak önerisi verilmez. AIT ZIP akışı bağımsız bir artefakt üretir; web veri kümesine kendiliğinden eklenmez. Kapsamı [AIT belgesindedir](AIT.md).

## Tekrarlama ve hacim

Tohum, kaynak ve model hash'lerini raporda birlikte karşılaştırın. Aynı yapılandırmayı farklı tohumlarla tekrarlamak tek seed sonucunun hassasiyetini gösterir; farklı senaryo ailelerini dışarıda bırakan bir genelleme deneyi yerine geçmez. 100.000 olay gibi gerçek hacim ölçümleri, makine bilgileri ve tekrar sonuçları yalnız [doğrulama kaydında](VALIDATION.md) ve onun bağladığı artefaktlarda bulunur. Burada çalıştırılmamış bir hız veya bellek sonucu verilmez.
