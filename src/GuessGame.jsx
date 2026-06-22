import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Star, Lock, Unlock, Plus, ChevronLeft, Image as ImageIcon,
  Calendar, KeyRound, Settings, Check, X, Clock, Eye, EyeOff,
  Sparkles, ChevronRight, Trash2, WifiOff, AlertTriangle, HelpCircle
} from "lucide-react";
import { db } from "./firebaseConfig.js";
import {
  collection, doc, setDoc, deleteDoc, onSnapshot, query, orderBy,
} from "firebase/firestore";

/* ----------------------------------------------------------------
   小日記 / 開發筆記（給未來的自己看）：
   - 視覺主題：信封 ＋ 封蠟。答案送出 = 封進信封；解鎖 = 拆信。
   - 配色：暖杏底 + 墨綠／酒紅雙主色，避免落入「米色+陶土」樣板。
   - 資料改存 Firebase Firestore（collection: "questions"），
     每一道題目是一個文件，用 onSnapshot 即時監聽，雙方裝置會自動同步，
     不需要手動 refresh。
------------------------------------------------------------------*/

// ---------- 色彩 token ----------
const COLORS = {
  paper: "#F6EFE4",
  paperDeep: "#EDE3D2",
  ink: "#2B2521",
  inkSoft: "#5C5249",
  wax: "#7A2E2E",      // 封蠟酒紅（男生）
  pine: "#2F4538",     // 墨綠（女生）
  gold: "#B8923D",
  goldSoft: "#D9C9A3",
  cream: "#FFFBF3",
};

// ---------- Firestore helpers ----------
const QUESTIONS_COLLECTION = "questions";

// 訂閱題目列表（即時同步）。回傳取消訂閱的函式。
function subscribeQuestions(onData, onError) {
  const q = query(collection(db, QUESTIONS_COLLECTION), orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      onData(list);
    },
    (err) => {
      console.error("Firestore 監聽失敗", err);
      onError && onError(err);
    }
  );
}

// 新增或覆寫一道題目（merge: true 避免覆蓋其他欄位）
async function saveQuestion(question) {
  const { id, ...data } = question;
  await setDoc(doc(db, QUESTIONS_COLLECTION, id), data, { merge: true });
}

