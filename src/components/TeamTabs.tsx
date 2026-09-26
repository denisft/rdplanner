// Переключатель команд: сегменты-вкладки. Двойной клик по вкладке —
// переименовать на месте (вместо window.prompt). В режиме просмотра
// (без onAdd) с одной командой не показываем — переключать нечего.

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Team } from '../types';
import { Tip } from '../ui/Tooltip';

export function TeamTabs({
  teams,
  activeId,
  onSelect,
  onAdd,
  onRename,
  editingId,
  onEditingChange,
}: {
  teams: Team[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  onRename?: (id: string, name: string) => void;
  /** Какая вкладка сейчас переименовывается (управляется снаружи — меню «Файл»). */
  editingId: string | null;
  onEditingChange: (id: string | null) => void;
}) {
  if (teams.length <= 1 && !onAdd) return null;
  return (
    // Скроллбар спрятан, чтобы не распирал шапку по высоте; прокрутка — колесом.
    <div
      role="tablist"
      aria-label="Команды"
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-[10px] border border-line bg-surface-2 p-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {teams.map((t) =>
        editingId === t.id && onRename ? (
          <RenameInput
            key={t.id}
            initial={t.name}
            onDone={(name) => {
              if (name && name !== t.name) onRename(t.id, name);
              onEditingChange(null);
            }}
          />
        ) : (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === activeId}
            onClick={() => onSelect(t.id)}
            onDoubleClick={() => onRename && onEditingChange(t.id)}
            title={onRename ? 'Двойной клик — переименовать' : undefined}
            className={`h-7 shrink-0 cursor-pointer rounded-lg px-2.5 text-[13px] font-semibold whitespace-nowrap ${
              t.id === activeId
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgb(15_23_42/0.08),0_0_0_1px_var(--color-line)]'
                : 'text-muted hover:text-ink'
            }`}
          >
            {t.name}
          </button>
        ),
      )}
      {onAdd && (
        <Tip label="Новая команда">
          <button
            onClick={onAdd}
            aria-label="Добавить команду"
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg text-faint hover:text-primary"
          >
            <Plus size={14} />
          </button>
        </Tip>
      )}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    onDone(save ? value.trim() : '');
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label="Название команды"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(false);
        }
      }}
      className="h-7 w-36 shrink-0 rounded-lg bg-surface px-2.5 text-[13px] font-semibold text-ink outline-none ring-2 ring-primary"
    />
  );
}
