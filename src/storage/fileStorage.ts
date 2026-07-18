// Хранение данных в локальном файле через File System Access API.
// Работает в Chrome/Edge на Windows. Есть запасные пути: скачать/загрузить файл
// и автосохранение в localStorage, чтобы данные переживали перезагрузку вкладки.

import type { AppData, SavedFile } from '../types';
import { SCHEMA_VERSION } from '../types';
import { migrateAppData } from './migrate';

const LS_KEY = 'resource-planner:data';

// Минимальные типы File System Access API (нет в стандартной lib).
interface FsFileHandle {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
  getFile: () => Promise<File>;
  name: string;
}

interface FsWindow {
  showSaveFilePicker?: (opts?: unknown) => Promise<FsFileHandle>;
  showOpenFilePicker?: (opts?: unknown) => Promise<FsFileHandle[]>;
}

export function hasFileSystemAccess(): boolean {
  const w = window as unknown as FsWindow;
  return typeof w.showSaveFilePicker === 'function';
}

const pickerOpts = {
  suggestedName: 'team-plan.json',
  types: [
    {
      description: 'План команды (JSON)',
      accept: { 'application/json': ['.json'] },
    },
  ],
};

function serialize(data: AppData): string {
  const payload: SavedFile = { version: SCHEMA_VERSION, data };
  return JSON.stringify(payload, null, 2);
}

function deserialize(text: string): AppData {
  const parsed = JSON.parse(text) as SavedFile | AppData;
  // Поддержка как обёрнутого формата, так и «голого» AppData.
  const raw = (parsed as SavedFile).data ?? (parsed as AppData);
  // Приводим к текущей схеме (старые планы — без команд).
  return migrateAppData(raw);
}

/** Сохранить в файл. Возвращает handle для последующей перезаписи без диалога. */
export async function saveToFile(
  data: AppData,
  handle: FsFileHandle | null,
): Promise<FsFileHandle | null> {
  const w = window as unknown as FsWindow;
  if (hasFileSystemAccess()) {
    const h = handle ?? (await w.showSaveFilePicker!(pickerOpts));
    const writable = await h.createWritable();
    await writable.write(serialize(data));
    await writable.close();
    return h;
  }
  // Запасной путь: скачать файл.
  downloadFallback(data);
  return null;
}

/** Открыть файл. Возвращает данные и handle (если доступен API). */
export async function openFromFile(): Promise<{
  data: AppData;
  handle: FsFileHandle | null;
}> {
  const w = window as unknown as FsWindow;
  if (hasFileSystemAccess()) {
    const [h] = await w.showOpenFilePicker!(pickerOpts);
    const file = await h.getFile();
    const text = await file.text();
    return { data: deserialize(text), handle: h };
  }
  // Запасной путь: <input type=file>.
  const text = await uploadFallback();
  return { data: deserialize(text), handle: null };
}

function downloadFallback(data: AppData): void {
  const blob = new Blob([serialize(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'team-plan.json';
  a.click();
  URL.revokeObjectURL(url);
}

function uploadFallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('Файл не выбран'));
      file.text().then(resolve, reject);
    };
    input.click();
  });
}

// --- Автосохранение в localStorage (страховка между перезагрузками) ---

export function autosave(data: AppData): void {
  try {
    localStorage.setItem(LS_KEY, serialize(data));
  } catch {
    // переполнение/приватный режим — игнорируем
  }
}

export function loadAutosave(): AppData | null {
  try {
    const text = localStorage.getItem(LS_KEY);
    return text ? deserialize(text) : null;
  } catch {
    return null;
  }
}

export type { FsFileHandle };
