/* 通知内容白名单：避免把超长/奇怪的对象传给系统通知。 */

function sanitizeNotification(payload) {
  if (!payload || typeof payload !== "object") return null;
  const title =
    typeof payload.title === "string" && payload.title.trim() ? payload.title.trim().slice(0, 60) : "doro";
  const body = typeof payload.body === "string" ? payload.body.trim().slice(0, 200) : "";
  if (!body) return null;
  return { title, body };
}

module.exports = { sanitizeNotification };
