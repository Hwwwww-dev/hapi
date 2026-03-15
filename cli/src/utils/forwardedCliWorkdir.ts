export function applyForwardedCliWorkdir(): void {
    const forwardedWorkdir = process.env.HAPI_CLI_WORKDIR
    if (!forwardedWorkdir) {
        return
    }

    process.chdir(forwardedWorkdir)
    delete process.env.HAPI_CLI_WORKDIR
}
