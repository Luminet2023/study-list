import { computed, readonly, ref } from "vue";

import { resolveApiUrl } from "../lib/apiUrl.js";

const user = ref(null);
const loading = ref(false);
const authError = ref(null);
const authenticated = computed(() => Boolean(user.value));
let initialized = false;

export async function refreshAuthSession() {
  loading.value = true;
  try {
    const response = await fetch(resolveApiUrl("v1/auth/session"), {
      credentials: "include",
      headers: { accept: "application/json" },
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    if (response.status === 401) {
      user.value = null;
      authError.value = null;
      return null;
    }
    if (!response.ok) throw new Error(`会话接口返回 ${response.status}`);
    const payload = await response.json();
    user.value = payload.authenticated ? payload.user : null;
    authError.value = null;
    return user.value;
  } catch (error) {
    user.value = null;
    authError.value = error;
    return null;
  } finally {
    loading.value = false;
  }
}

export async function initializeAuthSession() {
  if (initialized) return user.value;
  initialized = true;
  return refreshAuthSession();
}

export function loginWithLinuxDo() {
  globalThis.location?.assign?.(resolveApiUrl("v1/auth/login/linuxdo"));
}

export async function logoutAuthSession() {
  const response = await fetch(resolveApiUrl("v1/auth/logout"), {
    method: "POST",
    credentials: "include",
    referrerPolicy: "strict-origin-when-cross-origin",
  });
  if (!response.ok) throw new Error("退出登录失败");
  user.value = null;
}

export function useAuthSession() {
  return {
    user: readonly(user),
    authenticated: readonly(authenticated),
    loading: readonly(loading),
    error: readonly(authError),
    refresh: refreshAuthSession,
    login: loginWithLinuxDo,
    logout: logoutAuthSession,
  };
}
