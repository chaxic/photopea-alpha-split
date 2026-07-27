(function (root, factory) {
  var zip = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = zip;
  }

  root.AlphaSplitZip = zip;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xffffffff;
    for (var index = 0; index < bytes.length; index++) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    date = date || new Date();
    var year = Math.max(1980, date.getFullYear());
    return {
      time:
        (date.getHours() << 11) |
        (date.getMinutes() << 5) |
        Math.floor(date.getSeconds() / 2),
      date:
        ((year - 1980) << 9) |
        ((date.getMonth() + 1) << 5) |
        date.getDate(),
    };
  }

  function concatBytes(parts) {
    var total = 0;
    var i;
    for (i = 0; i < parts.length; i++) total += parts[i].length;
    var output = new Uint8Array(total);
    var offset = 0;
    for (i = 0; i < parts.length; i++) {
      output.set(parts[i], offset);
      offset += parts[i].length;
    }
    return output;
  }

  function createStoredZip(entries) {
    var encoder = new TextEncoder();
    var localParts = [];
    var centralParts = [];
    var stamp = dosDateTime();
    var localOffset = 0;
    var e;

    for (e = 0; e < entries.length; e++) {
      var entry = entries[e];
      var nameBytes = encoder.encode(entry.name);
      var data = entry.data;
      var checksum = crc32(data);

      var localHeader = new Uint8Array(30);
      var localView = new DataView(localHeader.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, stamp.time, true);
      localView.setUint16(12, stamp.date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, data.length, true);
      localView.setUint32(22, data.length, true);
      localView.setUint16(26, nameBytes.length, true);
      localView.setUint16(28, 0, true);

      localParts.push(localHeader, nameBytes, data);

      var centralHeader = new Uint8Array(46);
      var centralView = new DataView(centralHeader.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, stamp.time, true);
      centralView.setUint16(14, stamp.date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, data.length, true);
      centralView.setUint32(24, data.length, true);
      centralView.setUint16(28, nameBytes.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, localOffset, true);
      centralParts.push(centralHeader, nameBytes);

      localOffset += localHeader.length + nameBytes.length + data.length;
    }

    var centralDirectory = concatBytes(centralParts);
    var end = new Uint8Array(22);
    var endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralDirectory.length, true);
    endView.setUint32(16, localOffset, true);
    endView.setUint16(20, 0, true);

    return new Blob(localParts.concat([centralDirectory, end]), {
      type: "application/zip",
    });
  }

  return Object.freeze({
    crc32: crc32,
    createStoredZip: createStoredZip,
  });
}));
