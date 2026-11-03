# safeR5 — Beş dakikalık sunum

Bu akış gerçek arayüz kontrollerine göre hazırlanmıştır. Sunum provası ve tarayıcı kanıtı [VALIDATION.md](VALIDATION.md) üzerinden izlenir; bu metin tek başına provanın tamamlandığını iddia etmez. Sayıları ezberlemeyin veya başarı yüzdesi vaat etmeyin; ekranda o deneyin ürettiği sonucu okuyun.

2026-10-17: Demo, DNS kesintisi, öneriyle ayrı deney, ham delil, yenileme/iptal ve dört indirme gerçek bağlı Chrome'da denendi. Akışın her kullanıcıda tam beş dakika süreceği iddia edilmez. HTML dosyası görsel önizlemesi/baskısı araç politikası nedeniyle doğrulanamadı; bu adımı sunumdan önce kendi tarayıcınızda kontrol edin.

Önce `sh scripts/start.sh` ile uygulamayı açın ve [yerel adrese](http://127.0.0.1:8765) gidin. Kurulum tamamlanmış olmalıdır. İş süreleri makineye bağlıdır; uzun işte kalan anlatıma geçilebilir.

| Süre | Ekranda yapın | Anlatın / kontrol edin |
| --- | --- | --- |
| 0:00–0:45 | **Genel bakış → Demo deneyi başlat** | Üç kaynaktan sentetik veri, normal eğitim ve ayrı test oluşur. İlk demo kayıpsızdır; arayüz sabit başarı sayısı göstermez. İş durumunu ve tamamlanınca gerçek sonucu açın. |
| 0:45–1:45 | **Karşılaştırma → Alarmları ve kanıtları aç**; bir olayın kanıt bağlantısını açın | Adım yakalama ve delil kapsamasını ayırın. Ham satır, dosya kimliği, orijinal satır ve SHA256'yı gösterin. **Alarmlar** sekmesinde bir kuralla IF skorunun anlamını ayırın; normal bakım da alarm verebilir. |
| 1:45–2:45 | **Deney tasarımı**; aynı veri kümesini seçin, kayıp modelini **Kaynak kesintisi**, kaynağı **DNS** yapın; **Deneyi çalıştır** | Yeni deney, aynı verinin tam ve kayıplı kolunu aynı dondurulmuş modelle ölçer. DNS olay sayısını kontrol edin. Gizlenen gerçek adımlar paydaya dahildir; daha az alarm otomatik iyileşme değildir. |
| 2:45–4:00 | **Kaynak optimizasyonu**; adayları ve bağımsız testi gösterin, uygun öneri varsa **Önerilen kaynaklarla yeni deney** | Seçim sekiz altkümenin doğrulama sonucudur. Normalleştirilmiş bayt bütçesi ve gerçek test maliyeti farklıdır. Bağımsız kaynak-politikası testi ek DNS kaybını uygulamaz; yeni deney önceki kayıp ayarını da taşır. Öneri boşsa bunu açıklayın, başarı gibi göstermeyin. |
| 4:00–5:00 | **Raporlar ve ayarlar → HTML indir**; raporu açın | Yapılandırma, metrik, kaynak/model hash'leri ve delil bağlantılarını gösterin. Etiketsiz dış veride başarı ölçülmediğini, AIT'nin gerçek büyük dosyada doğrulanmadığını ve yöntemin üretim güvencesi olmadığını belirtin. |

Deney geçişlerinde aynı veri kümesi kimliğini ve kayıp ayarlarını kontrol edin. Kaynak önerisiyle oluşturulan ayrı deneyi geçmişte de gösterin; önceki deneyin üzerine yazılmaz. Sunum sonunda sayfa yenilemeyle seçili sonuç/iş durumunun geri geldiğini gösterebilirsiniz.

Beklenmeyen durumda: boş görünümde kaynak ve kayıp ayarını açıklayın; `Ölçülmedi` değerini sıfır diye okumayın. Başarısız/kesilmiş işi başarılıymış gibi sunmayın. İşin **İşi iptal et** düğmesiyle iptal edilebildiğini belirtin; yeniden deneme ayrı bir iştir. Backend kapalıysa hata ve tekrar deneme alanı üzerinden yerel servisi kontrol edin.
