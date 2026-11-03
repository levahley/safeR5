# safeR5 — Ölçüm yöntemi

## Araştırma sorusu ve sınır

safeR5, kayıt görünürlüğü azaldığında aynı algılayıcının sonucunun nasıl değiştiğini ve sınırlı bir veri bütçesinde hangi kaynak altkümesinin daha yararlı olduğunu ölçer. Sentetik laboratuvarla elde edilen sonuç, üretim ağı başarısı veya bütün saldırı türleri için genelleme değildir. Olumsuz sonuçlar ve normal bakımda oluşan yanlış alarmlar araştırma çıktısının parçasıdır.

## Bölme, eğitim ve dondurma

Laboratuvar `train`, `validation`, `test` bölümlerini farklı tarihler ve rastgele dizilerle üretir. Eğitimde saldırı adımı yoktur; normal bakım ve yoğun DNS gibi zor normal örnekler vardır. Doğrulama/test aynı üç senaryo ailesini farklı yerleşimlerle kullanır. Bu, ayrı veriyle testtir; daha önce görülmemiş saldırı ailesi testi değildir.

Her kaynak için olaylar `(source_type, host_id, user_id, floor(event_time / 300 saniye))` anahtarıyla sabit, çakışmayan beş dakikalık pencerelerde toplanır. Özellikler olay hacmi, başarısız giriş oranı, ayrıcalıklı işlem oranı, arşiv/uzak çalıştırma oranı, ortalama DNS adı uzunluğu, ortalama çıktı baytı ve farklı hedef sayısıdır. Host, kullanıcı, IP, dosya adı ve saldırı etiketi doğrudan model özelliği değildir; host/kullanıcı yalnız pencere gruplamasında kullanılır.

Medyan eksik değer tamamlama, standartlaştırma ve **64 ağaçlı Isolation Forest** yalnız normal eğitim pencerelerinde öğrenilir. Model için en az sekiz eğitim penceresi gerekir. Anomali skoru `-score_samples` değeridir; saldırı olasılığı değildir. Kaynak eşiği, ayrı doğrulama pencerelerinin skorlarının **%95 yüzdeliğidir**. Mevcut doğrulama bölümü normal ve saldırılı örnekleri birlikte içerir; eşik için etiketler okunmaz. Doğrulama penceresi yoksa eğitim skoru yedek olarak kullanılır; bu durum ayrı doğrulamanın güvencesini sağlamaz.

Model, ön işleme, eşik ve kural sürümleri tam/kayıplı testten önce dondurulur. Test verisiyle yeniden öğrenme veya kayba göre eşik ayarı yapılmaz. Yeni bir deney modeli deterministik tohumla yeniden kurar; aynı deneyin iki kolu aynı bellekteki model paketini kullanır. Model manifesti eğitim/doğrulama hash'lerini, sürümleri, eşikleri ve model hash'ini saklar.

## Kurallar ve deliller

Kurallar ve Isolation Forest alarmları birlikte değerlendirilir; bunların birleşimi nihai alarm kümesidir. Kurallı yöntem karşılaştırma tabanıdır, model skoru onun yerine konmaz. Beş dakika içindeki mevcut kurallar:

- Aynı host/kullanıcı için en az beş başarısız girişin **ardından** başarılı giriş; delil listesi ilgili başarısızlıkları ve başarıyı içerir.
- Audit tarafında en az iki ayrıcalıklı işlem, iki uzak çalıştırma veya üç arşivleme; ilgili kayıtlar delil olur. Normal bakım da tetikleyebilir.
- En az sekiz uzun DNS adı; bu tek başına sızdırma kanıtı değildir.
- Aynı kullanıcı ve zaman penceresinde en az üç hostta kimlik doğrulama hareketi; her host kendi gözlenen delilleriyle alarm üretir.

