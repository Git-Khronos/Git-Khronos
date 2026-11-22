// Optional Playwright reporter for local validation. Counts are observations,
// not a test verdict, and a retry updates the same test's latest result.
const { renameSync, writeFileSync } = require('node:fs');

class RendererProgress {
  constructor({ path }) {
    this.path = path;
    this.total = null;
    this.counts = { passed: 0, failed: 0, timedOut: 0, skipped: 0, interrupted: 0 };
    this.observed = new Map();
    this.attempts = 0;
    this.timer = null;
    this.writeFailed = false;
  }

  printsToStdio() { return false; }

  onBegin(_config, suite) {
    this.total = suite.allTests().length;
    this.publish(null);
  }

  onTestEnd(test, result) {
    if (this.total === null || !Object.hasOwn(this.counts, result.status)) return;
    const previous = this.observed.get(test.id);
    if (previous) this.counts[previous]--;
    this.observed.set(test.id, result.status);
    this.counts[result.status]++;
    this.attempts++;
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
    if (this.total !== null) this.publish(result.status);
  }

  publish(playwrightStatus) {
    if (this.writeFailed) return;
    try {
      const temporary = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({
        version: 1, totalTests: this.total, testsReported: this.observed.size,
        attemptsReported: this.attempts, latestOutcomes: this.counts, playwrightStatus,
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
