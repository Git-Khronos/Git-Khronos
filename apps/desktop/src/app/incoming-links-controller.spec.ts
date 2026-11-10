import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingRepositoryLinkState } from '@git-khronos/contracts';
import { IncomingLinksController } from './incoming-links-controller';
import { AsyncStateController } from './async-state';

const native = vi.hoisted(() => ({
  read: vi.fn(), acknowledge: vi.fn(), dismiss: vi.fn(), listen: vi.fn(),
}));
vi.mock('@git-khronos/contracts', () => ({
  ipc: {
    incoming_repository_links: native.read,
    acknowledge_incoming_repository_link: native.acknowledge,
    dismiss_incoming_repository_link_overflow: native.dismiss,
  },
  events: { incomingRepositoryLinksChanged: { listen: native.listen } },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  const host = {
    read: new AsyncStateController<IncomingRepositoryLinkState>({ requests: [], overflowed: false }),
    pending: signal(false), supported: signal(false), listenError: signal(''), mutationError: signal(''),
    refreshPolicies: vi.fn(async () => undefined),
  };
  return {
    host: { ...host, state: host.read.value, loading: host.read.loading, readError: host.read.error },
    controller: new IncomingLinksController(host),
  };
}
const overflow: IncomingRepositoryLinkState = { requests: [], overflowed: true };
const empty: IncomingRepositoryLinkState = { requests: [], overflowed: false };
function inbox(...ids: string[]): IncomingRepositoryLinkState {
  return { requests: ids.map(id => ({ id, payload: { kind: 'rejected', message: 'Fixture request' } })),
    overflowed: true };
}

describe('incoming inbox request ownership', () => {
  beforeEach(() => vi.resetAllMocks());

  it('publishes the accepted inbox before policies finish, keeping the read busy', async () => {
    const { host, controller } = setup();
    const policies = deferred<void>();
    native.read.mockResolvedValue(overflow);
    host.refreshPolicies.mockReturnValue(policies.promise);
    const reading = controller.refresh();
    await Promise.resolve();
    expect(host.state()).toEqual(overflow);
    expect(host.pending()).toBe(true);
    expect(host.loading()).toBe(true);
    policies.resolve();
    await reading;
    expect(host.loading()).toBe(false);
  });

  it('ignores a stale snapshot and retains accepted contents after a read failure or stop', async () => {
    const { host, controller } = setup();
    const stale = deferred<IncomingRepositoryLinkState>();
    native.read.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(overflow);
    const first = controller.refresh();
    await controller.refresh();
    stale.resolve(empty);
    await first;
    expect(host.state()).toEqual(overflow);
    native.read.mockRejectedValueOnce(new Error('offline'));
    await controller.refresh();
    expect(host.state()).toEqual(overflow);
    expect(host.readError()).toContain('could not be read');
    expect(host.pending()).toBe(true);
    controller.stop();
    expect(host.state()).toEqual(overflow);
    expect(host.loading()).toBe(false);
  });

  it('settles loading when acknowledgement supersedes an in-flight inbox read', async () => {
    const { host, controller } = setup();
    const stale = deferred<IncomingRepositoryLinkState>();
    native.read.mockReturnValue(stale.promise);
    native.acknowledge.mockResolvedValue(empty);
    const reading = controller.refresh();
    expect(await controller.acknowledge('accepted-request')).toBe(true);
    stale.resolve(overflow);
    await reading;
    expect(host.state()).toEqual(empty);
    expect(host.loading()).toBe(false);
  });

  it('reports a malformed snapshot without erasing the accepted inbox', async () => {
    const { host, controller } = setup();
    native.read.mockResolvedValueOnce(overflow).mockResolvedValueOnce({});
    await controller.refresh();
    await controller.refresh();
    expect(host.state()).toEqual(overflow);
    expect(host.readError()).toContain('could not be read');
    expect(host.pending()).toBe(true);
    expect(host.loading()).toBe(false);
  });

  it('releases a listener registered after stop and ignores late snapshots', async () => {
    const { host, controller } = setup();
    const registration = deferred<() => void>();
    const stale = deferred<IncomingRepositoryLinkState>();
    const unlisten = vi.fn();
    native.listen.mockReturnValue(registration.promise);
    native.read.mockReturnValue(stale.promise);
    const connecting = controller.connect();
    const reading = controller.refresh();
    controller.stop();
    registration.resolve(unlisten);
    stale.resolve(overflow);
    await Promise.all([connecting, reading]);
    expect(unlisten).toHaveBeenCalledOnce();
    expect(host.state()).toEqual(empty);
    expect(host.pending()).toBe(false);
  });

  for (const command of ['acknowledge', 'dismissOverflow'] as const) {
    for (const refreshOutcome of ['failed-before-reply', 'failed-after-reply', 'newer-snapshot'] as const) {
      it(`retains confirmed ${command} when its native event refresh has ${refreshOutcome}`, async () => {
        const { host, controller } = setup();
        let notify!: () => void;
        native.listen.mockImplementation(async listener => {
          notify = () => listener({ payload: { pending: true } });
          return vi.fn();
        });
        await controller.connect();
        native.read.mockResolvedValueOnce(inbox('dismissed', 'retained'));
        await controller.refresh();
        const refresh = deferred<IncomingRepositoryLinkState>();
        const reply = deferred<IncomingRepositoryLinkState>();
        native.read.mockReturnValueOnce(refresh.promise);
        native.acknowledge.mockReturnValueOnce(reply.promise);
        native.dismiss.mockReturnValueOnce(reply.promise);
        const mutation = command === 'acknowledge'
          ? controller.acknowledge('dismissed') : controller.dismissOverflow();
        // Native mutation commands publish this event before returning their snapshot.
        notify();
        if (refreshOutcome === 'failed-before-reply') {
          refresh.reject(new Error('Read unavailable'));
          await vi.waitFor(() => expect(host.loading()).toBe(false));
        } else if (refreshOutcome === 'newer-snapshot') {
          refresh.resolve(inbox('retained', 'later'));
          await vi.waitFor(() => expect(host.state()).toEqual(inbox('retained', 'later')));
        }
        reply.resolve(command === 'acknowledge' ? inbox('retained')
          : { ...inbox('dismissed', 'retained'), overflowed: false });
        const confirmed = await mutation;
        if (command === 'acknowledge') expect(confirmed).toBe(true);
        if (refreshOutcome === 'failed-after-reply') {
          refresh.reject(new Error('Read unavailable'));
          await vi.waitFor(() => expect(host.loading()).toBe(false));
        }
        if (refreshOutcome === 'newer-snapshot') {
          expect(host.state()).toEqual(inbox('retained', 'later'));
        } else {
          expect(host.state()).toEqual(command === 'acknowledge' ? inbox('retained')
            : { ...inbox('dismissed', 'retained'), overflowed: false });
          expect(host.readError()).toContain('could not be read');
          expect(host.pending()).toBe(true);
        }
      });
    }
  }

  it('returns a confirmed acknowledgement after stop without reviving the inbox', async () => {
    const { host, controller } = setup();
    const reply = deferred<IncomingRepositoryLinkState>();
    native.acknowledge.mockReturnValue(reply.promise);
    const mutation = controller.acknowledge('dismissed');
    controller.stop();
    reply.resolve(inbox('retained'));
    expect(await mutation).toBe(true);
    expect(host.state()).toEqual(empty);
  });

  it('does not resurrect a confirmed dismissal from an already-started event snapshot', async () => {
    const { host, controller } = setup();
    native.read.mockResolvedValueOnce(inbox('dismissed', 'retained'));
    await controller.refresh();
    const reply = deferred<IncomingRepositoryLinkState>();
    const refresh = deferred<IncomingRepositoryLinkState>();
    native.acknowledge.mockReturnValue(reply.promise);
    const mutation = controller.acknowledge('dismissed');
    native.read.mockReturnValue(refresh.promise);
    const reading = controller.refresh();
    reply.resolve(inbox('retained'));
    expect(await mutation).toBe(true);
    refresh.resolve(inbox('dismissed', 'retained', 'later'));
    await reading;
    expect(host.state()).toEqual(inbox('retained', 'later'));
    native.read.mockResolvedValueOnce(inbox('retained', 'later'));
    await controller.refresh();
    expect(host.state()).toEqual(inbox('retained', 'later'));
  });

  for (const command of ['acknowledge', 'dismissOverflow'] as const) {
    for (const response of ['rejected', 'malformed'] as const) {
      it(`reports ${command} as unconfirmed after a ${response} post-mutation response and reconciles without replay`, async () => {
        const { host, controller } = setup();
        let nativeInbox = inbox('dismissed', 'retained');
        native.read.mockImplementation(async () => nativeInbox);
        await controller.refresh();
        const mutate = async () => {
          nativeInbox = command === 'acknowledge' ? inbox('retained')
            : { ...nativeInbox, overflowed: false };
          if (response === 'rejected') throw new Error('Post-mutation snapshot unavailable');
          return {};
        };
        native.acknowledge.mockImplementation(mutate);
        native.dismiss.mockImplementation(mutate);
        const result = command === 'acknowledge'
          ? await controller.acknowledge('dismissed') : await controller.dismissOverflow();
        if (command === 'acknowledge') expect(result).toBe(false);
        expect(host.mutationError()).toContain('could not be confirmed');
        expect(host.mutationError()).toContain('before deciding whether to retry');
        expect(host.state()).toEqual(inbox('dismissed', 'retained'));
        expect(host.pending()).toBe(true);
        await controller.refresh();
        expect(host.state()).toEqual(nativeInbox);
        expect(host.readError()).toBeNull();
        expect(host.mutationError()).toBe('');
        expect(command === 'acknowledge' ? native.acknowledge : native.dismiss).toHaveBeenCalledOnce();
      });
    }
  }

  for (const command of ['acknowledge', 'dismissOverflow'] as const) {
    for (const response of ['rejected', 'malformed'] as const) {
      for (const eventRead of ['pending', 'failed', 'successful'] as const) {
        it(`keeps ${command} uncertainty independent of a ${eventRead} event read after ${response} reply`, async () => {
          const { host, controller } = setup();
          let notify!: () => void;
          native.listen.mockImplementation(async listener => {
            notify = () => listener({ payload: { pending: true } });
            return vi.fn();
          });
          await controller.connect();
          native.read.mockResolvedValueOnce(inbox('dismissed', 'retained'));
          await controller.refresh();
          const refresh = deferred<IncomingRepositoryLinkState>();
          const reply = deferred<IncomingRepositoryLinkState>();
          const reconciled = { ...inbox('retained', 'later'), overflowed: false };
          native.read.mockReturnValueOnce(refresh.promise);
          const mutate = () => { notify(); return reply.promise; };
          native.acknowledge.mockImplementation(mutate);
          native.dismiss.mockImplementation(mutate);
          const mutation = command === 'acknowledge'
            ? controller.acknowledge('dismissed') : controller.dismissOverflow();
          if (eventRead === 'successful') {
            refresh.resolve(reconciled);
            await vi.waitFor(() => expect(host.state()).toEqual(reconciled));
          } else if (eventRead === 'failed') {
            refresh.reject(new Error('Event read failed'));
            await vi.waitFor(() => expect(host.readError()).toContain('could not be read'));
          }
          if (response === 'rejected') reply.reject(new Error('Post-mutation snapshot unavailable'));
          else reply.resolve({} as IncomingRepositoryLinkState);
          await mutation;
          expect(host.mutationError()).toContain('could not be confirmed');
          expect(host.pending()).toBe(true);
          if (eventRead === 'successful') expect(host.state()).toEqual(reconciled);
          else expect(host.state()).toEqual(inbox('dismissed', 'retained'));
          await controller.acknowledge('dismissed');
          await controller.dismissOverflow();
          expect(command === 'acknowledge' ? native.acknowledge : native.dismiss).toHaveBeenCalledOnce();
          expect(command === 'acknowledge' ? native.dismiss : native.acknowledge).not.toHaveBeenCalled();
          if (eventRead === 'pending') {
            expect(host.loading()).toBe(true);
            refresh.resolve(reconciled);
            await vi.waitFor(() => expect(host.loading()).toBe(false));
            expect(host.mutationError()).toContain('could not be confirmed');
          }
          native.read.mockResolvedValueOnce(reconciled);
          await controller.refresh();
          expect(host.state()).toEqual(reconciled);
          expect(host.mutationError()).toBe('');
        });
      }
    }
  }

  it.each(['delayed', 'failed'])('does not release unknown-outcome admission using a pre-mutation read when the native event is %s', async event => {
    const { host, controller } = setup();
    let notify!: () => void;
    native.listen.mockImplementation(async listener => {
      notify = () => listener({ payload: { pending: true } });
      return vi.fn();
    });
    await controller.connect();
    native.read.mockResolvedValueOnce(inbox('dismissed', 'retained'));
    await controller.refresh();
    const reply = deferred<IncomingRepositoryLinkState>();
    native.acknowledge.mockReturnValue(reply.promise);
    const mutation = controller.acknowledge('dismissed');
    const capturedBeforeMutation = { ...inbox('dismissed', 'retained', 'later'), overflowed: false };
    const unrelated = deferred<IncomingRepositoryLinkState>();
    native.read.mockReturnValueOnce(unrelated.promise);
    const reading = controller.refresh();
    reply.reject(new Error('Post-mutation snapshot unavailable'));
    expect(await mutation).toBe(false);
    unrelated.resolve(capturedBeforeMutation);
    await reading;
    expect(host.state()).toEqual(capturedBeforeMutation);
    expect(host.mutationError()).toContain('could not be confirmed');
    expect(host.pending()).toBe(true);
    await controller.acknowledge('dismissed');
    expect(native.acknowledge).toHaveBeenCalledOnce();
    const reconciled = { ...inbox('retained', 'later'), overflowed: false };
    if (event === 'failed') {
      native.read.mockRejectedValueOnce(new Error('Event read failed'));
      notify();
      await vi.waitFor(() => expect(host.readError()).toContain('could not be read'));
      expect(host.mutationError()).toContain('could not be confirmed');
    }
    native.read.mockResolvedValueOnce(reconciled);
    notify();
    await vi.waitFor(() => expect(host.mutationError()).toBe(''));
    expect(host.state()).toEqual(reconciled);
  });
});
