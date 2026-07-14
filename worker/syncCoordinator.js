import { DurableObject } from "cloudflare:workers";

import {
  BASELINE_CHOICE,
  decodeResolveBaselineRequest,
  decodeSyncRequest,
  encodeResolveBaselineResponse,
  encodeSyncResponse,
} from "../src/sync/protocol.js";

const MAX_MUTATIONS = 200;
const MAX_RESOLUTION_RECORDS = 768;
const DEFAULT_PULL_LIMIT = 128;
const MAX_PULL_LIMIT = 256;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_BURST = 8;
const RESOLUTION_RATE_WINDOW_MS = 60_000;
const RESOLUTION_RATE_BURST = 3;
const CAMPAIGN_START = "2026-07-13";
const BASELINE_ID_PATTERN = /^baseline_[a-f0-9]{32}$/u;
const textDecoder = new TextDecoder();

function createBaselineId() {
  return `baseline_${crypto.randomUUID().replaceAll("-", "")}`;
}

function asBytes(value) {
  return value instanceof Uint8Array ? value : new Uint8Array(value ?? 0);
}

function asChange(row) {
  return {
    cursor: Number(row.cursor),
    entityKey: row.entity_key,
    valueJson: asBytes(row.value),
    deleted: Boolean(row.deleted),
    deviceId: row.device_id,
    clientTimeMs: Number(row.client_time),
    opId: row.op_id,
  };
}

function firstRow(cursor) {
  return cursor.toArray()[0];
}

function validateBaselineId(value, label = "baseline_id") {
  if (!BASELINE_ID_PATTERN.test(value)) throw new Error(`invalid ${label}`);
}

function validateDeviceId(deviceId) {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(deviceId)) throw new Error("invalid device_id");
}

function profileText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function asUserProfile(row) {
  if (!row) return null;
  return {
    subject: row.linuxdo_subject,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    email: row.email ?? "",
    createdAt: new Date(Number(row.created_at)).toISOString(),
    updatedAt: new Date(Number(row.updated_at)).toISOString(),
    lastLoginAt: new Date(Number(row.last_login_at)).toISOString(),
  };
}

function validateMutation(mutation, requestDeviceId) {
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(mutation.opId)) throw new Error("invalid mutation op_id");
  if (!mutation.entityKey.startsWith("stella/v1/") || mutation.entityKey.length > 512) {
    throw new Error("invalid mutation entity_key");
  }
  if (mutation.deviceId !== requestDeviceId) throw new Error("mutation device_id mismatch");
  if (mutation.valueJson.length > 128 * 1024) throw new Error("mutation value is too large");
}

function currentCursor(sql) {
  return Number(sql.exec("SELECT cursor FROM sync_meta WHERE id = 1").one().cursor);
}

function checkRateLimit(sql, table, windowMs, burst) {
  const now = Date.now();
  const rate = firstRow(sql.exec(`SELECT window_started, request_count FROM ${table} WHERE id = 1`));
  if (!rate || now - Number(rate.window_started) >= windowMs) {
    sql.exec(
      `INSERT INTO ${table} (id, window_started, request_count) VALUES (1, ?, 1)
       ON CONFLICT(id) DO UPDATE SET window_started = excluded.window_started, request_count = 1`,
      now,
    );
    return 0;
  }
  if (Number(rate.request_count) >= burst) {
    return Math.max(windowMs - (now - Number(rate.window_started)), 1000);
  }
  sql.exec(`UPDATE ${table} SET request_count = request_count + 1 WHERE id = 1`);
  return 0;
}

function decodeRecordValue(row) {
  try {
    return JSON.parse(textDecoder.decode(asBytes(row.value)));
  } catch {
    return undefined;
  }
}

