import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { catchError, filter, map, mergeMap, withLatestFrom } from 'rxjs/operators';
import { EMPTY } from 'rxjs';
import { GlobalConfigService } from '../config/global-config.service';
import { CaldavCalendarService } from './caldav-calendar.service';
import { CaldavCalendarCfg, CalendarEventData } from './caldav-calendar.model';
import { Store } from '@ngrx/store';
import { TaskService } from '../tasks/task.service';
import { Log } from '../../core/log';

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000; // 1 hour default

@Injectable()
export class CaldavCalendarEffects {
  private _localActions$ = inject(LOCAL_ACTIONS);
  private _globalConfigService = inject(GlobalConfigService);
  private _caldavCalendarService = inject(CaldavCalendarService);
  private _store = inject(Store);
  private _taskService = inject(TaskService);

  /**
   * Helper to check if CalDAV calendar sync is enabled and valid
   */
  private _isEnabled(cfg: CaldavCalendarCfg | undefined): cfg is CaldavCalendarCfg {
    return (
      !!cfg &&
      cfg.isEnabled &&
      !!cfg.caldavUrl &&
      !!cfg.calendarName &&
      !!cfg.username &&
      !!cfg.password
    );
  }

  /**
   * Helper to check if VTODO sync is enabled
   */
  private _isTodoSyncEnabled(
    cfg: CaldavCalendarCfg | undefined,
  ): cfg is CaldavCalendarCfg {
    return this._isEnabled(cfg) && cfg.syncTodos === true;
  }

