# safeR5 — Yerel tehdit modeli

## Güven kapsamı

safeR5 aynı bilgisayardaki tek kullanıcının araştırma aracıdır. Sunucu `127.0.0.1` üzerinde çalışır; üyelik ve kullanıcı yetkilendirmesi yoktur. Çok kullanıcılı veya internete açık kullanım için hazırlanmış değildir. Container yapılandırmasında süreç container içinde bütün arayüzleri dinler; host portu yalnız `127.0.0.1:8765` adresine bağlanır. Docker yolu ayrıca çalıştırılmadan güvenlik veya uyumluluk garantisi verilmez.

Korunacak varlıklar: kullanıcının getirdiği ham günlükler, saldırı cevapları, kaynak/olay kimlikleri, sonuçların bilimsel bütünlüğü, yerel dosyalar ve bilgisayarın bellek/disk kaynaklarıdır. Import edilen olay metni ve arşivler güvenilmez veri sayılır. Yerel uygulama kodu ve kurulum bağımlılıkları güven sınırının içindedir.

## Sınırlar ve mevcut önlemler

| Giriş / tehdit | Uygulamadaki önlem | Kalan sınır |
| --- | --- | --- |
| Dış sitenin yerel API'yi çağırması | Loopback bağlama, Host izin listesi, açık yerel Origin kontrolü, `Sec-Fetch-Site: cross-site` reddi | Kimlik doğrulama yoktur; aynı makinedeki süreç veya izinli yerel sayfa ayrıca güvenilirdir |
| Keyfî dosya/SQL yolu | Yönetilen opak kimlikler, parametreli SQLite/DuckDB sorguları, sabit alan ve sayfalama sınırları | Veri dizinine doğrudan yazabilen yerel kullanıcı kapsam dışındadır |
| Büyük veya akışla gönderilen istek | Hem Content-Length hem gerçek gövde okumasında 20.000.000 bayt sınırı | İzin verilen sınırdaki işler yine CPU ve disk tüketir; tek worker ve en fazla on aktif iş vardır |
| Bozuk Event satırı | Şema, saat dilimi/alan/satır sınırları, karantina, hiç geçerli kayıt yoksa reddetme | Şemaya uygun veri olayın gerçek olduğunu kanıtlamaz |
| ZIP yol kaçışı / symlink / açılma bombası | AIT ön kontrolü, yönetilen hedef adları, merkez dizin ve açılmış bayt/oran/satır/olay sınırları | Kullanıcının artırdığı toplam boyut sınırı disk ihtiyacını da artırır |
| Ham logdan komut veya kod çalıştırma | Olay metni shell'e verilmez; AIT kodu, kuralları, scriptleri ve saldırgan kayıtları dedektör girdisinden dışlanır | Günlükler hassas metin içerebilir; içerik otomatik anonimleştirilmez |
| HTML/CSV enjeksiyonu | React metin gösterimi, HTML raporunda escape, CSV hücrelerinde formül başlangıcını etkisizleştirme; CSP ve nosniff başlıkları | Kullanıcının daha sonra raporu farklı bir araçta dönüştürmesi bu sınırın dışındadır |
| Etiketlerin tespiti ele vermesi | Event fazladan alanları reddeder; truth ayrı dosya/parametredir; dedektör truth tüketmez; testte cevap değiştirme kontrolü | İşletim sistemi düzeyinde süreç/dosya izolasyonu yoktur |
| İşin iptal/çökme sırasında başarılı görünmesi | Geçici çalışma dizini, atomik sonuç klasörü, kalıcı iş durumu, yeniden başlatmada interrupted işaretleme | İptal işbirliklidir; uzun kütüphane çağrısını ortasında kesmeyebilir. Sert çökme geçici artık bırakabilir |
| Kullanıcının kötü amaçlı model yüklemesi | Model yükleme API'si yok; uygulama kendi modelini üretip saklar | Yerel model/veri dizini dışarıdan değiştirilirse bütünlük güvencesi yoktur |

## Veri ve ağ davranışı

Hazır laboratuvar ağ saldırısı veya işletim sistemi değişikliği gerçekleştirmez; yalnız olay dosyaları üretir. Çalışma zamanı buluta veri göndermez ve dış model API'si kullanmaz. İlk paket kurulumu ve kullanıcının kendi başlattığı kaynak indirmeleri internet gerektirebilir. AIT adaptörü otomatik indirme yapmaz.

Veri dizini ve raporlar yerelde düz dosyalardır; uygulama düzeyinde disk şifreleme, yedekleme, çok kullanıcı erişim denetimi veya otomatik kişisel veri temizleme yoktur. Aynı kullanıcı yetkisindeki kötü amaçlı bir sürece karşı koruma iddiası yapılmaz. Kullanıcı raporları dışarı paylaşmadan önce ham delil, host, hesap ve adres alanlarını incelemelidir.

## Doğrulama ve kapsam dışı kalanlar

Kaynak sınırı, Origin, import, rapor gösterimi ve iş kurtarma testleri [backend testleriyle](../backend/tests/) izlenir. AIT için [ayrı güvenlik kontrolleri](AIT.md) vardır. Hangi testlerin gerçekten çalıştırıldığı, bağımlılık denetimi bulguları ve tarayıcı kontrolleri [VALIDATION.md](VALIDATION.md) içinde kayıtlıdır. Test bulunması kusursuz güvenlik veya kapsamlı sızma testi anlamına gelmez.

İnternete yayınlama, hesap/rol sistemi, TLS sonlandırma, uzaktan yönetim, üretim servislerine aktif müdahale, kötü amaçlı yazılım çalıştırma ve işletim sistemi seviyesinde kanıtlanmış izolasyon bu sürümün kapsamı dışındadır.
