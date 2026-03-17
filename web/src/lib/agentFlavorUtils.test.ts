import { describe, expect, it } from 'vitest'

import { toSessionAgentSearch } from './agentFlavorUtils'

describe('toSessionAgentSearch', () => {
    it('keeps the selected agent', () => {
        expect(toSessionAgentSearch('codex')).toEqual({ agent: 'codex' })
    })
})
