/**
 * Privacy frame worker — transient ImageBitmap queue.
 * Closes bitmaps immediately; never posts pixels back; no storage/network.
 */
/// <reference lib="webworker" />

export {};

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as {
    type: string;
    id?: number;
    bitmap?: ImageBitmap;
  };

  if (msg.type === "frame" && msg.bitmap) {
    const id = msg.id ?? 0;
    const bmp = msg.bitmap;
    // Touch dimensions only — no encode, no transfer out of worker
    const w = bmp.width;
    const h = bmp.height;
    bmp.close(); // release GPU/CPU frame buffer immediately
    ctx.postMessage({ type: "wiped", id, w, h });
    return;
  }

  if (msg.type === "ping") {
    ctx.postMessage({ type: "pong" });
  }
};
