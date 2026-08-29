export async function sendTelegram(token: string | undefined, chatId: string | undefined, message: string) {
  if (!token || !chatId) return { skipped: true };
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true })
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
  return { skipped: false };
}
