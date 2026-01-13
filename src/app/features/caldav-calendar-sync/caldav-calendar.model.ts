/**
 * Configuration for CalDAV calendar sync.
 * - When syncTodos is enabled, tasks are synced as VTODOs
 * - When a task is scheduled with a time, a VEVENT is created in the configured calendar
 */
export interface CaldavCalendarCfg {
  isEnabled: boolean;
  caldavUrl: string | null;
  calendarName: string | null;
  username: string | null;
  password: string | null;
  syncTodos: boolean; // Sync tasks as VTODOs to calendar
}

export const DEFAULT_CALDAV_CALENDAR_CFG: CaldavCalendarCfg = {
  isEnabled: false,
  caldavUrl: null,
  calendarName: null,
  username: null,
  password: null,
  syncTodos: false,
};

export interface CalendarEventData {
  uid: string;
  summary: string;
  start: number;
  end: number;
  description?: string;
}

export interface CalendarTodoData {
  uid: string;
  summary: string;
  description?: string;
  priority?: number; // 1-9, where 1 is highest
  dueDate?: number; // Due date timestamp
  percentComplete?: number; // 0-100
  status?: 'NEEDS-ACTION' | 'IN-PROCESS' | 'COMPLETED' | 'CANCELLED';
}
