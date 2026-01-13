import { Injectable, inject } from '@angular/core';
import {
  CaldavCalendarCfg,
  CalendarEventData,
  CalendarTodoData,
} from './caldav-calendar.model';
// @ts-ignore
import DavClient, { namespaces as NS } from '@nextcloud/cdav-library';
// @ts-ignore
import Calendar from 'cdav-library/models/calendar';
// @ts-ignore
import ICAL from 'ical.js';

import { from, Observable, throwError } from 'rxjs';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { catchError } from 'rxjs/operators';
import { HANDLED_ERROR_PROP_STR } from '../../app.constants';
import { throwHandledError } from '../../util/throw-handled-error';
import { Log } from '../../core/log';

interface ClientCache {
  client: DavClient;
  calendars: Map<string, Calendar>;
}

@Injectable({
  providedIn: 'root',
})
export class CaldavCalendarService {
  private readonly _snackService = inject(SnackService);
  private _clientCache = new Map<string, ClientCache>();

  private static _isValidSettings(cfg: CaldavCalendarCfg): boolean {
    return (
      !!cfg &&
      cfg.isEnabled &&
      !!cfg.caldavUrl &&
      cfg.caldavUrl.length > 0 &&
      !!cfg.calendarName &&
      cfg.calendarName.length > 0 &&
      !!cfg.username &&
      cfg.username.length > 0 &&
      !!cfg.password &&
      cfg.password.length > 0
    );
  }

  private static _getCalendarUriFromUrl(url: string): string {
    if (url.endsWith('/')) {
      url = url.substring(0, url.length - 1);
    }
    return url.substring(url.lastIndexOf('/') + 1);
  }

  private static _generateUid(): string {
    return 'sp-' + crypto.randomUUID();
  }