function deriveProgressDay(sql) {
  const dates = [];
  for (const row of sql.exec("SELECT entity_key, value, deleted FROM records").toArray()) {
    if (row.deleted) continue;
    const segments = row.entity_key.split("/").slice(2).map((segment) => decodeURIComponent(segment));
    const value = decodeRecordValue(row);
    if (segments[0] === "day" && segments[1]) {
      const kind = segments[2];
      const meaningful =
        (kind === "journal" && String(value ?? "").trim()) ||
        // 周末模板默认就是 locked；只有 lockedAt 才代表用户真正锁定过目标。
        (kind === "goals" && Boolean(value?.lockedAt)) ||
        (kind === "blessing" && value?.liked) ||
        (kind === "item" && (String(value?.input ?? "").trim() || value?.status !== "pending"));
      if (meaningful) dates.push(segments[1]);
    } else if (segments[0] === "quote" && value?.date) {
      dates.push(value.date);
    } else if (segments[0] === "raffle" && (value?.drawDate || value?.date)) {
      dates.push(value.drawDate || value.date);
    }
  }
  return dates.sort().at(-1) ?? CAMPAIGN_START;
}

function snapshotChanges(sql) {
  return sql.exec("SELECT * FROM records ORDER BY entity_key ASC").toArray().map(asChange);
}

function ensureLineage(sql, requestedBaselineId) {
  const existing = firstRow(sql.exec(
    "SELECT baseline_id, version, updated_at, progress_day FROM sync_lineage WHERE id = 1",
  ));
  if (existing) return existing;
  const cursor = currentCursor(sql);
  const baselineId = cursor === 0 ? requestedBaselineId : createBaselineId();
  const updatedAt = cursor === 0 ? 0 : Date.now();
  const progressDay = cursor === 0 ? CAMPAIGN_START : deriveProgressDay(sql);
  sql.exec(
    "INSERT INTO sync_lineage (id, baseline_id, version, updated_at, progress_day) VALUES (1, ?, 0, ?, ?)",
    baselineId,
    updatedAt,
    progressDay,
  );
  return { baseline_id: baselineId, version: 0, updated_at: updatedAt, progress_day: progressDay };
}