  /**
   * When a task is scheduled with a time, create a calendar event (VEVENT)
   */
  createEventOnSchedule$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(TaskSharedActions.scheduleTaskWithTime),
      withLatestFrom(this._globalConfigService.caldavCalendar$),
      filter(([_, cfg]) => this._isEnabled(cfg)),
      mergeMap(([{ task, dueWithTime }, cfg]) => {
        const eventData: CalendarEventData = {
          uid: `sp-task-${task.id}`,
          summary: task.title,
          start: dueWithTime,
          end: dueWithTime + (task.timeEstimate || DEFAULT_EVENT_DURATION_MS),
          description: task.notes || undefined,
        };

        return this._caldavCalendarService.createEvent$(cfg!, eventData).pipe(
          map((uid) =>
            TaskSharedActions.updateTask({
              task: {
                id: task.id,
                changes: {
                  calendarEventUid: uid,
                },
              },
              isIgnoreShortSyntax: true,
            }),
          ),
          catchError((err) => {
            console.error('CalDAV Calendar: Failed to create event', err);
            Log.err('CalDAV Calendar: Failed to create event', err);
            return EMPTY;
          }),
        );
      }),
    ),
  );

  /**
   * When a task is rescheduled, update the calendar event
   */
  updateEventOnReschedule$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.reScheduleTaskWithTime),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([_, cfg]) => this._isEnabled(cfg)),
        mergeMap(([{ task, dueWithTime }, cfg]) => {
          // If task doesn't have a calendar event yet, create one
          if (!task.calendarEventUid) {
            const eventData: CalendarEventData = {
              uid: `sp-task-${task.id}`,
              summary: task.title,
              start: dueWithTime,
              end: dueWithTime + (task.timeEstimate || DEFAULT_EVENT_DURATION_MS),
              description: task.notes || undefined,
            };

            return this._caldavCalendarService.createEvent$(cfg!, eventData).pipe(
              map((uid) =>
                this._store.dispatch(
                  TaskSharedActions.updateTask({
                    task: {
                      id: task.id,
                      changes: {
                        calendarEventUid: uid,
                      },
                    },
                    isIgnoreShortSyntax: true,
                  }),
                ),
              ),
              catchError((err) => {
                Log.err('CalDAV Calendar: Failed to create event on reschedule', err);
                return EMPTY;
              }),
            );
          }

          // Update existing event
          return this._caldavCalendarService
            .updateEvent$(cfg!, task.calendarEventUid, {
              start: dueWithTime,
              end: dueWithTime + (task.timeEstimate || DEFAULT_EVENT_DURATION_MS),
            })
            .pipe(
              catchError((err) => {
                Log.err('CalDAV Calendar: Failed to update event', err);
                return EMPTY;
              }),
            );
        }),
      ),
    { dispatch: false },
  );

  /**
   * When a task is unscheduled, delete the calendar event
   */
  deleteEventOnUnschedule$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.unscheduleTask),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([_, cfg]) => this._isEnabled(cfg)),
        mergeMap(([{ id }, cfg]) =>
          this._taskService.getByIdOnce$(id).pipe(
            filter((task) => !!task?.calendarEventUid),
            mergeMap((task) =>
              this._caldavCalendarService
                .deleteEvent$(cfg!, task!.calendarEventUid!)
                .pipe(
                  map(() =>
                    this._store.dispatch(
                      TaskSharedActions.updateTask({
                        task: {
                          id: id,
                          changes: {
                            calendarEventUid: null,
                          },
                        },
                        isIgnoreShortSyntax: true,
                      }),
                    ),
                  ),
                  catchError((err) => {
                    Log.err('CalDAV Calendar: Failed to delete event', err);
                    return EMPTY;
                  }),
                ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task is deleted, also delete its calendar event if it exists
   */
  deleteEventOnTaskDelete$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([{ task }, cfg]) => this._isEnabled(cfg) && !!task.calendarEventUid),
        mergeMap(([{ task }, cfg]) =>
          this._caldavCalendarService.deleteEvent$(cfg!, task.calendarEventUid!).pipe(
            catchError((err) => {
              Log.err('CalDAV Calendar: Failed to delete event on task delete', err);
              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task title is updated, update the calendar event summary
   */
  updateEventOnTitleChange$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => !!task.changes.title),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([_, cfg]) => this._isEnabled(cfg)),
        mergeMap(([{ task }, cfg]) =>
          this._taskService.getByIdOnce$(task.id as string).pipe(
            filter((fullTask) => !!fullTask?.calendarEventUid),
            mergeMap((fullTask) =>
              this._caldavCalendarService
                .updateEvent$(cfg!, fullTask!.calendarEventUid!, {
                  summary: task.changes.title as string,
                })
                .pipe(
                  catchError((err) => {
                    Log.err('CalDAV Calendar: Failed to update event title', err);
                    return EMPTY;
                  }),
                ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task is marked as done, optionally delete the calendar event
   * (keeps the calendar clean from completed tasks)
   */
  deleteEventOnTaskDone$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([_, cfg]) => this._isEnabled(cfg)),
        mergeMap(([{ task }, cfg]) =>
          this._taskService.getByIdOnce$(task.id as string).pipe(
            filter((fullTask) => !!fullTask?.calendarEventUid),
            mergeMap((fullTask) =>
              this._caldavCalendarService
                .deleteEvent$(cfg!, fullTask!.calendarEventUid!)
                .pipe(
                  map(() =>
                    this._store.dispatch(
                      TaskSharedActions.updateTask({
                        task: {
                          id: task.id as string,
                          changes: {
                            calendarEventUid: null,
                          },
                        },
                        isIgnoreShortSyntax: true,
                      }),
                    ),
                  ),
                  catchError((err) => {
                    Log.err('CalDAV Calendar: Failed to delete event on task done', err);
                    return EMPTY;
                  }),
                ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  // ==================== Task Sync Effects (creates VEVENTs for tasks) ====================

  /**
   * When a task is created, create a VEVENT (if syncTodos is enabled)
   * Creates an event with a default time slot (next full hour, 1 hour duration)
   * User can adjust times in their calendar app, changes sync back to SP
   * Only syncs main tasks, not subtasks
   */
  createEventOnAddTask$ = createEffect(() =>
    this._localActions$.pipe(
      ofType(TaskSharedActions.addTask),
      withLatestFrom(this._globalConfigService.caldavCalendar$),
      filter(([{ task }, cfg]) => this._isTodoSyncEnabled(cfg) && !task.parentId),
      mergeMap(([{ task }, cfg]) => {
        // Default: next full hour, 1 hour duration (or use task's time estimate)
        const now = Date.now();
        const nextHour = new Date(now);
        nextHour.setMinutes(0, 0, 0);
        nextHour.setHours(nextHour.getHours() + 1);
        const startTime = nextHour.getTime();
        const duration = task.timeEstimate || DEFAULT_EVENT_DURATION_MS;

        const eventData: CalendarEventData = {
          uid: `sp-task-${task.id}`,
          summary: task.title,
          start: startTime,
          end: startTime + duration,
          description: task.notes || undefined,
        };

        return this._caldavCalendarService.createEvent$(cfg!, eventData).pipe(
          map((uid) =>
            TaskSharedActions.updateTask({
              task: {
                id: task.id,
                changes: {
                  calendarEventUid: uid,
                  dueWithTime: startTime,
                },
              },
              isIgnoreShortSyntax: true,
            }),
          ),
          catchError((err) => {
            Log.err('CalDAV Calendar: Failed to create event for task', err);
            return EMPTY;
          }),
        );
      }),
    ),
  );

  /**
   * When a task title is updated, update the synced event summary
   */
  updateSyncedEventOnTitleChange$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => !!task.changes.title),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([_, cfg]) => this._isTodoSyncEnabled(cfg)),
        mergeMap(([{ task }, cfg]) =>
          this._taskService.getByIdOnce$(task.id as string).pipe(
            filter(
              (fullTask) =>
                !!fullTask?.calendarEventUid &&
                fullTask.calendarEventUid.startsWith('sp-task-'),
            ),
            mergeMap((fullTask) =>
              this._caldavCalendarService
                .updateEvent$(cfg!, fullTask!.calendarEventUid!, {
                  summary: task.changes.title as string,
                })
                .pipe(
                  catchError((err) => {
                    Log.err('CalDAV Calendar: Failed to update event title', err);
                    return EMPTY;
                  }),
                ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task is marked as done, delete the synced calendar event
   */
  deleteSyncedEventOnTaskDone$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(([_, cfg]) => this._isTodoSyncEnabled(cfg)),
        mergeMap(([{ task }, cfg]) =>
          this._taskService.getByIdOnce$(task.id as string).pipe(
            filter(
              (fullTask) =>
                !!fullTask?.calendarEventUid &&
                fullTask.calendarEventUid.startsWith('sp-task-'),
            ),
            mergeMap((fullTask) =>
              this._caldavCalendarService
                .deleteEvent$(cfg!, fullTask!.calendarEventUid!)
                .pipe(
                  map(() =>
                    this._store.dispatch(
                      TaskSharedActions.updateTask({
                        task: {
                          id: task.id as string,
                          changes: {
                            calendarEventUid: null,
                          },
                        },
                        isIgnoreShortSyntax: true,
                      }),
                    ),
                  ),
                  catchError((err) => {
                    Log.err('CalDAV Calendar: Failed to delete event on task done', err);
                    return EMPTY;
                  }),
                ),
            ),
          ),
        ),
      ),
    { dispatch: false },
  );

  /**
   * When a task is deleted, delete the synced calendar event
   */
  deleteSyncedEventOnTaskDelete$ = createEffect(
    () =>
      this._localActions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        withLatestFrom(this._globalConfigService.caldavCalendar$),
        filter(
          ([{ task }, cfg]) =>
            this._isTodoSyncEnabled(cfg) &&
            !!task.calendarEventUid &&
            task.calendarEventUid.startsWith('sp-task-'),
        ),
        mergeMap(([{ task }, cfg]) =>
          this._caldavCalendarService.deleteEvent$(cfg!, task.calendarEventUid!).pipe(
            catchError((err) => {
              Log.err('CalDAV Calendar: Failed to delete synced event', err);
              return EMPTY;
            }),
          ),
        ),
      ),
    { dispatch: false },
  );
}
