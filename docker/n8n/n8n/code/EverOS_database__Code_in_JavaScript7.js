// 1. 取得前一個節點傳來的 JSON 資料
const inputData = $input.first().json;

// 2. 把 AI 的回答整理成一段文字
//    回答在 output（物件：conclusion / reasons / note / suggestions），舊版是 report（字串）
function answerToText(ans) {
  if (ans == null) return "";
  if (typeof ans === "string") return ans.trim();
  if (typeof ans !== "object") return String(ans);

  const lines = [];
  if (ans.conclusion) lines.push(`結論：${ans.conclusion}`);

  if (Array.isArray(ans.reasons) && ans.reasons.length) {
    lines.push("判斷依據：");
    for (const r of ans.reasons) {
      if (typeof r === "string") lines.push(`- ${r}`);
      else if (r && r.sign) lines.push(`- ${r.sign}${r.risk ? `（${r.risk}）` : ""}`);
    }
  }

  if (ans.note) lines.push(`補充：${ans.note}`);

  if (Array.isArray(ans.suggestions) && ans.suggestions.length) {
    lines.push("建議：");
    for (const s of ans.suggestions) lines.push(`- ${s}`);
  }

  // 都不是上面的欄位時，原樣轉成 JSON 文字，至少不會遺失
  return lines.length ? lines.join("\n") : JSON.stringify(ans);
}

const reportContent   = answerToText(inputData.output ?? inputData.report);
const questionContent = String(inputData.question || inputData.quetion || "").trim();

// 3. 登入者資料；sender_id 只能用英文、數字和 _ . @ + -，其餘字元換成底線
const accountId   = String(inputData.account_id || "york123").replace(/[^a-zA-Z0-9_.@+-]/g, "_");
const accountName = String(inputData.account_name || "").trim() || null;

// 4. 把「提問＋PhishGuard 的回答」寫成同一則訊息
//    EverOS 一定會抽取使用者這一方的訊息，回答放在同一則裡才保證查得到
const now = Date.now();
const messages = [];

if (questionContent !== "") {
  const content = reportContent !== ""
    ? `【PhishGuard 判斷紀錄】\n使用者提問：${questionContent}\nPhishGuard 的回答：\n${reportContent}`
    : questionContent;

  messages.push({
    sender_id:   accountId,
    sender_name: accountName,
    role:        "user",
    timestamp:   now,
    content,
  });
}

// EverOS 規定 messages 至少要有一則，沒有內容就不送
if (messages.length === 0) {
  return [];
}

// 5. 組裝成 EverOS /api/v2/memory/add 的格式
return [{
  json: {
    session_id: `phishguard_${accountId}`,   // 每個帳號各自一個 session
    app_id:     "default",
    project_id: "default_proj",
    messages,
  }
}];
