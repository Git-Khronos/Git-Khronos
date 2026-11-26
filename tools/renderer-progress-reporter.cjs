// Optional Playwright reporter for local validation. Counts are observations,
// not a test verdict, and a retry updates the same test's latest result.
const { renameSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');

class RendererProgress {
  constructor({ path }) {
    this.path = path;
    this.total = null;
    this.counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 };
    this.observed = new Map();
    this.attempts = 0;
    this.testPhaseStart = 0;
    this.attemptDurationMs = 0;
    this.durationBySpec = new Map();
    this.active = new Map();
    this.timer = null;
    this.writeFailed = false;
  }

  printsToStdio() { return false; }

  onBegin(_config, suite) {
    this.testPhaseStart = performance.now();
    this.total = suite.allTests().length;
    this.publish(null);
  }

  onTestBegin(test) {
    if (this.total === null || typeof test.location?.file !== 'string') return;
    const line = test.location.line;
    this.active.set(test.id, {
      spec: basename(test.location.file), startedAt: new Date().toISOString(),
      ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    });
    this.schedulePublish();
  }

  onTestEnd(test, result) {
    if (this.total === null) return;
    this.active.delete(test.id);
    this.schedulePublish();
    if (!Object.hasOwn(this.counts, result.status)) return;
    const previous = this.observed.get(test.id);
    if (previous) this.counts[previous]--;
    this.observed.set(test.id, result.status);
    this.counts[result.status]++;
    this.attempts++;
    if (Number.isFinite(result.duration) && result.duration >= 0) {
      const duration = Math.round(result.duration);
      this.attemptDurationMs += duration;
      if (typeof test.location?.file === 'string') {
        const spec = basename(test.location.file);
        const timing = this.durationBySpec.get(spec) ?? { durationMs: 0, timedAttempts: 0, maxAttemptMs: 0 };
        timing.durationMs += duration;
        if (!timing.timedAttempts || duration > timing.maxAttemptMs) {
          timing.maxAttemptMs = duration;
          const line = test.location.line;
          if (Number.isSafeInteger(line) && line > 0) timing.maxAttemptLine = line;
          else delete timing.maxAttemptLine;
        }
        timing.timedAttempts++;
        this.durationBySpec.set(spec, timing);
      }
    }
  }

  schedulePublish() {
    if (!this.timer && !this.writeFailed) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.publish(null);
      }, 1000);
      this.timer.unref();
    }
  }

  onEnd(result) {
    clearTimeout(this.timer);
    this.timer = null;
    this.active.clear();
    if (this.total !== null) this.publish(result.status);
  }

  publish(playwrightStatus) {
    if (this.writeFailed) return;
    try {
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({
        version: 1, totalTests: this.total, testsReported: this.observed.size,
        attemptsReported: this.attempts, latestOutcomes: this.counts, playwrightStatus,
        testPhaseElapsedMs: Math.round(performance.now() - this.testPhaseStart),
        totalAttemptDurationMs: this.attemptDurationMs,
        activeAttempts: this.active.size,
        oldestActiveAttempts: [...this.active.values()].slice(0, 5),
        slowestSpecsByAttemptTime: [...this.durationBySpec]
          .sort(([a, left], [b, right]) => right.durationMs - left.durationMs || a.localeCompare(b))
          .slice(0, 5).map(([spec, timing]) => ({ spec, ...timing })),
        updatedAt: new Date().toISOString(),
      }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      this.writeFailed = true;
      // Progress is optional and must not change the test process's verdict.
      process.stderr.write(`Could not record renderer progress: ${error.code ?? 'unknown error'}\n`);
    }
  }
}

module.exports = RendererProgress;