  private static _formatIcalDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  }

  /**
   * Test connection to CalDAV server and return available calendars
   */
  async testConnection(
    cfg: CaldavCalendarCfg,
  ): Promise<{ success: boolean; calendars?: string[]; error?: string }> {
    try {
      // Clear cache to force fresh connection
      this._clientCache.clear();

      const client = new DavClient(
        {
          rootUrl: cfg.caldavUrl,
        },
        this._getXhrProvider(cfg),
      );

      await client.connect({ enableCalDAV: true });

      if (!client.calendarHomes || client.calendarHomes.length === 0) {
        return { success: false, error: 'No calendar home found' };
      }

      const calendars = await client.calendarHomes[0].findAllCalendars();
      const calendarNames = calendars.map(
        (cal: Calendar) =>
          cal.displayname || CaldavCalendarService._getCalendarUriFromUrl(cal.url),
      );

      // Check if configured calendar exists
      const targetCalendar = cfg.calendarName;
      const calendarFound = targetCalendar
        ? calendarNames.includes(targetCalendar)
        : true;

      return {
        success: true,
        calendars: calendarNames,
        error: calendarFound
          ? undefined
          : `Calendar "${targetCalendar}" not found. Available: ${calendarNames.join(', ')}`,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Create a calendar event (VEVENT) for a scheduled task
   */
  createEvent$(cfg: CaldavCalendarCfg, eventData: CalendarEventData): Observable<string> {
    return from(this._createEvent(cfg, eventData)).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar: ' + err }),
      ),
    );
  }

  /**
   * Update an existing calendar event
   */
  updateEvent$(
    cfg: CaldavCalendarCfg,
    uid: string,
    eventData: Partial<CalendarEventData>,
  ): Observable<void> {
    return from(this._updateEvent(cfg, uid, eventData)).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar: ' + err }),
      ),
    );
  }

  /**
   * Delete a calendar event
   */
  deleteEvent$(cfg: CaldavCalendarCfg, uid: string): Observable<void> {
    return from(this._deleteEvent(cfg, uid)).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar: ' + err }),
      ),
    );
  }

  // ==================== VTODO Methods ====================

  /**
   * Create a VTODO for a task
   */
  createTodo$(cfg: CaldavCalendarCfg, todoData: CalendarTodoData): Observable<string> {
    return from(this._createTodo(cfg, todoData)).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar (VTODO): ' + err }),
      ),
    );
  }

  /**
   * Update an existing VTODO
   */
  updateTodo$(
    cfg: CaldavCalendarCfg,
    uid: string,
    todoData: Partial<CalendarTodoData>,
  ): Observable<void> {
    return from(this._updateTodo(cfg, uid, todoData)).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar (VTODO): ' + err }),
      ),
    );
  }

  /**
   * Mark a VTODO as completed
   */
  completeTodo$(cfg: CaldavCalendarCfg, uid: string): Observable<void> {
    return from(
      this._updateTodo(cfg, uid, { status: 'COMPLETED', percentComplete: 100 }),
    ).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar (VTODO): ' + err }),
      ),
    );
  }

  /**
   * Delete a VTODO
   */
  deleteTodo$(cfg: CaldavCalendarCfg, uid: string): Observable<void> {
    return from(this._deleteTodo(cfg, uid)).pipe(
      catchError((err) =>
        throwError({ [HANDLED_ERROR_PROP_STR]: 'CalDAV Calendar (VTODO): ' + err }),
      ),
    );
  }

  private async _getClient(cfg: CaldavCalendarCfg): Promise<ClientCache> {
    this._checkSettings(cfg);

    const clientKey = `${cfg.caldavUrl}|${cfg.username}|${cfg.password}`;

    if (this._clientCache.has(clientKey)) {
      return this._clientCache.get(clientKey) as ClientCache;
    }

    const client = new DavClient(
      {
        rootUrl: cfg.caldavUrl,
      },
      this._getXhrProvider(cfg),
    );

    await client
      .connect({ enableCalDAV: true })
      .catch((err: unknown) => this._handleNetErr(err));

    const cache = {
      client,
      calendars: new Map(),
    };
    this._clientCache.set(clientKey, cache);

    return cache;
  }

  private async _getCalendar(cfg: CaldavCalendarCfg): Promise<Calendar> {
    const clientCache = await this._getClient(cfg);
    const resource = cfg.calendarName as string;

    if (clientCache.calendars.has(resource)) {
      return clientCache.calendars.get(resource);
    }

    const calendars = await clientCache.client.calendarHomes[0]
      .findAllCalendars()
      .catch((err: unknown) => this._handleNetErr(err));

    const calendar = calendars.find(
      (item: Calendar) =>
        (item.displayname || CaldavCalendarService._getCalendarUriFromUrl(item.url)) ===
        resource,
    );

    if (calendar !== undefined) {
      clientCache.calendars.set(resource, calendar);
      return calendar;
    }

    this._snackService.open({
      type: 'ERROR',
      translateParams: {
        calendarName: cfg.calendarName as string,
      },
      msg: T.F.CALDAV.S.CALENDAR_NOT_FOUND,
    });
    throw new Error('CALENDAR NOT FOUND: ' + cfg.calendarName);
  }

  private async _createEvent(
    cfg: CaldavCalendarCfg,
    eventData: CalendarEventData,
  ): Promise<string> {
    console.log('CalDAV: Creating event', {
      cfg: { ...cfg, password: '***' },
      eventData,
    });
    const calendar = await this._getCalendar(cfg);
    console.log('CalDAV: Got calendar', calendar?.displayname || calendar?.url);

    if (calendar.readOnly) {
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          calendarName: cfg.calendarName as string,
        },
        msg: T.F.CALDAV.S.CALENDAR_READ_ONLY,
      });
      throw new Error('CALENDAR READ ONLY: ' + cfg.calendarName);
    }

    const uid = eventData.uid || CaldavCalendarService._generateUid();
    const now = CaldavCalendarService._formatIcalDateTime(Date.now());
    const dtstart = CaldavCalendarService._formatIcalDateTime(eventData.start);
    const dtend = CaldavCalendarService._formatIcalDateTime(eventData.end);

    const icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Super Productivity//CalDAV Calendar Sync//EN