Alarm delilleri ve pencere örnekleri sınırlıdır; her alarmda en fazla 20 olay kimliği tutulur. Pencerelerin toplam sayım özellikleri bütün olaylardan hesaplanır. Bu sınırlı delil seçimi, görünür bir saldırı adımının hangi alarma bağlanabildiğini etkileyebilir.

Olay grupları host/kullanıcı/zaman ilişkisine göre düzenlenir. Grafik, gözlenen host ve hostla sınırlandırılmış oturum bağlarını gösterir; aynı IP veya PID'den nedensellik çıkarmaz. En fazla 120 delil olayı grafiğe alınır; görsel ilk 36 düğümü çizer ve tablo grafik ilişkilerini sayfalar. Bunlar tam süreç kökeni grafiği değildir.

## Kontrollü kayıt kaybı

Kayıp fonksiyonu ground truth okumaz; özgün veriyi değiştirmez. Rastgele kayıp, tohum ve olay kimliğinin hash'ine göre deterministiktir; oran bir olasılık eşiğidir, her sonlu örnekte tam aynı sayıda olay kaybolması beklenmez. %0 ve %100 sınırları açıktır. Kaynak kesintisi seçilen kaynağı kaldırır; isteğe bağlı başlangıç/bitiş verilirse yalnız o aralıktadır. Zaman aralığı kaybı bütün kaynaklarda `[başlangıç, bitiş)` aralığını kaldırır.

Önce seçilmiş kaynakların tam test görünümü, ardından aynı görünümün kayıplı kolu analiz edilir. Ground truth değişmez; gizlenen gerçek adımlar değerlendirme paydasında kalır. Gecikme ekleme ve alan silme dönüşümleri uygulanmamıştır.

Kaynak görünürlüğündeki `observed/missing` durumu bu görünümde kayıt bulunup bulunmadığını söyler; gerçek bir DNS veya kimlik doğrulama servisinin sağlıklı/kapalı olduğunu ölçmez.

## Metriklerin anlamı

| Metrik | Tanım |
| --- | --- |
| Saldırı adımı yakalama | Gözlenen deliliyle en az bir alarma bağlanan gerçek adım / **bütün** gerçek adımlar |
| Delil kapsaması | En az bir olayı hâlâ görünen gerçek adım / bütün gerçek adımlar; tespit iddiası içermez |
| Yanlış pozitif oranı | En az bir alarm deliliyle işaretlenen **normal kaynak/host/kullanıcı/300 sn penceresi** / gözlenen normal pencere sayısı |
| `evidence_flag_rate` | Alarm delili olan gözlenen normal olay / gözlenen normal olay; pencere FPR'sinden ayrıdır |
| `false_positives` | Alarm deliline giren farklı gözlenen normal olay sayısı; alarm veya pencere sayısı değildir |
| `normal_events` | Ground truth'ta normal olan ve ilgili görünümde hâlâ bulunan olay sayısı |
| Ortalama tespit gecikmesi | Yakalanan adımlarda ilk eşleşen alarm zamanı eksi adım başlangıcı; negatif sonuç sıfıra kırpılır |

Bir pencere ancak gözlenen olaylarının tamamı normal ise normal adaydır. Ground truth `attack_windows` sağlıyorsa bu listede bulunan pencereler, saldırı kayıtları kayıpla görünmez olsa bile normal paydaya alınmaz. Aksi halde yalnız gözlenen içerikle karar verilebilmesinin sınırı kalır. Gizlenen normal olaylar/pencereler normal görünüm paydasını büyütmez. Kayıplı/tam FPR farkı bu değişen gözlem paydasıyla yorumlanmalıdır.

Bir saldırı adımı, kendi olay kimliklerinden gözlenen en az birinin alarm delilinde bulunması, kullanıcı eşliğinin tutması ve alarmın adım başlangıcından önce olmamasıyla yakalanmış sayılır. Sunucular arası ilerleme için host eşliği zorunlu değildir. Bu ölçüt saldırının bütün olaylarının çözümlendiği anlamına gelmez.

