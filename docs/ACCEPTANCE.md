# safeR5 — Kabul ve kanıt matrisi

Son kontrol: 2026-10-17. Sayı, süre ve kaynak özetlerinin tek kaydı [VALIDATION.md](VALIDATION.md); [SOURCE_MANIFEST.json](../SOURCE_MANIFEST.json) dosya sürümlerini gösterir. Yerel 0.1 uygulama teslim edilmiştir; açık ortam kapıları tamamlanmış gibi işaretlenmez.

| # | Kabul koşulu | Kanıt | Durum |
| --- | --- | --- | --- |
| 1 | safeR5 adı tutarlı | README, arayüz, raporlar | Geçti: kaynak/görsel kontrol |
| 2 | Temiz yerel kurulum | scripts/verify_clean_install.py | Geçti: macOS temiz venv/npm + gerçek demo/geçmiş |
| 3 | Dış hesap/ücretli API gerektirmeyen demo | lab.py, LAB.md | Geçti: yerel akış; çalışma sırasında dış servis yok |
| 4 | auth/audit/dns | test_lab_storage.py | Geçti |
| 5 | Üç aile ve normal bakım varyantları | lab.py, test_boundaries.py | Geçti; kurum/takvim CLI ayarı da sınandı |
| 6 | Truth ayrımı | test_analysis.py | Geçti: cevap kaldırma/değiştirme tespiti değiştirmiyor |
| 7 | Kurallar ve eğitilmiş IF | detection.py, model manifestleri | Geçti; yöntemler ayrıca raporlanıyor |
| 8 | Dondurulmuş tam/kayıplı karşılaştırma | test_analysis.py, experiments.py | Geçti |
| 9 | Üç kayıp, değişmez ham veri | test_analysis.py | Geçti: %0/%100, kaynak, zaman ve seed |
| 10 | Delil ve etkileşimli grafik | test_api_jobs.py, gerçek Chrome | Geçti: fare/Enter/boşluk; fiziksel satır/SHA256 |
| 11 | Maliyet ve sekiz altküme | optimization.py, test_cli_research.py | Geçti: bütçe/FPR ve referanslar |
| 12 | Bağımsız kaynak-politikası testi | test_cli_research.py | Geçti: test cevabı seçimi değiştirmiyor |
| 13 | Görünürlük/tespit/FPR/maliyet ayrımı | METHODOLOGY.md, UI/metric testleri | Geçti: normal pencere FPR ayrı olay oranı |
| 14 | Gerçek artefakttan UI | API response modelleri, gerçek Chrome | Geçti; sözleşme güncelliği otomatik sınanıyor |
| 15 | Hata, iptal, yeniden açılış | test_api_jobs.py, clean-install, Chrome | Geçti: iptal/kesinti/kalıcılık |
| 16 | Rapor ve izlenebilirlik | Dört gerçek indirme + dosya parse kontrolleri | İndirme/içerik geçti; HTML görsel print/PDF önizlemesi araç politikasıyla açık |
| 17 | Gerçek hacim ölçümü | artifacts/validation/performance.json | Geçti; kaynak/hacim/hız/bellek/donanım kayıtlı |
| 18 | Import/yol/log güvenliği | AIT, sınır, Unicode ve escape testleri; audit | Geçti; kapsamlı sızma testi iddiası yok |
| 19 | Belgeler uygulamayla uyumlu | README, LAB, METHODOLOGY, LIMITATIONS | Son davranış ve sınırlarla güncellendi |
| 20 | STATE/VALIDATION sürümü | SOURCE_MANIFEST.json, summary.json | Güncel uygulama hashleri ve kanıt bağlantıları mevcut |
| 21 | Backend/frontend/build/E2E | VALIDATION.md, browser-qa.json, e2e.json | Kod kapıları ve bağlı Chrome geçti; ayrı Playwright launcher ortamda engelli |
| 22 | Ana akış gerçek ve kullanılabilir | DEMO.md, Chrome/390px/klavye | Geçti; sunum adımları denendi, süre garantisi yok |
| 23 | AIT durumu dürüst | AIT.md, test_ait.py | Fixture ve metadata doğrulanmış; gerçek arşiv doğrulanmadı |
| 24 | OS/paketleme yolları açık | VALIDATION.md | macOS geçti; Windows/Docker runtime doğrulanmadı, Compose şeması geçti |
| 25 | Olumsuz bağımsız sonuçlar saklanıyor | repetitions.json, gerçek DNS/%100 kayıp deneyleri | Geçti; başarı yüzdesi zorlanmadı |

Özet test sayıları burada çoğaltılmaz. Gerçek AIT/Windows/Docker ve ayrı Chromium/HTML print kontrolü doğrulanana kadar sınır korunur. Genel veya tüm platformlarda kararlı sürüm güvencesi verilmez.
