import { logger } from "@/ui/logger";
import { delay } from "@/utils/time";
import { watch } from "fs/promises";

export function startFileWatcher(file: string, onFileChange: (file: string) => void) {
    const abortController = new AbortController();
    const MAX_RETRIES = 20;
    const MAX_DELAY_MS = 30_000;

    void (async () => {
        let consecutiveFailures = 0;
        while (consecutiveFailures < MAX_RETRIES) {
            try {
                logger.debug(`[FILE_WATCHER] Starting watcher for ${file}`);
                const watcher = watch(file, { persistent: true, signal: abortController.signal });
                for await (const event of watcher) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    logger.debug(`[FILE_WATCHER] File changed: ${file}`);
                    onFileChange(file);
                }
                // Watcher ended normally, reset failure count
                consecutiveFailures = 0;
            } catch (e: any) {
                if (abortController.signal.aborted) {
                    return;
                }
                consecutiveFailures++;
                const backoffDelay = Math.min(1000 * Math.pow(2, consecutiveFailures - 1), MAX_DELAY_MS);
                logger.debug(`[FILE_WATCHER] Watch error: ${e.message}, retry ${consecutiveFailures}/${MAX_RETRIES} in ${backoffDelay}ms`);
                await delay(backoffDelay);
            }
        }
        logger.warn(`[FILE_WATCHER] Exhausted ${MAX_RETRIES} retries for ${file}, stopping watcher`);
    })();

    return () => {
        abortController.abort();
    };
}