/* 点击穿透的纯逻辑：主进程与单元测试共用。 */

/** 过滤渲染层上报的命中矩形，最多 max 个。 */
function sanitizeHitboxes(raw, max = 12) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, max)
    .map((box) => {
      if (!box || typeof box !== "object") return null;
      const x = Number(box.x);
      const y = Number(box.y);
      const w = Number(box.w);
      const h = Number(box.h);
      if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
      return { x, y, w, h };
    })
    .filter(Boolean);
}

function pointInBox(point, bounds, box) {
  return (
    point.x >= bounds.x + box.x &&
    point.x <= bounds.x + box.x + box.w &&
    point.y >= bounds.y + box.y &&
    point.y <= bounds.y + box.y + box.h
  );
}

function isInsideAnyHitbox(point, bounds, boxes) {
  if (!point || !bounds || !Array.isArray(boxes) || !boxes.length) return false;
  return boxes.some((box) => pointInBox(point, bounds, box));
}

/** true = 窗口忽略鼠标（点击穿透）。 */
function computeIgnore({ clickThrough, point, bounds, boxes }) {
  if (!clickThrough) return false;
  return !isInsideAnyHitbox(point, bounds, boxes);
}

module.exports = { sanitizeHitboxes, pointInBox, isInsideAnyHitbox, computeIgnore };
