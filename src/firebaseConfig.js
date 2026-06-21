// ============================================================
// Firebase 設定檔
// ------------------------------------------------------------
// 請依照教學文件，把你自己 Firebase 專案的設定值貼到下面。
// 這些值不是「密碼」，是公開金鑰沒關係，真正的安全控制在
// Firestore 的「安全規則（Security Rules）」裡，請務必設定。
// ============================================================

import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDBNxlZgfJZm4O7lJczpXWoCLV8s0E-7Ig",
  authDomain: "mail-data-2d346.firebaseapp.com",
  projectId: "mail-data-2d346",
  storageBucket: "mail-data-2d346.firebasestorage.app",
  messagingSenderId: "972404051893",
  appId: "1:972404051893:web:276a78bb854fcdafbad3fc",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
