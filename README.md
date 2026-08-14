# DSH Hermes 记忆闭环

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（**DSH**）做的 agent 预设 + 插件：给编码 agent 加上 Hermes 式的**跨会话记忆**与**自主学习 skill**能力。

## 能力

- **自动记忆（`memory`）**：跨会话记住你的偏好、环境事实、约定、纠正。**无需说"记住 XX"**——模型每轮主动总结并保存，注入到每次会话的 prompt。
- **自主学习 skill（`skill_manage`）**：把非平凡工作流蒸馏成可复用 skill，跨会话、跨重启持久化并重新注册进技能目录。
- **原生跨会话搜索（`session_search` 等 5 个工具）**：检索历史会话、事件、血缘。
- **Code Mode**：基于 `code` 预设，把多次工具调用合成一个 TypeScript 程序。

## 持久化

记忆与 skill 存到 `~/.dsh/settings.yaml` 的 `hermes-memory` 命名空间（走宿主 `settings` 服务），**跟项目、启动目录都无关**，跨会话、跨重启稳定。

## 文件放置

| 文件 | 放到 |
|---|---|
| `plugin/index.js` | `<DSH checkout>/packages/hermes/hermes/lib/index.js` |
| `preset/agent.cordis.yml` | `~/.dsh/.agent-presets/hermes/agent.cordis.yml` |
| `preset/preset.yml` | `~/.dsh/.agent-presets/hermes/preset.yml` |

⚠️ 两处需按你的机器调整：

1. `plugin/index.js` 里 `import z from '../../../../vendor/schemastery/lib/index.mjs'` 是相对路径，指向 DSH 仓库自带的 vendored schemastery，**依赖文件所在的目录深度**，务必放在 `packages/hermes/hermes/lib/` 这一层。
2. `preset/agent.cordis.yml` 里 `hermes` 行的 `name` 是绝对路径 `D:/deepseek-harness/...`，改成你 DSH checkout 的实际路径。

## 安装

1. 按上表放好文件。
2. 重启 DSH。
3. 会话选择器选「Hermes 记忆闭环」。

## 标签

DSH · agent-preset · memory · skill · deepseek-harness
