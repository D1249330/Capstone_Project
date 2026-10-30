// 使用 $input.all() 來獲取所有的輸入資料
const allItems = $input.all();

// 檢查是否有資料
if (allItems.length > 0) {
    // 透過 map 提取每一筆資料的 pageContent，並過濾掉沒有內容的項目
    const combinedContent = allItems
        .map(item => item.json?.document?.pageContent) // 提取欄位
        .filter(text => text !== undefined && text !== null && text !== "") // 過濾掉空值
        .join("\n\n---\n\n"); // 用分隔線將它們接起來

    return {
        myFormattedText: combinedContent || "雖然有輸入資料，但找不到 pageContent 欄位"
    };
}

// 沒有資料時的回傳
return { myFormattedText: "無輸入資料" };
