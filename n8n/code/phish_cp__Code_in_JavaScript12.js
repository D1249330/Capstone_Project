// AI Agent8 之後的整理節點（網址＋提問）：判定結果完全照三模型投票，不讓 AI 改判
// 結論由程式依 Code in JavaScript20 的投票結果產生；AI 只負責說明跡象、回答提問與建議
// AI 的回答可能是物件（有 Structured Output Parser）或一段 JSON 文字（沒有 Parser），兩種都接受；
// 空白或格式錯誤時當作沒有回答，結論仍照投票產生
function parseAnswer(value) {
  if (value && typeof value === 'object') return value;
  let s = String(value || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { /* 解析失敗 */ }
  }
  return {};
}
const d = parseAnswer($json.output ?? $json.text);

// 1. 投票結果（Code in JavaScript20 的輸出）
let vote = {};
try { vote = $('Code in JavaScript20').first().json; } catch (e) { /* 找不到節點時略過 */ }
const label = vote.final_label;                       // "malicious" / "benign" / null
const decided = label === 'malicious' || label === 'benign';
const isPhish = label === 'malicious';
// 結論只說是不是釣魚網址，不提模型票數
const conclusion = !decided
  ? '本次無法判定'
  : (isPhish ? '是釣魚網址' : '不是釣魚網址');

// 2. 本機或內部位址
const url = String(vote.url || '');
let host = '';
try { host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`).hostname; } catch (e) {}
const isInternal =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
  /\.(local|internal)$/.test(host);

// 3. 簡轉繁、去符號、去重複詞
const s2t = {风:'風',险:'險',较:'較',这:'這',个:'個',为:'為',网:'網',络:'絡',数:'數',据:'據',设:'設',计:'計',码:'碼',访:'訪',问:'問',联:'聯',银:'銀',帐:'帳',户:'戶',号:'號',认:'認',证:'證',页:'頁',点:'點',击:'擊',链:'鏈',输:'輸',资:'資',讯:'訊',统:'統',们:'們',请:'請',时:'時',实:'實',骗:'騙',诈:'詐',钓:'釣',鱼:'魚',测:'測',检:'檢',应:'應',该:'該',进:'進',过:'過',还:'還',会:'會',对:'對',无:'無',与:'與',结:'結',论:'論'};
const clean = s => String(s || '')
  .replace(/[一-鿿]/g, c => s2t[c] || c)
  .replace(/[^\p{L}\p{N}\s　]/gu, '　')
  .replace(/[ 　]+/g, '　')
  .replace(/(\S+)(　\1)+/g, '$1')
  .trim();

// 4. 判斷依據只能是報告裡、和判定方向一致的跡象
const allowed = (vote.signals || []).map(clean);
const allowedSet = new Set(allowed);
let reasons = (d.reasons || [])
  .map(r => ({ sign: clean(r && r.sign), risk: clean(r && r.risk) }))
  .filter(r => allowedSet.has(r.sign));
if (!reasons.length) reasons = allowed.map(s => ({ sign: s, risk: '' }));

let suggestions = (d.suggestions || []).map(clean).filter(Boolean);
let note = clean(d.note);

// 和「正常」判定相反的字眼，判為正常時一律濾掉
const HEDGE = /可疑|不確定|分歧|疑慮|謹慎|小心|留意|注意|真偽|確認網站|誤判|風險|釣魚|惡意|詐騙|不要點擊|勿點擊|不要輸入|勿輸入|避免開啟|封鎖/;

if (!decided) {
  reasons = [];
  note = '';
  suggestions = ['請稍後重新檢測'];
} else if (isPhish) {
  const first = '不要點擊此連結　也不要輸入任何帳號　密碼或個人資料';
  // 判為釣魚：第一項固定是不要點擊，並拿掉「可以正常使用」這類和判定相反的建議
  suggestions = [first, ...suggestions.filter(s => !/不要點擊|勿點擊|正常使用|正常瀏覽|可以放心|安全無虞/.test(s))];
  if (/正常網址|可以放心|安全無虞/.test(note)) note = '';
} else {
  reasons = reasons.map(r => (HEDGE.test(r.risk) ? { sign: r.sign, risk: '' } : r));
  // 建議與提醒固定，不用 AI 寫的（AI 常會加上「停止操作」「修改密碼」這類和判定相反的內容）
  suggestions = ['可以正常瀏覽此網址'];
  note = '';
}

// 不提模型、投票、多數決
const VOTE_TALK = /模型|投票|多數決|票/;
reasons = reasons.map(r => (VOTE_TALK.test(r.risk) ? { sign: r.sign, risk: '' } : r));
suggestions = suggestions.filter(s => !VOTE_TALK.test(s));
if (VOTE_TALK.test(note)) note = '';
if (!suggestions.length) suggestions = [isPhish ? '不要點擊此連結　也不要輸入任何帳號　密碼或個人資料' : '可以正常瀏覽此網址'];

// 內部位址只補充說明，不改變投票結果
if (isInternal) note = '此網址為本機或內部網路位址　只能在您自己的電腦或公司內部開啟';

// 5. 組合：結論 → 連續編號的分析與建議 → 最後提醒
const lines = [conclusion, '分析與建議'];
let n = 1;
for (const r of reasons) lines.push(`${n++}. ${r.sign}${r.risk ? `　${r.risk}` : ''}`);
for (const s of suggestions.slice(0, 4)) lines.push(`${n++}. ${s}`);
if (note) lines.push(note);

return { json: { output: lines.join('\n') } };
