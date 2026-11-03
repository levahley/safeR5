const {defineConfig}=require('./frontend/node_modules/@playwright/test');
module.exports=defineConfig({
  testDir:'./tests/e2e',workers:1,timeout:90000,
  use:{baseURL:'http://127.0.0.1:8766',viewport:{width:1440,height:1000},screenshot:'only-on-failure',trace:'retain-on-failure'},
  reporter:[['list'],['json',{outputFile:'artifacts/validation/e2e.json'}]],
  outputDir:'work/playwright-results',
  webServer:{command:'PYTHONPATH=backend/src .venv/bin/python -m safer5 --root work/e2e-data serve --port 8766',url:'http://127.0.0.1:8766/api/v1/health',reuseExistingServer:false,timeout:30000},
});
