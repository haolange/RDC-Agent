# RDC-Agent UI / Design System

权威来源（按优先级）：

1. [`DESIGN.md`](../../DESIGN.md) — 产品边界与不变量裁决
2. [`workbench-and-transcript.md`](workbench-and-transcript.md) — Workbench / Composer Effort / transcript 产品规格
3. [`AGENTS.md`](../../AGENTS.md) — token / 按钮 / Appearance 执行纪律
4. [`src/renderer/styles/design-system.css`](../../src/renderer/styles/design-system.css) — primitive + semantic token 定义
5. [`src/shared/theme/`](../../src/shared/theme/) — preset catalog、`ThemeChromeCompiler`、`rdx-theme-v1`、compose accent 派生
6. [`designs/rdc-agent-design-system/Design System Preview.html`](../../designs/rdc-agent-design-system/Design%20System%20Preview.html) — 可交互预览

## 双体系（摘要）

| 体系 | 数据 | 作用域 |
|------|------|--------|
| 全局 Appearance | `appearance.theme` + `chromeThemes.light\|dark` | Shell、Settings、transcript、全局 CTA/focus |
| Compose Agent | `.agent.md` `accent` → `--composer-mode-accent` / `--composer-effort-*` | Composer 边框流光、泛光、mode pill、send、Effort/Max |

- Light/Dark（含 system）影响两套体系的亮度调制。
- 不提供 translucent sidebar。
- 主题分享格式：`rdx-theme-v1:`（拒绝 `codex-theme-v1:`）。
- 预设：RDC（默认）+ Absolutely / Ayu / Catppuccin / Dracula / Everforest / GitHub / Gruvbox / Linear。

## CSS 入口

- 唯一全局入口：`src/renderer/main.tsx` → `styles/global.css` → `design-system.css`。
- 禁止恢复 `styles/tokens/*` 或未接线的 `oklch-themes.css`。

## 验证

```bash
pnpm run check:appearance
pnpm run typecheck
```

浏览器真实会话覆盖 Settings → Appearance、agent accent、Light/Dark、Compose Effort 染色边界（见 `AGENTS.md`）。
