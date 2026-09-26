// Тема оформления — личная настройка вида зрителя (localStorage), не часть
// плана. 'system' — следовать теме ОС. На <html> всегда стоит data-theme с
// итоговым значением: CSS знает только 'light' | 'dark' (см. index.css).
// Первичная установка — инлайн-скрипт в index.html, чтобы не мигало.

import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_KEY = 'resource-planner:theme';

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function loadChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const resolve = (c: ThemeChoice): 'light' | 'dark' =>
  c === 'system' ? (media().matches ? 'dark' : 'light') : c;

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(loadChoice);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const on = () => setSystemDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const resolved = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  /** Переключить на противоположную текущей и запомнить явный выбор. */
  const toggle = () => {
    const next = resolve(choice) === 'dark' ? 'light' : 'dark';
    setChoice(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // приватный режим — выбор не переживёт перезагрузку
    }
  };

  return { resolved, toggle };
}
