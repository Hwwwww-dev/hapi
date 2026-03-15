import { describe, expect, it } from 'vitest'
import { getParentPath, isRootPath, joinChildPath } from './pathUtils'

describe('pathUtils', () => {
    it('handles POSIX root and child paths', () => {
        expect(isRootPath('/', 'linux')).toBe(true)
        expect(getParentPath('/', 'linux')).toBe('/')
        expect(joinChildPath('/Users/demo', 'project-a', 'darwin')).toBe('/Users/demo/project-a')
    })

    it('handles Windows root and child paths', () => {
        expect(isRootPath('C:\\', 'win32')).toBe(true)
        expect(getParentPath('C:\\', 'win32')).toBe('C:\\')
        expect(getParentPath('C:\\Users\\demo', 'win32')).toBe('C:\\Users')
        expect(joinChildPath('C:\\Users\\demo', 'repo', 'win32')).toBe('C:\\Users\\demo\\repo')
    })
})
