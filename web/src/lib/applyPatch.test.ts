import { describe, expect, it } from 'vitest'
import { extractApplyPatchFiles, extractApplyPatchText } from '@/lib/applyPatch'

describe('applyPatch helpers', () => {
    it('extracts patch text from freeform string input', () => {
        expect(extractApplyPatchText('*** Begin Patch\n*** End Patch')).toBe('*** Begin Patch\n*** End Patch')
    })

    it('extracts patch text from object input', () => {
        expect(extractApplyPatchText({ patch: '*** Begin Patch\n*** End Patch' })).toBe('*** Begin Patch\n*** End Patch')
    })

    it('extracts changed files from apply_patch payload', () => {
        const files = extractApplyPatchFiles({
            patch: [
                '*** Begin Patch',
                '*** Update File: web/src/foo.ts',
                '@@',
                '-old',
                '+new',
                '*** Add File: web/src/bar.ts',
                '+hello',
                '*** Delete File: web/src/baz.ts',
                '*** End Patch'
            ].join('\n')
        })

        expect(files).toEqual([
            'web/src/foo.ts',
            'web/src/bar.ts',
            'web/src/baz.ts'
        ])
    })
})
