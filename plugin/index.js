// Hermes memory + skill learning for the DeepSeek Harness.
//
// User-global persistence through the host `settings` service (a proper
// schemastery schema, stored at ~/.dsh/settings.yaml), so memory and learned
// skills survive restarts and follow the user across projects, sessions and
// launch directories — fully decoupled from the sandbox workspace.
//
// This file is referenced by absolute path from a user agent preset. It is
// hand-written ESM (no TypeScript build). Fully self-contained: the vendored
// schemastery (with its own node_modules) lives in this repository at
// ../vendor/schemastery, so the plugin can sit anywhere on disk and survives
// DeepSeek Harness version updates (no coupling to the harness checkout).

import z from '../vendor/schemastery/lib/index.mjs'

export const name = 'hermes'
export const inject = ['tools', 'systemPrompt']

const MEMORY_LIMIT = 4000 // ~1500 tokens — agent's personal notes
const USER_LIMIT = 1375 // ~500 tokens — user profile
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const schema = z.object({
  memory: z.array(z.string()),
  user: z.array(z.string()),
  skills: z.array(z.object({
    name: z.string(),
    description: z.string(),
    content: z.string(),
  })),
})

export function apply(ctx, config) {
  const settings = ctx.get('settings')
  const skills = ctx.get('skills')

  // Live view. Falls back to in-memory when the settings service is absent.
  let scope
  const live = { memory: [], user: [], skills: [] }
  const disposers = new Map()

  if (settings !== undefined) {
    try {
      scope = settings.register('hermes-memory', schema, { base: { memory: [], user: [], skills: [] } })
      const resolved = scope.get()
      if (Array.isArray(resolved.memory)) live.memory = resolved.memory.filter((x) => typeof x === 'string')
      if (Array.isArray(resolved.user)) live.user = resolved.user.filter((x) => typeof x === 'string')
      if (Array.isArray(resolved.skills)) {
        for (const s of resolved.skills) {
          if (s && typeof s.name === 'string' && NAME_RE.test(s.name) && typeof s.content === 'string') {
            live.skills.push({ name: s.name, description: typeof s.description === 'string' ? s.description : '', content: s.content })
          }
        }
      }
    } catch (error) {
      scope = undefined
    }
  }

  async function persistMemory(memory, user) {
    if (scope === undefined) throw new Error('settings service unavailable; memory is not persisted')
    await scope.update({ memory, user })
  }

  async function persistSkills(skillsArr) {
    if (scope === undefined) throw new Error('settings service unavailable; skills are not persisted')
    await scope.update({ skills: skillsArr.map((s) => ({ name: s.name, description: s.description, content: s.content })) })
  }

  function registerSkill(entry) {
    if (skills === undefined) return
    try {
      disposers.set(entry.name, skills.register({
        name: entry.name,
        description: entry.description,
        source: 'custom',
        content: entry.content,
      }))
    } catch (_) {
      // duplicate or invalid name: kept in settings, not live this session
    }
  }

  for (const entry of live.skills) registerSkill(entry)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'hermes:memory',
    order: 90,
    text: () => {
      const mem = live.memory.filter(Boolean)
      const user = live.user.filter(Boolean)
      const parts = []
      parts.push('AUTOMATIC MEMORY (always on): you maintain this memory yourself, proactively — never wait to be asked. After each turn, if the user expressed a preference, revealed a working style, corrected you, or stated a convention, save it now with the `memory` tool. After finishing a task together, summarize the preferences you observed into compact entries. Prefer target `user` for preferences/communication style; target `memory` for environment/project facts and learned techniques. Forgetting costs repeated corrections; saving is cheap and permanent.')
      if (mem.length > 0) {
        parts.push('════════════ MEMORY (your personal notes) ════════════\n' + mem.join('\n§\n'))
      }
      if (user.length > 0) {
        parts.push('════════════ USER PROFILE ════════════\n' + user.join('\n§\n'))
      }
      parts.push('Distill non-trivial reusable workflows into skills with `skill_manage`; recall past sessions with `session_search`.')
      return parts.join('\n\n')
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'memory',
    description: 'Persistent cross-session memory (agent notes + user profile), injected into your prompt every session. Call this proactively whenever you observe a preference or finish a task — do not wait to be asked. Actions: list, add, replace, remove. Store compact, information-dense facts only — user preferences, environment facts, project conventions, corrections, completed work. Skip trivia, re-discoverable facts, raw data dumps, and one-off ephemera.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'list | add | replace | remove' },
        target: { type: 'string', description: 'memory (agent notes) or user (user profile); defaults to memory' },
        content: { type: 'string', description: 'new entry text (add / replace)' },
        old_text: { type: 'string', description: 'unique substring identifying one existing entry (replace / remove)' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      const action = args.action || 'list'
      const target = args.target === 'user' ? 'user' : 'memory'
      const list = target === 'user' ? live.user : live.memory
      const limit = target === 'user' ? USER_LIMIT : MEMORY_LIMIT
      const joined = () => list.join('\n')
      const usage = () => joined().length + '/' + limit

      if (action === 'list') {
        return JSON.stringify({ success: true, target, entries: list.slice(), usage: usage() })
      }

      if (action === 'add') {
        const content = typeof args.content === 'string' ? args.content.trim() : ''
        if (content === '') return JSON.stringify({ success: false, error: 'content is required for add' })
        if (list.indexOf(content) !== -1) return JSON.stringify({ success: true, note: 'no duplicate added' })
        if (joined().length + content.length > limit) {
          return JSON.stringify({ success: false, error: 'memory at ' + joined().length + '/' + limit + ' chars; adding would exceed the limit. Consolidate with replace/remove first, then retry add.', current_entries: list.slice(), usage: usage() })
        }
        const next = list.slice()
        next.push(content)
        try {
          await persistMemory(target === 'user' ? live.memory : next, target === 'user' ? next : live.user)
        } catch (e) { return JSON.stringify({ success: false, error: 'persist failed: ' + String(e && e.message ? e.message : e) }) }
        list.push(content)
        return JSON.stringify({ success: true, target, added: content, usage: usage() })
      }

      if (action === 'replace' || action === 'remove') {
        const oldText = typeof args.old_text === 'string' ? args.old_text : ''
        if (oldText === '') return JSON.stringify({ success: false, error: 'old_text is required for ' + action })
        const matches = []
        for (let i = 0; i < list.length; i += 1) if (list[i].indexOf(oldText) !== -1) matches.push(i)
        if (matches.length === 0) return JSON.stringify({ success: false, error: 'no entry contains old_text "' + oldText + '"' })
        if (matches.length > 1) return JSON.stringify({ success: false, error: 'old_text matches ' + matches.length + ' entries; provide a more specific substring' })

        const idx = matches[0]
        if (action === 'remove') {
          const next = list.slice()
          const removed = next.splice(idx, 1)[0]
          try {
            await persistMemory(target === 'user' ? live.memory : next, target === 'user' ? next : live.user)
          } catch (e) { return JSON.stringify({ success: false, error: 'persist failed: ' + String(e && e.message ? e.message : e) }) }
          list.splice(idx, 1)
          return JSON.stringify({ success: true, target, removed, usage: usage() })
        }

        const content = typeof args.content === 'string' ? args.content.trim() : ''
        if (content === '') return JSON.stringify({ success: false, error: 'content is required for replace' })
        const after = list.slice()
        after[idx] = content
        if (after.join('\n').length > limit) {
          return JSON.stringify({ success: false, error: 'replacement would exceed the ' + limit + '-char limit; shorten content or remove another entry', current_entries: list.slice(), usage: usage() })
        }
        const before = list[idx]
        const next = list.slice()
        next[idx] = content
        try {
          await persistMemory(target === 'user' ? live.memory : next, target === 'user' ? next : live.user)
        } catch (e) { return JSON.stringify({ success: false, error: 'persist failed: ' + String(e && e.message ? e.message : e) }) }
        list[idx] = content
        return JSON.stringify({ success: true, target, replaced: before, with: content, usage: usage() })
      }

      return JSON.stringify({ success: false, error: 'unknown action "' + action + '"' })
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'skill_manage',
    description: 'Author, update and delete your own reusable skills (procedural memory), persisted user-globally. Create a skill after completing a non-trivial workflow (5+ tool calls), after hitting dead ends and finding the working path, or after a user corrects your approach. `content` is the full SKILL.md-style markdown body with sections such as "When to Use", "Procedure", "Pitfalls", "Verification". Actions: create, patch, delete, list.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'create | patch | delete | list' },
        name: { type: 'string', description: 'kebab-case skill name' },
        description: { type: 'string', description: 'one-line routing description (create)' },
        content: { type: 'string', description: 'full skill markdown body (create), or replacement text (patch)' },
        old_string: { type: 'string', description: 'exact substring to replace (patch)' },
      },
      additionalProperties: false,
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    execute: async (args) => {
      const action = args.action || 'list'

      if (action === 'list') {
        return JSON.stringify({ skills: live.skills.map((s) => ({ name: s.name, description: s.description })) }, null, 2)
      }

      if (action === 'create') {
        const name = typeof args.name === 'string' ? args.name : ''
        const content = typeof args.content === 'string' ? args.content : ''
        if (!NAME_RE.test(name)) return JSON.stringify({ success: false, error: 'name must be kebab-case: [a-z0-9]+(-[a-z0-9]+)*' })
        if (content.trim() === '') return JSON.stringify({ success: false, error: 'content is required for create' })
        if (live.skills.some((s) => s.name === name)) return JSON.stringify({ success: false, error: 'skill "' + name + '" already exists; use patch or delete first' })
        const entry = { name, description: typeof args.description === 'string' ? args.description : '', content }
        const next = live.skills.slice()
        next.push(entry)
        try { await persistSkills(next) } catch (e) { return JSON.stringify({ success: false, error: 'persist failed: ' + String(e && e.message ? e.message : e) }) }
        live.skills.push(entry)
        registerSkill(entry)
        return JSON.stringify({ success: true, created: name })
      }

      if (action === 'patch') {
        const name = typeof args.name === 'string' ? args.name : ''
        const oldStr = typeof args.old_string === 'string' ? args.old_string : ''
        const content = typeof args.content === 'string' ? args.content : ''
        const entry = live.skills.find((s) => s.name === name)
        if (entry === undefined) return JSON.stringify({ success: false, error: 'no skill "' + name + '"' })
        if (oldStr === '') return JSON.stringify({ success: false, error: 'old_string is required for patch' })
        if (entry.content.indexOf(oldStr) === -1) return JSON.stringify({ success: false, error: 'old_string not found in skill "' + name + '"' })
        const newContent = entry.content.replace(oldStr, content)
        const next = live.skills.map((s) => s === entry ? { name: s.name, description: s.description, content: newContent } : s)
        try { await persistSkills(next) } catch (e) { return JSON.stringify({ success: false, error: 'persist failed: ' + String(e && e.message ? e.message : e) }) }
        entry.content = newContent
        const oldDisposer = disposers.get(name)
        if (typeof oldDisposer === 'function') { try { oldDisposer() } catch (_) { /* already disposed */ } disposers.delete(name) }
        registerSkill(entry)
        return JSON.stringify({ success: true, patched: name })
      }

      if (action === 'delete') {
        const name = typeof args.name === 'string' ? args.name : ''
        const idx = live.skills.findIndex((s) => s.name === name)
        if (idx === -1) return JSON.stringify({ success: false, error: 'no skill "' + name + '"' })
        const next = live.skills.filter((s, i) => i !== idx)
        try { await persistSkills(next) } catch (e) { return JSON.stringify({ success: false, error: 'persist failed: ' + String(e && e.message ? e.message : e) }) }
        live.skills.splice(idx, 1)
        const oldDisposer = disposers.get(name)
        if (typeof oldDisposer === 'function') { try { oldDisposer() } catch (_) { /* already disposed */ } disposers.delete(name) }
        return JSON.stringify({ success: true, deleted: name })
      }

      return JSON.stringify({ success: false, error: 'unknown action "' + action + '"' })
    },
  }))
}
