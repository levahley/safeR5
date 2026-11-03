# safeR5 — Bilinen sınırlar

## Verinin ve sonucun anlamı

- Demo sentetik bir araştırma test ortamıdır. Üç saldırı ailesi ve normal bakım örnekleri vardır; üretim ağı çeşitliliğini temsil ettiği gösterilmemiştir. Doğrulama/test aileleri aynıdır; tarihler, rastgele diziler ve yerleşimler ayrıdır. Görülmemiş aile, kurum veya saldırgana genelleme ölçülmez.
- Kurallar normal bakımda da tetiklenebilir; modelin düşük veya olumsuz sonucu gizlenmez. Anomali skoru olasılık, önem derecesi kesin saldırı hükmü değildir.
- JSONL importu normalleştirilmiş olay bekler; evrensel syslog parserı değildir. Eksik saat dilimi tahmin edilmez. Kimlik/alan eşliği sağlanmayan kaynakların çapraz ilişkilendirilmesi güvenilir sayılmaz.
- İçe aktarılan veri için ground truth bilinmiyorsa başarı metrikleri ve kaynak önerisi hesaplanmaz. Normal sentetik referans modelinin dış veri üzerindeki karar eşiği ve genellemesi doğrulanmamıştır. Alarm üretilmesi bu sınırı kaldırmaz.
- AIT kaydının sürümü, lisansı ve dosya metadata'sı kontrol edildi; **gerçek arşiv indirilip denenmedi**. Adaptör dar, fixture ile sınanmış audit/RFC3339 SSH/BIND kapsamındadır. Klasik yıl/saat dilimi eksik satırlar ve `.gz` alt dosyaları desteklenmez. Tam satır ve lisans ayrıntıları [AIT.md](AIT.md) içindedir.

## Analitik ve ölçüm

- Pencereler sabit, çakışmayan beş dakikalık dilimlerdir. Sınırı geçen yavaş veya dağınık örüntüler parçalanabilir. Kaynak/host/kullanıcı ayrımı bilinmeyen kimliklerin aynı grupta toplanmasını etkileyebilir.
- Isolation Forest yalnız normal eğitimde öğrenir; %95 eşik doğrulama skorlarından gelir. Mevcut doğrulama bölümü saldırılı örnekleri de içerir. Yüzdelik eşik, belirli bir üretim yanlış alarm oranını garanti etmez.
- Kurallar ve IF birleşimi esas sonuçtur; alarm delilleri sınırlı örnek listeleridir. Her alarm bütün pencereyi veya bütün saldırı olaylarını göstermez. Delil seçimi adım yakalama hesabını etkileyebilir.
- Grafik sınırlı gözlenen host/oturum bağlarıdır. PID/IP eşliği tek başına nedensellik oluşturmaz; tam süreç ağacı, saldırı kökeni veya saldırgan atfı kurulmaz. Backend en fazla 120 delil olayı tutar; görsel ilk 36 düğümü çizer.
- FPR'nin paydası gözlenen **normal pencerelerdir**; normal olay işaretleme oranı ayrıdır. Kayıp sonrasında normal payda değişebilir. `attack_windows` olmadan görünmez saldırı pencerelerini eksiksiz dışlama güvencesi yoktur.
- Tespit gecikmesi yalnız yakalanan adımlara aittir. Alarm saati son bilinen olay/gözlenme zamanına dayanır; gerçek zamanlı işlem veya ağ gecikmesi ölçümü değildir. Gecikme ve alan kaybı dönüşümleri uygulanmamıştır.
- %100 kayıpta görünen delil kalmaz; gizlenen gerçek adımlar paydadan çıkarılmaz. Boş veya cevapsız paydaların `null` olması sıfır başarıyla karıştırılmamalıdır.
- Kaynak araması üç kaynak için sekiz altkümedir. Test sonucuyla seçim yapılmaz. Rastgele referans yalnız üç tohum kullanır; kapsamlı istatistiksel güç veya güven aralığı iddiası yoktur.
- Bütçe normalleştirilmiş UTF-8 olay baytlarıdır; özgün dosya, ZIP, PCAP, ağ veya işlem maliyeti değildir. Doğrulamada uygun politika, test hacmi değişirse aynı bayt bütçesini aşabilir. Gerçek test maliyeti ayrıca gösterilir.
- Optimizasyonun bağımsız testi kaynak altkümesini değerlendirir; deneydeki ek kayıt kaybını uygulamaz. Öneriyle yeni deney aynı kayıp ayarını taşıdığından sonuç farklı olabilir. [METHODOLOGY.md](METHODOLOGY.md) tanımları ayrıntılandırır.

## İşletim ve güvenlik

- Ürün tek kullanıcılı ve loopback içindir; hesap, TLS, uzaktan yetkilendirme ve OS izolasyonu yoktur. Yerel yetkili süreçler veri dosyalarını okuyabilir/değiştirebilir. Ham veriler şifrelenmez veya otomatik anonimleştirilmez.
- Bir worker kullanılır; en fazla on aktif iş alınır. İptal işbirliklidir; uzun model eğitimi anında durmayabilir. Sert süreç sonlandırması geçici çalışma artıkları bırakabilir; eski işler yeniden açılışta kesilmiş gösterilir.
- Kullanıcı model dosyası yükleyemez. Uygulamanın model artefaktları yalnız kendi eğitim akışından gelir; keyfî dosya güvenli biçimde yüklenebilir iddiası yoktur.
- Hacim üst sınırları performans kanıtı değildir. Süre uçtan uca deney süresidir; `process_peak_rss_bytes` önceki işleri de içeren süreç ömrü tepe belleğidir. Son ölçülmüş hacim ve donanım [doğrulama kaydındadır](VALIDATION.md).
- macOS temiz kurulum, HTTP demo/geçmiş koruma ve bağlı Chrome ana akış/dar ekran kontrolleri geçti; kanıt VALIDATION.md içindedir. Ayrı Playwright çalıştırıcısının Chromium açılışı macOS izniyle, HTML dosya önizlemesi tarayıcı URL politikasıyla engellendi. Bunlar geçti sayılmaz. Windows PowerShell ve Docker dosyaları hazırdır fakat runtime yolları doğrulanmadı.
- Arayüz zamanları UTC olarak açıkça etiketler; kullanıcıya saat dilimi seçici sunulmaz. Laboratuvar CLI/API kullanıcı/host/takvim ayarını destekler; hızlı UI üretimi varsayılan kurum profilini kullanır.
- Kaynak yolu, HTML, CSV, arşiv ve bağımlılık kontrolleri kapsama göre yapılır; kapsamlı sızma testi, kusursuz güvenlik veya üretim SLA'sı verilmez.

## Sürüm kabul durumu

Bu belgede listelenen işlevler tek başına kararlı sürüm onayı değildir. [25 maddelik kabul matrisi](ACCEPTANCE.md) ve [gerçek kontrol kaydı](VALIDATION.md), hangi kapının tamamlandığını ve hangisinin açık kaldığını birlikte gösterir. Çalıştırılmamış test, ölçüm veya paketleme yolu başarılı sayılmaz.
