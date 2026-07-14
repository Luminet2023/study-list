import { createRouter, createWebHistory } from "vue-router";

import { CAMPAIGN_START, clampCampaignDate } from "../domain/campaign.js";

const RouteMarker = { name: "RouteMarker", render: () => null };

function shanghaiToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const initialDate = clampCampaignDate(shanghaiToday()) || CAMPAIGN_START;

// 兼容旧书签：首次打开 /#/day/... 时直接迁移到无 Hash 的标准路径。
if (typeof window !== "undefined" && window.location.hash.startsWith("#/")) {
  window.history.replaceState(window.history.state, "", window.location.hash.slice(1));
}

const routes = [
  {
    path: "/",
    redirect: { name: "day", params: { date: initialDate } },
  },
  {
    path: "/day/:date?",
    name: "day",
    component: RouteMarker,
    meta: { viewMode: "day", label: "日视图" },
  },
  {
    path: "/week/:date?",
    name: "week",
    component: RouteMarker,
    meta: { viewMode: "week", label: "周视图" },
  },
  {
    path: "/month/:month?",
    name: "month",
    component: RouteMarker,
    meta: { viewMode: "month", label: "月视图" },
  },
  {
    path: "/stats/week/:date?",
    name: "week-stats",
    component: RouteMarker,
    meta: { viewMode: "week-stats", label: "本周统计" },
  },
  {
    path: "/stats/total",
    name: "total",
    component: RouteMarker,
    meta: { viewMode: "total", label: "总统计" },
  },
  {
    path: "/favorites",
    name: "favorites",
    component: RouteMarker,
    meta: { viewMode: "favorites", label: "赠语收藏" },
  },
  {
    path: "/raffle",
    name: "raffle",
    component: RouteMarker,
    meta: { viewMode: "raffle", label: "摸鱼大转盘" },
  },
  {
    path: "/settings",
    name: "settings",
    component: RouteMarker,
    meta: { viewMode: "settings", label: "设置" },
  },
  {
    path: "/ending",
    name: "ending",
    component: RouteMarker,
    meta: { viewMode: "ending", label: "旅程终章" },
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: { name: "day", params: { date: initialDate } },
  },
];

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior: () => ({ left: 0, top: 0 }),
});
