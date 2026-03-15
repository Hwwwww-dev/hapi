import { describe, expect, it } from 'vitest'

import { toSessionAgentSearch } from './agentFlavorUtils'

describe('toSessionAgentSearch', () => {
    it('keeps the selected agent when not all', () => {
        expect(toSessionAgentSearch('codex')).toEqual({ agent: 'codex' })
    })

    it('clears the query when selecting all', () => {
        expect(toSessionAgentSearch('all')).toEqual({})
    })
})
