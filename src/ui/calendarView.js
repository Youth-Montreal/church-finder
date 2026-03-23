import { t } from '../i18n.js';
import { shortenAddress } from '../utils/address.js';

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function normalizeDate(value) {
  return new Date(`${value}T00:00:00`);
}

function expandEvent(event, rangeStart, rangeEnd, church) {
  const baseDate = normalizeDate(event.date);
  const until = event.until ? normalizeDate(event.until) : rangeEnd;
  const recurrence = event.recurrence || 'none';

  const occurrences = [];
  let cursor = new Date(baseDate);

  const next = () => {
    if (recurrence === 'weekly') cursor = addDays(cursor, 7);
    else if (recurrence === 'biweekly') cursor = addDays(cursor, 14);
    else if (recurrence === 'monthly') cursor = addMonths(cursor, 1);
    else cursor = addDays(rangeEnd, 1);
  };

  while (cursor <= rangeEnd && cursor <= until) {
    if (cursor >= rangeStart) {
      occurrences.push({
        churchId: church.id,
        churchName: church.name,
        churchAddress: church.address,
        type: event.type,
        ageGroup: event.ageGroup || '',
        time: event.time,
        date: cursor.toISOString().slice(0, 10),
        recurrence
      });
    }
    next();
  }

  return occurrences;
}

export function collectOccurrences(churches, rangeStart, rangeEnd) {
  return churches
    .flatMap((church) => (church.events || []).flatMap((event) => expandEvent(event, rangeStart, rangeEnd, church)))
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function startOfWeek(date) {
  const start = new Date(date);
  start.setDate(start.getDate() - start.getDay());
  return start;
}

function monthGridStart(date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  return startOfWeek(first);
}

function canManage(state, churchId) {
  return state.isAdminMode || (state.isHostMode && state.hostChurchId === churchId);
}

function renderDailyList(rows, state) {
  return rows
    .map(
      (row, index) => `
      <article class="calendar-item">
        <h4>${row.type}</h4>
        <p><strong>${row.date}</strong> ${t(state, 'atLabel')} ${row.time || '00:00'}</p>
        <p>${row.churchName}</p>
        ${row.churchAddress ? `<p>${shortenAddress(row.churchAddress)}</p>` : ''}
        ${row.ageGroup ? `<p>${t(state, 'ageGroup')}: ${row.ageGroup}</p>` : ''}
        <div class="finder-actions compact-actions">
          <button type="button" class="secondary calendar-suggest-btn" data-row-index="${index}">${t(state, 'suggestEventUpdate')}</button>
          ${canManage(state, row.churchId) ? `<button type="button" class="secondary calendar-edit-btn" data-row-index="${index}">${t(state, 'editPin')}</button>` : ''}
          ${canManage(state, row.churchId) ? `<button type="button" class="secondary calendar-delete-btn" data-row-index="${index}">${t(state, 'delete')}</button>` : ''}
        </div>
      </article>
    `
    )
    .join('');
}

function renderWeekGrid(rows, state, rangeStart) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(rangeStart, index));
  return `
    <div class="calendar-grid calendar-grid-week">
      ${days
        .map((day) => {
          const dateKey = day.toISOString().slice(0, 10);
          const dayRows = rows.filter((row) => row.date === dateKey);
          return `
            <section class="calendar-cell">
              <header>
                <strong>${day.toLocaleDateString('en-CA', { weekday: 'short' })}</strong>
                <span>${dateKey}</span>
              </header>
              <div class="calendar-cell-events">
                ${dayRows.length
                  ? dayRows
                      .map(
                        (row, index) => `
                      <article class="calendar-badge" data-row-index="${rows.indexOf(row)}">
                        <strong>${row.time || '00:00'}</strong>
                        <span>${row.type}</span>
                        <em>${row.churchName}</em>
                      </article>
                    `
                      )
                      .join('')
                  : `<p class="help-text">${t(state, 'noEventsForFilters')}</p>`}
              </div>
            </section>
          `;
        })
        .join('')}
    </div>
  `;
}

