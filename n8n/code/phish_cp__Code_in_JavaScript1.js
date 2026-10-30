// 執行你的迴圈邏輯
for (const item of $input.all()) {
  item.json.myNewField = 1;
}

// 捨棄原本的 $input.all()，直接回傳一個包含 "finish" 的新項目
return [{
  json: {
    status: "finish"
  }
}];
