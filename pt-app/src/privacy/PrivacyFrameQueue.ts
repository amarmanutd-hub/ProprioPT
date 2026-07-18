/**
 * PrivacyFrameQueue — main-thread handle to transient worker memory.
 *
 * Raw camera frames are transferred in, wiped in-worker, never stored or
 * sent to the network. Pose landmarks stay on the main PerceptionEngine
 * path (MediaPipe); only disposable frame copies hit this queue.
 */

export class PrivacyFrameQueue {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = 0;
  private readonly maxPending = 2;

  start(): void {
    if (this.worker) return;
    this.worker = new Worker(
      new URL("./privacyFrameWorker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = () => {
      this.pending = Math.max(0, this.pending - 1);
    };
    this.worker.onerror = (e) => {
      console.warn("[PrivacyFrameQueue]", e.message);
    };
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending = 0;
  }

  /**
   * Clone current video frame into an ImageBitmap, transfer to worker for wipe.
   * Drops frames if the queue is backed up (never buffers video history).
   */
  async enqueueVideoFrame(video: HTMLVideoElement): Promise<void> {
    if (!this.worker) return;
    if (this.pending >= this.maxPending) return;
    if (video.readyState < 2 || !video.videoWidth) return;

    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(video);
    } catch {
      return;
    }

    this.pending += 1;
    const id = ++this.seq;
    this.worker.postMessage({ type: "frame", id, bitmap }, [bitmap]);
  }

  getPending(): number {
    return this.pending;
  }
}
