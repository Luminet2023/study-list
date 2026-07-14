export function createUndoHistory(initialValue = "") {
  let entries = [String(initialValue ?? "")];
  let index = 0;

  return {
    reset(value = "") {
      entries = [String(value ?? "")];
      index = 0;
      return entries[index];
    },

    record(value) {
      const next = String(value ?? "");
      if (entries[index] === next) return next;
      entries = entries.slice(0, index + 1);
      entries.push(next);
      index += 1;
      return next;
    },

    undo() {
      if (index > 0) index -= 1;
      return entries[index];
    },

    redo() {
      if (index < entries.length - 1) index += 1;
      return entries[index];
    },
  };
}