// 刪除一道題目
async function removeQuestion(id) {
  await deleteDoc(doc(db, QUESTIONS_COLLECTION, id));
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// 圖片轉 base64，並順手壓縮，避免 Firestore 單一文件超過 1MB 限制存不進去
function fileToCompressedDataUrl(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function isUnlockedByDate(q) {
  if (!q.unlockDate) return false;
  return new Date() >= new Date(q.unlockDate);
}

// ---------- 共用元件 ----------

function WaxSeal({ color = COLORS.wax, size = 56, children }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: "50%",
        background: `radial-gradient(circle at 32% 28%, ${color}dd, ${color} 60%, ${color}cc 100%)`,
        boxShadow: "0 3px 8px rgba(0,0,0,0.35), inset 0 2px 3px rgba(255,255,255,0.25), inset 0 -3px 5px rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    empty:   { label: "尚未開始", bg: COLORS.goldSoft, fg: "#5C4A1F" },
    partial: { label: "等待對方作答", bg: "#E7D7B8", fg: "#5C4A1F" },
    sealed:  { label: "已封存．等待解鎖", bg: "#D8C9B0", fg: COLORS.ink },
    ready:   { label: "可以拆信了", bg: COLORS.pine, fg: "#fff" },
    revealed:{ label: "已對答案", bg: "#3E3A35", fg: "#fff" },
  };
  const s = map[status] || map.empty;
  return (
    <span style={{
      background: s.bg, color: s.fg, fontSize: 12, fontWeight: 600,
      padding: "4px 10px", borderRadius: 999, letterSpacing: 0.3,
      display: "inline-flex", alignItems: "center", gap: 4,
    }}>
      {status === "ready" && <Sparkles size={12} />}
      {s.label}
    </span>
  );
}

function deriveStatus(q) {
  const hasA = !!(q.answers?.boy?.text || q.answers?.boy?.image);
  const hasB = !!(q.answers?.girl?.text || q.answers?.girl?.image);
  if (q.revealed) return "revealed";
  if (!hasA && !hasB) return "empty";
  if (hasA !== hasB) return "partial";
  // both answered -> 看是不是已經滿足解鎖條件（日期到了，或密語雙方都已各自確認）
  const bothConfirmedPw = !!(q.pwConfirmed?.boy && q.pwConfirmed?.girl);
  if (isUnlockedByDate(q) || (q.passwordSet && bothConfirmedPw)) return "ready";
  return "sealed";
}

// ================================================================
// 主畫面
// ================================================================
export default function GuessGame() {
  const [questions, setQuestions] = useState(null); // null = loading
  const [view, setView] = useState({ name: "list" }); // list | detail | admin
  const [toast, setToast] = useState(null);
  const [connError, setConnError] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const seeded = useRef(false);

  useEffect(() => {
    const unsubscribe = subscribeQuestions(
      (list) => {
        setConnError(null);
        if (list.length === 0 && !seeded.current) {
          // 第一次使用、資料庫是空的 -> 種兩道示範題目，讓畫面不要空空的
          seeded.current = true;
          const seed = [
            {
              id: uid(),
              title: "我們第一次見面，我穿的是什麼顏色的衣服？",
              type: "text",
              createdAt: new Date().toISOString(),
              unlockDate: "",
              passwordSet: "",
              answers: {},
              pwConfirmed: {},
              revealed: false,
            },
            {
              id: uid(),
              title: "畫出你心目中我們最喜歡去的那間店",
              type: "image",
              createdAt: new Date().toISOString(),
              unlockDate: "",
              passwordSet: "",
              answers: {},
              pwConfirmed: {},
              revealed: false,
            },
          ];
          seed.forEach((q) => saveQuestion(q));
          // 不直接 setQuestions(seed)：onSnapshot 寫入後會自動再推一次最新資料
        } else {
          setQuestions(list);
        }
      },
      (err) => {
        setConnError(
          err?.code === "permission-denied"
            ? "沒有讀取權限，請檢查 Firestore 安全規則是否已設定好"
            : "連不上資料庫，請檢查網路連線或 Firebase 設定"
        );
      }
    );
    return () => unsubscribe();
  }, []);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  const handleUpdate = useCallback(async (updated) => {
    try {
      await saveQuestion(updated);
    } catch (e) {
      console.error(e);
      showToast("儲存失敗，請檢查網路連線");
    }
  }, []);

  const handleAdd = useCallback(async (newQ) => {
    try {
      await saveQuestion(newQ);
    } catch (e) {
      console.error(e);
      showToast("新增失敗，請檢查網路連線");
    }
  }, []);

  const handleDelete = useCallback(async (id) => {
    try {
      await removeQuestion(id);
    } catch (e) {
      console.error(e);
      showToast("刪除失敗，請檢查網路連線");
    }
  }, []);

  if (connError) {
    return <ConnectionErrorScreen message={connError} />;
  }

  if (questions === null) {
    return <LoadingScreen />;
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${COLORS.paper} 0%, ${COLORS.paperDeep} 100%)`,
        fontFamily: "'Iowan Old Style','Noto Serif TC',Georgia,serif",
        color: COLORS.ink,
        position: "relative",
      }}
    >
      <PaperTexture />
      <TopBar view={view} setView={setView} setShowHelp={setShowHelp} />

      <div style={{ position: "relative", zIndex: 1, maxWidth: 900, margin: "0 auto", padding: "0 clamp(12px, 5vw, 24px) 80px" }}>
        {view.name === "list" && (
          <ListScreen
            questions={questions}
            onOpen={(q) => setView({ name: "detail", id: q.id })}
            onAdmin={() => setView({ name: "admin" })}
          />
        )}
        {view.name === "detail" && (
          <DetailScreen
            question={questions.find((q) => q.id === view.id)}
            onBack={() => setView({ name: "list" })}
            onUpdate={handleUpdate}
            showToast={showToast}
          />
        )}
        {view.name === "admin" && (
          <AdminScreen
            questions={questions}
            onBack={() => setView({ name: "list" })}
            onAdd={handleAdd}
            onDelete={handleDelete}
            showToast={showToast}
          />
        )}
      </div>

      {toast && <Toast text={toast} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// ---------- 紙張紋理裝飾 ----------
function PaperTexture() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        opacity: 0.5,
        backgroundImage:
          "radial-gradient(circle at 20% 20%, rgba(184,146,61,0.06), transparent 40%), radial-gradient(circle at 80% 70%, rgba(47,69,56,0.05), transparent 45%)",
      }}
    />
  );
}

function ConnectionErrorScreen({ message }) {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: COLORS.paper, fontFamily: "'Noto Sans TC',sans-serif", color: COLORS.ink,
      padding: 24, textAlign: "center",
    }}>
      <div style={{ maxWidth: 360 }}>
        <AlertTriangle size={32} color={COLORS.wax} style={{ marginBottom: 14 }} />
        <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 16 }}>連線發生問題</div>
        <div style={{ fontSize: 13.5, color: COLORS.inkSoft, lineHeight: 1.7 }}>{message}</div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: COLORS.paper, fontFamily: "'Iowan Old Style',Georgia,serif", color: COLORS.inkSoft,
    }}>
      <div style={{ textAlign: "center" }}>
        <Star size={28} style={{ marginBottom: 10, opacity: 0.5 }} />
        <div>正在開信箱…</div>
      </div>
    </div>
  );
}

function HelpModal({ onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: 20,
    }}>
      <div style={{
        background: COLORS.cream, borderRadius: 20, padding: 24, maxWidth: 500,
        maxHeight: "80vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>💡 使用說明</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ fontSize: 14, lineHeight: 1.8, color: COLORS.ink, fontFamily: "'Noto Sans TC',sans-serif" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 15 }}>📝 如何寫答案</div>
            <ol style={{ marginLeft: 20, marginTop: 6 }}>
              <li>點擊題目卡片進入</li>
              <li>選擇你的身份（⭐ 男生 或 ✨ 女生）</li>
              <li>輸入或上傳你的答案</li>
              <li>點擊「封存這個答案」提交</li>
              <li>答案會被加密，只有在解鎖後才能看到</li>
            </ol>
          </div>

          <div style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 15 }}>🔓 如何打開答案</div>
            <ol style={{ marginLeft: 20, marginTop: 6 }}>
              <li>等雙方都寫好答案後，狀態會顯示「可以拆信了」</li>
              <li>點擊進入題目</li>
              <li>如果有設定「通關密語」，兩個人都要輸入密語</li>
              <li>點擊「拆信對答案」，答案就會揭曉！</li>
            </ol>
          </div>

          <div style={{ padding: 12, background: `${COLORS.goldSoft}33`, borderRadius: 10, fontSize: 13 }}>
            💡 <strong>小提示：</strong>可以設定解鎖日期或通關密語，讓遊戲更有趣！
          </div>
        </div>

        <button
          onClick={onClose}
          style={{
            marginTop: 20, width: "100%", padding: 12,
            background: COLORS.wax, color: "#fff", border: "none",
            borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: "pointer",
            fontFamily: "'Noto Sans TC',sans-serif",
          }}
        >
          知道了！
        </button>
      </div>
    </div>
  );
}

function Toast({ text }) {
  return (
    <div style={{
      position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
      background: COLORS.ink, color: COLORS.cream, padding: "10px 20px",
      borderRadius: 999, fontSize: 14, zIndex: 50, boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
      fontFamily: "'Noto Sans TC',sans-serif",
    }}>
      {text}
    </div>
  );
}

// ================================================================
// 頂部列
// ================================================================
function TopBar({ view, setView, setShowHelp }) {
  const showBack = view.name !== "list";
  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 10,
      background: "rgba(246,239,228,0.88)", backdropFilter: "blur(8px)",
      borderBottom: `1px solid ${COLORS.goldSoft}`,
    }}>
      <div style={{
        maxWidth: "100%", margin: "0 auto", padding: "clamp(12px, 3vw, 16px) clamp(12px, 5vw, 20px)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {showBack ? (
            <button
              onClick={() => setView({ name: "list" })}
              style={iconBtnStyle}
              aria-label="返回"
            >
              <ChevronLeft size={20} color={COLORS.ink} />
            </button>
          ) : (
            <Star size={20} color={COLORS.wax} fill={COLORS.wax} />
          )}
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.5 }}>
              {view.name === "list" && "猜猜看信箱"}
              {view.name === "detail" && "這封信"}
              {view.name === "admin" && "信箱管理"}
            </div>
            {view.name === "list" && (
              <div style={{ fontSize: 11.5, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>
                寫下答案，封存起來，時間到了再一起拆開
              </div>
            )}
          </div>
        </div>
        {view.name === "list" && (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowHelp(true)} style={iconBtnStyle} aria-label="幫助">
              <HelpCircle size={19} color={COLORS.inkSoft} />
            </button>
            <button onClick={() => setView({ name: "admin" })} style={iconBtnStyle} aria-label="管理題目">
              <Settings size={19} color={COLORS.inkSoft} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const iconBtnStyle = {
  width: 36, height: 36, borderRadius: "50%", border: "none",
  background: "rgba(0,0,0,0.04)", display: "flex", alignItems: "center",
  justifyContent: "center", cursor: "pointer",
};

// ================================================================
// 列表畫面
// ================================================================
function ListScreen({ questions, onOpen, onAdmin }) {
  if (questions.length === 0) {
    return (
      <EmptyState onAdmin={onAdmin} />
    );
  }
  return (
    <div style={{ paddingTop: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {questions.map((q) => (
          <EnvelopeCard key={q.id} question={q} onClick={() => onOpen(q)} />
        ))}
      </div>

      <button
        onClick={onAdmin}
        style={{
          marginTop: 22, width: "100%", padding: "14px",
          background: "transparent", border: `1.5px dashed ${COLORS.goldSoft}`,
          borderRadius: 14, color: COLORS.inkSoft, fontSize: 14,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          cursor: "pointer", fontFamily: "'Noto Sans TC',sans-serif",
        }}
      >
        <Plus size={16} /> 新增一道題目
      </button>
    </div>
  );
}

function EmptyState({ onAdmin }) {
  return (
    <div style={{ textAlign: "center", padding: "80px 20px" }}>
      <Star size={36} color={COLORS.goldSoft} style={{ marginBottom: 16 }} />
      <div style={{ fontSize: 18, marginBottom: 6 }}>信箱還是空的</div>
      <div style={{ fontSize: 13.5, color: COLORS.inkSoft, marginBottom: 24, fontFamily: "'Noto Sans TC',sans-serif" }}>
        新增第一道題目，開始你們的猜猜看
      </div>
      <button onClick={onAdmin} style={primaryBtnStyle}>
        <Plus size={16} /> 新增題目
      </button>
    </div>
  );
}

function EnvelopeCard({ question: q, onClick }) {
  const status = deriveStatus(q);
  const hasBoy = !!(q.answers?.boy?.text || q.answers?.boy?.image);
  const hasGirl = !!(q.answers?.girl?.text || q.answers?.girl?.image);

  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", width: "100%", border: "none", cursor: "pointer",
        background: COLORS.cream,
        borderRadius: 16,
        padding: "18px 18px",
        boxShadow: "0 2px 10px rgba(43,37,33,0.08)",
        position: "relative", overflow: "hidden",
        borderLeft: `4px solid ${status === "ready" ? COLORS.pine : status === "revealed" ? "#3E3A35" : COLORS.goldSoft}`,
        fontFamily: "inherit",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 16, lineHeight: 1.5, fontWeight: 600, color: COLORS.ink, flex: 1 }}>
          {q.title}
        </div>
        {q.type === "image" && <ImageIcon size={16} color={COLORS.inkSoft} style={{ flexShrink: 0, marginTop: 3 }} />}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
        <div style={{ display: "flex", gap: 6, fontFamily: "'Noto Sans TC',sans-serif" }}>
          <MiniTag label="男生" filled={hasBoy} color={COLORS.wax} />
          <MiniTag label="女生" filled={hasGirl} color={COLORS.pine} />
        </div>
        <StatusChip status={status} />
      </div>

      {q.unlockDate && status === "sealed" && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: COLORS.inkSoft, display: "flex", alignItems: "center", gap: 4, fontFamily: "'Noto Sans TC',sans-serif" }}>
          <Clock size={12} /> {formatDateTime(q.unlockDate)} 解鎖
        </div>
      )}
    </button>
  );
}

function MiniTag({ label, filled, color }) {
  return (
    <span style={{
      fontSize: 11, padding: "3px 8px", borderRadius: 999,
      background: filled ? color : "transparent",
      color: filled ? "#fff" : COLORS.inkSoft,
      border: `1px solid ${filled ? color : COLORS.goldSoft}`,
      display: "inline-flex", alignItems: "center", gap: 3,
    }}>
      {filled ? <Check size={10} /> : null}{label}
    </span>
  );
}

const primaryBtnStyle = {
  background: COLORS.wax, color: "#fff", border: "none",
  padding: "12px 22px", borderRadius: 999, fontSize: 14, fontWeight: 600,
  display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer",
  fontFamily: "'Noto Sans TC',sans-serif",
};

// ================================================================
// 詳情畫面（依狀態分流到 作答 / 已封存等待 / 拆信 / 對答案）
// ================================================================
function DetailScreen({ question, onBack, onUpdate, showToast }) {
  if (!question) return null;
  const status = deriveStatus(question);
  const hasA = !!(question.answers?.boy?.text || question.answers?.boy?.image);
  const hasB = !!(question.answers?.girl?.text || question.answers?.girl?.image);
  const bothAnswered = hasA && hasB;

  if (status === "revealed") {
    return <RevealScreen question={question} onBack={onBack} />;
  }
  if (bothAnswered) {
    // 不論是「等待日期 / 等待雙方輸入密語」還是「已經可以拆信」，都交給 UnlockScreen 判斷顯示
    return <UnlockScreen question={question} onUpdate={onUpdate} showToast={showToast} />;
  }
  return <AnswerScreen question={question} onUpdate={onUpdate} showToast={showToast} status={status} />;
}

// ---------- 作答畫面 ----------
function AnswerScreen({ question, onUpdate, showToast, status }) {
  return (
    <div style={{ paddingTop: 20 }}>
      <h2 style={{ fontSize: 20, lineHeight: 1.5, marginBottom: 6 }}>{question.title}</h2>
      <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 20, fontFamily: "'Noto Sans TC',sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
        <Lock size={12} />
        答案送出後會封存，{question.unlockDate ? `${formatDateTime(question.unlockDate)} 解鎖` : "輸入通關密語後"}才能看到對方的內容
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <AnswerPane
          who="boy" label="男生作答" color={COLORS.wax}
          question={question} onUpdate={onUpdate} showToast={showToast}
        />
        <AnswerPane
          who="girl" label="女生作答" color={COLORS.pine}
          question={question} onUpdate={onUpdate} showToast={showToast}
        />
      </div>
    </div>
  );
}

function AnswerPane({ who, label, color, question, onUpdate, showToast }) {
  const existing = question.answers?.[who];
  const locked = !!existing && (existing.text || existing.image);
  const [text, setText] = useState(existing?.text || "");
  const [image, setImage] = useState(existing?.image || null);
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef(null);

  const needsImage = question.type === "image" || question.type === "both";
  const needsText = question.type === "text" || question.type === "both";

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) {
      showToast("圖片太大了，請選 10MB 以下");
      return;
    }
    try {
      setCompressing(true);
      // 壓縮過後存進 Firestore，避免單一文件超過 1MB 限制存不進去
      const dataUrl = await fileToCompressedDataUrl(f);
      setImage(dataUrl);
    } catch (err) {
      console.error(err);
      showToast("圖片處理失敗，請換一張試試");
    } finally {
      setCompressing(false);
    }
  };

  const submit = () => {
    if (needsText && !text.trim() && !needsImage) {
      showToast("還沒寫答案喔");
      return;
    }
    if (needsImage && !needsText && !image) {
      showToast("還沒選圖片喔");
      return;
    }
    const updated = {
      ...question,
      answers: {
        ...question.answers,
        [who]: { text: text.trim(), image, submittedAt: new Date().toISOString() },
      },
    };
    onUpdate(updated);
    showToast(`${label}已封存 ✓`);
  };

  return (
    <div style={{
      background: COLORS.cream, borderRadius: 16, padding: 18,
      border: `1.5px solid ${locked ? color : COLORS.goldSoft}`,
      position: "relative",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <WaxSeal color={color} size={32}>
          {locked ? <Lock size={14} color="#fff" /> : (who === "boy" ? <Star size={14} color="#fff" fill="#fff" /> : <Sparkles size={14} color="#fff" />)}
        </WaxSeal>
        <div style={{ fontWeight: 700, fontSize: 14.5, fontFamily: "'Noto Sans TC',sans-serif" }}>{label}</div>
        {locked && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color, fontFamily: "'Noto Sans TC',sans-serif" }}>
            已封存
          </span>
        )}
      </div>

      {locked ? (
        <div style={{ fontSize: 13.5, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>
          答案已經寫好並封進信封了，等解鎖時間到才能看到內容（包括自己也看不到，這樣才公平 😄）
        </div>
      ) : (
        <>
          {needsText && (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="寫下你的答案…"
              rows={3}
              style={{
                width: "100%", border: `1px solid ${COLORS.goldSoft}`, borderRadius: 10,
                padding: "10px 12px", fontSize: 14.5, fontFamily: "'Noto Sans TC',sans-serif",
                resize: "vertical", background: "#fff", boxSizing: "border-box", color: COLORS.ink,
              }}
            />
          )}

          {needsImage && (
            <div style={{ marginTop: needsText ? 10 : 0 }}>
              {image ? (
                <div style={{ position: "relative", display: "inline-block" }}>
                  <img src={image} alt="" style={{ maxWidth: "100%", maxHeight: 180, borderRadius: 10, display: "block" }} />
                  <button
                    onClick={() => setImage(null)}
                    style={{
                      position: "absolute", top: 6, right: 6, background: "rgba(0,0,0,0.55)",
                      border: "none", borderRadius: "50%", width: 24, height: 24, color: "#fff",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={compressing}
                  style={{
                    width: "100%", padding: "20px", border: `1.5px dashed ${COLORS.goldSoft}`,
                    borderRadius: 10, background: "transparent", color: COLORS.inkSoft,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                    cursor: compressing ? "default" : "pointer", fontFamily: "'Noto Sans TC',sans-serif", fontSize: 13,
                  }}
                >
                  <ImageIcon size={20} />
                  {compressing ? "圖片處理中…" : "上傳圖片"}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
            </div>
          )}

          <button
            onClick={submit}
            style={{
              marginTop: 14, width: "100%", padding: "11px",
              background: color, color: "#fff", border: "none", borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontFamily: "'Noto Sans TC',sans-serif",
            }}
          >
            <Lock size={14} /> 封存這個答案
          </button>
        </>
      )}
    </div>
  );
}

// ---------- 解鎖畫面（雙方都已作答，等待拆信）----------
function UnlockScreen({ question, onUpdate, showToast }) {
  const dateOk = isUnlockedByDate(question);
  const boyConfirmed = !!question.pwConfirmed?.boy;
  const girlConfirmed = !!question.pwConfirmed?.girl;
  const bothConfirmed = boyConfirmed && girlConfirmed;

  const revealByDate = () => {
    onUpdate({ ...question, revealed: true });
  };

  // 雙方密語都確認完成 -> 直接可以拆信
  const revealByPassword = () => {
    onUpdate({ ...question, revealed: true });
  };

  return (
    <div style={{ paddingTop: 30, textAlign: "center" }}>
      <h2 style={{ fontSize: 19, lineHeight: 1.5, marginBottom: 4 }}>{question.title}</h2>
      <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 28, fontFamily: "'Noto Sans TC',sans-serif" }}>
        雙方都已經封存答案了
      </div>

      <div style={{
        background: COLORS.cream, borderRadius: 20, padding: "32px 24px",
        border: `1.5px solid ${COLORS.goldSoft}`, position: "relative",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 8, marginBottom: 18 }}>
          <WaxSeal color={COLORS.wax} size={48}><Star size={18} color="#fff" fill="#fff" /></WaxSeal>
          <WaxSeal color={COLORS.pine} size={48}><Sparkles size={18} color="#fff" /></WaxSeal>
        </div>

        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>可以拆信了</div>
        <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 22, fontFamily: "'Noto Sans TC',sans-serif" }}>
          {question.unlockDate && `解鎖時間：${formatDateTime(question.unlockDate)}`}
          {question.unlockDate && question.passwordSet && "．"}
          {question.passwordSet && "需要雙方各自輸入通關密語"}
        </div>

        {dateOk && (
          <button onClick={revealByDate} style={{ ...primaryBtnStyle, background: COLORS.pine, width: "100%", justifyContent: "center", marginBottom: question.passwordSet ? 18 : 0 }}>
            <Unlock size={16} /> 時間已到，拆信對答案
          </button>
        )}

        {question.passwordSet && (
          <>
            {dateOk && <div style={{ fontSize: 11.5, color: COLORS.inkSoft, margin: "10px 0 16px", fontFamily: "'Noto Sans TC',sans-serif" }}>或是兩人各自輸入通關密語解鎖</div>}

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <PasswordPane
                who="boy" label="男生" color={COLORS.wax}
                confirmed={boyConfirmed} question={question} onUpdate={onUpdate} showToast={showToast}
              />
              <PasswordPane
                who="girl" label="女生" color={COLORS.pine}
                confirmed={girlConfirmed} question={question} onUpdate={onUpdate} showToast={showToast}
              />
            </div>

            {bothConfirmed && (
              <button
                onClick={revealByPassword}
                style={{ ...primaryBtnStyle, background: COLORS.wax, width: "100%", justifyContent: "center", marginTop: 16 }}
              >
                <Unlock size={16} /> 雙方都確認了，拆信對答案
              </button>
            )}
            {!bothConfirmed && (boyConfirmed || girlConfirmed) && (
              <div style={{ marginTop: 12, fontSize: 12, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>
                還在等另一位輸入密語喔
              </div>
            )}
          </>
        )}

        {!dateOk && !question.passwordSet && (
          <div style={{ fontSize: 12.5, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>
            還沒到解鎖時間，再等等吧
          </div>
        )}
      </div>
    </div>
  );
}

function PasswordPane({ who, label, color, confirmed, question, onUpdate, showToast }) {
  const [pwInput, setPwInput] = useState("");

  const tryConfirm = () => {
    if (pwInput.trim() === question.passwordSet) {
      onUpdate({
        ...question,
        pwConfirmed: { ...question.pwConfirmed, [who]: true },
      });
    } else {
      showToast("通關密語不對喔，再想想？");
    }
  };

  if (confirmed) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
        background: `${color}14`, borderRadius: 10, border: `1px solid ${color}55`,
      }}>
        <WaxSeal color={color} size={26}><Check size={12} color="#fff" /></WaxSeal>
        <div style={{ fontSize: 13, fontFamily: "'Noto Sans TC',sans-serif", color: COLORS.ink }}>
          {label}已輸入密語，等待對方
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input
        type="text"
        value={pwInput}
        onChange={(e) => setPwInput(e.target.value)}
        placeholder={`${label}輸入通關密語`}
        style={{
          flex: 1, border: `1px solid ${color}88`, borderRadius: 10,
          padding: "10px 12px", fontSize: 14, fontFamily: "'Noto Sans TC',sans-serif",
          boxSizing: "border-box",
        }}
        onKeyDown={(e) => e.key === "Enter" && tryConfirm()}
      />
      <button
        onClick={tryConfirm}
        style={{
          background: color, color: "#fff", border: "none", borderRadius: 10,
          padding: "0 16px", cursor: "pointer", display: "flex", alignItems: "center",
        }}
      >
        <KeyRound size={16} />
      </button>
    </div>
  );
}

// ---------- 對答案畫面 ----------
function RevealScreen({ question, onBack }) {
  const boy = question.answers?.boy;
  const girl = question.answers?.girl;
  const bothHaveText = !!(boy?.text && girl?.text);
  const sameText = bothHaveText && boy.text.trim() === girl.text.trim();
  const diffText = bothHaveText && !sameText;

  return (
    <div style={{ paddingTop: 20 }}>
      <h2 style={{ fontSize: 20, lineHeight: 1.5, marginBottom: 4 }}>{question.title}</h2>
      <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 20, fontFamily: "'Noto Sans TC',sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
        <Unlock size={12} /> 已拆信，答案揭曉
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <RevealPane label="男生的答案" color={COLORS.wax} data={boy} />
        <RevealPane label="女生的答案" color={COLORS.pine} data={girl} />
      </div>

      {sameText && (
        <div style={{
          marginTop: 18, textAlign: "center", padding: "14px",
          background: "#FBF4E2", borderRadius: 12, color: "#7A5C1E",
          fontSize: 13.5, fontFamily: "'Noto Sans TC',sans-serif",
        }}>
          ✨ 答案一模一樣！太有默契了
        </div>
      )}

      {diffText && (
        <div style={{
          marginTop: 18, textAlign: "center", padding: "14px",
          background: "#F3E7E0", borderRadius: 12, color: COLORS.wax,
          fontSize: 13.5, fontFamily: "'Noto Sans TC',sans-serif",
        }}>
          😆 喔喔～猜對了嗎 哈哈
        </div>
      )}
    </div>
  );
}

function RevealPane({ label, color, data }) {
  return (
    <div style={{
      background: COLORS.cream, borderRadius: 16, padding: 18,
      border: `1.5px solid ${color}55`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <WaxSeal color={color} size={30}><Unlock size={13} color="#fff" /></WaxSeal>
        <div style={{ fontWeight: 700, fontSize: 14, fontFamily: "'Noto Sans TC',sans-serif" }}>{label}</div>
      </div>
      {data?.text && (
        <div style={{ fontSize: 15, lineHeight: 1.7, color: COLORS.ink, marginBottom: data?.image ? 10 : 0 }}>
          {data.text}
        </div>
      )}
      {data?.image && (
        <img src={data.image} alt="" style={{ maxWidth: "100%", borderRadius: 10, display: "block" }} />
      )}
      {!data?.text && !data?.image && (
        <div style={{ fontSize: 13, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>（沒有作答）</div>
      )}
      {data?.submittedAt && (
        <div style={{ marginTop: 10, fontSize: 10.5, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>
          封存於 {formatDateTime(data.submittedAt)}
        </div>
      )}
    </div>
  );
}

// ================================================================
// 後台管理畫面
// ================================================================
function AdminScreen({ questions, onBack, onAdd, onDelete, showToast }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div style={{ paddingTop: 20 }}>
      {!showForm ? (
        <>
          <button onClick={() => setShowForm(true)} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginBottom: 22 }}>
            <Plus size={16} /> 新增題目
          </button>

          <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 10, fontFamily: "'Noto Sans TC',sans-serif" }}>
            所有題目（{questions.length}）
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {questions.map((q) => (
              <AdminRow key={q.id} question={q} onDelete={() => onDelete(q.id)} />
            ))}
            {questions.length === 0 && (
              <div style={{ fontSize: 13, color: COLORS.inkSoft, textAlign: "center", padding: 30, fontFamily: "'Noto Sans TC',sans-serif" }}>
                還沒有題目
              </div>
            )}
          </div>
        </>
      ) : (
        <NewQuestionForm
          onCancel={() => setShowForm(false)}
          onSave={(q) => { onAdd(q); setShowForm(false); showToast("題目新增成功"); }}
        />
      )}
    </div>
  );
}

function AdminRow({ question: q, onDelete }) {
  const status = deriveStatus(q);
  const [confirming, setConfirming] = useState(false);

  return (
    <div style={{
      background: COLORS.cream, borderRadius: 12, padding: "12px 14px",
      display: "flex", alignItems: "center", gap: 10,
      border: `1px solid ${COLORS.goldSoft}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {q.title}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <StatusChip status={status} />
          {q.unlockDate && (
            <span style={{ fontSize: 10.5, color: COLORS.inkSoft, fontFamily: "'Noto Sans TC',sans-serif" }}>
              {formatDateTime(q.unlockDate)}
            </span>
          )}
          {q.passwordSet && (
            <span style={{ fontSize: 10.5, color: COLORS.inkSoft, display: "flex", alignItems: "center", gap: 2, fontFamily: "'Noto Sans TC',sans-serif" }}>
              <KeyRound size={10} /> 有密語
            </span>
          )}
        </div>
      </div>
      {confirming ? (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button onClick={onDelete} style={{ ...smallBtn, background: COLORS.wax, color: "#fff" }}>確定</button>
          <button onClick={() => setConfirming(false)} style={{ ...smallBtn, background: "transparent", border: `1px solid ${COLORS.goldSoft}` }}>取消</button>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} style={{ ...iconBtnStyle, flexShrink: 0 }} aria-label="刪除">
          <Trash2 size={15} color={COLORS.inkSoft} />
        </button>
      )}
    </div>
  );
}

