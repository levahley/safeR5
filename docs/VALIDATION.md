# safeR5 — Doğrulama kaydı

Güncelleme: 2026-10-17T03:28:21.773561+03:00 (Europe/Istanbul). Bu sayfa önceki yerel kontrolleri özetler. Üretilen raporlar ve ayrıntılı deney artefaktları yerelde tutulur; bu depoya eklenmez.

17 Ekim doğrulamasında kullanılan uygulama kaynak özeti: `3dbd7d43a158320420b014b71d6fe123b0ed591556a4482f7690e941a063073c`. Depodaki dosya manifesti: [SOURCE_MANIFEST.json](../SOURCE_MANIFEST.json). Backend özeti: `87299a71d2dcd0ad0022a24082e0f25b4c77d3482c773ef86ec22837cec4a415`. Üretilmiş deneyler kendi kaynak/model/girdi/yapılandırma hash'lerini korur; önceki ölçüm sürümü güncel kodmuş gibi sunulmaz.

## Geçen kapılar

| Kontrol | Gerçek sonuç | Tekrar çalıştırma |
| --- | --- | --- |
| Backend | 57 geçti, 0 başarısız; Python 3.13.15 ile 9,62 sn. TestClient için bir Starlette/httpx kullanımdan kaldırma uyarısı | `cd backend` sonra `PYTHONPATH=src ../.venv/bin/python -m pytest -q` |
| Backend statik kontrol | Ruff geçti | `cd backend` sonra `../.venv/bin/python -m ruff check src tests` |
| Sözleşme | Pydantic yanıt doğrulaması + üretilmiş TypeScript güncellik testi geçti | `.venv/bin/python scripts/generate_contract.py --check` |
| Arayüz | 24 geçti; lint, tür kontrolü, production build geçti | `cd frontend` sonra `npm test && npm run lint && npm run typecheck && npm run build` |
| Temiz macOS kurulum | Boş sanal ortam + npm kurulumu, boşluk/Türkçe içeren kopya dizin, HTTP demo ve yeniden başlatma/geçmiş koruma geçti | `.venv/bin/python scripts/verify_clean_install.py` (yeni boş hedef gerekir) |
| Gerçek tarayıcı | Bağlı Chrome'da demo → DNS kesintisi → kaynak önerisiyle ayrı deney → ham delil → dört dosya indirimi; iptal, yenileme, %100 kayıp, klavye ve grafikten Enter ile delil geçti | `browser-qa.json`, [DEMO.md](DEMO.md) |
| Dar ekran | Yedi çalışma alanında 390×844 görünüm; belge genişliği her birinde 390 px, dış yatay taşma yok; geçici viewport geri alındı | `Ekran kanıtları` |
| Güvenlik girdileri | Yol/host/origin, chunked boyut sınırı, Unicode fiziksel satır, ham HTML/CSV, arşiv traversal/symlink/boyut, cevap ayrımı testleri geçti | `backend/tests/` |
| Bağımlılıklar | Python production kilidinde bilinen açık yok; npm taraması toplam 0 açık | `Python`, `npm` |
| Raporlar | JSON/CSV/Markdown/HTML gerçek tarayıcıyla indirildi; JSON/CSV parse edildi, HTML işaretleme/escape/print CSS kontrol edildi | `Örnek HTML` ve diğer raporlar aynı dizinde |
| Compose şeması | `docker compose config --quiet` geçti | Docker runtime sonucu aşağıda |

## Hacim ve tekrarlar

Gerçek üretilen/içe alınan kayıt: **300,000**; analiz edilen bağımsız test kaydı: **100,000**. Testin özellik çıkarma ve analiz aşaması 1,947 sn; üretim ve model eğitimi bu süreye dahil değildir. Süreç ömrü tepe RSS yaklaşık 1.00 GiB. Bu tek yerel ölçümdür; SLA veya tüm hacimler için hız iddiası değildir. Donanım, sorgu gecikmeleri, seed ve kaynak özeti `performance.json` içinde.

