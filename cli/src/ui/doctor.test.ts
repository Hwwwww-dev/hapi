import { afterEach, describe, expect, it } from 'vitest'

import { getEnvironmentInfo } from './doctor'

describe('getEnvironmentInfo', () => {
    const originalEnv = process.env.HAPI_CLI_WORKDIR

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.HAPI_CLI_WORKDIR
        } else {
            process.env.HAPI_CLI_WORKDIR = originalEnv
        }
    })

    it('reports the forwarded logical cwd when present', () => {
        process.env.HAPI_CLI_WORKDIR = '/tmp/doctor-forwarded'

        expect(getEnvironmentInfo().workingDirectory).toBe('/tmp/doctor-forwarded')
    })
})
