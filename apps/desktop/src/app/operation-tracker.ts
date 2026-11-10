import { computed, signal } from '@angular/core';

export interface CancellationRequest {
  readonly activityId: number;
  readonly operationId: string;
}

type CancellationState =
  | { kind: 'idle' }
  | { kind: 'requested'; request: CancellationRequest }
  | { kind: 'accepted'; request: CancellationRequest };

export interface RunningOperation {
  readonly activityId: number;
  readonly repositoryId: string | null;
  readonly operationId: string | null;
  readonly cancellation: CancellationState;
}

export interface BackgroundFetchRequest { readonly repositoryId: string }

export type BackgroundFetchState =
  | { kind: 'idle' }
  | { kind: 'waitingForHistory' | 'fetching' | 'reconciling'; request: BackgroundFetchRequest };

/** Owns live work, independently of bounded/clearable presentation logs. */
export class OperationTracker {
  private readonly running = signal<readonly RunningOperation[]>([]);
  private readonly fetching = signal<BackgroundFetchState>({ kind: 'idle' });
  readonly foreground = this.running.asReadonly();
  readonly background = this.fetching.asReadonly();
  readonly busy = computed(() => this.running().length > 0);
  readonly cancellingOperationIds = computed(() => this.running().flatMap(operation =>
    operation.cancellation.kind === 'idle' ? [] : [operation.cancellation.request.operationId]));
  readonly backgroundBusy = computed(() => this.fetching().kind !== 'idle');
  readonly backgroundRepositoryId = computed(() => {
    const state = this.fetching();
    return state.kind === 'idle' ? null : state.request.repositoryId;
  });

  start(activityId: number, repositoryId: string | null, operationId: string | null): void {
    if (this.running().some(operation => operation.activityId === activityId)) {
      throw new Error(`Activity ${activityId} is already running`);
    }
    this.running.update(operations => [...operations,
      { activityId, repositoryId, operationId, cancellation: { kind: 'idle' } }]);
  }

  complete(activityId: number): void {
    this.running.update(operations => operations.filter(operation => operation.activityId !== activityId));
  }

  requestCancellation(operationId: string): CancellationRequest | null {
    const operation = this.running().find(candidate => candidate.operationId === operationId);
    if (!operation || operation.cancellation.kind !== 'idle') return null;
    const request = { activityId: operation.activityId, operationId };
    this.running.update(operations => operations.map(candidate => candidate === operation
      ? { ...candidate, cancellation: { kind: 'requested', request } } : candidate));
    return request;
  }

  settleCancellation(request: CancellationRequest, accepted: boolean): void {
    this.running.update(operations => operations.map(operation =>
      operation.cancellation.kind !== 'idle' && operation.cancellation.request === request
        ? { ...operation, cancellation: accepted ? { kind: 'accepted', request } : { kind: 'idle' } }
        : operation));
  }

  beginBackground(repositoryId: string): BackgroundFetchRequest | null {
    if (this.backgroundBusy()) return null;
    const request = { repositoryId };
    this.fetching.set({ kind: 'waitingForHistory', request });
    return request;
  }

  advanceBackground(request: BackgroundFetchRequest, kind: 'fetching' | 'reconciling'): void {
    const state = this.fetching();
    if (state.kind !== 'idle' && state.request === request) this.fetching.set({ kind, request });
  }

  completeBackground(request: BackgroundFetchRequest): void {
    const state = this.fetching();
    if (state.kind !== 'idle' && state.request === request) this.fetching.set({ kind: 'idle' });
  }
}
