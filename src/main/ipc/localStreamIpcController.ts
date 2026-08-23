import type {
  Event as ElectronEvent,
  WebContents,
  WebContentsDidStartNavigationEventParams,
} from "electron";

import type { LocalTranscribeResult } from "../../types/shared";
import type { ManagedLocalStreamingSession } from "../localSttLifecycle";

type BeginLocalStream = (
  modelId: string,
  onPartial: (text: string) => void,
  signal: AbortSignal,
) => Promise<ManagedLocalStreamingSession>;

type StreamRecord = {
  id: string;
  owner: WebContents;
  abortController: AbortController;
  session: ManagedLocalStreamingSession | null;
  removeOwnerListeners: () => void;
};

/**
 * Owns the one allowed live-STT session across IPC calls.
 *
 * The record exists while model startup is pending. This is important because
 * a renderer can reload before start() returns and lose the session ID. A
 * document change aborts that pending request without stopping a model that
 * has just finished loading.
 */
export class LocalStreamIpcController {
  private current: StreamRecord | null = null;

  constructor(
    private readonly begin: BeginLocalStream,
    private readonly abortBatchTranscription: () => void,
    private readonly createId: () => string,
  ) {}

  async start(owner: WebContents, modelId: string): Promise<{ sessionId: string }> {
    if (this.current) {
      throw new Error("A local streaming session is already active.");
    }

    const record: StreamRecord = {
      id: this.createId(),
      owner,
      abortController: new AbortController(),
      session: null,
      removeOwnerListeners: () => undefined,
    };
    this.current = record;
    record.removeOwnerListeners = this.watchOwner(record);

    try {
      const session = await this.begin(
        modelId,
        (text) => {
          if (this.current !== record || owner.isDestroyed()) return;
          owner.send("stt:local-stream-partial", {
            sessionId: record.id,
            text,
          });
        },
        record.abortController.signal,
      );

      if (this.current !== record || record.abortController.signal.aborted) {
        session.cancel();
        throw new Error(
          "Local streaming session was cancelled during startup.",
        );
      }

      record.session = session;
      return { sessionId: record.id };
    } catch (error) {
      this.clearRecord(record);
      throw error;
    }
  }

  async push(
    owner: WebContents,
    sessionId: string,
    pcmBytes: Uint8Array,
  ): Promise<void> {
    const { record, session } = this.requireSession(owner, sessionId);
    try {
      await session.push(
        Buffer.from(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength),
      );
    } catch (error) {
      this.cancelRecord(record);
      throw error;
    }
  }

  async finish(
    owner: WebContents,
    sessionId: string,
  ): Promise<LocalTranscribeResult> {
    const { record, session } = this.requireSession(owner, sessionId);
    try {
      return await session.finish();
    } finally {
      this.clearRecord(record);
    }
  }

  cancel(): void {
    const record = this.current;
    if (!record) {
      this.abortBatchTranscription();
      return;
    }
    this.cancelRecord(record);
  }

  private requireSession(
    owner: WebContents,
    sessionId: string,
  ): { record: StreamRecord; session: ManagedLocalStreamingSession } {
    const record = this.current;
    if (
      !record ||
      !record.session ||
      record.id !== sessionId ||
      record.owner.id !== owner.id
    ) {
      throw new Error("Local streaming session is not active.");
    }
    return { record, session: record.session };
  }

  private watchOwner(record: StreamRecord): () => void {
    const { owner } = record;
    const onOwnerGone = () => this.cancelRecord(record);
    const onNavigation = (
      event: ElectronEvent<WebContentsDidStartNavigationEventParams>,
    ) => {
      if (event.isMainFrame && !event.isSameDocument) {
        this.cancelRecord(record);
      }
    };

    owner.once("destroyed", onOwnerGone);
    owner.once("render-process-gone", onOwnerGone);
    owner.on("did-start-navigation", onNavigation);

    return () => {
      if (owner.isDestroyed()) return;
      owner.removeListener("destroyed", onOwnerGone);
      owner.removeListener("render-process-gone", onOwnerGone);
      owner.removeListener("did-start-navigation", onNavigation);
    };
  }

  private cancelRecord(record: StreamRecord): void {
    if (this.current !== record) return;
    this.current = null;
    record.removeOwnerListeners();
    record.abortController.abort();
    record.session?.cancel();
  }

  private clearRecord(record: StreamRecord): void {
    if (this.current !== record) return;
    this.current = null;
    record.removeOwnerListeners();
  }
}
