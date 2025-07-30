const standardToScrambledMap = new Map();
const scrambledToStandardMap = new Map();
for (let i = 0x0; i < 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.length; i++) {
  standardToScrambledMap.set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[i], "m2f-7O0wNnKq3Gz_5J1k4U6tFhI8sRBY9VPeDlcLMoaxjZbuSgrivCTWHpXAyE"[i]);
  scrambledToStandardMap.set("m2f-7O0wNnKq3Gz_5J1k4U6tFhI8sRBY9VPeDlcLMoaxjZbuSgrivCTWHpXAyE"[i], 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[i]);
}
function encrypt(_0x4d8153) {
  try {
    const _0x105e16 = JSON.stringify(_0x4d8153);
    const _0x53aef3 = Buffer.from(_0x105e16, "utf8").toString("base64url");
    let _0x4be120 = '';
    for (const _0x44e8f5 of _0x53aef3) {
      _0x4be120 += standardToScrambledMap.get(_0x44e8f5) || _0x44e8f5;
    }
    return _0x4be120;
  } catch (_0x3614aa) {
    console.error("Encryption failed:", _0x3614aa);
    return null;
  }
}
function decode(_0x17ebe9) {
  try {
    let _0x50c055 = '';
    for (const _0x41ae6b of _0x17ebe9) {
      _0x50c055 += scrambledToStandardMap.get(_0x41ae6b) || _0x41ae6b;
    }
    const _0x1100c3 = Buffer.from(_0x50c055, "base64url").toString("utf8");
    return JSON.parse(_0x1100c3);
  } catch (_0x15922a) {
    console.error("Decryption failed. The input may be invalid or corrupted.", _0x15922a);
    return null;
  }
}
export { encrypt, decode };
