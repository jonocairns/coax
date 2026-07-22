export function nativeWindowHandleToWid(handle: Buffer): string {
  let rawValue: bigint;
  if (handle.byteLength === 8) {
    rawValue = handle.readBigUInt64LE();
  } else if (handle.byteLength === 4) {
    rawValue = BigInt(handle.readUInt32LE());
  } else {
    throw new Error("unsupported-native-window-handle-size");
  }

  const value = BigInt.asUintN(32, rawValue);
  if (value === 0n) throw new Error("invalid-native-window-handle");
  return value.toString(10);
}
