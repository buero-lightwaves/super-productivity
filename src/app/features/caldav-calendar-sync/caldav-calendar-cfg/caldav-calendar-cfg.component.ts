import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CaldavCalendarCfg, DEFAULT_CALDAV_CALENDAR_CFG } from '../caldav-calendar.model';
import { CaldavCalendarService } from '../caldav-calendar.service';
import { SnackService } from '../../../core/snack/snack.service';
import {
  ConfigFormSection,
  GlobalConfigSectionKey,
} from '../../config/global-config.model';

@Component({
  selector: 'caldav-calendar-cfg',
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="caldav-calendar-cfg">
      <mat-slide-toggle
        [(ngModel)]="localCfg.isEnabled"
        (ngModelChange)="onSave()"
      >
        Enable CalDAV Calendar Sync
      </mat-slide-toggle>

      @if (localCfg.isEnabled) {
        <mat-form-field appearance="outline">
          <mat-label>CalDAV Server URL</mat-label>
          <input
            matInput
            [(ngModel)]="localCfg.caldavUrl"
            (blur)="onSave()"
          />
          <mat-hint>e.g., https://calendar.example.com/dav.php</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Calendar Name</mat-label>
          <input
            matInput
            [(ngModel)]="localCfg.calendarName"
            (blur)="onSave()"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Username</mat-label>
          <input
            matInput
            [(ngModel)]="localCfg.username"
            (blur)="onSave()"
          />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Password</mat-label>
          <input
            matInput
            type="password"
            [(ngModel)]="localCfg.password"
            (blur)="onSave()"
          />
        </mat-form-field>

        <div class="test-connection-row">
          <button
            mat-raised-button
            color="primary"
            (click)="testConnection()"
            [disabled]="isTesting()"
          >
            @if (isTesting()) {
              <mat-spinner diameter="20"></mat-spinner>
            } @else {
              <mat-icon>wifi_tethering</mat-icon>
            }
            Test Connection
          </button>

          @if (testResult()) {
            <span
              class="test-result"
              [class.success]="testResult()?.success && !testResult()?.error"
              [class.warning]="testResult()?.success && testResult()?.error"
              [class.error]="!testResult()?.success"
            >
              @if (testResult()?.success && !testResult()?.error) {
                <mat-icon>check_circle</mat-icon>
                Connected! Calendars: {{ testResult()?.calendars?.join(', ') }}
              } @else if (testResult()?.success && testResult()?.error) {
                <mat-icon>warning</mat-icon>
                {{ testResult()?.error }}
              } @else {
                <mat-icon>error</mat-icon>
                {{
                  testResult()?.error ||
                    'Connection failed - check browser console for details'
                }}
              }
            </span>
          }
        </div>

        <div class="sync-options">
          <h4>Sync Options</h4>
          <mat-slide-toggle
            [(ngModel)]="localCfg.syncTodos"
            (ngModelChange)="onSave()"
          >
            Sync tasks as VTODOs
          </mat-slide-toggle>
          <p class="hint">
            When enabled, tasks will appear as todos in your calendar app. You can drag
            them to timeslots to create timeboxed events.
          </p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .caldav-calendar-cfg {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px 0;
      }

      mat-form-field {
        width: 100%;
      }

      .test-connection-row {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
      }

      .test-result {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .test-result.success {
        color: #4caf50;
      }

      .test-result.error {
        color: #f44336;
      }

      button mat-spinner {
        display: inline-block;
        margin-right: 8px;
      }

      button mat-icon {
        margin-right: 8px;
      }

      .sync-options {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(128, 128, 128, 0.3);
      }

      .sync-options h4 {
        margin: 0 0 12px 0;
        font-weight: 500;
      }

      .sync-options .hint {
        margin: 8px 0 0 0;
        font-size: 12px;
        color: rgba(128, 128, 128, 0.8);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CaldavCalendarCfgComponent {
  private readonly _caldavService = inject(CaldavCalendarService);
  private readonly _snackService = inject(SnackService);

  @Input() section?: ConfigFormSection<CaldavCalendarCfg>;

  localCfg: CaldavCalendarCfg = { ...DEFAULT_CALDAV_CALENDAR_CFG };

  // This is set by config-section.component.ts
  // Need deep copy because NgRx store provides frozen objects
  @Input() set cfg(v: CaldavCalendarCfg) {
    if (v) {
      this.localCfg = {
        isEnabled: v.isEnabled,
        caldavUrl: v.caldavUrl,
        calendarName: v.calendarName,
        username: v.username,
        password: v.password,
        syncTodos: v.syncTodos ?? false,
      };
    }
  }

  readonly save = output<{
    sectionKey: GlobalConfigSectionKey;
    config: CaldavCalendarCfg;
  }>();

  isTesting = signal(false);
  testResult = signal<{ success: boolean; calendars?: string[]; error?: string } | null>(
    null,
  );

  async testConnection(): Promise<void> {
    this.isTesting.set(true);
    this.testResult.set(null);

    try {
      const result = await this._caldavService.testConnection(this.localCfg);
      this.testResult.set(result);

      if (result.success && !result.error) {
        this._snackService.open({
          type: 'SUCCESS',
          msg: 'Connection successful!',
        });
      } else if (result.success && result.error) {
        this._snackService.open({
          type: 'CUSTOM',
          msg: result.error,
          ico: 'warning',
        });
      }
    } catch (err) {
      this.testResult.set({
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.isTesting.set(false);
    }
  }

  onSave(): void {
    this.save.emit({
      sectionKey: 'caldavCalendar',
      config: this.localCfg,
    });
  }
}
