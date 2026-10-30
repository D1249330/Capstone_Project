// PhishGuard 網址檢測報告：對應新版模型 API（LSTM + CNN + XGBoost 投票，SHAP 只有 XGBoost）
// 放在 n8n Code 節點（Mode: Run Once for All Items）
// summary_report 只用白話文字：不出現特徵代號、分數或強度標籤
// 判定完全依照 0805_three_model_workflow.md 的三模型硬投票：至少 2 個模型判為 1 才是惡意，
// 任一模型沒有結果就不判定；不使用 final_score（平均機率）或信心度

// 1. 依特徵實際值產生白話描述（規則對應 transfer.py）
//    v：特徵實際值；s：該特徵的 SHAP 值（正 = 推向惡意，負 = 推向安全）
//    回傳 [描述, 是否屬於可疑描述]；描述與模型方向不一致時不列入報告，避免「正常跡象：子網域層數偏多」這類矛盾
const R = t => [t, true];   // 可疑描述
const N = t => [t, false];  // 正常描述
function phrase(f, v, s) {
    v = Number(v);
    switch (f) {
        case "UF2":  return v >= 1 ? R("子網域層數過多") : (v >= 0.5 ? R("子網域層數偏多") : N("子網域層數正常"));
        case "UF3":  return v >= 1 ? R("直接使用 IP 位址而非網域名稱") : N("使用一般網域名稱而非 IP 位址");
        case "UF4":  return v >= 1 ? R("網址含有 @ 符號，可能用來隱藏真實目的地") : N("網址沒有 @ 重新導向符號");
        case "UF5":  return v >= 1 ? R("網址長度過長") : (v >= 0.5 ? R("網址長度偏長") : N("網址長度正常"));
        case "UF6":  return v === 0 ? N("網址沒有額外路徑，直接指向網站首頁") : (s > 0 ? R("網址路徑層數不尋常") : N("網址路徑結構正常"));
        case "UF8":  return v >= 1 ? R("主機名稱夾帶 http 字樣，疑似偽裝") : N("主機名稱沒有夾帶 http 字樣");
        case "UF10": return v >= 1 ? R("使用短網址服務，無法直接看出真實目的地") : N("沒有使用短網址服務");
        case "UF11": return v >= 1 ? R("網域名稱含有連字號") : N("網域名稱沒有連字號");
        case "UF12": return v >= 1 ? R("網址含有登入、驗證、帳戶等敏感字眼") : N("網址沒有登入、驗證等敏感字眼");
        case "UF13": return v >= 1 ? R("網址中出現知名品牌名稱") : N("網址中沒有出現知名品牌名稱");
        case "UF14": return v >= 1 ? R("網址含有大寫字母") : N("網址沒有大寫字母");
        case "UF15": return v >= 1 ? R("網址中的點號偏多") : N("網址中的點號數量正常");
        case "UF16": return v >= 2 ? R("網址字元組成接近隨機亂碼") : (v >= 1 ? R("網址字元組成略顯複雜") : N("網址字元組成規律，不像隨機字串"));
        case "UF17": return v >= 2 ? R("網址帶有大量查詢參數") : (v >= 1 ? N("網址只帶有少量查詢參數") : N("網址沒有查詢參數"));
        case "UF18": return v >= 1 ? R("網址含有編碼字元，可能用來混淆內容") : N("網址沒有編碼字元");
        case "UF19": return s > 0 ? R("網址中某些字元重複出現的情況不尋常") : N("網址字元重複程度正常");
        case "UF20": return v >= 1 ? R("品牌名稱只出現在子網域，疑似冒用知名品牌") : N("沒有在子網域冒用品牌名稱");
        case "UF21": return v >= 1 ? N("品牌名稱就在註冊網域本身，較可能是官方網站") : R("註冊網域本身不是知名品牌");
        case "UF22": return s > 0 ? R("註冊網域名稱的長度不尋常") : N("註冊網域名稱的長度正常");
        case "UF23": return v >= 2 ? R("註冊網域名稱組成複雜，接近隨機字串") : (v >= 1 ? N("註冊網域名稱組成一般") : N("註冊網域名稱組成單純"));
        case "UF24": return v >= 1 ? R("架設在免費託管或免費架站平台上") : N("沒有使用免費託管或架站平台");
        case "UF25": return v >= 1 ? R("網域含有雲端基礎設施或 CDN 相關字樣") : N("網域沒有雲端基礎設施相關字樣");
        case "UF26": return v >= 1 ? R("使用高風險的頂級網域（如 .xyz、.top）") : N("使用一般常見的頂級網域");
        default:     return null;
    }
}

const MODEL_NAME = { lstm: "LSTM", cnn: "CNN", xgb: "XGBoost" };
const CN_NUM = ["零", "一", "兩", "三", "四", "五"];
const cn = n => CN_NUM[n] ?? String(n);

// 2. 追溯原始使用者提問（與原本相同）
let user_chat_input = null;
let user_question = null;
try {
    const routerData = $('Code in JavaScript2')?.first()?.json || $('Code')?.first()?.json || {};
    user_question = routerData.question || routerData.text || null;
    const webhookData = $('Webhook')?.first()?.json?.body || $('Webhook')?.first()?.json || {};
    user_chat_input = webhookData.chatInput || webhookData.url || user_question;
} catch (e) { /* 找不到節點時改用網址 */ }

