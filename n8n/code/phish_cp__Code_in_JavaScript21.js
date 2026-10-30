return $input.all().map(item => {
  const j = item.json;

  // 依上一個節點的 mode 組出問題：
  //   chat     → text（例如「HTTPS 一定安全嗎?」）
  //   url      → url
  //   url_chat → url + question
  // 加上預設值防呆，避免印出 "undefined"
  const url = j.url || '';
  const question = j.mode === 'chat'
    ? (j.text || '')
    : `${url} ${j.question || ''}`.trim();

  return {
    json: {
      question,
      account_id:   j.account_id   || '',
      account_name: j.account_name || '',
    }
  };
});
