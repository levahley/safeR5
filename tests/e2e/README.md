# safeR5 — Tarayıcı doğrulaması

Üç Playwright senaryosu gerçek API/production build kullanır. Yeni demo, DNS kesintisi, %60 bütçe/öneriyle ayrı deney, gözlenen delil, dört indirme; dar ekran/klavye; bağlantı hatası, %100 kayıp ve iptal kapsanır. Çalıştırıcı yerel 8766 portunda ayrı veri diziniyle servis açar. Ana 8765 uygulamasını değiştirmez.

macOS/Linux proje kökünde:

```sh
PLAYWRIGHT_BROWSERS_PATH="$PWD/work/playwright-browsers" frontend/node_modules/.bin/playwright install chromium
PLAYWRIGHT_BROWSERS_PATH="$PWD/work/playwright-browsers" frontend/node_modules/.bin/playwright test --config playwright.config.cjs
```

Bu oturumda browser indirmesi başarılıydı; Chromium başlatma macOS MachPort izniyle reddedildi. Üç senaryo test gövdesi başlamadan başarısız oldu; geçti diye sayılmaz. `artifacts/validation/e2e.json` gerçek sonuçtur. Aynı ürün akışları bağlı Chrome/CUA ile ayrıca yürütüldü; `artifacts/validation/browser-qa.json` ve `artifacts/qa/` gerçek kanıtları içerir.

Grafik düğümünün fare/Enter/boşlukla delil açması ayrıca arayüz davranış testleri ve gerçek bağlı Chrome'da Enter ile sınandı. HTML dosyası önizlemesi `file:` URL politikasıyla engellendi; dosyalar indirilip içerikleri kontrol edildi, görsel print/PDF geçişi iddia edilmez.
