"""
PhishGuard AI - 本機測試伺服器（只用 Python 內建模組，不需要 pip install）

- 開在 http://localhost:8080（8000 被 EverOS 使用）
- GET  任何路徑         → 提供 web/ 資料夾裡的 index.html、app.js、style.css
- POST /predict、/predict/batch → 原封不動轉發到 Render 上的釣魚模型
- POST /analyze  {type, message, url, account_id, account_name}
                        → 轉發到本機 n8n 的 webhook，回傳 {"text": "..."}
                          （account_* 來自網站的模擬登入，缺少時回 401）
- POST /report   回報這次判斷 → 轉發到 N8N_REPORT_WEBHOOK
- POST /content-check {url}  不當資訊檢測 → 轉發到 N8N_CONTENT_WEBHOOK，原樣回傳 JSON

網頁、模型 API、n8n 對瀏覽器來說都是同一個網址（localhost:8080），
所以不會遇到 CORS 問題，n8n 也不用另外設定。

啟動：  python server.py
可選環境變數：
  PHISHGUARD_API   釣魚模型網址（預設 https://n8n-local-model-university.onrender.com）
  N8N_WEBHOOK         網址分析 / 知識問答的 n8n webhook（預設 http://127.0.0.1:5678/webhook/deep-forensics）
  N8N_REPORT_WEBHOOK  回報這次判斷的 n8n webhook（預設 http://127.0.0.1:5678/webhook/phishguard-report）
  N8N_CONTENT_WEBHOOK 不當資訊檢測的 n8n webhook（預設 .../webhook/da65ece8-855c-48aa-9f95-6bec7afc98d1）
  PORT             本機埠號（預設 8080）
"""
import json
import os
import sys
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

API_BASE = os.environ.get(
    "PHISHGUARD_API", "https://n8n-local-model-university.onrender.com"
).rstrip("/")
N8N_WEBHOOK = os.environ.get("N8N_WEBHOOK", "http://127.0.0.1:5678/webhook/deep-forensics")
# 「回報這次判斷」送往的 n8n webhook（和網址分析分開，避免混在同一個流程裡）
N8N_REPORT_WEBHOOK = os.environ.get("N8N_REPORT_WEBHOOK", "http://127.0.0.1:5678/webhook/phishguard-report")
# 「不當資訊」檢測 workflow（Jina/Firecrawl 抓內容 → Gemini 假訊息 + BERT 四類）
N8N_CONTENT_WEBHOOK = os.environ.get(
    "N8N_CONTENT_WEBHOOK", "http://127.0.0.1:5678/webhook/da65ece8-855c-48aa-9f95-6bec7afc98d1")
CONTENT_TIMEOUT_S = 180  # 要抓網頁 + Gemini + BERT，比一般分析久
PORT = int(os.environ.get("PORT", "8080"))
WEB_DIR = Path(__file__).resolve().parent / "web"
PROXY_PATHS = ("/predict", "/predict/batch")
TIMEOUT_S = 90        # Render 免費方案冷啟動可能要 30~60 秒
N8N_TIMEOUT_S = 120   # n8n 裡如果有呼叫 LLM，可能比較久

# 連本機 n8n 時不要經過系統代理
_direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))

# n8n 回傳 JSON 時，依序找這些欄位當作文字訊息
TEXT_KEYS = ("text", "output", "message", "reply", "answer", "content", "result", "response")


