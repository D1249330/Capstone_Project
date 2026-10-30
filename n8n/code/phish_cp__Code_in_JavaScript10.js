// AI Agent1 之後的整理節點：判定結果完全照三模型投票，不讓 AI 改判
// 結論由程式依 Code in JavaScript19 的投票結果產生；AI 只負責說明跡象與建議

// 1. 取得 AI Agent 的回答（通常在 output，是一段 JSON 字串）
const raw = $input.first().json.output ?? $input.first().json.text ?? "";

// 2. 解析 JSON：去掉 ```json 標記，只取第一個 { 到最後一個 } 之間的內容
function parseAnswer(value) {
  if (value && typeof value === "object") return value;
  let s = String(value).trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { /* 解析失敗就走下面的備用 */ }
  }
  return null;
}

const str = (v) => (v == null ? "" : String(v).trim());

// 3. 投票結果（Code in JavaScript19 的輸出）
let vote = {};
try { vote = $('Code in JavaScript19').first().json; } catch (e) { /* 找不到節點時略過 */ }
const nModels = Number(vote.n_models ?? 0);
const nMal = Number(vote.n_mal ?? 0);
const decided = nModels === 3;
const isPhish = decided && vote.is_malicious === true;
const CN = ["零", "一", "兩", "三"];

let conclusion;
if (!decided) {
  conclusion = "有模型沒有產生結果，本次無法判定。";
} else if (isPhish) {
  conclusion = `三個模型中有${CN[nMal]}個判為惡意，依多數決判定為釣魚網址。`;
} else {
  conclusion = `三個模型中有${CN[nMal]}個判為惡意，依多數決判定為正常網址。`;
}

// 4. 整理 AI 的回答
let ans = parseAnswer(raw) || { reasons: [], note: "", suggestions: [] };

// 和「正常」判定相反的字眼，判為正常時一律濾掉
const HEDGE = /可疑|不確定|分歧|疑慮|謹慎|小心|留意|注意|真偽|確認網站|風險|釣魚|惡意|詐騙|不要點擊|勿點擊|不要輸入|勿輸入|封鎖/;

// 判斷依據只能是報告裡、和判定方向一致的跡象（判為釣魚 → 可疑跡象；判為正常 → 正常跡象）
const allowed = isPhish ? (vote.risk_signals || []) : (vote.safe_signals || []);
const allowedSet = new Set(allowed);
let reasons = (Array.isArray(ans.reasons) ? ans.reasons : [])
  .map((r) => (typeof r === "string"
    ? { sign: str(r), risk: "" }
    : { sign: str(r && r.sign), risk: str(r && r.risk) }))
  .filter((r) => allowedSet.has(r.sign));
// AI 沒照抄跡象時，直接用報告的跡象
if (!reasons.length) reasons = allowed.map((s) => ({ sign: s, risk: "" }));

let suggestions = (Array.isArray(ans.suggestions) ? ans.suggestions : []).map(str).filter(Boolean);
let note = str(ans.note);

if (!decided) {
  reasons = [];
  note = "";
  suggestions = ["請確認模型服務狀態後重新檢測"];
} else if (isPhish) {
  // 判為釣魚：第一項固定是不要點擊
  const first = "不要點擊此連結，也不要輸入任何帳號、密碼或個人資料";
  suggestions = [first, ...suggestions.filter((s) => !/不要點擊|勿點擊|正常使用|正常瀏覽|可以放心|安全無虞/.test(s))];
  if (/正常網址|可以放心|安全無虞/.test(note)) note = "";
} else {
  // 判為正常：說明不可帶有可疑、謹慎、不要點擊等字眼
  reasons = reasons.map((r) => (HEDGE.test(r.risk) ? { sign: r.sign, risk: "" } : r));
  // 建議與提醒固定，不用 AI 寫的（AI 常會加上「停止操作」「修改密碼」這類和判定相反的內容）
  suggestions = ["可以正常瀏覽此網址"];
  note = "";
}

const output = { conclusion, reasons, note, suggestions: suggestions.slice(0, 4) };

// 5. 排成前端顯示的文字
const lines = [output.conclusion];

if (output.reasons.length) {
  lines.push("", "判斷依據：");
  output.reasons.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.sign}${r.risk ? `：${r.risk}` : ""}`);
  });
}

if (output.suggestions.length) {
  lines.push("", "建議：");
  output.suggestions.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
}

if (output.note) lines.push("", `提醒：${output.note}`);

// 6. 帶上提問與帳號，後面的 EverOS 程式節點會用到
let src = {};
try { src = $('Code in JavaScript2').first().json; } catch (e) { /* 節點名稱不同時略過 */ }

// 按「網址分析」時沒有提問，只有網址，就用網址組成一句問題，EverOS 才會存這次的記憶
const userQuestion = str(src.question || src.chatInput || src.message);
const checkedUrl   = str(src.url || src.URL || src.link);
const question     = userQuestion || (checkedUrl ? `${checkedUrl} 是釣魚網站嗎?` : "");

return [{
  json: {
    question,
    account_id:   str(src.account_id),
    account_name: str(src.account_name),
    output,                       // 物件，給 EverOS 程式節點
    text: lines.join("\n"),       // 文字，給前端顯示
  }
}];
