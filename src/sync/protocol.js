const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const BASE64_CHUNK_SIZE = 32_768;

export const BASELINE_CHOICE = Object.freeze({
  NONE: 0,
  USE_LOCAL: 1,
  USE_SERVER: 2,
});

function concat(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function varint(value) {
  let remaining = BigInt(value ?? 0);
  if (remaining < 0n) throw new RangeError("protobuf varint cannot be negative");
  const bytes = [];
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Uint8Array.from(bytes);
}

function fieldKey(field, wireType) {
  return varint((field << 3) | wireType);
}

function uintField(field, value) {
  if (!value) return new Uint8Array();
  return concat([fieldKey(field, 0), varint(value)]);
}

function boolField(field, value) {
  return value ? concat([fieldKey(field, 0), Uint8Array.of(1)]) : new Uint8Array();
}

function bytesField(field, value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value ?? 0);
  if (!bytes.length) return new Uint8Array();
  return concat([fieldKey(field, 2), varint(bytes.length), bytes]);
}

function stringField(field, value) {
  return value ? bytesField(field, textEncoder.encode(String(value))) : new Uint8Array();
}

function messageField(field, value) {
  return value?.length ? concat([fieldKey(field, 2), varint(value.length), value]) : new Uint8Array();
}

class Reader {
  constructor(input) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input ?? 0);
    this.offset = 0;
  }

  get done() {
    return this.offset >= this.bytes.length;
  }

  readVarint() {
    let result = 0n;
    let shift = 0n;
    while (this.offset < this.bytes.length && shift <= 63n) {
      const byte = this.bytes[this.offset++];
      result |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return result;
      shift += 7n;
    }
    throw new Error("invalid protobuf varint");
  }

  readNumber() {
    const value = this.readVarint();
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError("protobuf uint64 exceeds JavaScript safe integer range");
    }
    return Number(value);
  }

  readBytes() {
    const length = this.readNumber();
    const end = this.offset + length;
    if (end > this.bytes.length) throw new Error("truncated protobuf bytes field");
    const value = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return value;
  }

  readString() {
    return textDecoder.decode(this.readBytes());
  }

  skip(wireType) {
    if (wireType === 0) {
      this.readVarint();
      return;
    }
    if (wireType === 2) {
      this.readBytes();
      return;
    }
    if (wireType === 1) {
      this.offset += 8;
      return;
    }
    if (wireType === 5) {
      this.offset += 4;
      return;
    }
    throw new Error(`unsupported protobuf wire type ${wireType}`);
  }
}

function decodeMessage(input, handlers) {
  const reader = input instanceof Reader ? input : new Reader(input);
  while (!reader.done) {
    const key = reader.readNumber();
    const field = key >>> 3;
    const wire = key & 7;
    const handler = handlers[field];
    if (handler) handler(reader, wire);
    else reader.skip(wire);
  }
}

export function encodeMutation(mutation) {
  return concat([
    stringField(1, mutation.opId),
    stringField(2, mutation.entityKey),
    uintField(3, mutation.baseVersion),
    uintField(4, mutation.clientTimeMs),
    bytesField(5, mutation.valueJson),
    boolField(6, mutation.deleted),
    stringField(7, mutation.deviceId),
    uintField(8, mutation.clientSeq),
  ]);
}

export function decodeMutation(input) {
  const result = {
    opId: "",
    entityKey: "",
    baseVersion: 0,
    clientTimeMs: 0,
    valueJson: new Uint8Array(),
    deleted: false,
    deviceId: "",
    clientSeq: 0,
  };
  decodeMessage(input, {
    1: (reader) => { result.opId = reader.readString(); },
    2: (reader) => { result.entityKey = reader.readString(); },
    3: (reader) => { result.baseVersion = reader.readNumber(); },
    4: (reader) => { result.clientTimeMs = reader.readNumber(); },
    5: (reader) => { result.valueJson = reader.readBytes(); },
    6: (reader) => { result.deleted = Boolean(reader.readNumber()); },
    7: (reader) => { result.deviceId = reader.readString(); },
    8: (reader) => { result.clientSeq = reader.readNumber(); },
  });
  return result;
}

function encodeAck(ack) {
  return concat([
    stringField(1, ack.opId),
    uintField(2, ack.serverCursor),
    boolField(3, ack.conflict),
    boolField(4, ack.applied),
  ]);
}

function decodeAck(input) {
  const result = { opId: "", serverCursor: 0, conflict: false, applied: false };
  decodeMessage(input, {
    1: (reader) => { result.opId = reader.readString(); },
    2: (reader) => { result.serverCursor = reader.readNumber(); },
    3: (reader) => { result.conflict = Boolean(reader.readNumber()); },
    4: (reader) => { result.applied = Boolean(reader.readNumber()); },
  });
  return result;
}

export function encodeChange(change) {
  return concat([
    uintField(1, change.cursor),
    stringField(2, change.entityKey),
    bytesField(3, change.valueJson),
    boolField(4, change.deleted),
    stringField(5, change.deviceId),
    uintField(6, change.clientTimeMs),
    stringField(7, change.opId),
  ]);
}

