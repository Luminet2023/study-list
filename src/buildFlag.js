export function installBuildFlag(target, commitHash) {
  const flag = Object.freeze({ ver: commitHash });
  Object.defineProperty(target, "flag", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: flag,
  });
  return flag;
}