function renderMonthGrid(rows, state, rangeStart) {
  const first = monthGridStart(rangeStart);
  const days = Array.from({ length: 35 }, (_, index) => addDays(first, index));
  return `
    <div class="calendar-grid calendar-grid-month">
      ${days
        .map((day) => {
          const dateKey = day.toISOString().slice(0, 10);
          const dayRows = rows.filter((row) => row.date === dateKey);
          return `
            <section class="calendar-cell ${day.getMonth() === rangeStart.getMonth() ? '' : 'calendar-cell-muted'}">
              <header>
                <strong>${day.getDate()}</strong>
                <span>${day.toLocaleDateString('en-CA', { weekday: 'short' })}</span>
              </header>
              <div class="calendar-cell-events">
                ${dayRows
                  .slice(0, 4)
                  .map(
                    (row) => `
                    <article class="calendar-badge" data-row-index="${rows.indexOf(row)}">
                      <strong>${row.time || '00:00'}</strong>
                      <span>${row.type}</span>
                    </article>
                  `
                  )
                  .join('')}
              </div>
            </section>
          `;
        })
        .join('')}
    </div>
  `;
}

export function renderCalendarList({ state, elements, onSuggestEventUpdate, onEditEvent, onDeleteEvent }) {
  const keyword = elements.calendarKeyword.value.trim().toLowerCase();
  const type = elements.calendarType.value.trim().toLowerCase();
  const language = elements.calendarLanguage.value.trim().toLowerCase();
  const ageGroup = elements.calendarAge?.value || '';
  const from = elements.calendarFrom.value || new Date().toISOString().slice(0, 10);
  const mode = elements.calendarMode?.value || 'daily';

  const rangeStart = normalizeDate(from);
  const rangeEnd = new Date(rangeStart);
  if (mode === 'daily') rangeEnd.setDate(rangeEnd.getDate() + 1);
  if (mode === 'weekly') rangeEnd.setDate(rangeEnd.getDate() + 7);
  if (mode === 'monthly') rangeEnd.setMonth(rangeEnd.getMonth() + 1);

  const rows = collectOccurrences(state.churches, rangeStart, rangeEnd).filter((row) => {
    const church = state.churches.find((item) => item.id === row.churchId);
    if (!church) return false;
    const text = `${row.churchName} ${row.churchAddress || ''} ${row.type}`.toLowerCase();
    const byKeyword = !keyword || text.includes(keyword);
    const byType = !type || row.type.toLowerCase().includes(type);
    const byLanguage = !language || (church.languages || []).join(' ').toLowerCase().includes(language);
    const byAge = !ageGroup || (row.ageGroup || '').toLowerCase() === ageGroup.toLowerCase();
    return byKeyword && byType && byLanguage && byAge;
  });

  elements.calendarCount.textContent = `${rows.length} ${t(state, 'eventsFound')}`;
  if (!rows.length) {
    elements.calendarList.innerHTML = `<p class="help-text">${t(state, 'noEventsForFilters')}</p>`;
    return;
  }

  if (mode === 'daily') elements.calendarList.innerHTML = renderDailyList(rows, state);
  if (mode === 'weekly') elements.calendarList.innerHTML = renderWeekGrid(rows, state, startOfWeek(rangeStart));
  if (mode === 'monthly') elements.calendarList.innerHTML = renderMonthGrid(rows, state, rangeStart);

  elements.calendarList.querySelectorAll('.calendar-suggest-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const row = rows[Number(button.dataset.rowIndex)];
      if (!row) return;
      const church = state.churches.find((item) => item.id === row.churchId);
      if (!church) return;
      onSuggestEventUpdate?.(church, row);
    });
  });

  elements.calendarList.querySelectorAll('.calendar-edit-btn, .calendar-badge').forEach((button) => {
    button.addEventListener('click', () => {
      const row = rows[Number(button.dataset.rowIndex)];
      if (!row || !canManage(state, row.churchId)) return;
      onEditEvent?.(row);
    });
  });

  elements.calendarList.querySelectorAll('.calendar-delete-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const row = rows[Number(button.dataset.rowIndex)];
      if (!row || !canManage(state, row.churchId)) return;
      onDeleteEvent?.(row);
    });
  });
}
