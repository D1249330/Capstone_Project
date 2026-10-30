// n8n Code 節點的單元測試：直接讀 n8n/phish_cp.json 裡的程式，用假資料模擬 n8n 的 $input、$()、$json
// 執行：node --test tests/code_nodes.test.mjs   （Node.js 18 以上，不需要安裝套件）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wf = JSON.parse(readFileSync(new URL("../n8n/phish_cp.json", import.meta.url), "utf8"));
const codeOf = (name) => wf.nodes.find((n) => n.name === name).parameters.jsCode;

// 模擬 n8n 執行環境：$input 是上一個節點的輸出，$("節點名") 讀其他節點，$json 是目前這筆
function run(nodeName, items, others = {}) {
  const $input = { all: () => items, first: () => items[0] };
  const $ = (name) => {
    if (!(name in others)) throw new Error(`沒有節點 ${name}`);
    return { first: () => ({ json: others[name] }), item: { json: others[name] } };
  };
  const $json = items[0]?.json ?? {};
  const out = new Function("$input", "$", "$json", codeOf(nodeName))($input, $, $json);
  return Array.isArray(out) ? out.map((o) => o.json ?? o) : [out.json ?? out];
}
const webhook = (message, extra = {}) => [{ json: { body: { message, account_id: "S0000001", account_name: "測試使用者", ...extra } } }];

// ── Code in JavaScript2：分流與網址清理 ──
test("Code2：只有網址 → url，並拿掉開頭 www.、保留路徑與參數", () => {
  const [r] = run("Code in JavaScript2", webhook("https://www.youtube.com/watch?v=_DymcG1A8Kg"));
  assert.equal(r.mode, "url");
  assert.equal(r.url, "https://youtube.com/watch?v=_DymcG1A8Kg");
  assert.equal(r.account_id, "S0000001");
});
test("Code2：網址加問題 → url_chat，問題分開", () => {
  const [r] = run("Code in JavaScript2", webhook("www.google.com 安全嗎"));
  assert.equal(r.mode, "url_chat");
  assert.equal(r.url, "google.com");
  assert.equal(r.question, "安全嗎");
});
test("Code2：去武裝寫法 example[.]com 也認得", () => {
  const [r] = run("Code in JavaScript2", webhook("paypal[.]com-secure[.]xyz/login"));
  assert.equal(r.mode, "url");
});
test("Code2：純文字 → chat；空白 → error", () => {
  assert.equal(run("Code in JavaScript2", webhook("什麼是釣魚網站?"))[0].mode, "chat");
  assert.equal(run("Code in JavaScript2", webhook(""))[0].mode, "error");
});

// ── Code in JavaScript19 → Code in JavaScript10：判定完全照投票，AI 不能改判 ──
const api = (votes) => ({
  url: "https://youtube.com/watch?v=_DymcG1A8Kg", votes,
  shap: { xgb: [{ feature: "UF6", value: 0.8 }, { feature: "UF26", value: -0.5 }] },
  shap_meta: { xgb: { feature_inputs: { UF6: 2, UF26: 0 } } },
});
const router = { mode: "url", url: "https://youtube.com/watch?v=_DymcG1A8Kg", account_id: "S0000001", account_name: "測試使用者" };
// 故意模擬 AI 寫錯：把結果說成可疑、建議改密碼
const badAI = { output: JSON.stringify({ conclusion: "判定結果為可疑，模型意見分歧", reasons: [{ sign: "網址路徑層數不尋常", risk: "隱藏真實目的" }, { sign: "使用一般常見的頂級網域", risk: "符合一般網站樣貌" }], note: "請謹慎", suggestions: ["不要點擊連結", "立即修改密碼並啟用兩步驟驗證"] }) };

function urlBranch(votes) {
  const [report] = run("Code in JavaScript19", [{ json: api(votes) }], { "Code in JavaScript2": router, Webhook: {} });
  const [out] = run("Code in JavaScript10", [{ json: badAI }], { "Code in JavaScript19": report, "Code in JavaScript2": router });
  return { report, out };
}
test("1/3 票 → 正常網址，AI 的「可疑」「改密碼」被濾掉", () => {
  const { report, out } = urlBranch({ xgb: 1, lstm: 0, cnn: 0 });
  assert.equal(report.is_malicious, false);
  assert.match(out.output.conclusion, /依多數決判定為正常網址/);
  assert.deepEqual(out.output.suggestions, ["可以正常瀏覽此網址"]);
  assert.ok(out.output.reasons.every((r) => r.sign !== "網址路徑層數不尋常"));
  assert.doesNotMatch(out.text, /可疑|改密碼/);
});
test("2/3 票 → 釣魚網址，第一項建議固定是不要點擊", () => {
  const { report, out } = urlBranch({ xgb: 1, lstm: 1, cnn: 0 });
  assert.equal(report.is_malicious, true);
  assert.match(out.output.conclusion, /依多數決判定為釣魚網址/);
  assert.match(out.output.suggestions[0], /不要點擊此連結/);
});
test("有模型沒結果 → 無法判定", () => {
  const { report, out } = urlBranch({ xgb: 1, lstm: 1 });
  assert.equal(report.verdict_label, "無法判定");
  assert.match(out.output.conclusion, /無法判定/);
  assert.deepEqual(out.output.reasons, []);
});

// ── Code in JavaScript12：網址＋提問的結論只說是／不是 ──
const c20 = (label, rate, signals) => ({ url: "https://a.example/login", final_label: label, vote_rate: rate, signals });
test("Code12：正常網址 → 「不是釣魚網址」，不提模型與票數", () => {
  const [r] = run("Code in JavaScript12", [{ json: badAI }], { "Code in JavaScript20": c20("benign", 1 / 3, ["使用一般常見的頂級網域"]) });
  assert.match(r.output, /^不是釣魚網址/);
  assert.doesNotMatch(r.output, /模型|投票|多數決|可疑/);
});
test("Code12：釣魚網址 → 「是釣魚網址」", () => {
  const [r] = run("Code in JavaScript12", [{ json: badAI }], { "Code in JavaScript20": c20("malicious", 2 / 3, ["網址路徑層數不尋常"]) });
  assert.match(r.output, /^是釣魚網址/);
  assert.match(r.output, /不要點擊此連結/);
});
test("Code12：AI 回空白也不會壞（Structured Output Parser 拿掉後的情況）", () => {
  const [r] = run("Code in JavaScript12", [{ json: { output: "" } }], { "Code in JavaScript20": c20("malicious", 1, ["網址路徑層數不尋常"]) });
  assert.match(r.output, /^是釣魚網址/);
});
