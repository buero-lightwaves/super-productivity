/**
 * Configuration for CalDAV calendar sync.
 * When a task is scheduled with a time, a VEVENT is created in the configured calendar.
 */
export interface CaldavCalendarCfg {
  isEnabled: boolean;
  caldavUrl: string | null;
  calendarName: string | null;
  username: string | null;
  password: string | null;
}

export const DEFAULT_CALDAV_CALENDAR_CFG: CaldavCalendarCfg = {
  isEnabled: false,
  caldavUrl: null,
  calendarName: null,
  username: null,
  password: null,
};

export interface CalendarEventData {
  uid: string;
  summary: string;
  start: number;
  end: number;
  description?: string;
}
