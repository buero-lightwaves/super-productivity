import { CaldavCalendarConfig, ConfigFormSection } from '../global-config.model';

export const CALDAV_CALENDAR_FORM_CFG: ConfigFormSection<CaldavCalendarConfig> = {
  title: 'CalDAV Calendar Sync',
  help: 'Sync scheduled tasks to a CalDAV calendar as events. When you schedule a task with a time, a calendar event (VEVENT) is created in your CalDAV calendar.',
  key: 'caldavCalendar',
  customSection: 'CALDAV_CALENDAR_CFG',
};