return $input.all().map(({ json: item = {} }) => {
    // 3. 基礎數據：判定只看三個模型的 0/1 投票（0805 文件第 8 節）
    const target_url = item.url || "Unknown";
    const votes = item.votes || {};
    const n_models = Object.keys(votes).length;
    const mal_keys = Object.keys(votes).filter(k => votes[k] === 1);
    const ben_keys = Object.keys(votes).filter(k => votes[k] === 0);
    const n_mal = mal_keys.length;
    const is_malicious = n_models === 3 && n_mal >= 2;
    const vote_rate = n_models === 3 ? Math.round(n_mal / 3 * 10000) / 10000 : null;  // 文件的 y_prob
    const final_score = item.final_score != null ? Number(item.final_score) : null;   // 僅保留供參考，不參與判定
    const confidence = item.confidence != null ? Number(item.confidence) : null;
    const agreement = item.agreement != null ? Number(item.agreement) : null;
    const names = keys => keys.map(k => MODEL_NAME[k] || k).join("、");

    // 4. 判定：完全依照 0805 文件的三模型硬投票（至少 2 票才是惡意）
    let risk_level, verdict, advice;
    if (n_models < 3) {
        risk_level = "❔ 無法判定";
        verdict = "有模型沒有產生結果，依規則不做判定。";
        advice = "請確認模型服務狀態後重新檢測。";
    } else if (n_mal === 3) {
        risk_level = "🚨 極高風險";
        verdict = "三個模型都判定為釣魚或惡意網址。";
        advice = "請勿點擊此網址，也不要在該頁面輸入任何帳號、密碼或個人資料，建議直接封鎖。";
    } else if (n_mal === 2) {
        risk_level = "⚠️ 高風險";
        verdict = "多數模型判定為釣魚或惡意網址。";
        advice = "請勿點擊此網址，也不要在該頁面輸入任何帳號、密碼或個人資料。";
    } else {
        // 0 票或 1 票：多數決為正常，完全照投票結果，不再加「可疑」「謹慎」等字眼
        risk_level = "🛡️ 安全正常";
        verdict = "依三個模型的投票結果，判定為正常網址。";
        advice = "可以正常瀏覽此網址。";
    }

    // 5. 模型共識（文字）：只寫票數與多數決結果，不點名哪個模型持不同意見
    const verdict_label = n_models < 3 ? "無法判定" : (is_malicious ? "釣魚網址" : "正常網址");
    const consensus = n_models < 3
        ? "沒有完成三個模型的檢測。"
        : `三個模型中有${cn(n_mal)}個判為惡意，依多數決判定為${verdict_label}。`;

    // 6. XGBoost SHAP → 可疑跡象 / 正常跡象（白話）
    const xgb_list = (item.shap && (item.shap.xgb || item.shap.xgboost)) || [];
    const inputs = (item.shap_meta && item.shap_meta.xgb && item.shap_meta.xgb.feature_inputs) || {};
    const sorted_xgb = xgb_list.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const described = sorted_xgb
        .filter(x => inputs[x.feature] !== undefined && Math.abs(x.value) >= 0.3)
        .map(x => ({ v: Number(x.value), p: phrase(x.feature, inputs[x.feature], Number(x.value)) }))
        .filter(x => x.p);
    // 可疑跡象：模型推向惡意，且描述本身是可疑的；正常跡象反之
    const risk_signals = [...new Set(described.filter(x => x.v > 0 && x.p[1]).map(x => x.p[0]))].slice(0, 4);
    const safe_signals = [...new Set(described.filter(x => x.v < 0 && !x.p[1]).map(x => x.p[0]))].slice(0, 4);
    const bullet = arr => arr.length ? arr.map(t => `- ${t}`).join("\n") : "- 無明顯跡象";

    // 7. 組裝報告（純文字說明）
    // 只列出和判定方向一致的跡象：判為釣魚列可疑跡象，判為正常列正常跡象
    const xgb_section = sorted_xgb.length ? (is_malicious ? `
**可疑跡象：**
${bullet(risk_signals)}
` : `
**正常跡象：**
${bullet(safe_signals)}
`) : `
**網址結構分析：** 本次未執行網址結構分析。
`;

    const full_summary_report = `
### 🛡️ PhishGuard 網址檢測報告

**檢測網址：** \`${target_url}\`

**判定結果：** ${risk_level}｜${verdict}

**模型共識：** ${consensus}
${xgb_section}
**建議：** ${advice}
`.trim();

    // 8. 輸出（數值欄位保留在報告外，供後續節點判斷使用）
    return {
        json: {
            url: target_url,
            is_malicious,
            verdict_label,
            n_mal,
            n_models,
            risk_level,
            verdict,
            advice,
            risk_signals,
            safe_signals,
            final_score,
            confidence,
            vote_rate,
            agreement,
            summary_report: full_summary_report,
            chatInput: user_chat_input || target_url,
            question: user_question || target_url,
            raw_api_data: item,
        },
    };
});
