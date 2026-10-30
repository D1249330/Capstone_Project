const results = [];
// 建立中文數字對阿拉伯數字的轉換表
const numMap = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' };

for (const item of $input.all()) {
  // 1. 抓取 Agent 產出的原始文字
  let rawText = item.json.output || "";

  // 2. 雙重保險：先將字面的 '\\n' 強制轉換成真實的 '\n'
  let formattedText = rawText.replace(/\\n/g, '\n');

  // 3. 數字轉換魔法：鎖定「空白 + 第一/第二... + 空白」，替換為「兩個換行符號 + 1. / 2. ...」
  formattedText = formattedText.replace(/[ \s]*第([一二三四五六七八九十]+)[ \s]*/g, (match, p1) => {
    const arabicNum = numMap[p1] || p1; // 若超過十，會保留原字以防呆
    return `\n${arabicNum}. `;
  });

  // 4. HTML 換行魔法：強制將所有 \n 轉為前端看得懂的 <br> 標籤
 // formattedText = formattedText.replace(/\n/g, '<br>');

  // 5. 將整理好的內容，直接打包成前端預期的 JSON 格式
  results.push({
    json: {
      report: formattedText
    }
  });
}

return results;