42/43/44 seed'leriyle kayıpsız, %50 rastgele kayıp ve DNS kesintisi için dokuz tam deney çalıştı. Her deneyde doğrulama seçimi ve bağımsız kaynak-politikası testi saklandı. Gerçek değerler, ortalama ve seed dağılımı `repetitions.json` içinde; gerçek bağımsız saldırı kampanyaları veya güven aralığı değildir. Çalıştırma: `.venv/bin/python scripts/research_check.py`.

## İnceleme ve düzeltmeler

Bağımsız inceleme ve regresyonlar: fiziksel satır eşleme/saklı delil sızıntısı; kurala ilgisiz delil eklenmesi; auth olay sırası ve sonradan gelen olayların eski tanığı silmesi; gözlenme saati; 100 kayıttan eski aktif işlerin kurtarılması; özel port origin denetimi; normal pencere FPR; yeniden açılışta tarih sıralaması. Kurum/takvim ayarları ve 256 host üst sınırında geçerli özel IP üretimi de sınandı. Son tam kapı yukarıdaki kaynak özetinde geçti.

## Engellenen / doğrulanmayan yollar

- **Playwright komut çalıştırıcısı:** Üç test başlatılmak istendi; macOS Chromium `MachPortRendezvous Permission denied` nedeniyle tarayıcı açılmadan durdu. Bu üç testi geçti diye saymıyoruz. Aynı ana akışlar bağlı Chrome otomasyonu ile ayrıca doğrulandı. `Çalıştırıcı raporu`, [yeniden çalıştırma](../tests/e2e/README.md).
- **HTML görsel dosya önizlemesi:** Dört rapor indirildi. `file:` URL'sini açma tarayıcı güvenlik politikası tarafından reddedildi; alternatif yolla aşılmadı. HTML dosyasının görsel baskı/PDF yerleşimi bu ortamda doğrulanmış sayılmaz.
- **Windows:** PowerShell betikleri hazır; Windows ortamı yok, çalıştırılmadı. resource modülü yokluğunda bellek ölçümü null olur.
- **Docker:** Compose yapılandırması geçerli; daemon'a bağlanılamadı. İmaj build/çalıştırma yapılmadı.
- **AIT:** Kayıt metadata/lisansı ve dar adaptör fixture'ları doğrulandı; gerçek büyük arşiv indirilmedi/çalıştırılmadı. [AIT.md](AIT.md).

Yerel çalışma komutu gerçekten denendi: proje kökünde `sh scripts/start.sh`, adres `http://127.0.0.1:8765`. Ürün localhost dışında yayımlanmadı.

Son paketlemede yalnız dosya sonundaki boş satırlar normalize edildi. Ölçümün özgün kaynak özetleri değiştirilmedi; byte farkları ve yeniden üretilebilir önceki manifest `format-normalization.json` içindedir. Bu biçim adımı semantiği değiştirmedi. Sonrasında rastgele kaybın %0 ve %100 uçları açık koşullarla sabitlendi ve bir regresyon eklendi; `son değişiklik kaydı`. Ölçülen kayıpsız/%50/kaynak kesintisi profilleri etkilenmez. Backend tam kapısı son dosyalarda yeniden çalıştırıldı.

Yerel macOS dosya yer tutucularının okuma zaman aşımı nedeniyle 11 dosya, önceki Git nesnesinden birebir geri yüklendi; manifest kapsamında olanların SHA256 özeti de doğrulandı. Kilitli bağımlılıklar yeni Python 3.13 ortamına kopya olarak kuruldu; eski ortam korundu. Son 57 test ve Ruff bu ortamda geçti. `Kurtarma kaydı`.

## Başlatma betiği · 20 Ekim 2026

Python açılış hatası, gerçek port doluluğu ve boş portta başarılı başlangıç için üç regresyon testi geçti. Bu kontrol, başlatma betiğinin bir Python hatasını port çakışması olarak göstermediğini doğrular.
