/**
 * Speed LLM helper for browser code.
 *
 * Wraps `@ai-sdk/openai-compatible` so React components can call Speed's
 * unified LLM endpoint via the AI SDK core functions (`generateText`,
 * `streamText`, `generateObject`, `streamObject`).
 *
 * Auth (`Authorization: Bearer <jwt>` and `X-Speed-Payer: user`) is injected
 * automatically by the Speed SDK service worker for any request to
 * `speed.llm.baseURL`. No API key is needed in user code.
 *
 * Usage:
 *
 * ```ts
 * import { getSpeedLLMModel } from '../utils/speed-llm'
 * import { streamText } from 'ai'
 *
 * const { textStream } = streamText({
 *   model: getSpeedLLMModel('flash'),
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * })
 * for await (const chunk of textStream) console.log(chunk)
 * ```
 *
 * Two abstract models are exposed:
 * - `'thinking'` — reasoning model (slower, smarter)
 * - `'flash'`    — fast non-reasoning model
 *
 * Vision is auto-detected from message content; no model switch is required.
 */

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export type SpeedLLMModel = 'thinking' | 'flash'

// The Speed SDK initializes `speed.llm.baseURL` synchronously in the main
// thread (from `window.SPEED_CONFIG` + defaults), so we can build the
// provider lazily on first use and reuse it forever.
let provider: ReturnType<typeof createOpenAICompatible> | undefined

/**
 * Returns a Speed-backed chat model handle. Auth is injected by the Speed
 * SDK service worker; no options are required in browser code.
 */
export function getSpeedLLMModel(model: SpeedLLMModel): LanguageModel {
	if (!provider) {
		provider = createOpenAICompatible({
			name: 'speed',
			baseURL: speed.llm.baseURL,
			// Speed authenticates via headers injected by the SDK service worker.
			// The provider still requires a string here.
			apiKey: 'speed',
			includeUsage: true,
		})
	}
	return provider.chatModel(model)
}
