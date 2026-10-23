# Tool002 · 附近泊位

香港附近停車場空位小工具（prototype）。資料來自 [data.gov.hk 停車場空位 API](https://data.gov.hk/tc-data/dataset/hk-td-tis_21-real-time-parking-vacancy-data)。

## 功能

- 瀏覽器定位 → 列出最近參與車場（約 580 個）
- 顯示：名稱、距離、地址、私家車／電單車空位、開放狀態、限高
- 手動刷新；約每 45 秒自動刷新空位
- 拒絕定位時：可用地區篩選或搜尋名稱
- UI：淺色軟、厚描邊立體掣（同 Tool001 感覺）

## 點樣開

唔使後端。API 已設 `Access-Control-Allow-Origin: *`，瀏覽器可直接打。

```bash
cd /workspace/tool002-parking
python3 -m http.server 8765
```

然後用瀏覽器開：`http://127.0.0.1:8765/`  
（定位多數要 HTTPS 或 localhost；用 `127.0.0.1`／`localhost` 就得。）

或者直接用檔案系統開 `index.html`（部分瀏覽器可能限制 geolocation／fetch，建議用上面嘅 local server）。

## API

- Info：`GET https://api.data.gov.hk/v1/carpark-info-vacancy?data=info&lang=zh_TW`
- Vacancy：`GET https://api.data.gov.hk/v1/carpark-info-vacancy?data=vacancy&vehicleTypes=privateCar,motorCycle&lang=zh_TW`

## 限制

- 唔係全港所有車場都有開放數據
- 空位數可能延遲；`-1`／無資料會顯示「?」
- `vacancy_type`：A＝空位數、B＝有／無、C＝百分比
- 未部署 GitHub Pages（本地 prototype）

## Creator

Paper P.