export function decodeChange(input) {
  const result = {
    cursor: 0,
    entityKey: "",
    valueJson: new Uint8Array(),
    deleted: false,
    deviceId: "",
    clientTimeMs: 0,
    opId: "",
  };
  decodeMessage(input, {
    1: (reader) => { result.cursor = reader.readNumber(); },
    2: (reader) => { result.entityKey = reader.readString(); },
    3: (reader) => { result.valueJson = reader.readBytes(); },
    4: (reader) => { result.deleted = Boolean(reader.readNumber()); },
    5: (reader) => { result.deviceId = reader.readString(); },
    6: (reader) => { result.clientTimeMs = reader.readNumber(); },
    7: (reader) => { result.opId = reader.readString(); },
  });
  return result;
}

export function encodeSyncRequest(request) {
  return concat([
    stringField(1, request.deviceId),
    uintField(2, request.cursor),
    ...request.mutations.map((mutation) => messageField(3, encodeMutation(mutation))),
    uintField(4, request.pullLimit),
    stringField(5, request.baselineId),
    uintField(6, request.localVersion),
    uintField(7, request.localUpdatedAtMs),
    stringField(8, request.localProgressDay),
  ]);
}

export function decodeSyncRequest(input) {
  const result = {
    deviceId: "",
    cursor: 0,
    mutations: [],
    pullLimit: 0,
    baselineId: "",
    localVersion: 0,
    localUpdatedAtMs: 0,
    localProgressDay: "",
  };
  decodeMessage(input, {
    1: (reader) => { result.deviceId = reader.readString(); },
    2: (reader) => { result.cursor = reader.readNumber(); },
    3: (reader) => { result.mutations.push(decodeMutation(reader.readBytes())); },
    4: (reader) => { result.pullLimit = reader.readNumber(); },
    5: (reader) => { result.baselineId = reader.readString(); },
    6: (reader) => { result.localVersion = reader.readNumber(); },
    7: (reader) => { result.localUpdatedAtMs = reader.readNumber(); },
    8: (reader) => { result.localProgressDay = reader.readString(); },
  });
  return result;
}

export function encodeSyncResponse(response) {
  return concat([
    uintField(1, response.nextCursor),
    ...response.acks.map((ack) => messageField(2, encodeAck(ack))),
    ...response.changes.map((change) => messageField(3, encodeChange(change))),
    boolField(4, response.hasMore),
    boolField(5, response.resetRequired),
    stringField(6, response.baselineId),
    uintField(7, response.serverVersion),
    uintField(8, response.serverUpdatedAtMs),
    stringField(9, response.serverProgressDay),
    boolField(10, response.baselineMismatch),
  ]);
}

export function decodeSyncResponse(input) {
  const result = {
    nextCursor: 0,
    acks: [],
    changes: [],
    hasMore: false,
    resetRequired: false,
    baselineId: "",
    serverVersion: 0,
    serverUpdatedAtMs: 0,
    serverProgressDay: "",
    baselineMismatch: false,
  };
  decodeMessage(input, {
    1: (reader) => { result.nextCursor = reader.readNumber(); },
    2: (reader) => { result.acks.push(decodeAck(reader.readBytes())); },
    3: (reader) => { result.changes.push(decodeChange(reader.readBytes())); },
    4: (reader) => { result.hasMore = Boolean(reader.readNumber()); },
    5: (reader) => { result.resetRequired = Boolean(reader.readNumber()); },
    6: (reader) => { result.baselineId = reader.readString(); },
    7: (reader) => { result.serverVersion = reader.readNumber(); },
    8: (reader) => { result.serverUpdatedAtMs = reader.readNumber(); },
    9: (reader) => { result.serverProgressDay = reader.readString(); },
    10: (reader) => { result.baselineMismatch = Boolean(reader.readNumber()); },
  });
  return result;
}

export function encodeDiffRequest(request) {
  return concat([
    stringField(1, request.deviceId),
    ...request.mutations.map((mutation) => messageField(2, encodeMutation(mutation))),
    stringField(3, request.baselineId),
    uintField(4, request.localVersion),
    uintField(5, request.localUpdatedAtMs),
    stringField(6, request.localProgressDay),
  ]);
}

export function decodeDiffRequest(input) {
  const result = {
    deviceId: "",
    mutations: [],
    baselineId: "",
    localVersion: 0,
    localUpdatedAtMs: 0,
    localProgressDay: "",
  };
  decodeMessage(input, {
    1: (reader) => { result.deviceId = reader.readString(); },
    2: (reader) => { result.mutations.push(decodeMutation(reader.readBytes())); },
    3: (reader) => { result.baselineId = reader.readString(); },
    4: (reader) => { result.localVersion = reader.readNumber(); },
    5: (reader) => { result.localUpdatedAtMs = reader.readNumber(); },
    6: (reader) => { result.localProgressDay = reader.readString(); },
  });
  return result;
}

