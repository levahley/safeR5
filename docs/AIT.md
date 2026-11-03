# safeR5 — AIT yerel içe aktarma

## Kaynak ve doğrulama kapsamı

[AIT Log Data Set V2.1 kaydı](https://zenodo.org/records/19483937), 17 Ekim 2026 tarihinde sayfa ve canlı Rights alanından kontrol edildi:

| Alan | Kaynakta görülen değer |
| --- | --- |
| Sürüm / yayın | `v2_1` / 9 Nisan 2026 |
| DOI | `10.5281/zenodo.19483937` |
| Lisans | **CC BY-NC-SA 4.0** — atıf, ticari olmayan kullanım ve aynı lisansla paylaşım koşulları |
| Başlangıç dosyası | `russellmitchell_no-pcaps.zip` |
| Sıkıştırılmış boyut | **522.1 MB**, Zenodo'nun gösterdiği yuvarlatılmış değer |
| Kaynağın verdiği checksum | `md5:abb43a46c70939ad9f98669e3510d2b7` |
| russellmitchell simülasyon aralığı | 21 Ocak 2022 00:00–25 Ocak 2022 00:00; sayfa bu tabloda saat dilimi belirtmiyor |

Bu kayıt, araştırma test ortamında üretilen veriyi tanımlar. Üretim ağı verisi değildir. Akademik kullanımda kaydın istediği Landauer ve diğerleri yayınlarına atıf yapılmalıdır; veri yeniden paylaşılacaksa kayıt lisansı uygulanır. safeR5 testleri kendi küçük yapay örneklerini üretir; AIT arşivi dağıtılmaz.

Kaynak, `gather/<host>/logs/` içindeki günlüklerle aynı yoldaki `labels/<host>/logs/` dosyalarını eşler. Etiket JSONL satırındaki `line`, orijinal günlükte **1'den başlayan fiziksel satırdır**; `labels` saldırı adımlarını, `rules` etiketleme kurallarını belirtir. Kaynakta bu etiketleme kapsamındaki etiketsiz satırlar normal sayılır. Saldırganın `attacks.log` dosyası, işleme kodu ve kurallar cevap bilgisi içerir. Bu bilgiler [kayıt açıklamasında](https://zenodo.org/records/19483937) belgelenir.

**Gerçek arşiv indirilmedi veya içe aktarılmadı.** Doğrulanan şey kaynak metadata'sı, aşağıda belirtilen dar parser davranışı ve küçük yapay ZIP örnekleridir. Bir MD5 eşleşmesi dosyanın kayıtla aynı olduğunu gösterebilir; parser kapsamının tamamının gerçek dosyada doğru olduğunu kanıtlamaz. `real_archive_verified` bu sürümde daima `false` kalır. Kaynakta verilen MD5 sürüm eşlemesi içindir; bütünlük ve delil kayıtları ayrıca SHA256 kullanır.

## Kullanım

Arşivi kullanıcı kendi seçtiği yere indirir. Adaptör ağ isteği yapmaz, otomatik indirme başlatmaz. PCAP gerekmez. Proje kökünde, kurulmuş Python ortamıyla:

```sh
PYTHONPATH=backend/src .venv/bin/python -m safer5 ait import \
  --archive '/yerel/dizin/russellmitchell_no-pcaps.zip' \
  --destination '/yerel/dizin/yeni-ait-ciktisi'
```

Aynı adaptörün bağımsız, test edilmiş modül komutu:

```sh
PYTHONPATH=backend/src .venv/bin/python -m safer5.ait \
  --archive '/yerel/dizin/ornek.zip' \
  --destination '/yerel/dizin/yeni-ait-ciktisi'
```

Hedef klasör önceden var olmamalıdır. Başarılı işlem manifest JSON'unu yazdırır. Hata halinde işlem kodu 2 döner; tamamlanmış gibi görünen hedef klasör bırakılmaz. Çıktı bağımsız bir içe aktarma artefaktıdır; web arayüzündeki yönetilen veri kümelerine otomatik eklenmez.

Python arayüzü:

```python
from pathlib import Path
from safer5.ait import import_ait_archive

manifest = import_ait_archive(
    Path('/yerel/dizin/ornek.zip'),
    Path('/yerel/dizin/yeni-ait-ciktisi'),
    max_uncompressed_bytes=1024**3,
)
```

## Desteklenen girdi

- ZIP içinde doğrudan `gather/`, `labels/`, `dataset.yml` veya bunların önünde **tek bir kök klasör** bulunabilir. Birden çok veri kümesi kökü karışık kabul edilmez.
- `auth.log`, `secure` ve bunların `.1`, `.2` gibi sıkıştırılmamış döndürülmüş sürümleri: açık saat dilimli RFC3339 öneki taşıyan OpenSSH `Accepted/Failed password/publickey` girişleri.
- `audit/audit.log` veya `audit.log`, sıkıştırılmamış numaralı sürümleri: Linux `type=... msg=audit(epoch:serial):` satırları. Zenodo'nun audit örneğiyle aynı kayıt zarfı desteklenir.
- `queries.log`, `query.log`, `named.log`, `dns.log`; `bind9/`, `bind/`, `named/` altındaki karşılıkları ve numaralı sürümleri: RFC3339 syslog önekiyle BIND `client IP#port ... query: NAME IN TYPE` satırları.
- `dataset.yml` için yalnızca `start`/`end` veya `start_time`/`end_time` anahtarlarının açık saat dilimli ISO tarih skalerleri okunur. YAML kodu, etiketleri veya nesneleri çalıştırılmaz. Aralık varsa `[başlangıç, bitiş)` filtresi uygulanır.

Klasik `Jan 24 03:01:00` syslog, saat dilimi olmayan BIND tarihleri, `.gz` alt dosyaları ve diğer log türleri bu sürümde desteklenmez. Yıl veya saat dilimi tahmin edilmez. Tanınan dosyadaki çözülemeyen satırlar `unparsed_lines`, tanınmayan dosyalar `unsupported_files` ve `skipped_files` ile açıklanır. Zaman aralığı güvenle okunamıyorsa manifest açık uyarı verir ve zaman filtresi uygulamaz. Bu nedenle gerçek arşivi genel amaçlı, eksiksiz AIT desteği olarak sunmak doğru değildir.

## Etiket ve delil sınırı

| Çıktı | İçerik / tüketici |
| --- | --- |
| `events.jsonl` | Yalnız API sözleşmesindeki Event alanları; dedektör girdisi |
| `truth.jsonl` | `event_id`, `is_attack: true/false/null`, `labels`, `coverage`, `raw_refs`; yalnız değerlendirme |
| `provenance.jsonl` | Her olay için bütün orijinal satır referansları; delil görüntüleme |
| `raw/<file_id>.log` | Seçilen orijinal günlük baytları; dosya içeriği değiştirilmez |
| `answers/<file_id>.jsonl` | İlgili orijinal etiket dosyasının baytları; dedektörden ayrı tutulur |
| `manifest.json` | Kaynak yolları, dosya SHA256, arşiv MD5/SHA256, sınırlar, tanılar ve çıktı yolları |

Etiketler SQLite dizinine **satırlar elenmeden önce** alınır ve her fiziksel satırın özgün numarasıyla eşlenir. Tam karşılık gelen etiket dosyası varsa kapsamdaki etiketsiz olay `false`; dosya yoksa `null/unknown` olur. Bozuk, tekrar eden veya günlük boyunu aşan etiket referansı importu durdurur. Çözülemeyen veya zaman filtresinde dışarıda kalan etiketli satır sayıları ayrıca `labeled_unparsed_lines` ve `labeled_outside_window_lines` içinde gösterilir. Bu sayılar sıfır değilse kalan olaylarla hesaplanacak sonuçların kapsamı daralmıştır.

Audit olayları aynı **dosya + epoch + serial** anahtarıyla birleştirilir; araya başka olay girse bile bütün satırlar korunur. Dönen ayrı dosyalardaki aynı audit kimliği birleştirilmez. Event içindeki tek `raw_ref` ilk satırı gösterir; tam delil için `provenance.jsonl` içindeki `raw_refs` listesi kullanılmalıdır. Bir gruptaki tüm etiketler truth tarafında birleşir. Özgün dosyanın SHA256'sı her referansta bulunur; bu değer satır hash'i değildir. Dosya içeriği değişirse dosya ve olay kimlikleri de değişir. Yalnız etiket değişikliği Event girdisini değiştirmez.

Host ve kullanıcı kimlikleri metinden türetilen opak hash'lerdir; saldırı cevabı içeren klasör adları özellik olarak taşınmaz. Host eşliği arşivdeki aynı host adına dayanır; IP alanları yalnız kayıtta açıkça görülen değerlerden alınır. `processing/config/servers.yml` otomatik işlenmez; host/IP ters eşlemesi veya kimlik dizini çözümü yapıldığı iddia edilmez. Audit UID'si ile SSH hesap adı kendiliğinden aynı kullanıcı sayılmaz. Bilinmeyen alanlar `null` kalır.

`attacker` hostları, saldırı/cevap/etiket/senaryo adları taşıyan dosyalar, `processing`, `rules`, `environment`, scriptler ve allowlist dışında kalan içerik analiz girdisine girmez. Etiketler ve orijinal yollar manifest/answers tarafında tutulur; bu dosyalar model özelliklerine verilmemelidir. Bu ayrım uygulama düzeyindedir; işletim sistemi düzeyinde erişim izolasyonu değildir.

## Kaynak sınırları

Varsayılanlar: arşiv en fazla 2 GiB; toplam ilan edilen ve gerçekten okunan açılmış baytlar 1 GiB; en fazla 10.000 ZIP girdisi; merkez dizin en fazla 16 MiB; fiziksel satır en fazla 1 MiB; 1.000.000 normalize olay; 2.000.000 etiket kaydı; bir audit grubunda 1.024 satır; açılma oranı en fazla 500:1. Merkez dizin sınırı, Python ZIP okuyucusu metadata'yı belleğe almadan önce denetlenir. Boyut hesabına dışlanan dosyalar da katılır. Geçersiz yol, `..`, mutlak/Windows yolu, ters eğik çizgi, tekrar eden yol, symlink, özel dosya, şifreli ZIP ve desteklenmeyen sıkıştırma reddedilir.

`--max-uncompressed-bytes N` yalnız toplam açılmış bayt sınırını değiştirir; diğer sınırlar yerinde kalır. Gerçek aday dosya bu varsayılan sınırı aşabilir. Limit artırmadan önce disk kapasitesi kontrol edilmelidir: geçici SQLite dizini, ham kopyalar ve JSONL çıktıları açılmış günlüklerin üstüne ek alan ister. Bellek yerine akış ve disk dizini kullanılır; bütün arşiv veya günlük bir kerede belleğe alınmaz. Ara dosyalar hedefin yanında tutulur; yalnız tamamlanan klasör atomik yeniden adlandırmayla yayımlanır. Orijinal ZIP yazılmaz.

## Gerçekten çalıştırılan kontroller

`backend/tests/test_ait.py`, özgün satır eşlemesi, etiket değişikliğinde Event değişmezliği, içerik değişikliğinde delil kimliği, ayrı dosyada dönen audit kayıtları, araya kayıt giren çok satırlı audit, DNS alanları, bilinmeyen etiket/alan durumu, Event sözleşmesi, güvenli arşiv sınırları ve komut satırının başarı/hata davranışını küçük yapay ZIP'lerle sınar. Gerçek AIT dosyasıyla uçtan uca sonuç ve performans ölçümü **doğrulanmadı**. Güncel test özeti proje doğrulama kaydında tutulur.
