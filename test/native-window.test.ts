import { describe, expect, it } from "vitest";
import { nativeWindowHandleToWid } from "../src/main/native-window";

describe("native Windows handle conversion", () => {
  it("casts Windows handles to the unsigned 32-bit decimal value mpv accepts", () => {
    const handle32 = Buffer.alloc(4);
    handle32.writeUInt32LE(0xf1234567);
    const handle64 = Buffer.alloc(8);
    handle64.writeBigUInt64LE(0x12345678abcdef01n);

    expect(nativeWindowHandleToWid(handle32)).toBe("4045620583");
    expect(nativeWindowHandleToWid(handle64)).toBe("2882400001");
  });

  it("rejects null and unsupported handle buffers", () => {
    expect(() => nativeWindowHandleToWid(Buffer.alloc(8))).toThrow(
      "invalid-native-window-handle",
    );
    expect(() => nativeWindowHandleToWid(Buffer.alloc(6))).toThrow(
      "unsupported-native-window-handle-size",
    );
  });
});
