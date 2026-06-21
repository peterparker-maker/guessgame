import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 重要：GitHub Pages 是部署在「子路徑」底下（例如 https://你的帳號.github.io/儲存庫名稱/）
// 所以這裡用相對路徑 "./"，避免部署後資源讀不到（白畫面）的問題。
// 如果你改用自訂網域（不是 github.io 子路徑），也可以改回 "/"。
export default defineConfig({
  plugins: [react()],
  base: "./",
});
