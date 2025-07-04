import { create } from "zustand";

export const useThemeStore = create((set) => ({
  theme: localStorage.getItem("ChatApp") || "forest",
  setTheme: (theme) => {
    localStorage.setItem("ChatApp", theme);
    set({ theme });
  },
}));