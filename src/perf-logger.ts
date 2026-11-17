/**
 * Performance logging for web-treeview
 *
 * Times key operations (insertArray phases, filterNodes, expandAll/collapseAll,
 * scrollToPath) through core's `createPerfLogger` (`TREEVIEW:PERF`, SPEC §12.1).
 *
 * Usage:
 *   import { enablePerfLogging, setPerfThreshold } from '@keenmate/web-treeview';
 *
 *   enablePerfLogging();
 *   setPerfThreshold(10); // Only log operations taking >10ms
 */

import { createLoggers, createPerfLogger, type Logger } from '@keenmate/web-components-core';

/** The shared perf logger: `perf.start` / `perf.end` / `perf.summarize`. */
export const perf = createPerfLogger('TREEVIEW');

// The same `TREEVIEW:PERF` logger core's perf logger writes through (loggers are
// registered by name), so its level stays independent of the TREEVIEW:* category loggers.
const perfLogger: Logger = createLoggers('TREEVIEW', ['PERF'] as const).loggers.PERF;

// Disabled by default.
perfLogger.setLevel('silent');

/** Enable performance logging (core's perf lines log at `debug`). */
export function enablePerfLogging(): void {
    perfLogger.setLevel('debug');
}

/** Disable performance logging. */
export function disablePerfLogging(): void {
    perfLogger.setLevel('silent');
}

/**
 * Set minimum threshold for logging (only log operations slower than threshold)
 * @param thresholdMs - Threshold in milliseconds (0 = log everything)
 */
export function setPerfThreshold(thresholdMs: number): void {
    perf.setThreshold(thresholdMs);
}