Alarm zamanı, penceredeki bilinen `event_time` ve varsa `observed_time` değerlerinin en geç olanıdır. Bu, pencere delilinin hazır olduğu zamana ilişkin ihtiyatlı **toplu analiz saatidir**; canlı dedektör gecikmesi veya ağ iletim süresi ölçümü değildir. Yalnız yakalanan adımların gecikmesi ortalanır; yakalanmayanların gecikmesi sonsuz gibi raporlanmaz. Hiç yakalanan adım yoksa gecikme `null` olur.

Ground truth yoksa durum `no_ground_truth`, başarı oranları `null` olur. Olay yoksa görünüm `empty` olabilir; gerçek adımlar biliniyorsa yakalama sıfır kalır. Paydası olmayan oranlar `null` olur; arayüzdeki boş işaret sıfır başarıyla karıştırılmamalıdır.

## Kaynak seçimi ve bağımsız kontrol

Üç kaynağın boş küme dahil **sekiz altkümesi** doğrulama üzerinde açıkça denenir. Maliyet, canonical normalleştirilmiş Event JSON'unun UTF-8 baytları ve her kayıt için satır sonudur. ZIP boyutu, PCAP, özgün ham log diski, ağ faturası veya CPU maliyeti değildir. Bütçe doğrulamadaki bütün kaynakların bu maliyetinin seçilen oranıdır.

Uygun altküme doğrulama bütçesini ve normal pencere FPR sınırını aşmaz. Önce yakalama en yüksek, sonra FPR ve maliyet daha düşük olan seçilir. Metrik paydası yoksa uygunluk hesabı FPR'yi sıfır gibi işler; özellikle boş altküme istatistiksel güvence değildir. Boş küme seçilebilir ve arayüz bunu açıkça gösterir.

Seçilen kaynaklar ve model dondurulduktan sonra test etiketi yalnız değerlendirme için kullanılır. Karşılaştırmalar tüm kaynakları, en ucuz kaynaktan başlayarak bütçeye sığan politikayı, tam doğrulama aramasını ve üç tohumla rastgele uygun altküme seçimini içerir. Tam arama ile safeR5 önerisi burada aynı küçük aramanın sonucudur; bağımsız iki optimizasyon algoritması değildir.

Kaynak seçimi bölümünün `independent_test` sonucu **yalnız kaynak altkümesinin** bağımsız testidir; deneyin rastgele/kesinti/zaman kaybı ayrıca uygulanmaz. **Önerilen kaynaklarla yeni deney** aynı kayıp ayarlarını da taşıdığı için yeni deneyin kayıplı sonucu bu kaynak-politikası testinden farklı olabilir. Tahmini maliyet doğrulama üzerindedir; gerçek test maliyeti ayrı raporlanır ve hacim değişirse doğrulama bütçesini aşabilir. Teste bakarak yeni kaynak seçilmez.

## İçe aktarılmış veriler ve tekrar üretim

JSONL importunda etiketli eğitim/doğrulama/test ayrımı olmadığı için kaynak optimizasyonu yapılmaz. Uygulama normal sentetik referans verisinde model kurup import olaylarını puanlar. Alan uyumu, testbed ile gerçek ortam farkı ve karar eşiğinin geçerliliği doğrulanmadığından alarmı doğrulanmış saldırı tespiti gibi okumayın. AIT truth dosyası da otomatik olarak yönetilen deneyin değerlendirme cevabına dönüşmez; [ayrı adaptör sınırlarına](AIT.md) bakın.

Sonuç; girdi, kod, yapılandırma, model ve kayıp hash'leriyle birlikte saklanır. Seed tekrarları, hız/bellek bilgileri ve doğrulanan kaynak sürümü [VALIDATION.md](VALIDATION.md) üzerinden izlenir. Çalışma süresi toplam deney süresidir; süreç tepe belleği önceki işlerin etkisini içeren süreç ömrü üst değeridir. Tek ölçüm, güven aralığı veya üretim kapasitesi garantisi değildir.
