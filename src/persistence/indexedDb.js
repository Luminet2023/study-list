export const CAMPAIGN_SCHEMA_VERSION = 1;

const DATABASE_NAME = "zako-study-list";
const DATABASE_VERSION = CAMPAIGN_SCHEMA_VERSION;
const STORE_NAME = "campaign";
const STATE_KEY = "state";
const LOCAL_STORAGE_KEY = `${DATABASE_NAME}:${STORE_NAME}:${STATE_KEY}`;
const CHANNEL_NAME = `${DATABASE_NAME}:state-changes`;
const REVISION_MESSAGE_TYPE = "campaign-state-revision";

let databasePromise;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRevision(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function cloneSerializableState(value, label = "campaign state") {
  if (!isObject(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable`, { cause: error });
  }

  if (serialized === undefined) {
    throw new TypeError(`${label} must be JSON-serializable`);
  }

  return JSON.parse(serialized);
}

function assertPersistedState(value) {
  if (!isObject(value)) {
    throw new TypeError("Persisted campaign state must be an object");
  }
  if (value.schemaVersion !== CAMPAIGN_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported campaign schema version: ${String(value.schemaVersion)}`,
    );
  }
  if (!isRevision(value.revision)) {
    throw new TypeError(
      "Persisted campaign revision must be a non-negative safe integer",
    );
  }
  if (
    value.lastUpdatedAt !== null &&
    (typeof value.lastUpdatedAt !== "string" ||
      Number.isNaN(Date.parse(value.lastUpdatedAt)))
  ) {
    throw new TypeError(
      "Persisted campaign lastUpdatedAt must be an ISO date string or null",
    );
  }

  return value;
}

function createFallbackState(fallbackFactory) {
  if (typeof fallbackFactory !== "function") {
    throw new TypeError("fallbackFactory must be a function");
  }

  const fallback = fallbackFactory();
  if (fallback && typeof fallback.then === "function") {
    throw new TypeError("fallbackFactory must return synchronously");
  }

  const state = cloneSerializableState(fallback, "fallback campaign state");
  const revision = isRevision(state.revision) ? state.revision : 0;
  const lastUpdatedAt =
    state.lastUpdatedAt === null ||
    (typeof state.lastUpdatedAt === "string" &&
      !Number.isNaN(Date.parse(state.lastUpdatedAt)))
      ? state.lastUpdatedAt
      : null;

  return {
    ...state,
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    revision,
    lastUpdatedAt,
  };
}

function createNextState(value, revision) {
  const state = cloneSerializableState(value);

  return {
    ...state,
    schemaVersion: CAMPAIGN_SCHEMA_VERSION,
    revision,
    lastUpdatedAt: new Date().toISOString(),
  };
}

function runMutator(currentState, mutator) {
  if (typeof mutator !== "function") {
    throw new TypeError("mutator must be a function");
  }

  const draft = cloneSerializableState(currentState);
  const result = mutator(draft);
  if (result && typeof result.then === "function") {
    throw new TypeError(
      "mutator must run synchronously inside the storage transaction",
    );
  }

  return result === undefined ? draft : result;
}

function hasIndexedDb() {
  return typeof globalThis.indexedDB !== "undefined";
}

function openDatabase() {
  if (databasePromise) {
    return databasePromise;
  }

  databasePromise = new Promise((resolve, reject) => {
    let request;
    let blocked = false;

    try {
      request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      databasePromise = undefined;
      reject(error);
      return;
    }

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    });

    request.addEventListener("blocked", () => {
      blocked = true;
      databasePromise = undefined;
      reject(
        new Error(`Opening IndexedDB database "${DATABASE_NAME}" was blocked`),
      );
    });

    request.addEventListener("error", () => {
      databasePromise = undefined;
      reject(
        request.error ??
          new Error(`Unable to open IndexedDB database "${DATABASE_NAME}"`),
      );
    });

    request.addEventListener("success", () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }

      database.addEventListener("versionchange", () => {
        database.close();
        databasePromise = undefined;
      });
      database.addEventListener("close", () => {
        databasePromise = undefined;
      });
      resolve(database);
    });
  });

  return databasePromise;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    });
  });
}

function transactionCompletion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("abort", () => {
      reject(
        transaction.error ?? new DOMException("Transaction aborted", "AbortError"),
      );
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    });
  });
}

async function abortAndRethrow(transaction, completion, error) {
  try {
    transaction.abort();
  } catch (abortError) {
    if (abortError?.name !== "InvalidStateError") {
      throw new AggregateError(
        [error, abortError],
        "Campaign transaction failed and could not be aborted cleanly",
      );
    }
  }

  try {
    await completion;
  } catch (completionError) {
    if (completionError?.name !== "AbortError" && completionError !== error) {
      throw new AggregateError(
        [error, completionError],
        "Campaign transaction failed while aborting",
      );
    }
  }

  throw error;
}

function getLocalStorage() {
  let storage;
  try {
    storage = globalThis.localStorage;
  } catch (error) {
    throw new Error("localStorage is unavailable", { cause: error });
  }

  if (!storage) {
    throw new Error("Neither IndexedDB nor localStorage is available");
  }
  return storage;
}

function readLocalState(storage) {
  const serialized = storage.getItem(LOCAL_STORAGE_KEY);
  if (serialized === null) {
    return undefined;
  }

  let state;
  try {
    state = JSON.parse(serialized);
  } catch (error) {
    throw new Error("Stored campaign state contains invalid JSON", {
      cause: error,
    });
  }

  return assertPersistedState(state);
}

