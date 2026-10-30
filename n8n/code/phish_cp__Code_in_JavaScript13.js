const results = [];

for (const item of $input.all()) {
  // 1. 指定你想挑出的欄位名稱 (例如 "summary_report")
  const targetField = item.json.summary_report;

  // 2. 將它包裝成一個全新的乾淨 JSON 物件
  results.push({
    json: {
      // 這裡可以自訂輸出的欄位名稱，例如叫 extracted_data
      extracted_data: targetField 
    }
  });
}

return results;
