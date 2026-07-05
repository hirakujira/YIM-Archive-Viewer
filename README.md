# Yahoo Messenger 對話紀錄瀏覽器

純前端工具，在瀏覽器中解碼並瀏覽 Yahoo Messenger 封存（`.dat`）。全程本機處理，不上傳資料到雲端。

## 快速使用

直接開啟：<https://hirakujira.github.io/YIM-Archive-Viewer/>

## 使用

1. 用瀏覽器開啟 `index.html`（建議 Chrome / Edge），或直接使用上方網址。
2. 點「選取 Profiles 資料夾」選擇 `Profiles` 目錄。
3. 於左側選擇帳號、分類、對象瀏覽，支援日期篩選與關鍵字搜尋。

支援 `Messages`、`Conferences`、`會客室` 三類封存，並自動處理 UTF-8／Big5 混用的舊紀錄。

可將目前對話或篩選結果匯出為 HTML、JSON 或 CSV。

## 檔案

- `index.html` / `styles.css`：介面
- `parser.js`：`.dat` 解碼與解析（相容瀏覽器與 Node.js）
- `app.js`：選檔、索引、篩選、渲染

## 隱私

對話僅在瀏覽器本機處理，不上傳您的任何資料到雲端。
