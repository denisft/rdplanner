// Аналитика использования (Umami Cloud). Скрипт трекера подключён в
// index.html и работает только на проде (data-domains) — в dev и превью
// window.umami нет, и вызовы просто ничего не делают.
// Правило: содержимое планов (имена людей, названия задач) не отправляем —
// только факты действий и числовые счётчики.

type EventData = Record<string, string | number>;

declare global {
  interface Window {
    umami?: { track: (event: string, data?: EventData) => void };
  }
}

export function track(event: string, data?: EventData): void {
  if (window.umami) {
    send(event, data);
    return;
  }
  // Скрипт трекера грузится с defer и мог не успеть к раннему событию
  // (например, открытие плана по ссылке) — одна отложенная попытка.
  setTimeout(() => send(event, data), 2000);
}

function send(event: string, data?: EventData): void {
  try {
    window.umami?.track(event, data);
  } catch {
    // аналитика никогда не должна ронять приложение
  }
}
