import { FileImexComponent } from '../../imex/file-imex/file-imex.component';
import { SimpleCounterCfgComponent } from '../simple-counter/simple-counter-cfg/simple-counter-cfg.component';
import { CustomCfgSection } from './global-config.model';
import { ClickUpAdditionalCfgComponent } from '../issue/providers/clickup/clickup-view-components/clickup-cfg/clickup-additional-cfg.component';
import { CaldavCalendarCfgComponent } from '../caldav-calendar-sync/caldav-calendar-cfg/caldav-calendar-cfg.component';

export const customConfigFormSectionComponent = (
  customSection: CustomCfgSection,
): unknown => {
  switch (customSection) {
    case 'FILE_IMPORT_EXPORT':
      return FileImexComponent;

    case 'SIMPLE_COUNTER_CFG':
      return SimpleCounterCfgComponent;

    case 'CLICKUP_CFG':
      return ClickUpAdditionalCfgComponent;

    case 'CALDAV_CALENDAR_CFG':
      return CaldavCalendarCfgComponent;

    default:
      throw new Error('Invalid component');
  }
};