const smallBtn = {
  fontSize: 12, padding: "6px 10px", borderRadius: 8, cursor: "pointer",
  fontFamily: "'Noto Sans TC',sans-serif", border: "none",
};

function NewQuestionForm({ onCancel, onSave }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("text"); // text | image | both
  const [unlockMode, setUnlockMode] = useState("date"); // date | password | both
  const [unlockDate, setUnlockDate] = useState("");
  const [unlockTime, setUnlockTime] = useState("20:00");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  const canSave = title.trim() && (
    (unlockMode === "date" && unlockDate) ||
    (unlockMode === "password" && password.trim()) ||
    (unlockMode === "both" && unlockDate && password.trim())
  );

  const save = () => {
    if (!canSave) return;
    const iso = unlockDate ? new Date(`${unlockDate}T${unlockTime || "00:00"}`).toISOString() : "";
    onSave({
      id: uid(),
      title: title.trim(),
      type,
      createdAt: new Date().toISOString(),
      unlockDate: unlockMode === "password" ? "" : iso,
      passwordSet: unlockMode === "date" ? "" : password.trim(),
      answers: {},
      pwConfirmed: {},
      revealed: false,
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 18 }}>
        <button onClick={onCancel} style={iconBtnStyle}><ChevronLeft size={18} /></button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>新增題目</div>
      </div>

      <FieldLabel>題目內容</FieldLabel>
      <textarea
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="例如：猜猜我最想去的旅行地點？"
        rows={2}
        style={textareaStyle}
      />

      <FieldLabel>作答形式</FieldLabel>
      <SegmentedControl
        value={type}
        onChange={setType}
        options={[
          { value: "text", label: "純文字" },
          { value: "image", label: "純圖片" },
          { value: "both", label: "文字＋圖片" },
        ]}
      />

      <FieldLabel>解鎖方式</FieldLabel>
      <SegmentedControl
        value={unlockMode}
        onChange={setUnlockMode}
        options={[
          { value: "date", label: "指定日期" },
          { value: "password", label: "通關密語" },
          { value: "both", label: "兩者皆可" },
        ]}
      />

      {(unlockMode === "date" || unlockMode === "both") && (
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input type="date" value={unlockDate} onChange={(e) => setUnlockDate(e.target.value)} style={{ ...inputStyle, flex: 1.3 }} />
          <input type="time" value={unlockTime} onChange={(e) => setUnlockTime(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        </div>
      )}

      {(unlockMode === "password" || unlockMode === "both") && (
        <div style={{ position: "relative", marginTop: 10 }}>
          <input
            type={showPw ? "text" : "password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="設定通關密語"
            style={{ ...inputStyle, width: "100%", paddingRight: 40, boxSizing: "border-box" }}
          />
          <button
            onClick={() => setShowPw((s) => !s)}
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer" }}
          >
            {showPw ? <EyeOff size={16} color={COLORS.inkSoft} /> : <Eye size={16} color={COLORS.inkSoft} />}
          </button>
        </div>
      )}

      <button
        onClick={save}
        disabled={!canSave}
        style={{
          marginTop: 22, width: "100%", padding: "13px",
          background: canSave ? COLORS.wax : COLORS.goldSoft,
          color: "#fff", border: "none", borderRadius: 10, fontSize: 14.5, fontWeight: 600,
          cursor: canSave ? "pointer" : "not-allowed",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontFamily: "'Noto Sans TC',sans-serif",
        }}
      >
        <Check size={16} /> 儲存題目
      </button>
    </div>
  );
}

function FieldLabel({ children }) {
  return (
    <div style={{ fontSize: 12.5, color: COLORS.inkSoft, marginTop: 16, marginBottom: 6, fontFamily: "'Noto Sans TC',sans-serif", fontWeight: 600 }}>
      {children}
    </div>
  );
}

function SegmentedControl({ value, onChange, options }) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1, padding: "9px 6px", borderRadius: 9, fontSize: 12.5,
            border: `1.5px solid ${value === opt.value ? COLORS.wax : COLORS.goldSoft}`,
            background: value === opt.value ? COLORS.wax : "transparent",
            color: value === opt.value ? "#fff" : COLORS.inkSoft,
            cursor: "pointer", fontFamily: "'Noto Sans TC',sans-serif", fontWeight: 600,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

const textareaStyle = {
  width: "100%", border: `1px solid ${COLORS.goldSoft}`, borderRadius: 10,
  padding: "10px 12px", fontSize: 14.5, fontFamily: "'Noto Sans TC',sans-serif",
  resize: "vertical", background: "#fff", boxSizing: "border-box", color: COLORS.ink,
};

const inputStyle = {
  border: `1px solid ${COLORS.goldSoft}`, borderRadius: 10,
  padding: "10px 12px", fontSize: 14, fontFamily: "'Noto Sans TC',sans-serif",
  background: "#fff", color: COLORS.ink,
};
