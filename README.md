# 猜猜看信箱（Firebase 版）

這是「猜猜看信箱」的獨立部署版本，資料改存在你自己的 Firebase 帳號裡，
不再依賴 Claude.ai 的共享儲存，可以放心部署到 GitHub Pages 長期使用。

設定教學請見對話內容，這裡只列出檔案結構提要：

```
src/
  firebaseConfig.js   <- 你的 Firebase 專案金鑰要貼在這裡
  GuessGame.jsx        <- 主程式
  main.jsx / index.css <- 進入點
firestore.rules        <- Firestore 安全規則（複製貼到 Firebase 後台）
```

## 開發時本機預覽

```bash
npm install
npm run dev
```

## 部署到 GitHub Pages

```bash
npm install
npm run build
npm run deploy
```

`npm run deploy` 會自動把 `dist/` 資料夾推到 `gh-pages` 分支，
之後到 GitHub 儲存庫設定 -> Pages，選擇 `gh-pages` 分支即可上線。