export function encodeDiffResponse(response) {
  return concat([
    ...response.acks.map((ack) => messageField(1, encodeAck(ack))),
    ...response.canonicalChanges.map((change) => messageField(2, encodeChange(change))),
    stringField(3, response.baselineId),
    uintField(4, response.serverCursor),
    uintField(5, response.serverVersion),
    uintField(6, response.serverUpdatedAtMs),
    stringField(7, response.serverProgressDay),
    boolField(8, response.baselineMismatch),
  ]);
}

export function decodeDiffResponse(input) {
  const result = {
    acks: [],
    canonicalChanges: [],
    baselineId: "",
    serverCursor: 0,
    serverVersion: 0,
    serverUpdatedAtMs: 0,
    serverProgressDay: "",
    baselineMismatch: false,
  };
  decodeMessage(input, {
    1: (reader) => { result.acks.push(decodeAck(reader.readBytes())); },
    2: (reader) => { result.canonicalChanges.push(decodeChange(reader.readBytes())); },
    3: (reader) => { result.baselineId = reader.readString(); },
    4: (reader) => { result.serverCursor = reader.readNumber(); },
    5: (reader) => { result.serverVersion = reader.readNumber(); },
    6: (reader) => { result.serverUpdatedAtMs = reader.readNumber(); },
    7: (reader) => { result.serverProgressDay = reader.readString(); },
    8: (reader) => { result.baselineMismatch = Boolean(reader.readNumber()); },
  });
  return result;
}

export function encodeResolveBaselineRequest(request) {
  return concat([
    stringField(1, request.requestId),
    stringField(2, request.deviceId),
    stringField(3, request.localBaselineId),
    stringField(4, request.expectedServerBaselineId),
    uintField(5, request.expectedServerVersion),
    uintField(6, request.choice),
    ...request.localSnapshot.map((mutation) => messageField(7, encodeMutation(mutation))),
    uintField(8, request.localVersion),
    uintField(9, request.localUpdatedAtMs),
    stringField(10, request.localProgressDay),
  ]);
}

export function decodeResolveBaselineRequest(input) {
  const result = {
    requestId: "",
    deviceId: "",
    localBaselineId: "",
    expectedServerBaselineId: "",
    expectedServerVersion: 0,
    choice: BASELINE_CHOICE.NONE,
    localSnapshot: [],
    localVersion: 0,
    localUpdatedAtMs: 0,
    localProgressDay: "",
  };
  decodeMessage(input, {
    1: (reader) => { result.requestId = reader.readString(); },
    2: (reader) => { result.deviceId = reader.readString(); },
    3: (reader) => { result.localBaselineId = reader.readString(); },
    4: (reader) => { result.expectedServerBaselineId = reader.readString(); },
    5: (reader) => { result.expectedServerVersion = reader.readNumber(); },
    6: (reader) => { result.choice = reader.readNumber(); },
    7: (reader) => { result.localSnapshot.push(decodeMutation(reader.readBytes())); },
    8: (reader) => { result.localVersion = reader.readNumber(); },
    9: (reader) => { result.localUpdatedAtMs = reader.readNumber(); },
    10: (reader) => { result.localProgressDay = reader.readString(); },
  });
  return result;
}

export function encodeResolveBaselineResponse(response) {
  return concat([
    stringField(1, response.baselineId),
    uintField(2, response.serverVersion),
    uintField(3, response.serverUpdatedAtMs),
    stringField(4, response.serverProgressDay),
    ...response.records.map((change) => messageField(5, encodeChange(change))),
    boolField(6, response.stale),
    uintField(7, response.serverCursor),
  ]);
}

export function decodeResolveBaselineResponse(input) {
  const result = {
    baselineId: "",
    serverVersion: 0,
    serverUpdatedAtMs: 0,
    serverProgressDay: "",
    records: [],
    stale: false,
    serverCursor: 0,
  };
  decodeMessage(input, {
    1: (reader) => { result.baselineId = reader.readString(); },
    2: (reader) => { result.serverVersion = reader.readNumber(); },
    3: (reader) => { result.serverUpdatedAtMs = reader.readNumber(); },
    4: (reader) => { result.serverProgressDay = reader.readString(); },
    5: (reader) => { result.records.push(decodeChange(reader.readBytes())); },
    6: (reader) => { result.stale = Boolean(reader.readNumber()); },
    7: (reader) => { result.serverCursor = reader.readNumber(); },
  });
  return result;
}

export function encodeJsonValue(value) {
  return textEncoder.encode(JSON.stringify(value));
}

export function decodeJsonValue(bytes) {
  return JSON.parse(textDecoder.decode(bytes));
}

/** 网络传输使用标准 Base64；Protobuf 本身仍保持 Uint8Array。 */
export function bytesToBase64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input ?? 0);
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
  }
  return btoa(chunks.join(""));
}

export function base64ToBytes(value) {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw new TypeError("invalid Base64 protobuf envelope");
  }
  if (value && !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    throw new TypeError("invalid Base64 protobuf envelope");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
