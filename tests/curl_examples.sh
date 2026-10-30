#!/usr/bin/env bash
# 各服務的驗證指令。逐段執行，或整份跑：bash tests/curl_examples.sh
# 需要先啟動：Render（自動）、本機模型服務 :8001、n8n :5678、server.py :8080
set -u
RENDER=${PHISHGUARD_API:-https://n8n-local-model-university.onrender.com}
LOCAL_MODEL=${LOCAL_MODEL:-http://localhost:8001}
SERVER=${SERVER:-http://localhost:8080}
N8N=${N8N:-http://localhost:5678}

echo "== 1. Render 模型 API：確認三個模型都載入、版本正確（第一次可能要等 30–60 秒喚醒）"
curl -s "$RENDER/health"; echo

echo "== 2. Render：單一網址（www. 會先拿掉，再照規格前處理）"
curl -s -X POST "$RENDER/predict" -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=_DymcG1A8Kg"}'; echo

echo "== 3. Render：批次（最多 20 個）"
curl -s -X POST "$RENDER/predict/batch" -H 'Content-Type: application/json' \
  -d '{"urls":["google.com","https://paypa1-secure-login.verify-account.xyz/signin.php"]}'; echo

echo "== 4. 本機模型服務 :8001（n8n 呼叫的那一個）：分數應和 Render 相同"
curl -s -X POST "$LOCAL_MODEL/predict" -H 'Content-Type: application/json' \
  -d '{"url":"https://youtube.com/watch?v=_DymcG1A8Kg"}'; echo

echo "== 5. server.py 轉發到 Render"
curl -s -X POST "$SERVER/predict" -H 'Content-Type: application/json' \
  -d '{"url":"google.com"}'; echo

echo "== 6. server.py → n8n 網址分析（沒有帳號會回 401）"
curl -s -o /dev/null -w "沒帶帳號 → HTTP %{http_code}\n" -X POST "$SERVER/analyze" \
  -H 'Content-Type: application/json' -d '{"type":"url","message":"google.com","url":"google.com"}'
curl -s -X POST "$SERVER/analyze" -H 'Content-Type: application/json' \
  -d '{"type":"url","message":"https://www.youtube.com/watch?v=_DymcG1A8Kg","url":"https://www.youtube.com/watch?v=_DymcG1A8Kg","account_id":"S0000001","account_name":"測試使用者"}'; echo

echo "== 7. server.py → n8n 網址＋提問"
curl -s -X POST "$SERVER/analyze" -H 'Content-Type: application/json' \
  -d '{"type":"chat","message":"https://youtube.com/watch?v=_DymcG1A8Kg 是釣魚網站嗎?","url":"","account_id":"S0000001","account_name":"測試使用者"}'; echo

echo "== 8. 直接打 n8n webhook（不經 server.py）"
curl -s -X POST "$N8N/webhook/deep-forensics" -H 'Content-Type: application/json' \
  -d '{"type":"chat","message":"什麼是釣魚網站?","account_id":"S0000001","account_name":"測試使用者"}'; echo

echo "== 9. 回報紀錄：送一筆後到 local_files/reports/phishing_reports.jsonl 確認多一行"
curl -s -X POST "$SERVER/report" -H 'Content-Type: application/json' \
  -d '{"url":"google.com","predicted":"safe","confidence":0,"categories":["wrong_verdict"],"description":"測試回報","source":"web","account_id":"S0000001","account_name":"測試使用者","ts":0}'; echo
