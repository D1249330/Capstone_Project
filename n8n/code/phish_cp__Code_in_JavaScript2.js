const req = $input.first().json;
// 相容 POST (body)、GET (query) 或是直接攤平的 JSON
const payload = req.body || req.query || req;

// PhishGuard 網站送來：{ type, message, url, account_id, account_name }
// 舊前端送來：{ chatInput } 或 { url }
const text = String(payload.message || payload.chatInput || payload.url || "").trim();

// 登入者資料，帶到每個輸出給後面的節點用
const user = {
  account_id:   payload.account_id   || "",
  account_name: payload.account_name || "",
};

if (!text) {
  return [{ json: { mode: "error", message: "未收到任何網址或文字", ...user } }];
}

// 認得：任何協定（選填）、localhost、IPv4、一般網域（含 [.]、(.) 這種去武裝寫法）、連接埠、路徑與參數
const urlRegex = /((?:[a-z][a-z0-9+.-]*:\/\/)?(?:localhost|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-zA-Z0-9-]+(?:\.|\[\.\]|\(\.\)))+[a-zA-Z]{2,})(?::\d+)?(?:[-a-zA-Z0-9@:%_\+.~#?&\/=\[\]()!$',;*]*))/i;

if (!urlRegex.test(text)) {
  return [{ json: { mode: "chat", text, ...user } }];
}

// 依 0805_three_model_workflow.md：網址送給模型服務，不縮成網域
// 本專案額外規則：只拿掉開頭的 www.（含 www1.、www[.]），路徑與參數保留，和 Render 一致
//   https://www.youtube.com/watch?v=abc → https://youtube.com/watch?v=abc
// 其餘清理（去協定、轉小寫、還原 [.] 等）由 8001 模型服務自己照文件處理
const originalUrl = text.match(urlRegex)[0];
const url = originalUrl
  .replace(/[.,;:!?'"]+$/, "")                                                   // 去掉句尾黏到的標點
  .replace(/^(\s*(?:[a-z][a-z0-9+.-]*:\/\/)?)www\d*(?:\.|\[\.\]|\(\.\))/i, "$1");   // 拿掉開頭的 www.

if (!url) {
  return [{ json: { mode: "chat", text, ...user } }];
}

// 用原始字串移除網址，剩下的當作問題
const remain = text.replace(originalUrl, "").trim();

if (remain.length === 0) {
  return [{ json: { mode: "url", url, ...user } }];
}

return [{ json: { mode: "url_chat", url, question: remain, ...user } }];
