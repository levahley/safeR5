# safeR5 — Kararlar

- 2026-10-17: Kullanıcının sağladığı ayrıntılı spesifikasyon tasarım brief'i ve uygulama yetkisidir; rutin tasarım kararlarında yeniden onay istenmez.
- Proje outputs/safeR5 içinde; üst dizinin git kökü kullanıcının ev dizini olduğundan o depoya dosya eklenmez. Ayrı proje deposu kullanılır.
- Python 3.12; FastAPI/Pydantic, DuckDB/Parquet, SQLite, scikit-learn. React/TypeScript/Vite. Çözümlenen bağımlılıklar kilitlenir.
- Ground truth yalnızca değerlendirme/optimizasyon kalibrasyon katmanına girer. Her veri bölmesi ayrı kurumsal benzetim ve seed'dir; test eşiği ayarlamaz.
- Temel maliyet birimi doğrulama döneminde normalize edilmiş UTF-8 olay byte sayısıdır. Testte gerçekleşen byte ayrıca raporlanır.
- Tek kalıcı işçi; polling; tamamlanmış deney dizini atomik olarak yayımlanır. İptal/kesinti başarı sayılmaz.
- Arayüz: lacivert #0a111c, grafit #121e2b, turkuaz #44dfc6, açık metin #e6eef4, ikincil #91a6b9, uyarı #efb76b. Sistem sans ve mono; dış font isteği yok. Sol gezinme, deney günlüğü ve delil ilişkisi odağı; gereksiz dekorasyon yok.
- Kaynak grafiği gözlenen oturum/süreç bağlarını gösterir; zaman yakınlığı nedensellik sayılmaz. Tablo alternatifi zorunlu.
- İnceleme sonrası: FPR normal kaynak/host/kullanıcı/300sn pencereleriyle ölçülür. Sınırlı delil-olay işaretleme oranı ayrı alandır; bu oran FPR kısıtı olarak kullanılmaz.
- Kural delili kurala özgü yeterli tanıklardan gelir. Auth tanığı en erken beş başarısızlık ve en geç başarıyla sırasız girdide de korunur; sonraki olaylar geçerli örüntüyü silemez.
- İçe aktarma ve ham delil okuma aynı fiziksel CR/LF satır tanımını kullanır. Unicode U+2028 gibi karakterler yeni olay satırı oluşturmaz.
- Native Chrome ile kullanıcı akışı ve 390px görünüm doğrulandı. Ayrı Chromium çalıştırıcısı macOS MachPort izniyle engellendi; başarısız çalıştırma başarılı sayılmaz. Dosya URL'si politikası HTML görsel önizlemesini de engelledi; dört dosya indirimi ve içerik kontrolleri ayrı doğrulandı.
- Serena dil sunucusu başlatılamadığı için proje dosyaları normal dosya araçlarıyla düzenlendi. macOS çalışma alanında gizli işaretlenen .pth dosyaları Python tarafından atlandığından başlatma/test komutları açık PYTHONPATH kullanır.
