/**
 * 马克一号 · 看板样式。
 *
 * 只用手写的类名（不用 CSS Modules，也不需要构建步骤）：所有规则挂在 `.mark1-*`
 * 前缀下，正好嵌进右栏 tab 里，不污染宿主其它区域。
 * 颜色/圆角尽量走 DSH 的设计 token，深浅色主题自动跟随。
 *
 * @module mark1/client/styles
 */

/** ⚠ 这段 CSS 会被原样塞进 <style>。 */
export const CSS = `
.mark1-root {
  --mark1-gap: 8px;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-primary);
}
.mark1-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: .5px solid var(--dsw-alias-border-l1);
  flex: none;
}
.mark1-bar-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.mark1-bar-name {
  font-weight: 600;
  white-space: nowrap;
}
.mark1-bar-sub {
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  cursor: pointer;
}
.mark1-icon-btn:hover:not(:disabled) {
  background: var(--dsw-alias-fill-l1);
  color: var(--dsw-alias-label-primary);
}
.mark1-icon-btn:disabled { opacity: .45; cursor: default; }
.mark1-icon-btn[aria-pressed="true"] { background: var(--dsw-alias-fill-l2); color: var(--dsw-alias-label-primary); }
.mark1-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mark1-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-top: 2px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 16px;
  letter-spacing: .02em;
}
.mark1-meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-fill-l1);
}
.mark1-meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}
.mark1-meta-key {
  flex: none;
  width: 62px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
}
.mark1-meta-value {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
}
.mark1-mono {
  font-family: var(--dsw-font-mono);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-link {
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  cursor: pointer;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-link:hover { text-decoration: underline; }
.mark1-card {
  border: .5px solid var(--dsw-alias-border-l1);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-fill-l1);
  overflow: hidden;
}
.mark1-card[data-state="active"] { border-color: color-mix(in srgb, var(--dsw-alias-label-primary) 22%, transparent); }
.mark1-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border: 0;
  background: transparent;
  width: 100%;
  text-align: left;
  color: inherit;
  font: inherit;
}
.mark1-card-head:hover { background: var(--dsw-alias-fill-l2); }
.mark1-card-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.mark1-card-title {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.mark1-card-title-text {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mark1-card-sub {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  min-width: 0;
}
.mark1-tag {
  flex: none;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-secondary);
  padding: 0 5px;
  font-size: 10px;
  line-height: 16px;
  white-space: nowrap;
}
.mark1-tag-scene { background: color-mix(in srgb, var(--dsw-alias-label-primary) 10%, transparent); }
.mark1-chevron { flex: none; color: var(--dsw-alias-label-tertiary); transition: transform .12s; }
.mark1-chevron[data-open="true"] { transform: rotate(90deg); }
.mark1-card-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
  border-top: .5px solid var(--dsw-alias-border-l1);
  padding-top: 8px;
}
.mark1-report {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mark1-report-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--dsw-alias-label-secondary);
}
.mark1-report-next { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.mark1-report-missing {
  margin: 0;
  color: var(--dsw-alias-label-tertiary);
  font-style: italic;
}
.mark1-files {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.mark1-file {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}
.mark1-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.mark1-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-specific-menu, transparent);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  cursor: pointer;
}
.mark1-action:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-fill-l2);
}
.mark1-action:disabled { opacity: .45; cursor: default; }
.mark1-action[data-tone="danger"]:hover:not(:disabled),
.mark1-action[data-tone="danger"] {
  color: var(--dsw-alias-state-error-primary);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 40%, transparent);
}
.mark1-action[data-armed="true"] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);
}
.mark1-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-l1);
}
.mark1-tab {
  padding: 1px 8px;
  border: 0;
  border-radius: var(--dsw-radius-xs);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 18px;
  cursor: pointer;
}
.mark1-tab[aria-pressed="true"] {
  background: var(--dsw-specific-menu, var(--dsw-alias-fill-l2));
  color: var(--dsw-alias-label-primary);
}
.mark1-md {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  padding: 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-secondary);
  font-family: var(--dsw-font-mono);
  font-size: 11px;
  line-height: 17px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.mark1-inline-input {
  width: 100%;
  box-sizing: border-box;
  min-height: 56px;
  padding: 6px 8px;
  border: .5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-fill-l2);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  resize: vertical;
}
.mark1-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 16px 12px;
  border: .5px dashed var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  color: var(--dsw-alias-label-tertiary);
}
.mark1-empty-title { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.mark1-error {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent);
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
}
.mark1-scene-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-top: .5px solid var(--dsw-alias-border-l1);
}
.mark1-scene-row:first-of-type { border-top: 0; }
.mark1-scene-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.mark1-scene-name { color: var(--dsw-alias-label-primary); }
.mark1-scene-desc { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
`

/**
 * 给样式文件一个短类名。
 * @param {string} name - 语义名。
 * @returns {string} class 名。
 */
export function c(name) {
  return `mark1-${name}`
}
