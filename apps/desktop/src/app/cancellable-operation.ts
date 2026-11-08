import { ipc } from '@git-khronos/contracts';

export type OperationCancellation = 'accepted' | 'finished' | 'unacknowledged' | { error: unknown };

const CANCELLATION_ATTEMPTS = 3;
const CANCELLATION_RETRY_DELAY_MS = 50;
const CANCELLATION_ACK_TIMEOUT_MS = 1000;

export class CancellableOperation {
  private finished = false;
  private acknowledged = false;
  private pending: Promise<OperationCancellation> | null = null;

  constructor(readonly id: string) {}

  get settled(): boolean { return this.finished; }
  get accepted(): boolean { return this.acknowledged; }

  finish(): void { this.finished = true; }

  cancel(): Promise<OperationCancellation> {
    if (this.finished) return Promise.resolve('finished');
    if (this.acknowledged) return Promise.resolve('accepted');
    if (this.pending) return this.pending;
    const request = this.tryCancel();
    this.pending = request;
    void request.then(() => {
      if (this.pending === request) this.pending = null;
    });
    return request;
  }

  private async tryCancel(): Promise<OperationCancellation> {
    try {
      for (let attempt = 0; attempt < CANCELLATION_ATTEMPTS && !this.finished; attempt++) {
        const reply = await this.requestOnce();
        if (this.finished) return 'finished';
        if (reply === 'timeout') return 'unacknowledged';
        if (reply) {
          this.acknowledged = true;
          return 'accepted';
        }
        if (attempt < CANCELLATION_ATTEMPTS - 1) await new Promise(resolve => setTimeout(resolve, CANCELLATION_RETRY_DELAY_MS));
      }
      return this.finished ? 'finished' : 'unacknowledged';
    } catch (error: unknown) {
      return this.finished ? 'finished' : { error };
    }
  }

  private async requestOnce(): Promise<boolean | 'timeout'> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), CANCELLATION_ACK_TIMEOUT_MS); });
      return await Promise.race([ipc.cancel_git_operation({ operationId: this.id }), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
