// Шпаргалка по управлению (клавиша «?»): сюда переехал абзац подсказок,
// который раньше стоял под легендой ганта.

import { Fragment, type ReactNode } from 'react';
import { Kbd } from '../ui/Button';
import { Modal } from '../ui/Dialog';

const ROWS: [ReactNode, string][] = [
  [<Kbd key="n">N</Kbd>, 'Новая задача'],
  [
    <>
      <Kbd>Ctrl</Kbd> <Kbd>Z</Kbd>
    </>,
    'Отменить',
  ],
  [
    <>
      <Kbd>Ctrl</Kbd> <Kbd>Shift</Kbd> <Kbd>Z</Kbd>
    </>,
    'Повторить (или Ctrl+Y)',
  ],
  [
    <>
      <Kbd>Ctrl</Kbd> <Kbd>S</Kbd>
    </>,
    'Сохранить в файл',
  ],
  [<Kbd key="t">T</Kbd>, 'Прокрутить гант к сегодня'],
  [<Kbd key="s">/</Kbd>, 'Поиск по задачам и людям'],
  [<Kbd key="e">Esc</Kbd>, 'Закрыть окно или панель'],
  ['перетащить', 'Закрепить этап на другом дне или человеке'],
  ['клик по этапу', 'Открыть задачу'],
  ['двойной клик', 'Снять закрепление этапа'],
  [<Kbd key="q">?</Kbd>, 'Эта шпаргалка'],
];

export function KeyboardHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Управление" onClose={onClose} width="max-w-md">
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
        {ROWS.map(([keys, text], i) => (
          <Fragment key={i}>
            <dt className="flex justify-end gap-1 text-[13px] font-semibold text-muted">{keys}</dt>
            <dd className="m-0 text-ink">{text}</dd>
          </Fragment>
        ))}
      </dl>
    </Modal>
  );
}
