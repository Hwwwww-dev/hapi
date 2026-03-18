/**
 * Marker used by hapi's metadata extraction probe.
 * Sessions whose first user message matches this marker are internal
 * and should be excluded from native sync discovery.
 */
export const HAPI_METADATA_PROBE_MARKER = '__hapi_metadata_probe__'
