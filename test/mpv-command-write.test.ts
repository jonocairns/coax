import { describe, expect, it, vi } from "vitest";
import { writeMpvCommand } from "../src/main/mpv/controller";

const command = { command: ["get_property", "video-params"], request_id: 1 };

describe("mpv IPC command writes", () => {
  it("accepts a command that was buffered under backpressure", () => {
    const write = vi.fn(() => false);

    expect(writeMpvCommand({ writable: true, write }, command)).toBe(true);
    expect(write).toHaveBeenCalledOnce();
  });

  it("rejects an unavailable or synchronously failed pipe", () => {
    expect(writeMpvCommand(null, command)).toBe(false);
    expect(
      writeMpvCommand(
        {
          writable: true,
          write: vi.fn(() => {
            throw new Error("pipe-closed");
          }),
        },
        command,
      ),
    ).toBe(false);
  });
});