BEGIN:VEVENT
UID:${uid}
DTSTAMP:${now}
DTSTART:${dtstart}
DTEND:${dtend}
SUMMARY:${this._escapeIcalText(eventData.summary)}
${eventData.description ? `DESCRIPTION:${this._escapeIcalText(eventData.description)}` : ''}
SEQUENCE:0
END:VEVENT
END:VCALENDAR`;

    try {
      await calendar.createVObject(icalData);
      Log.log('CalDAV Calendar: Created event', uid);
      return uid;
    } catch (err) {
      this._handleNetErr(err);
      throw err;
    }
  }

  private async _updateEvent(
    cfg: CaldavCalendarCfg,
    uid: string,
    eventData: Partial<CalendarEventData>,
  ): Promise<void> {
    const calendar = await this._getCalendar(cfg);

    if (calendar.readOnly) {
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          calendarName: cfg.calendarName as string,
        },
        msg: T.F.CALDAV.S.CALENDAR_READ_ONLY,
      });
      throw new Error('CALENDAR READ ONLY: ' + cfg.calendarName);
    }

    // Find the event by UID
    const events = await this._findEventByUid(calendar, uid);

    if (events.length < 1) {
      Log.warn('CalDAV Calendar: Event not found for update', uid);
      return;
    }

    const event = events[0];
    const jCal = ICAL.parse(event.data);
    const comp = new ICAL.Component(jCal);
    const vevent = comp.getFirstSubcomponent('vevent');

    if (!vevent) {
      Log.err('No vevent found', event);
      return;
    }

    const now = ICAL.Time.now();
    let changeObserved = false;

    if (eventData.summary !== undefined) {
      const oldSummary = vevent.getFirstPropertyValue('summary');
      if (eventData.summary !== oldSummary) {
        vevent.updatePropertyWithValue('summary', eventData.summary);
        changeObserved = true;
      }
    }

    if (eventData.start !== undefined) {
      const newStart = ICAL.Time.fromJSDate(new Date(eventData.start), false);
      vevent.updatePropertyWithValue('dtstart', newStart);
      changeObserved = true;
    }

    if (eventData.end !== undefined) {
      const newEnd = ICAL.Time.fromJSDate(new Date(eventData.end), false);
      vevent.updatePropertyWithValue('dtend', newEnd);
      changeObserved = true;
    }

    if (eventData.description !== undefined) {
      vevent.updatePropertyWithValue('description', eventData.description);
      changeObserved = true;
    }

    if (!changeObserved) {
      return;
    }

    vevent.updatePropertyWithValue('last-modified', now);
    vevent.updatePropertyWithValue('dtstamp', now);

    const sequence = vevent.getFirstPropertyValue('sequence');
    const sequenceInt = sequence ? parseInt(sequence as string) + 1 : 1;
    vevent.updatePropertyWithValue('sequence', sequenceInt);

    event.data = ICAL.stringify(jCal);
    if (event.update) {
      await event.update().catch((err: unknown) => this._handleNetErr(err));
    }

    Log.log('CalDAV Calendar: Updated event', uid);
  }

  private async _deleteEvent(cfg: CaldavCalendarCfg, uid: string): Promise<void> {
    const calendar = await this._getCalendar(cfg);

    const events = await this._findEventByUid(calendar, uid);

    if (events.length < 1) {
      Log.warn('CalDAV Calendar: Event not found for deletion', uid);
      return;
    }

    const event = events[0];

    if (event.delete) {
      await event.delete().catch((err: unknown) => this._handleNetErr(err));
    }

    Log.log('CalDAV Calendar: Deleted event', uid);
  }

  // ==================== Private VTODO Implementation ====================

  private async _createTodo(
    cfg: CaldavCalendarCfg,
    todoData: CalendarTodoData,
  ): Promise<string> {
    console.log('CalDAV: Creating VTODO', {
      cfg: { ...cfg, password: '***' },
      todoData,
    });
    const calendar = await this._getCalendar(cfg);
    console.log('CalDAV: Got calendar for VTODO', calendar?.displayname || calendar?.url);

    if (calendar.readOnly) {
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          calendarName: cfg.calendarName as string,
        },
        msg: T.F.CALDAV.S.CALENDAR_READ_ONLY,
      });
      throw new Error('CALENDAR READ ONLY: ' + cfg.calendarName);
    }

    const uid = todoData.uid || CaldavCalendarService._generateUid();
    const now = CaldavCalendarService._formatIcalDateTime(Date.now());

    let icalData = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Super Productivity//CalDAV Calendar Sync//EN
BEGIN:VTODO
UID:${uid}
DTSTAMP:${now}
CREATED:${now}
SUMMARY:${this._escapeIcalText(todoData.summary)}
STATUS:${todoData.status || 'NEEDS-ACTION'}`;

    if (todoData.description) {
      icalData += `\nDESCRIPTION:${this._escapeIcalText(todoData.description)}`;
    }

    if (todoData.priority !== undefined) {
      icalData += `\nPRIORITY:${todoData.priority}`;
    }

    if (todoData.dueDate !== undefined) {
      const dueStr = CaldavCalendarService._formatIcalDateTime(todoData.dueDate);
      icalData += `\nDUE:${dueStr}`;
    }

    if (todoData.percentComplete !== undefined) {
      icalData += `\nPERCENT-COMPLETE:${todoData.percentComplete}`;
    }

    icalData += `
SEQUENCE:0
END:VTODO
END:VCALENDAR`;

    try {
      await calendar.createVObject(icalData);
      Log.log('CalDAV Calendar: Created VTODO', uid);
      return uid;
    } catch (err) {
      this._handleNetErr(err);
      throw err;
    }
  }

  private async _updateTodo(
    cfg: CaldavCalendarCfg,
    uid: string,
    todoData: Partial<CalendarTodoData>,
  ): Promise<void> {
    const calendar = await this._getCalendar(cfg);

    if (calendar.readOnly) {
      this._snackService.open({
        type: 'ERROR',
        translateParams: {
          calendarName: cfg.calendarName as string,
        },
        msg: T.F.CALDAV.S.CALENDAR_READ_ONLY,
      });
      throw new Error('CALENDAR READ ONLY: ' + cfg.calendarName);
    }

    // Find the VTODO by UID
    const todos = await this._findTodoByUid(calendar, uid);

    if (todos.length < 1) {
      Log.warn('CalDAV Calendar: VTODO not found for update', uid);
      return;
    }

    const todo = todos[0];
    const jCal = ICAL.parse(todo.data);
    const comp = new ICAL.Component(jCal);
    const vtodo = comp.getFirstSubcomponent('vtodo');

    if (!vtodo) {
      Log.err('No vtodo found', todo);
      return;
    }

    const now = ICAL.Time.now();
    let changeObserved = false;

    if (todoData.summary !== undefined) {
      const oldSummary = vtodo.getFirstPropertyValue('summary');
      if (todoData.summary !== oldSummary) {
        vtodo.updatePropertyWithValue('summary', todoData.summary);
        changeObserved = true;
      }
    }

    if (todoData.description !== undefined) {
      vtodo.updatePropertyWithValue('description', todoData.description);
      changeObserved = true;
    }

    if (todoData.status !== undefined) {
      vtodo.updatePropertyWithValue('status', todoData.status);
      changeObserved = true;
      // Set COMPLETED timestamp when marking as completed
      if (todoData.status === 'COMPLETED') {
        vtodo.updatePropertyWithValue('completed', now);
      }
    }

    if (todoData.percentComplete !== undefined) {
      vtodo.updatePropertyWithValue('percent-complete', todoData.percentComplete);
      changeObserved = true;
    }

    if (todoData.priority !== undefined) {
      vtodo.updatePropertyWithValue('priority', todoData.priority);
      changeObserved = true;
    }

    if (todoData.dueDate !== undefined) {
      const newDue = ICAL.Time.fromJSDate(new Date(todoData.dueDate), false);
      vtodo.updatePropertyWithValue('due', newDue);
      changeObserved = true;
    }

    if (!changeObserved) {
      return;
    }

    vtodo.updatePropertyWithValue('last-modified', now);
    vtodo.updatePropertyWithValue('dtstamp', now);

    const sequence = vtodo.getFirstPropertyValue('sequence');
    const sequenceInt = sequence ? parseInt(sequence as string) + 1 : 1;
    vtodo.updatePropertyWithValue('sequence', sequenceInt);

    todo.data = ICAL.stringify(jCal);
    if (todo.update) {
      await todo.update().catch((err: unknown) => this._handleNetErr(err));
    }

    Log.log('CalDAV Calendar: Updated VTODO', uid);
  }

  private async _deleteTodo(cfg: CaldavCalendarCfg, uid: string): Promise<void> {
    const calendar = await this._getCalendar(cfg);

    const todos = await this._findTodoByUid(calendar, uid);

    if (todos.length < 1) {
      Log.warn('CalDAV Calendar: VTODO not found for deletion', uid);
      return;
    }

    const todo = todos[0];

    if (todo.delete) {
      await todo.delete().catch((err: unknown) => this._handleNetErr(err));
    }

    Log.log('CalDAV Calendar: Deleted VTODO', uid);
  }

  private async _findTodoByUid(
    calendar: Calendar,
    todoUid: string,
  ): Promise<
    {
      data: string;
      url: string;
      etag: string;
      update?: () => Promise<void>;
      delete?: () => Promise<void>;
    }[]
  > {
    const query = {
      name: [NS.IETF_CALDAV, 'comp-filter'],
      attributes: [['name', 'VCALENDAR']],
      children: [
        {
          name: [NS.IETF_CALDAV, 'comp-filter'],
          attributes: [['name', 'VTODO']],
          children: [
            {
              name: [NS.IETF_CALDAV, 'prop-filter'],
              attributes: [['name', 'uid']],
              children: [
                {
                  name: [NS.IETF_CALDAV, 'text-match'],
                  value: todoUid,
                },
              ],
            },
          ],
        },
      ],
    };
    return await calendar.calendarQuery([query]);
  }

  private async _findEventByUid(
    calendar: Calendar,
    eventUid: string,
  ): Promise<
    {
      data: string;
      url: string;
      etag: string;
      update?: () => Promise<void>;
      delete?: () => Promise<void>;
    }[]
  > {
    const query = {
      name: [NS.IETF_CALDAV, 'comp-filter'],
      attributes: [['name', 'VCALENDAR']],
      children: [
        {
          name: [NS.IETF_CALDAV, 'comp-filter'],
          attributes: [['name', 'VEVENT']],
          children: [
            {
              name: [NS.IETF_CALDAV, 'prop-filter'],
              attributes: [['name', 'uid']],
              children: [
                {
                  name: [NS.IETF_CALDAV, 'text-match'],
                  value: eventUid,
                },
              ],
            },
          ],
        },
      ],
    };
    return await calendar.calendarQuery([query]);
  }

  private _escapeIcalText(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }

  private _getXhrProvider(cfg: CaldavCalendarCfg): () => XMLHttpRequest {
    // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
    function xhrProvider(): XMLHttpRequest {
      const xhr = new XMLHttpRequest();
      const oldOpen = xhr.open;

      xhr.open = function (): void {
        // @ts-ignore
        // eslint-disable-next-line prefer-rest-params
        const result = oldOpen.apply(this, arguments);
        // @ts-ignore
        xhr.setRequestHeader('X-Requested-With', 'SuperProductivity');
        xhr.setRequestHeader(
          'Authorization',
          'Basic ' + btoa(cfg.username + ':' + cfg.password),
        );
        return result;
      };
      return xhr;
    }

    return xhrProvider;
  }

  private _handleNetErr(err: unknown): never {
    this._snackService.open({
      type: 'ERROR',
      msg: T.F.ISSUE.S.ERR_NETWORK,
      translateParams: {
        issueProviderName: 'CalDAV Calendar',
      },
    });
    throw new Error('CALDAV CALENDAR NETWORK ERROR: ' + err);
  }

  private _checkSettings(cfg: CaldavCalendarCfg): void {
    if (!CaldavCalendarService._isValidSettings(cfg)) {
      this._snackService.open({
        type: 'ERROR',
        msg: T.F.ISSUE.S.ERR_NOT_CONFIGURED,
        translateParams: {
          issueProviderName: 'CalDAV Calendar',
        },
      });
      throwHandledError('CalDAV Calendar: Not enough settings');
    }
  }
}
