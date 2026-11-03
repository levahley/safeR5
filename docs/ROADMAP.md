# safeR5 — İş paketleri

Yerel araştırma laboratuvarının teslim ve doğrulama aşamaları.

| Paket | Fazlar | Sonuç / kapı | Durum |
| --- | --- | --- | --- |
| A | 0–3 | Şema, seed'li ve yapılandırılabilir lab, truth ayrımı, idempotent Parquet/DuckDB | Uygulandı ve doğrulandı |
| B | 4–8 | Kurallar, eğitilmiş IF, delil, kayıp, metrikler; leakage ve sınır testleri | Uygulandı; inceleme regresyonları geçti |
| C | 9–10 | 8 altküme, bağımsız test, kalıcı işler, iptal, raporlar; API entegrasyonu | Uygulandı; dört gerçek indirme doğrulandı |
| D | 1,4,6,9,12 | Türkçe arayüz, gerçek API, kullanıcı akışları; tip/build/görsel kontrol | Geçti: bağlı Chrome; ayrı Playwright launcher engeli kayıtlı |
| E | 11 | Güvenli yerel AIT import, etiket/satır eşlemesi; gerçek veri durum kaydı | Fixture adaptörü geçti; gerçek arşiv doğrulanmadı |
| F | 12–13 | Güvenlik, 100k ölçümü, temiz kurulum, belgeler ve sunum | macOS yerel teslim hazır; HTML print/Windows/Docker runtime kapıları açık |

Son kanıt ve kaynak özeti yalnız VALIDATION.md / SOURCE_MANIFEST.json içindedir. Açık ortam kapıları başarı diye işaretlenmez.