def extract_text(raw: bytes, ctype: str) -> str:
    """把 n8n 各種可能的回傳格式統一成一段文字。"""
    s = raw.decode("utf-8", errors="replace").strip()
    if not s:
        return ""
    try:
        data = json.loads(s)
    except ValueError:
        return s  # 純文字回應

    def pick(obj):
        if isinstance(obj, str):
            return obj
        if isinstance(obj, list):
            return "\n\n".join(t for t in (pick(x) for x in obj) if t)
        if isinstance(obj, dict):
            for k in TEXT_KEYS:
                if k in obj and obj[k] not in (None, ""):
                    return pick(obj[k])
            if len(obj) == 1:  # 只有一個欄位，就用那個欄位
                return pick(next(iter(obj.values())))
            return json.dumps(obj, ensure_ascii=False, indent=2)
        return str(obj)

    return pick(data)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    # 開發時不要讓瀏覽器快取舊的 js/css
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _send_json(self, status, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length)

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path in PROXY_PATHS:
            self._proxy_model(path)
        elif path == "/analyze":
            self._proxy_n8n()
        elif path == "/report":
            self._proxy_report()
        elif path == "/content-check":
            self._proxy_content_check()
        else:
            self._send_json(404, {"detail": f"本機伺服器沒有 {path} 這個路徑"})

    # ── Render 釣魚模型：原封不動轉發 ──
    def _proxy_model(self, path):
        req = urllib.request.Request(
            API_BASE + path,
            data=self._read_body(),
            method="POST",
            headers={"Content-Type": "application/json", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                body, status = resp.read(), resp.status
                ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            body, status = e.read(), e.code
            ctype = e.headers.get("Content-Type", "application/json")
        except Exception as e:  # 連不上、逾時
            self.log_message("模型轉發失敗：%s", e)
            self._send_json(502, {"detail": f"無法連線到模型伺服器：{e}"})
            return

        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # ── 本機 n8n：送訊息／網址 + 帳號代碼 + 帳號名稱，回傳文字 ──
    def _proxy_n8n(self):
        try:
            data = json.loads(self._read_body() or b"{}")
            if not isinstance(data, dict):
                data = {}
        except ValueError:
            data = {}

        def field(name, limit):
            v = data.get(name, "")
            return str(v).strip()[:limit] if v is not None else ""

        url = field("url", 2000)
        message = field("message", 2000) or url
        msg_type = field("type", 10) or ("url" if url else "chat")
        if msg_type not in ("url", "chat"):
            msg_type = "chat"
        account_id = field("account_id", 32)
        account_name = field("account_name", 20)

        if not message:
            self._send_json(400, {"detail": "請提供 message 或 url"})
            return
        if not account_id or not account_name:
            self._send_json(401, {"detail": "請先登入（缺少帳號代碼或帳號名稱）"})
            return

        payload = {
            "type": msg_type,          # "url"：使用者貼網址；"chat"：一般文字
            "message": message,        # 使用者輸入的原文（貼網址時就是網址）
            "url": url,                # 只有 type=url 時有值
            "account_id": account_id,
            "account_name": account_name,
        }
        self.log_message("送往 n8n：%s", json.dumps(payload, ensure_ascii=False))
        text = self._post_n8n(N8N_WEBHOOK, payload)
        if text is None:
            return
        self._send_json(200, {"text": text or "（n8n 沒有回傳任何文字）"})

    # ── 共用：POST JSON 到 n8n，成功回傳原始 bytes；失敗時直接回錯誤給前端並回傳 None ──
    def _post_n8n_raw(self, webhook, payload, timeout=N8N_TIMEOUT_S):
        req = urllib.request.Request(
            webhook,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with _direct.open(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", errors="replace")[:300]
            hint = ""
            if e.code == 404:
                hint = f"（找不到 webhook：確認 n8n 的 workflow 已啟用 Active，且路徑是 {webhook}）"
            self.log_message("n8n 回應 %s：%s", e.code, detail)
            self._send_json(502, {"detail": f"n8n 回應錯誤 {e.code}{hint}"})
        except Exception as e:
            self.log_message("n8n 轉發失敗：%s", e)
            self._send_json(502, {"detail": f"連不到 n8n（{webhook}），請確認 n8n 有在執行"})
        return None

    # ── 共用：POST 到 n8n，把回應整理成一段文字 ──
    def _post_n8n(self, webhook, payload):
        raw = self._post_n8n_raw(webhook, payload)
        return None if raw is None else extract_text(raw, "")

    # ── 不當資訊檢測：送網址，原樣回傳 n8n 的 JSON 結果 ──
    def _proxy_content_check(self):
        try:
            data = json.loads(self._read_body() or b"{}")
            if not isinstance(data, dict):
                data = {}
        except ValueError:
            data = {}
        url = str(data.get("url") or "").strip()[:2000]
        account_id = str(data.get("account_id") or "").strip()[:32]
        account_name = str(data.get("account_name") or "").strip()[:20]
        if not url:
            self._send_json(400, {"detail": "請提供 url"})
            return
        if not account_id or not account_name:
            self._send_json(401, {"detail": "請先登入（缺少帳號代碼或帳號名稱）"})
            return

        payload = {"url": url, "account_id": account_id, "account_name": account_name}
        self.log_message("不當資訊檢測送往 n8n：%s", url)
        raw = self._post_n8n_raw(N8N_CONTENT_WEBHOOK, payload, timeout=CONTENT_TIMEOUT_S)
        if raw is None:
            return
        try:
            result = json.loads(raw.decode("utf-8", errors="replace") or "null")
        except ValueError:
            self._send_json(502, {"detail": "n8n 回傳的不是 JSON，請確認最後是 Respond to Webhook 回傳 Final JSON"})
            return
        # Respond to Webhook 設成 All Incoming Items 時會包成陣列，取第一筆
        if isinstance(result, list):
            result = result[0] if result else {}
        if not isinstance(result, dict):
            self._send_json(502, {"detail": "n8n 回傳格式不正確"})
            return
        self._send_json(200, result)

    # ── 回報這次判斷：整理欄位後送到 N8N_REPORT_WEBHOOK ──
    def _proxy_report(self):
        try:
            data = json.loads(self._read_body() or b"{}")
            if not isinstance(data, dict):
                data = {}
        except ValueError:
            data = {}

        def text(name, limit):
            v = data.get(name, "")
            return str(v).strip()[:limit] if v is not None else ""

        def number(name):
            v = data.get(name)
            return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None

        allowed = {"wrong_verdict", "wrong_reason", "wrong_score", "missing_evidence", "other"}
        categories = [c for c in data.get("categories") or [] if c in allowed]
        payload = {
            "type": "report",
            "url": text("url", 2000),
            "predicted": text("predicted", 20),          # 模型判斷：safe / phishing / unknown
            "confidence": number("confidence"),          # 投票比例 0~1（判為釣魚的模型數 / 3）
            "categories": categories,                    # 問題類型代碼
            "category_labels": [str(x)[:30] for x in (data.get("category_labels") or []) if isinstance(x, str)][:5],  # 問題類型中文
            "description": text("description", 500),     # 使用者的詳細描述
            "source": text("source", 30),                # web / web_from_warning
            "account_id": text("account_id", 32),
            "account_name": text("account_name", 20),
            "ts": number("ts"),                          # 回報時間（毫秒）
        }
        if not payload["url"] or not categories:
            self._send_json(400, {"detail": "缺少網址或問題類型"})
            return
        if not payload["account_id"] or not payload["account_name"]:
            self._send_json(401, {"detail": "請先登入（缺少帳號代碼或帳號名稱）"})
            return

        self.log_message("回報送往 n8n：%s", json.dumps(payload, ensure_ascii=False))
        reply = self._post_n8n(N8N_REPORT_WEBHOOK, payload)
        if reply is None:
            return
        self._send_json(200, {"ok": True, "text": reply})


def main():
    if not (WEB_DIR / "index.html").exists():
        sys.exit(f"找不到 {WEB_DIR / 'index.html'}，請確認 web 資料夾和 server.py 放在一起。")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"PhishGuard 本機網站：http://localhost:{PORT}")
    print(f"釣魚模型轉發到：     {API_BASE}")
    print(f"n8n 分析轉發到：     {N8N_WEBHOOK}")
    print(f"n8n 回報轉發到：     {N8N_REPORT_WEBHOOK}")
    print(f"不當資訊檢測轉發到： {N8N_CONTENT_WEBHOOK}")
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
