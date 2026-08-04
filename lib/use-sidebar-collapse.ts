"use client";

import { useEffect, useState } from "react";

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

export function useSidebarCollapse() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [collapsed]);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }

  return [collapsed, toggle] as const;
}