function appendOperation(sql, mutation, cursor, deviceId, clientTimeMs, opId = mutation.opId) {
  sql.exec(
    `INSERT INTO operations
      (cursor, op_id, entity_key, value, deleted, device_id, client_time)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    cursor,
    opId,
    mutation.entityKey,
    mutation.valueJson,
    mutation.deleted ? 1 : 0,
    deviceId,
    clientTimeMs,
  );
  sql.exec(
    `INSERT INTO records
      (entity_key, cursor, value, deleted, device_id, client_time, op_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(entity_key) DO UPDATE SET
       cursor = excluded.cursor,
       value = excluded.value,
       deleted = excluded.deleted,
       device_id = excluded.device_id,
       client_time = excluded.client_time,
       op_id = excluded.op_id`,
    mutation.entityKey,
    cursor,
    mutation.valueJson,
    mutation.deleted ? 1 : 0,
    deviceId,
    clientTimeMs,
    opId,
  );
}

export class UserSyncCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS user_profile (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          owner_key TEXT NOT NULL UNIQUE,
          linuxdo_subject TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL,
          display_name TEXT NOT NULL,
          avatar_url TEXT NOT NULL,
          email TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_login_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          cursor INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO sync_meta (id, cursor) VALUES (1, 0);
        CREATE TABLE IF NOT EXISTS records (
          entity_key TEXT PRIMARY KEY,
          cursor INTEGER NOT NULL,
          value BLOB NOT NULL,
          deleted INTEGER NOT NULL,
          device_id TEXT NOT NULL,
          client_time INTEGER NOT NULL,
          op_id TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS operations (
          cursor INTEGER PRIMARY KEY,
          op_id TEXT UNIQUE NOT NULL,
          entity_key TEXT NOT NULL,
          value BLOB NOT NULL,
          deleted INTEGER NOT NULL,
          device_id TEXT NOT NULL,
          client_time INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS receipts (
          op_id TEXT PRIMARY KEY,
          server_cursor INTEGER NOT NULL,
          conflict INTEGER NOT NULL,
          applied INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sync_lineage (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          baseline_id TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          progress_day TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS baseline_resolutions (
          request_id TEXT PRIMARY KEY,
          local_baseline_id TEXT NOT NULL,
          expected_server_baseline_id TEXT NOT NULL,
          expected_server_version INTEGER NOT NULL,
          choice INTEGER NOT NULL,
          result_baseline_id TEXT NOT NULL,
          result_cursor INTEGER NOT NULL,
          result_version INTEGER NOT NULL DEFAULT 0,
          result_updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS request_rate_limit (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          window_started INTEGER NOT NULL,
          request_count INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS resolution_rate_limit (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          window_started INTEGER NOT NULL,
          request_count INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS operations_cursor_idx ON operations(cursor);
      `);
      const lineageColumns = this.ctx.storage.sql.exec("PRAGMA table_info(sync_lineage)").toArray();
      if (!lineageColumns.some((column) => column.name === "version")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE sync_lineage ADD COLUMN version INTEGER NOT NULL DEFAULT 0",
        );
      }
      const resolutionColumns = this.ctx.storage.sql.exec("PRAGMA table_info(baseline_resolutions)").toArray();
      if (!resolutionColumns.some((column) => column.name === "result_version")) {
        this.ctx.storage.sql.exec(
          "ALTER TABLE baseline_resolutions ADD COLUMN result_version INTEGER NOT NULL DEFAULT 0",
        );
      }
      if (firstRow(this.ctx.storage.sql.exec("SELECT id FROM sync_lineage WHERE id = 1"))) {
        this.ctx.storage.sql.exec(
          "UPDATE sync_lineage SET progress_day = ? WHERE id = 1",
          deriveProgressDay(this.ctx.storage.sql),
        );
      }
    });
  }

  upsertUserProfile(profile, ownerKey) {
    if (!/^[a-f0-9]{64}$/u.test(ownerKey)) throw new Error("invalid owner_key");
    const subject = profileText(profile?.subject, 128);
    if (!subject) throw new Error("invalid linuxdo subject");
    const username = profileText(profile?.username, 128);
    const displayName = profileText(profile?.displayName, 256) || username || "Linux DO 用户";
    const avatarUrl = profileText(profile?.avatarUrl, 2048);
    const email = profile?.email === undefined ? null : profileText(profile.email, 320) || null;
    const now = Date.now();
    const requestedLastLoginAt = Number(profile?.lastLoginAtMs);
    const lastLoginAt = Number.isSafeInteger(requestedLastLoginAt) && requestedLastLoginAt > 0
      ? Math.min(requestedLastLoginAt, now + MAX_FUTURE_SKEW_MS)
      : now;
    const sql = this.ctx.storage.sql;
    sql.exec(
      `INSERT INTO user_profile
        (id, owner_key, linuxdo_subject, username, display_name, avatar_url, email,
         created_at, updated_at, last_login_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         owner_key = excluded.owner_key,
         linuxdo_subject = excluded.linuxdo_subject,
         username = excluded.username,
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         email = COALESCE(excluded.email, user_profile.email),
         updated_at = excluded.updated_at,
         last_login_at = MAX(user_profile.last_login_at, excluded.last_login_at)`,
      ownerKey,
      subject,
      username,
      displayName,
      avatarUrl,
      email,
      now,
      now,
      lastLoginAt,
    );
    return this.getUserProfile();
  }

  getUserProfile() {
    return asUserProfile(firstRow(this.ctx.storage.sql.exec("SELECT * FROM user_profile WHERE id = 1")));
  }

  async archiveChanges(ownerKey, baselineId, changes, headCursor, serverVersion) {
    await Promise.all(changes.map((change) => {
      const record = encodeSyncResponse({
        nextCursor: change.cursor,
        acks: [],
        changes: [change],
        hasMore: false,
        resetRequired: false,
        baselineId,
        serverVersion,
        serverUpdatedAtMs: Date.now(),
        serverProgressDay: CAMPAIGN_START,
        baselineMismatch: false,
      });
      return this.env.SYNC_KV.put(
        `users/${ownerKey}/baselines/${baselineId}/changes/${String(change.cursor).padStart(16, "0")}`,
        record,
        { metadata: { entityKey: change.entityKey, opId: change.opId } },
      );
    }));
    await this.env.SYNC_KV.put(
      `users/${ownerKey}/baselines/${baselineId}/head`,
      JSON.stringify({ baselineId, cursor: headCursor }),
    );
  }

  async exchange(bytes, ownerKey) {
    const request = decodeSyncRequest(bytes);
    validateDeviceId(request.deviceId);
    validateBaselineId(request.baselineId);
    if (request.mutations.length > MAX_MUTATIONS) throw new Error("too many mutations");
    const pullLimit = Math.min(Math.max(request.pullLimit || DEFAULT_PULL_LIMIT, 1), MAX_PULL_LIMIT);
    const sql = this.ctx.storage.sql;
    const retryAfterMs = checkRateLimit(sql, "request_rate_limit", RATE_LIMIT_WINDOW_MS, RATE_LIMIT_BURST);
    if (retryAfterMs) return { body: null, retryAfterMs };

    let lineage = ensureLineage(sql, request.baselineId);
    let headCursor = currentCursor(sql);
    if (lineage.baseline_id !== request.baselineId) {
      return {
        body: encodeSyncResponse({
          nextCursor: request.cursor,
          acks: [],
          changes: [],
          hasMore: false,
          resetRequired: false,
          baselineId: lineage.baseline_id,
          serverVersion: Number(lineage.version),
          serverUpdatedAtMs: Number(lineage.updated_at),
          serverProgressDay: lineage.progress_day,
          baselineMismatch: true,
        }),
        retryAfterMs: 0,
      };
    }

    const acks = [];
    const forcedChanges = [];
    const archiveChanges = [];
    let appliedCount = 0;
    for (const mutation of request.mutations) {
      validateMutation(mutation, request.deviceId);
      mutation.clientTimeMs = Math.min(
        Math.max(Number(mutation.clientTimeMs) || 0, 1),
        Date.now() + MAX_FUTURE_SKEW_MS,
      );
      const receipt = firstRow(sql.exec(
        "SELECT server_cursor, conflict, applied FROM receipts WHERE op_id = ?",
        mutation.opId,
      ));
      if (receipt) {
        acks.push({
          opId: mutation.opId,
          serverCursor: Number(receipt.server_cursor),
          conflict: Boolean(receipt.conflict),
          applied: Boolean(receipt.applied),
        });
        continue;
      }

      const existing = firstRow(sql.exec("SELECT * FROM records WHERE entity_key = ?", mutation.entityKey));
      const conflict = Boolean(existing && Number(existing.cursor) > mutation.baseVersion);
      const applied = !existing || Number(existing.cursor) <= mutation.baseVersion;
      let serverCursor = Number(existing?.cursor ?? 0);
      if (applied) {
        serverCursor = Number(
          sql.exec("UPDATE sync_meta SET cursor = cursor + 1 WHERE id = 1 RETURNING cursor").one().cursor,
        );
        appendOperation(sql, mutation, serverCursor, mutation.deviceId, mutation.clientTimeMs);
        archiveChanges.push({ ...mutation, cursor: serverCursor });
        appliedCount += 1;
      } else if (existing) {
        forcedChanges.push(asChange(existing));
      }
      sql.exec(
        "INSERT INTO receipts (op_id, server_cursor, conflict, applied) VALUES (?, ?, ?, ?)",
        mutation.opId,
        serverCursor,
        conflict ? 1 : 0,
        applied ? 1 : 0,
      );
      acks.push({ opId: mutation.opId, serverCursor, conflict, applied });
    }

    if (appliedCount) {
      const updatedAt = Date.now();
      const progressDay = deriveProgressDay(sql);
      const version = Number(sql.exec(
        `UPDATE sync_lineage
         SET version = version + 1, updated_at = ?, progress_day = ?
         WHERE id = 1
         RETURNING version`,
        updatedAt,
        progressDay,
      ).one().version);
      lineage = { ...lineage, version, updated_at: updatedAt, progress_day: progressDay };
    }

    const rows = sql.exec(
      "SELECT * FROM operations WHERE cursor > ? ORDER BY cursor ASC LIMIT ?",
      request.cursor,
      pullLimit + 1,
    ).toArray();
    const hasMore = rows.length > pullLimit;
    const pageChanges = rows.slice(0, pullLimit).map(asChange);
    const changes = [...pageChanges];
    const seen = new Set(changes.map((change) => `${change.cursor}:${change.entityKey}`));
    for (const change of forcedChanges) {
      const identity = `${change.cursor}:${change.entityKey}`;
      if (!seen.has(identity)) changes.push(change);
    }
    changes.sort((left, right) => left.cursor - right.cursor);
    const nextCursor = pageChanges.at(-1)?.cursor ?? request.cursor;
    headCursor = currentCursor(sql);
    const response = {
      nextCursor,
      acks,
      changes,
      hasMore,
      resetRequired: request.cursor > headCursor,
      baselineId: lineage.baseline_id,
      serverVersion: Number(lineage.version),
      serverUpdatedAtMs: Number(lineage.updated_at),
      serverProgressDay: lineage.progress_day,
      baselineMismatch: false,
    };

    if (archiveChanges.length) {
      this.ctx.waitUntil(
        this.archiveChanges(
          ownerKey,
          lineage.baseline_id,
          archiveChanges,
          headCursor,
          Number(lineage.version),
        ).catch((error) => {
          console.error(JSON.stringify({ event: "sync_kv_archive_failed", message: error?.message }));
        }),
      );
    }
    return { body: encodeSyncResponse(response), retryAfterMs: 0 };
  }

  async resolveBaseline(bytes, ownerKey) {
    const request = decodeResolveBaselineRequest(bytes);
    validateDeviceId(request.deviceId);
    validateBaselineId(request.localBaselineId, "local_baseline_id");
    validateBaselineId(request.expectedServerBaselineId, "expected_server_baseline_id");
    if (!/^[A-Za-z0-9_-]{12,128}$/u.test(request.requestId)) throw new Error("invalid request_id");
    if (![BASELINE_CHOICE.USE_LOCAL, BASELINE_CHOICE.USE_SERVER].includes(request.choice)) {
      throw new Error("invalid baseline choice");
    }
    if (request.localSnapshot.length > MAX_RESOLUTION_RECORDS) throw new Error("snapshot has too many records");
    const sql = this.ctx.storage.sql;
    const retryAfterMs = checkRateLimit(
      sql,
      "resolution_rate_limit",
      RESOLUTION_RATE_WINDOW_MS,
      RESOLUTION_RATE_BURST,
    );
    if (retryAfterMs) return { body: null, retryAfterMs };

    let lineage = ensureLineage(sql, request.localBaselineId);
    let headCursor = currentCursor(sql);
    const receipt = firstRow(sql.exec("SELECT * FROM baseline_resolutions WHERE request_id = ?", request.requestId));
    if (receipt) {
      const sameRequest =
        receipt.local_baseline_id === request.localBaselineId &&
        receipt.expected_server_baseline_id === request.expectedServerBaselineId &&
        Number(receipt.expected_server_version) === request.expectedServerVersion &&
        Number(receipt.choice) === request.choice;
      if (!sameRequest) throw new Error("resolution request_id was reused with different data");
      const receiptIsCurrent =
        lineage.baseline_id === receipt.result_baseline_id &&
        Number(lineage.version) === Number(receipt.result_version);
      return {
        body: encodeResolveBaselineResponse({
          baselineId: lineage.baseline_id,
          serverVersion: Number(lineage.version),
          serverUpdatedAtMs: Number(lineage.updated_at),
          serverProgressDay: lineage.progress_day,
          records: receiptIsCurrent ? snapshotChanges(sql) : [],
          stale: !receiptIsCurrent,
          serverCursor: headCursor,
        }),
        retryAfterMs: 0,
      };
    }

    if (
      lineage.baseline_id !== request.expectedServerBaselineId ||
      Number(lineage.version) !== request.expectedServerVersion
    ) {
      return {
        body: encodeResolveBaselineResponse({
          baselineId: lineage.baseline_id,
          serverVersion: Number(lineage.version),
          serverUpdatedAtMs: Number(lineage.updated_at),
          serverProgressDay: lineage.progress_day,
          records: [],
          stale: true,
          serverCursor: headCursor,
        }),
        retryAfterMs: 0,
      };
    }

    const archiveChanges = [];
    const now = Date.now();
    if (request.choice === BASELINE_CHOICE.USE_LOCAL) {
      const localByKey = new Map();
      for (const mutation of request.localSnapshot) {
        validateMutation(mutation, request.deviceId);
        if (localByKey.has(mutation.entityKey)) throw new Error("snapshot contains duplicate entity_key");
        localByKey.set(mutation.entityKey, mutation);
      }
      this.ctx.storage.transactionSync(() => {
        // 基线已经更换，旧基线的 cursor/operation 不再有意义；新基线从稀疏快照重新计数。
        sql.exec("DELETE FROM receipts");
        sql.exec("DELETE FROM operations");
        sql.exec("DELETE FROM records");
        sql.exec("UPDATE sync_meta SET cursor = 0 WHERE id = 1");
        sql.exec("DELETE FROM baseline_resolutions");
        for (const mutation of [...localByKey.values()].sort((left, right) => left.entityKey.localeCompare(right.entityKey))) {
          const cursor = Number(
            sql.exec("UPDATE sync_meta SET cursor = cursor + 1 WHERE id = 1 RETURNING cursor").one().cursor,
          );
          appendOperation(sql, mutation, cursor, request.deviceId, now);
          archiveChanges.push({ ...mutation, cursor, clientTimeMs: now });
        }
        headCursor = currentCursor(sql);
        const progressDay = deriveProgressDay(sql);
        const version = localByKey.size ? 1 : 0;
        sql.exec(
          `UPDATE sync_lineage
           SET baseline_id = ?, version = ?, updated_at = ?, progress_day = ?
           WHERE id = 1`,
          request.localBaselineId,
          version,
          now,
          progressDay,
        );
        sql.exec(
          `INSERT INTO baseline_resolutions
            (request_id, local_baseline_id, expected_server_baseline_id, expected_server_version,
             choice, result_baseline_id, result_cursor, result_version, result_updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          request.requestId,
          request.localBaselineId,
          request.expectedServerBaselineId,
          request.expectedServerVersion,
          request.choice,
          request.localBaselineId,
          headCursor,
          version,
          now,
        );
      });
      lineage = {
        baseline_id: request.localBaselineId,
        version: localByKey.size ? 1 : 0,
        updated_at: now,
        progress_day: deriveProgressDay(sql),
      };
    } else {
      sql.exec(
        `INSERT INTO baseline_resolutions
          (request_id, local_baseline_id, expected_server_baseline_id, expected_server_version,
           choice, result_baseline_id, result_cursor, result_version, result_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        request.requestId,
        request.localBaselineId,
        request.expectedServerBaselineId,
        request.expectedServerVersion,
        request.choice,
        lineage.baseline_id,
        headCursor,
        Number(lineage.version),
        Number(lineage.updated_at),
      );
    }

    if (request.choice === BASELINE_CHOICE.USE_LOCAL) {
      this.ctx.waitUntil(
        this.archiveChanges(
          ownerKey,
          lineage.baseline_id,
          archiveChanges,
          headCursor,
          Number(lineage.version),
        ).catch((error) => {
          console.error(JSON.stringify({ event: "resolution_kv_archive_failed", message: error?.message }));
        }),
      );
    }
    return {
      body: encodeResolveBaselineResponse({
        baselineId: lineage.baseline_id,
        serverVersion: Number(lineage.version),
        serverUpdatedAtMs: Number(lineage.updated_at),
        serverProgressDay: lineage.progress_day,
        records: snapshotChanges(sql),
        stale: false,
        serverCursor: headCursor,
      }),
      retryAfterMs: 0,
    };
  }
}