function writeLocalState(storage, state) {
  storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

function postRevisionMessage(revision, lastUpdatedAt) {
  if (typeof globalThis.BroadcastChannel === "undefined") {
    return false;
  }

  const channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
  try {
    channel.postMessage({
      type: REVISION_MESSAGE_TYPE,
      revision,
      lastUpdatedAt,
    });
  } finally {
    channel.close();
  }
  return true;
}

async function loadIndexedDbState(fallbackFactory) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readonly");
  const completion = transactionCompletion(transaction);
  try {
    const state = await requestResult(
      transaction.objectStore(STORE_NAME).get(STATE_KEY),
    );
    await completion;

    if (state === undefined) {
      return createFallbackState(fallbackFactory);
    }
    return cloneSerializableState(assertPersistedState(state));
  } catch (error) {
    return abortAndRethrow(transaction, completion, error);
  }
}

async function saveIndexedDbState(state) {
  const incoming = cloneSerializableState(state);
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completion = transactionCompletion(transaction);
  const store = transaction.objectStore(STORE_NAME);

  try {
    const stored = await requestResult(store.get(STATE_KEY));
    const currentRevision =
      stored === undefined ? 0 : assertPersistedState(stored).revision;
    const incomingRevision = isRevision(incoming.revision) ? incoming.revision : 0;
    const next = createNextState(
      incoming,
      Math.max(currentRevision, incomingRevision) + 1,
    );
    await requestResult(store.put(next, STATE_KEY));
    await completion;
    postRevisionMessage(next.revision, next.lastUpdatedAt);
    return cloneSerializableState(next);
  } catch (error) {
    return abortAndRethrow(transaction, completion, error);
  }
}

async function transactIndexedDbState(fallbackFactory, mutator) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, "readwrite");
  const completion = transactionCompletion(transaction);
  const store = transaction.objectStore(STORE_NAME);

  try {
    const stored = await requestResult(store.get(STATE_KEY));
    const current =
      stored === undefined
        ? createFallbackState(fallbackFactory)
        : cloneSerializableState(assertPersistedState(stored));
    const mutated = runMutator(current, mutator);
    const next = createNextState(mutated, current.revision + 1);
    await requestResult(store.put(next, STATE_KEY));
    await completion;
    postRevisionMessage(next.revision, next.lastUpdatedAt);
    return cloneSerializableState(next);
  } catch (error) {
    return abortAndRethrow(transaction, completion, error);
  }
}

function loadLocalStorageState(fallbackFactory) {
  const state = readLocalState(getLocalStorage());
  return state === undefined
    ? createFallbackState(fallbackFactory)
    : cloneSerializableState(state);
}

function saveLocalStorageState(state) {
  const storage = getLocalStorage();
  const incoming = cloneSerializableState(state);
  const stored = readLocalState(storage);
  const next = createNextState(
    incoming,
    Math.max(
      stored?.revision ?? 0,
      isRevision(incoming.revision) ? incoming.revision : 0,
    ) + 1,
  );

  writeLocalState(storage, next);
  postRevisionMessage(next.revision, next.lastUpdatedAt);
  return cloneSerializableState(next);
}

function transactLocalStorageState(fallbackFactory, mutator) {
  const storage = getLocalStorage();
  const stored = readLocalState(storage);
  const current =
    stored === undefined ? createFallbackState(fallbackFactory) : stored;
  const mutated = runMutator(current, mutator);
  const next = createNextState(mutated, current.revision + 1);

  writeLocalState(storage, next);
  postRevisionMessage(next.revision, next.lastUpdatedAt);
  return cloneSerializableState(next);
}

export async function loadCampaignState(fallbackFactory) {
  if (!hasIndexedDb()) {
    return loadLocalStorageState(fallbackFactory);
  }
  return loadIndexedDbState(fallbackFactory);
}

export async function saveCampaignState(state) {
  if (!hasIndexedDb()) {
    return saveLocalStorageState(state);
  }
  return saveIndexedDbState(state);
}

export async function transactCampaignState(fallbackFactory, mutator) {
  if (!hasIndexedDb()) {
    return transactLocalStorageState(fallbackFactory, mutator);
  }
  return transactIndexedDbState(fallbackFactory, mutator);
}

export async function requestPersistentStorage() {
  const persist = globalThis.navigator?.storage?.persist;
  if (typeof persist !== "function") {
    return false;
  }
  return persist.call(globalThis.navigator.storage);
}

export function createCampaignChannel(onExternalRevision) {
  if (typeof onExternalRevision !== "function") {
    throw new TypeError("onExternalRevision must be a function");
  }

  if (typeof globalThis.BroadcastChannel === "undefined") {
    return Object.freeze({
      postRevision: () => false,
      close: () => {},
    });
  }

  const channel = new globalThis.BroadcastChannel(CHANNEL_NAME);
  let closed = false;

  const handleMessage = (event) => {
    const message = event.data;
    if (
      !isObject(message) ||
      message.type !== REVISION_MESSAGE_TYPE ||
      !isRevision(message.revision)
    ) {
      return;
    }
    onExternalRevision(message.revision, message);
  };

  channel.addEventListener("message", handleMessage);

  return Object.freeze({
    postRevision(revision) {
      if (closed) {
        throw new Error("Campaign channel is closed");
      }
      if (!isRevision(revision)) {
        throw new TypeError("revision must be a non-negative safe integer");
      }
      channel.postMessage({
        type: REVISION_MESSAGE_TYPE,
        revision,
        lastUpdatedAt: new Date().toISOString(),
      });
      return true;
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      channel.removeEventListener("message", handleMessage);
      channel.close();
    },
  });
}
