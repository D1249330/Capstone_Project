// 取出網站送來的回報（都在 body 裡）
const b = $input.first().json.body || {};

const VERDICT = { safe: '安全', suspicious: '可疑', phishing: '釣魚網站' };
const prob = typeof b.confidence === 'number' ? b.confidence : null;
const ts = typeof b.ts === 'number' ? b.ts : Date.now();

// 整理成一筆回報紀錄
const record = {
  reported_at:     new Date(ts).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }),
  account_id:      b.account_id   || '',
  account_name:    b.account_name || '',
  url:             b.url || '',
  predicted:       b.predicted || '',                                    // safe / suspicious / phishing
  predicted_label: VERDICT[b.predicted] || b.predicted || '',           // 中文判斷
  phishing_prob:   prob === null ? '' : `${Math.round(prob * 100)}%`,   // 模型給的釣魚機率
  categories:      (b.categories || []).join(','),                       // 問題代碼
  category_labels: (b.category_labels || []).join('、'),                 // 問題類型中文
  description:     b.description || '',
  source:          b.source === 'web_from_warning' ? '警告頁轉入' : '網站檢測',
};

// 整筆紀錄轉成一行 JSON 再轉 base64，給 Execute Command 安全地寫進檔案
const b64 = Buffer.from(JSON.stringify(record), 'utf8').toString('base64');

return [{
  json: { ...record, b64 },
}];
