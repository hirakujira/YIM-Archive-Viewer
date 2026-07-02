// Yahoo Messenger .dat 對話封存解析器（純 JavaScript）
// 支援瀏覽器（掛在 window.YIM）與 Node.js（module.exports），後者僅供開發驗證。
(function (root) {
  'use strict';

  var BLOCK_HEADER_SIZE = 16;
  var utf8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
  var big5Decoder = null;
  if (typeof TextDecoder !== 'undefined') {
    try { big5Decoder = new TextDecoder('big5'); } catch (e) { big5Decoder = null; }
  }

  function decodeUtf8(bytes) {
    if (utf8Decoder) return utf8Decoder.decode(bytes);
    // Node 後備
    return Buffer.from(bytes).toString('utf-8');
  }

  function ratioFFFD(text) {
    if (!text.length) return 0;
    var bad = 0;
    for (var i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xFFFD) bad++;
    return bad / text.length;
  }

  // 舊紀錄可能為 UTF-8 或 Big5，逐則挑選亂碼較少者。
  function decodeBest(bytes) {
    var u = decodeUtf8(bytes);
    var ru = ratioFFFD(u);
    if (ru <= 0.02 || !big5Decoder) return { text: u, ratio: ru };
    var b = big5Decoder.decode(bytes);
    var rb = ratioFFFD(b);
    return rb < ru ? { text: b, ratio: rb } : { text: u, ratio: ru };
  }

  // 重複金鑰 XOR，還原原始位元組。
  function decryptBytes(bytes, key) {
    var keyBytes = [];
    for (var i = 0; i < key.length; i++) {
      var cp = key.charCodeAt(i);
      if (cp < 128) {
        keyBytes.push(cp);
      } else {
        // 帳號金鑰理論上皆為 ASCII，仍以 UTF-8 展開以策安全。
        var enc = unescape(encodeURIComponent(key.charAt(i)));
        for (var j = 0; j < enc.length; j++) keyBytes.push(enc.charCodeAt(j));
      }
    }
    var out = new Uint8Array(bytes.length);
    for (var k = 0; k < bytes.length; k++) {
      out[k] = bytes[k] ^ keyBytes[k % keyBytes.length];
    }
    return out;
  }

  // 重複金鑰 XOR 後解碼（UTF-8 / Big5 自動選擇）。
  function decrypt(bytes, key) {
    return decodeBest(decryptBytes(bytes, key)).text;
  }

  // 移除部分 Yahoo Messenger 格式標籤（font / FADE / ALT）。
  function clean(message) {
    var result = '';
    var waitClose = false;
    for (var i = 0; i < message.length; i++) {
      if (message[i] === '<' && i < message.length - 6) {
        if (message[i + 1] === 'f' && message[i + 2] === 'o' && message[i + 3] === 'n' && message[i + 4] === 't' && message[i + 5] === ' ' && (message[i + 6] === 'f' || message[i + 6] === 's')) { waitClose = true; continue; }
        if (message[i + 1] === 'F' && message[i + 2] === 'A' && message[i + 3] === 'D' && message[i + 4] === 'E' && message[i + 5] === ' ' && message[i + 6] === '#') { waitClose = true; continue; }
        if (message[i + 1] === '/' && message[i + 2] === 'F' && message[i + 3] === 'A' && message[i + 4] === 'D' && message[i + 5] === 'E') { waitClose = true; continue; }
        if (message[i + 1] === 'A' && message[i + 2] === 'L' && message[i + 3] === 'T' && message[i + 4] === ' ' && message[i + 5] === '#') { waitClose = true; continue; }
      }
      if (message[i] === '<' && i < message.length - 4) {
        if (message[i + 1] === '/' && message[i + 2] === 'A' && message[i + 3] === 'L' && message[i + 4] === 'T') { waitClose = true; continue; }
      }
      if (waitClose) {
        if (message[i] !== '>') continue;
        waitClose = false;
        continue;
      }
      result += message[i];
    }
    // 移除格式與顏色前綴，例如 [#0080ffm、[#ff8040m、[1m、[37m
    result = result.replace(/\[#[0-9a-fA-F]{6}m/g, '').replace(/\[[0-9]{1,2}m/g, '');
    // 移除殘留的控制字元（如 ESC 0x1B），保留 tab 與換行
    result = result.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
    return result;
  }

  // 由相對路徑推導帳號、分類、對象、日期。
  // 例：Profiles/<帳號>/Archive/Messages/<對象>/YYYYMMDD-<帳號>.dat
  function parsePath(relativePath) {
    var parts = relativePath.split(/[\\/]+/).filter(Boolean);
    var archiveIdx = parts.indexOf('Archive');
    if (archiveIdx <= 0 || archiveIdx + 2 >= parts.length) return null;
    var account = parts[archiveIdx - 1];
    var category = parts[archiveIdx + 1];
    var peer = parts[archiveIdx + 2];
    var filename = parts[parts.length - 1];
    if (!/\.dat$/i.test(filename)) return null;
    var dateMatch = filename.match(/^(\d{4})(\d{2})(\d{2})-/);
    var date = dateMatch ? dateMatch[1] + '-' + dateMatch[2] + '-' + dateMatch[3] : '';
    return { account: account, category: category, peer: peer, filename: filename, date: date };
  }

  // U+FFFD（替代字元）比例，用來評估金鑰是否正確。
  function garbageRatio(text) {
    if (!text.length) return 0;
    var bad = 0;
    for (var i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 0xFFFD) bad++;
    }
    return bad / text.length;
  }

  // 解析單一 .dat 檔內容。
  // buffer: ArrayBuffer；meta: parsePath() 結果。
  // candidateKeys: 選填，其他可嘗試的帳號金鑰（用於封存被複製到別的帳號資料夾時）。
  function parseArchive(buffer, meta, candidateKeys) {
    var view = new DataView(buffer);
    var raw = new Uint8Array(buffer);
    var total = buffer.byteLength;
    var offset = 0;
    var records = []; // { timestamp, field2, field3, sender, payload }
    var isMessages = meta.category === 'Messages';

    while (offset + BLOCK_HEADER_SIZE <= total) {
      var timestamp = view.getInt32(offset, true);
      var field2 = view.getInt32(offset + 4, true);
      var field3 = view.getInt32(offset + 8, true);
      var size = view.getInt32(offset + 12, true);
      offset += BLOCK_HEADER_SIZE;

      if (size < 0 || offset + size > total) break; // 資料損毀，停止解析
      var payload = raw.subarray(offset, offset + size);
      offset += size;

      var sender;
      if (isMessages) {
        offset += 4; // 4-byte 結束標記
        sender = field3 === 0 ? meta.account : meta.peer;
      } else {
        if (offset + 4 > total) break;
        var nameLen = view.getInt32(offset, true);
        offset += 4;
        if (nameLen < 0 || offset + nameLen > total) break;
        var nameBytes = raw.subarray(offset, offset + nameLen);
        offset += nameLen;
        var name = decodeUtf8(nameBytes);
        sender = name || (field3 === 0 ? meta.account : meta.peer);
      }

      if (size <= 0) continue; // 事件紀錄（加入/離開等），略過
      records.push({ timestamp: timestamp, field2: field2, field3: field3, sender: sender, payload: payload });
    }

    // 選擇金鑰：優先用資料夾帳號，若亂碼比例過高再嘗試其他候選帳號。
    var keys = [meta.account].concat(candidateKeys || []);
    var seen = {};
    keys = keys.filter(function (k) { if (!k || seen[k]) return false; seen[k] = true; return true; });

    var bestKey = meta.account;
    var bestRatio = Infinity;
    var bestTexts = null;
    for (var ki = 0; ki < keys.length; ki++) {
      var k = keys[ki];
      var texts = [];
      var totalLen = 0, badLen = 0;
      for (var ri = 0; ri < records.length; ri++) {
        var t = decrypt(records[ri].payload, k);
        texts.push(t);
        totalLen += t.length;
        badLen += Math.round(garbageRatio(t) * t.length);
      }
      var ratio = totalLen ? badLen / totalLen : 0;
      if (ratio < bestRatio) { bestRatio = ratio; bestKey = k; bestTexts = texts; }
      if (ratio <= 0.02) break; // 幾乎無亂碼即採用
    }

    var messages = [];
    for (var mi = 0; mi < records.length; mi++) {
      var text = clean(bestTexts ? bestTexts[mi] : decrypt(records[mi].payload, bestKey));
      if (!text) continue;
      var r = records[mi];
      messages.push({
        timestamp: r.timestamp,
        field2: r.field2,
        field3: r.field3,
        sender: r.sender,
        direction: r.sender === meta.account ? 'self' : 'peer',
        text: text
      });
    }

    return messages;
  }

  var api = {
    decrypt: decrypt,
    clean: clean,
    garbageRatio: garbageRatio,
    parsePath: parsePath,
    parseArchive: parseArchive
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.YIM = api;
  }
})(typeof window !== 'undefined' ? window : this);
